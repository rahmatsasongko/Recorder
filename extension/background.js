// Background service worker — owns the recording session.
// A session holds a Test Suite made of many Scenarios; each scenario has steps.

// Keep in sync with lib/gen-core.js and content/player.js — same rule for
// "does this upload get swapped for the bundled fixture", just applied here
// at record time instead of at generate/play time.
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i;

const DEFAULT_SESSION = {
  active: false,
  paused: false,
  tabId: null,
  projectName: "MyProject",
  suiteName: "My Suite",
  targetUrl: "",
  startTime: null,
  pausedAccum: 0,
  pausedAt: null,
  lastUrl: null,
  scenarios: [], // [{ id, name, steps: [], saved }]
  recordingIndex: -1,
  hasIframes: false // set by content.js when the recorded page has iframes we can't instrument
};

// chrome.storage.local.set() can fail silently (e.g. QUOTA_BYTES_PER_ITEM /
// QUOTA_BYTES exceeded on a very large session) — chrome.runtime.lastError is
// the only signal, and it's easy to lose if nobody checks it. Every write in
// this file goes through here so a full storage means a visible error
// response instead of quietly-lost steps.
function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "storage error"));
        return;
      }
      resolve();
    });
  });
}

const DEFAULT_PLAYBACK = {
  active: false,
  status: "idle", // idle | running | passed | failed | stopped
  tabId: null,
  mode: "one", // one | all
  plan: [], // ordered scenario indices being played
  queue: [], // scenario indices still to run
  scenarioIndex: -1,
  stepIndex: 0,
  startedAt: null,
  finishedAt: null,
  results: [] // [{ scenarioIndex, stepIndex, action, name, status, message, ms }]
};

let playGen = 0; // bumped on every start/stop so a stale loop can bail
let ticking = false;
// The generation of a run that was requested while another loop was still on
// the stack. The multi-suite queue starts the next suite from inside
// finishPlayback() — while the previous suite's loop is still unwinding — and
// that runPlayback() call used to be thrown away by the `ticking` guard. The
// new run then sat marked active with nobody driving it, until something
// happened to poll PLAY_STATE (only the popup does, and it closes the moment
// the played tab takes focus). runPlayback() now remembers the request and
// honours it once the current loop is done.
let pendingRun = null;

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || { ...DEFAULT_SESSION };
}

// What the on-page overlay polls twice a second: enough to draw the timer and
// the step counter without reading — or shipping back — every scenario and
// step of the session. Written in the same set() as `session`, so the two
// can never disagree.
function metaOf(session) {
  const sc = (session.scenarios || [])[session.recordingIndex];
  return {
    active: !!session.active,
    paused: !!session.paused,
    tabId: session.tabId == null ? null : session.tabId,
    startTime: session.startTime || null,
    pausedAccum: session.pausedAccum || 0,
    pausedAt: session.pausedAt || null,
    stepCount: sc ? (sc.steps || []).length : 0
  };
}

async function setSession(session) {
  await storageSet({ session, sessionMeta: metaOf(session) });
  return session;
}

async function overlayState(sender) {
  let { sessionMeta: meta } = await chrome.storage.local.get("sessionMeta");
  // Storage written before this key existed: derive it from the session.
  if (!meta) meta = metaOf(await getSession());
  const isThisTab = !!(sender.tab && meta.tabId === sender.tab.id);
  return {
    active: meta.active,
    paused: meta.paused,
    isThisTab,
    recording: meta.active && !meta.paused && (isThisTab || !sender.tab),
    startTime: meta.startTime,
    pausedAccum: meta.pausedAccum,
    pausedAt: meta.pausedAt,
    stepCount: meta.stepCount
  };
}

async function getPlayback() {
  const { playback } = await chrome.storage.local.get("playback");
  return playback || { ...DEFAULT_PLAYBACK };
}

async function setPlayback(playback) {
  await storageSet({ playback });
  return playback;
}

// Tracks a "play every suite" run across suite switches. Lives in storage
// (not a popup-side variable) so the chain survives the popup closing —
// which Chrome does the moment the recorded tab takes focus — exactly like
// single-suite playback already survives it via `playback` + runPlayback().
async function getSuiteQueue() {
  const { suitePlayQueue } = await chrome.storage.local.get("suitePlayQueue");
  return suitePlayQueue || null;
}

async function setSuiteQueue(queue) {
  await storageSet({ suitePlayQueue: queue });
  return queue;
}

// The suite library — every suite the user has started or switched away
// from, so opening a new one never silently discards the last one.
// Each entry is a persisted snapshot: { id, projectName, suiteName,
// targetUrl, scenarios, updatedAt }. Runtime-only fields (active, tabId,
// recordingIndex, ...) live solely on `session`, which always mirrors
// whichever suite (if any) is currently open — tracked by `activeSuiteId`.

async function getSuites() {
  const { suites } = await chrome.storage.local.get("suites");
  return Array.isArray(suites) ? suites : [];
}

async function setSuites(suites) {
  await storageSet({ suites });
  return suites;
}

async function getActiveSuiteId() {
  const { activeSuiteId } = await chrome.storage.local.get("activeSuiteId");
  return activeSuiteId || null;
}

async function setActiveSuiteId(id) {
  await storageSet({ activeSuiteId: id || null });
}

// Upserts the current session's suite fields into the library under
// activeSuiteId. No-op while nothing is tracked (e.g. before the first
// suite is ever created). Call this before replacing/leaving `session` so
// in-progress work is never lost.
async function syncActiveSuite(session) {
  const activeId = await getActiveSuiteId();
  if (!activeId) return;
  const suites = await getSuites();
  const idx = suites.findIndex((s) => s.id === activeId);
  const snapshot = {
    id: activeId,
    projectName: session.projectName,
    suiteName: session.suiteName,
    targetUrl: session.targetUrl,
    scenarios: session.scenarios,
    updatedAt: Date.now()
  };
  if (idx === -1) suites.push(snapshot);
  else suites[idx] = snapshot;
  await setSuites(suites);
}

// Loads suite `id` as the active session. Shared by the SWITCH_SUITE message
// handler and the multi-suite play queue (which switches suites itself
// between runs, entirely inside the service worker).
async function doSwitchSuite(id) {
  const session = await getSession();
  const activeIdNow = await getActiveSuiteId();
  if (id && id === activeIdNow) {
    // Already open — nothing to do (and re-reading it below would clobber
    // unsaved edits with the last-synced snapshot).
    return { ok: true };
  }
  const suites = await getSuites();
  const target = suites.find((s) => s.id === id);
  if (!target) {
    return { ok: false, reason: "suite not found" };
  }
  playGen++;
  if (session.active && session.tabId != null) {
    await notifyTab(session.tabId, { type: "STATE_CHANGED", recording: false });
  }
  // Save the suite being left before swapping it out.
  await syncActiveSuite(session);

  const loaded = {
    ...DEFAULT_SESSION,
    projectName: target.projectName,
    suiteName: target.suiteName,
    targetUrl: target.targetUrl,
    scenarios: target.scenarios || [],
    recordingIndex: -1
  };
  await setActiveSuiteId(target.id);
  await setSession(loaded);
  await storageSet({
    playback: { ...DEFAULT_PLAYBACK },
    lastPlay: {}
  });
  return { ok: true };
}

// Starts playback for the CURRENT active session. Shared by the PLAY_START
// message handler (fresh, single-suite request from the popup — clears any
// leftover suite queue) and the multi-suite play queue (fromQueue: true —
// the queue itself owns starting one suite after another).
async function doPlayStart(mode, index, opts) {
  opts = opts || {};
  const session = await getSession();
  const scenarios = session.scenarios || [];
  const m = mode === "all" ? "all" : "one";

  let order;
  if (m === "all") {
    order = scenarios.map((s, i) => i).filter((i) => (scenarios[i].steps || []).length);
  } else {
    const i = index;
    if (i == null || !scenarios[i] || !(scenarios[i].steps || []).length) {
      return { ok: false, reason: "no steps to play" };
    }
    order = [i];
  }
  if (!order.length) {
    return { ok: false, reason: "nothing to play" };
  }

  if (!opts.fromQueue) await setSuiteQueue(null);

  playGen++;
  const myGen = playGen;

  let tabId = session.tabId;
  if (tabId != null) {
    try {
      await chrome.tabs.get(tabId);
    } catch (e) {
      tabId = null;
    }
  }
  const startUrl = firstUrlOf(scenarios[order[0]]) || session.targetUrl;
  if (tabId == null) {
    const tab = await chrome.tabs.create({ url: startUrl || "about:blank" });
    tabId = tab.id;
  }

  const pb = {
    ...DEFAULT_PLAYBACK,
    active: true,
    status: "running",
    tabId,
    mode: m,
    plan: order.slice(),
    queue: order.slice(1),
    scenarioIndex: order[0],
    stepIndex: 0,
    startedAt: Date.now(),
    finishedAt: null,
    results: []
  };
  await setPlayback(pb);

  // runPlayback() flips `ticking` synchronously, so PLAY_STATE polls that
  // arrive during the first navigation won't spawn a second loop.
  runPlayback(myGen);
  return { ok: true };
}

// Advances the multi-suite play queue to `idx`: switches to that suite and
// starts its own "play all" run. On failure to switch or start, records an
// error entry and tries the next suite instead of stalling the whole chain.
async function beginSuiteQueueEntry(idx) {
  const q = await getSuiteQueue();
  if (!q || !q.active) return false;
  if (idx >= q.entries.length) {
    q.active = false;
    await setSuiteQueue(q);
    return false;
  }
  const entry = q.entries[idx];
  const switched = await doSwitchSuite(entry.id);
  if (switched.ok) {
    const started = await doPlayStart("all", null, { fromQueue: true });
    if (started.ok) {
      q.idx = idx;
      await setSuiteQueue(q);
      return true;
    }
  }
  q.summaries.push({ name: entry.name, status: "error", passed: 0, failed: 0, skipped: 0, total: 0 });
  q.idx = idx + 1;
  await setSuiteQueue(q);
  return beginSuiteQueueEntry(idx + 1);
}

// Records the just-finished suite's result into the active queue and either
// chains into the next suite (natural completion) or ends the queue (an
// explicit Stop, or the tab having been closed).
async function settleSuiteQueueEntry(pb, chainNext) {
  const q = await getSuiteQueue();
  if (!q || !q.active) return;
  const entry = q.entries[q.idx];
  const results = pb.results || [];
  q.summaries.push({
    name: entry ? entry.name : "suite",
    status: pb.status,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    total: results.length
  });
  const nextIdx = q.idx + 1;
  if (chainNext && nextIdx < q.entries.length) {
    await setSuiteQueue(q);
    await beginSuiteQueueEntry(nextIdx);
  } else {
    q.active = false;
    await setSuiteQueue(q);
  }
}

function newSuiteId() {
  return "suite-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

function stepId(n) {
  return "step-" + String(n + 1).padStart(3, "0");
}

function newScenario(name, count) {
  return {
    id: "sc-" + Date.now().toString(36),
    name: name || "Scenario " + (count + 1),
    steps: [],
    saved: false
  };
}

// Tells the recorded tab something and does not care about an answer. Bounded
// on purpose: handlers run one at a time (see serialize), so a tab that never
// replies — a page stuck in a script loop — must not hold every later message
// hostage with it. Gone, not ready or slow all just mean "skip".
async function notifyTab(tabId, msg) {
  try {
    await sendToTab(tabId, msg, 2000);
  } catch (e) {
    /* tab gone / content script not ready / not answering */
  }
}

async function broadcastState() {
  const session = await getSession();
  const recording = session.active && !session.paused;
  if (session.tabId == null) return;
  await notifyTab(session.tabId, { type: "STATE_CHANGED", recording });
}

async function ensureRecordingTab(session) {
  // Reuse the existing tab if it still exists — the browser is NOT closed
  // between scenarios.
  if (session.tabId != null) {
    try {
      await chrome.tabs.get(session.tabId);
      await chrome.tabs.update(session.tabId, {
        url: session.targetUrl,
        active: true
      });
      return session.tabId;
    } catch (e) {
      /* tab gone — fall through and create */
    }
  }
  const tab = await chrome.tabs.create({ url: session.targetUrl });
  return tab.id;
}

// Nearly every handler is a read-modify-write of chrome.storage.local: read
// `session`, change it, write the whole object back. Two of those running at
// once lose data — both read the same snapshot and the later write discards
// the earlier one. content.js sends `type` and then `keydown` back to back,
// and a Stop from the on-page overlay right after the last ADD_STEP has the
// same shape (either write can undo the other: the step goes missing, or the
// Stop is reverted). So handlers run strictly one at a time, in the order
// they arrived.
//
// Only top-level entry points may call serialize(): a task that waited on
// another serialize()d task would wait on itself.
let taskQueue = Promise.resolve();
function serialize(task) {
  const run = taskQueue.then(task);
  taskQueue = run.catch(() => {}); // a failed task must not wedge the queue
  return run;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Read-only and polled twice a second — no reason to make it wait behind a
  // burst of writes, and it reads its own small key, not the whole session.
  if (msg && msg.type === "OVERLAY_STATE") {
    overlayState(sender).then(sendResponse, () => sendResponse(null));
    return true;
  }
  serialize(async () => {
    try {
      await handleMessage(msg, sender, sendResponse);
    } catch (e) {
      // Most commonly a full/broken chrome.storage.local (see storageSet) —
      // surface it instead of leaving the popup waiting on a response that
      // will never come.
      sendResponse({ ok: false, reason: "storage_error", message: String((e && e.message) || e) });
    }
  });
  return true;
});

async function handleMessage(msg, sender, sendResponse) {
    const session = await getSession();

    switch (msg.type) {
      case "GET_STATE": {
        const isThisTab = !!(sender.tab && session.tabId === sender.tab.id);
        sendResponse({
          ...session,
          recording:
            session.active && !session.paused && (isThisTab || !sender.tab),
          // Distinct from `recording` (which is also false while paused) —
          // content.js's on-page overlay needs to know "is this the recorded
          // tab" independently of pause state, so a paused recording still
          // shows its controls only on the right tab.
          isThisTab
        });
        return;
      }

      case "START": {
        // Preserve whatever suite was already open — starting a new one
        // must never silently discard it.
        await syncActiveSuite(session);

        const fresh = {
          ...DEFAULT_SESSION,
          active: true,
          paused: false,
          projectName: msg.projectName || "MyProject",
          suiteName: msg.suiteName || "My Suite",
          targetUrl: msg.targetUrl || "",
          startTime: Date.now(),
          scenarios: [newScenario(msg.scenarioName, 0)],
          recordingIndex: 0
        };
        await setActiveSuiteId(newSuiteId());
        await setSession(fresh);
        fresh.tabId = await ensureRecordingTab(fresh);
        await setSession(fresh);
        await syncActiveSuite(fresh);
        await broadcastState();
        sendResponse({ ok: true });
        return;
      }

      case "LIST_SUITES": {
        // Bring the active suite's entry fully up to date first (covers
        // steps recorded since the last mutation-triggered sync) so every
        // suite — including the one you're mid-recording — shows correctly
        // the moment you open "All suites".
        await syncActiveSuite(session);
        const suites = await getSuites();
        const activeId = await getActiveSuiteId();
        sendResponse({
          ok: true,
          activeSuiteId: activeId,
          suites: suites
            .slice()
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .map((s) => ({
              id: s.id,
              projectName: s.projectName,
              suiteName: s.suiteName,
              targetUrl: s.targetUrl,
              scenarioCount: (s.scenarios || []).length,
              updatedAt: s.updatedAt || 0
            }))
        });
        return;
      }

      case "EXPORT_ALL_SUITES": {
        // Full snapshots (scenarios included), not the summaries LIST_SUITES
        // returns — this is what gets written to the bundle file.
        await syncActiveSuite(session);
        const suites = await getSuites();
        sendResponse({
          ok: true,
          suites: suites.map((s) => ({
            id: s.id,
            projectName: s.projectName,
            suiteName: s.suiteName,
            targetUrl: s.targetUrl,
            scenarios: s.scenarios || []
          }))
        });
        return;
      }

      case "IMPORT_ALL_SUITES": {
        // Purely additive: every suite in the bundle is added to the
        // library as a new entry (fresh id, so it can never collide with
        // one already here). Whatever is currently open is left alone.
        const raw = Array.isArray(msg.suites) ? msg.suites : null;
        if (!raw) {
          sendResponse({ ok: false, reason: "bukan file bundle suite yang valid" });
          return;
        }
        const str = (v, d) => (typeof v === "string" && v ? v : d);
        const suites = await getSuites();
        // Import used to always create a new suite even when one with the
        // exact same name already existed, so importing the same bundle
        // twice (or a bundle sharing names with what's already here) left
        // ambiguous duplicates in the library with no way to tell them
        // apart. Auto-suffix instead — the data still gets in, just under a
        // name that's unique.
        const uniqueSuiteName = (name) => {
          const taken = new Set(suites.map((s) => (s.suiteName || "").trim().toLowerCase()));
          if (!taken.has(name.trim().toLowerCase())) return name;
          let n = 2;
          while (taken.has((name + " (" + n + ")").trim().toLowerCase())) n++;
          return name + " (" + n + ")";
        };
        let added = 0;
        for (const rawSuite of raw) {
          const rs = rawSuite && typeof rawSuite === "object" ? rawSuite : {};
          if (!Array.isArray(rs.scenarios)) continue;
          const scenarios = rs.scenarios.map((sc, i) => {
            sc = sc && typeof sc === "object" ? sc : {};
            const steps = Array.isArray(sc.steps) ? sc.steps.filter(Boolean) : [];
            return {
              id: str(sc.id, "sc-" + Date.now().toString(36) + "-" + i),
              name: str(sc.name, "Scenario " + (i + 1)),
              saved: !!sc.saved,
              steps: steps.map((st, k) => ({ ...st, id: str(st.id, stepId(k)) }))
            };
          });
          suites.push({
            id: newSuiteId(),
            projectName: str(rs.projectName, "MyProject"),
            suiteName: uniqueSuiteName(str(rs.suiteName, "Imported Suite " + (added + 1))),
            targetUrl: str(rs.targetUrl, ""),
            scenarios,
            updatedAt: Date.now()
          });
          added++;
        }
        if (!added) {
          sendResponse({ ok: false, reason: "tidak ada suite yang valid di file ini" });
          return;
        }
        await setSuites(suites);
        sendResponse({ ok: true, added });
        return;
      }

      case "SWITCH_SUITE": {
        const res = await doSwitchSuite(msg.id);
        sendResponse(res);
        return;
      }

      case "DELETE_SUITE": {
        const suites = await getSuites();
        const idx = suites.findIndex((s) => s.id === msg.id);
        if (idx === -1) {
          sendResponse({ ok: false, reason: "not found" });
          return;
        }
        suites.splice(idx, 1);
        await setSuites(suites);

        const activeId = await getActiveSuiteId();
        if (activeId === msg.id) {
          playGen++;
          if (session.active && session.tabId != null) {
            await notifyTab(session.tabId, { type: "STATE_CHANGED", recording: false });
          }
          await setActiveSuiteId(null);
          await setSession({ ...DEFAULT_SESSION });
          await storageSet({
            playback: { ...DEFAULT_PLAYBACK },
            lastPlay: {}
          });
        }
        sendResponse({ ok: true });
        return;
      }

      case "ADD_SCENARIO": {
        if (!session.scenarios.length) {
          sendResponse({ ok: false, reason: "no session" });
          return;
        }
        session.scenarios.push(newScenario(msg.scenarioName, session.scenarios.length));
        session.recordingIndex = session.scenarios.length - 1;
        session.active = true;
        session.paused = false;
        session.startTime = Date.now();
        session.pausedAccum = 0;
        session.pausedAt = null;
        session.lastUrl = null;
        await setSession(session);
        session.tabId = await ensureRecordingTab(session);
        await setSession(session);
        await syncActiveSuite(session);
        await broadcastState();
        sendResponse({ ok: true, index: session.recordingIndex });
        return;
      }

      case "RECORD_SCENARIO": {
        // Re-open recording for an existing scenario (append more steps).
        const idx = msg.index;
        if (idx == null || !session.scenarios[idx]) {
          sendResponse({ ok: false, reason: "bad index" });
          return;
        }
        session.recordingIndex = idx;
        session.active = true;
        session.paused = false;
        session.startTime = Date.now();
        session.pausedAccum = 0;
        session.pausedAt = null;
        session.lastUrl = null;
        await setSession(session);
        session.tabId = await ensureRecordingTab(session);
        await setSession(session);
        await syncActiveSuite(session);
        await broadcastState();
        sendResponse({ ok: true });
        return;
      }

      case "PAUSE": {
        if (session.active && !session.paused) {
          session.paused = true;
          session.pausedAt = Date.now();
          await setSession(session);
          await broadcastState();
        }
        sendResponse({ ok: true });
        return;
      }

      case "RESUME": {
        if (session.active && session.paused) {
          session.pausedAccum += Date.now() - (session.pausedAt || Date.now());
          session.paused = false;
          session.pausedAt = null;
          await setSession(session);
          await broadcastState();
        }
        sendResponse({ ok: true });
        return;
      }

      case "STOP": {
        session.active = false;
        session.paused = false;
        await setSession(session);
        await syncActiveSuite(session);
        await broadcastState();
        sendResponse({ ok: true });
        return;
      }

      case "SAVE_SCENARIO": {
        const idx = msg.index;
        if (session.scenarios[idx]) {
          if (typeof msg.name === "string" && msg.name.trim())
            session.scenarios[idx].name = msg.name.trim();
          session.scenarios[idx].saved = true;
          await setSession(session);
          await syncActiveSuite(session);
        }
        sendResponse({ ok: true });
        return;
      }

      case "UPDATE_SCENARIO": {
        const idx = msg.index;
        if (session.scenarios[idx]) {
          if (Array.isArray(msg.steps)) session.scenarios[idx].steps = msg.steps;
          if (typeof msg.name === "string") session.scenarios[idx].name = msg.name;
          await setSession(session);
          await syncActiveSuite(session);
        }
        sendResponse({ ok: true });
        return;
      }

      case "DELETE_SCENARIO": {
        const idx = msg.index;
        if (session.scenarios[idx]) {
          session.scenarios.splice(idx, 1);
          if (session.recordingIndex >= session.scenarios.length)
            session.recordingIndex = session.scenarios.length - 1;
          await setSession(session);
          await syncActiveSuite(session);
        }
        sendResponse({ ok: true });
        return;
      }

      case "SET_META": {
        if (typeof msg.projectName === "string") session.projectName = msg.projectName;
        if (typeof msg.suiteName === "string") session.suiteName = msg.suiteName;
        if (typeof msg.targetUrl === "string") session.targetUrl = msg.targetUrl;
        await setSession(session);
        await syncActiveSuite(session);
        sendResponse({ ok: true });
        return;
      }

      case "RESET": {
        playGen++;
        // Discards only the in-progress working session — anything already
        // saved to the suite library (see syncActiveSuite) is untouched and
        // can still be reopened from "All suites".
        await setActiveSuiteId(null);
        await setSession({ ...DEFAULT_SESSION });
        await storageSet({
          playback: { ...DEFAULT_PLAYBACK },
          lastPlay: {},
          suitePlayQueue: null
        });
        sendResponse({ ok: true });
        return;
      }

      case "IMPORT_SESSION": {
        // Replace the whole session with a previously exported one. Any
        // recording / playback state is dropped — the import is inert until
        // the user plays or records again.
        const raw = msg.session;
        if (!raw || typeof raw !== "object" || !Array.isArray(raw.scenarios)) {
          sendResponse({ ok: false, reason: "bukan file session Recorder" });
          return;
        }
        playGen++;
        // Tell a still-live recording tab to stop before we drop the session.
        if (session.active && session.tabId != null) {
          await notifyTab(session.tabId, { type: "STATE_CHANGED", recording: false });
        }
        // Preserve whatever suite was already open before replacing it.
        await syncActiveSuite(session);
        const str = (v, d) => (typeof v === "string" && v ? v : d);
        const imported = {
          ...DEFAULT_SESSION,
          projectName: str(raw.projectName, DEFAULT_SESSION.projectName),
          suiteName: str(raw.suiteName, DEFAULT_SESSION.suiteName),
          targetUrl: str(raw.targetUrl, ""),
          scenarios: raw.scenarios.map((sc, i) => {
            sc = sc && typeof sc === "object" ? sc : {};
            const steps = Array.isArray(sc.steps) ? sc.steps.filter(Boolean) : [];
            return {
              id: str(sc.id, "sc-" + Date.now().toString(36) + "-" + i),
              name: str(sc.name, "Scenario " + (i + 1)),
              saved: !!sc.saved,
              steps: steps.map((st, k) => ({
                ...st,
                id: str(st.id, stepId(k))
              }))
            };
          }),
          recordingIndex: -1
        };
        await setActiveSuiteId(newSuiteId());
        await setSession(imported);
        await syncActiveSuite(imported);
        await storageSet({
          playback: { ...DEFAULT_PLAYBACK },
          lastPlay: {}
        });
        sendResponse({
          ok: true,
          suiteName: imported.suiteName,
          scenarios: imported.scenarios.length
        });
        return;
      }

      /* ----------------------------- playback ----------------------------- */

      case "PLAY_START": {
        const res = await doPlayStart(msg.mode, msg.index, {});
        sendResponse(res);
        return;
      }

      case "PLAY_SUITES_START": {
        const entries = Array.isArray(msg.entries)
          ? msg.entries
              .filter((e) => e && e.id)
              .map((e) => ({ id: e.id, name: e.name || "Suite" }))
          : [];
        if (!entries.length) {
          sendResponse({ ok: false, reason: "nothing to play" });
          return;
        }
        await setSuiteQueue({ active: true, entries, idx: 0, summaries: [] });
        const started = await beginSuiteQueueEntry(0);
        sendResponse(started ? { ok: true } : { ok: false, reason: "could not start any suite" });
        return;
      }

      case "PLAY_STOP": {
        playGen++;
        const pb = await getPlayback();
        pb.active = false;
        pb.status = "stopped";
        pb.finishedAt = Date.now();
        await setPlayback(pb);
        try {
          await sendToTab(pb.tabId, { type: "PLAY_STOP" }, 2000);
        } catch (e) {}
        // A deliberate Stop ends the whole multi-suite chain — it never
        // continues into the next suite.
        await settleSuiteQueueEntry(pb, false);
        sendResponse({ ok: true });
        return;
      }

      case "PLAY_STATE": {
        const pb = await getPlayback();
        // If the loop died (service worker recycled) but playback is still
        // marked active, restart it — same generation, so it just resumes.
        if (pb.active && !ticking) runPlayback(playGen);
        const sc = (session.scenarios || [])[pb.scenarioIndex];
        const suiteQueue = await getSuiteQueue();
        sendResponse({
          ...pb,
          scenarioName: sc
            ? sc.name || "Scenario " + (pb.scenarioIndex + 1)
            : "",
          totalSteps: sc ? (sc.steps || []).length : 0,
          suiteQueue: suiteQueue || null
        });
        return;
      }

      case "PLAY_HELLO": {
        // Fresh player after a navigation — keeps the service worker awake.
        sendResponse({ ok: true });
        return;
      }

      case "IFRAME_WARNING": {
        // content.js detected an <iframe> on the recorded page — elements
        // inside it can't be recorded or replayed (all_frames:false), so the
        // popup shows a heads-up banner while recording instead of only
        // failing reactively at playback time.
        if (session.active && sender.tab && sender.tab.id === session.tabId && !session.hasIframes) {
          session.hasIframes = true;
          await setSession(session);
        }
        sendResponse({ ok: true });
        return;
      }

      case "ADD_STEP": {
        if (!session.active || session.paused) {
          sendResponse({ ok: false, reason: "not recording" });
          return;
        }
        if (!sender.tab || sender.tab.id !== session.tabId) {
          sendResponse({ ok: false, reason: "wrong tab" });
          return;
        }
        const sc = session.scenarios[session.recordingIndex];
        if (!sc) {
          sendResponse({ ok: false, reason: "no scenario" });
          return;
        }
        const step = msg.step;
        if (step.action === "visit") {
          if (session.lastUrl === step.url) {
            sendResponse({ ok: true, skipped: true });
            return;
          }
          session.lastUrl = step.url;
        }
        // Recorded upload steps only ever hold the picked file's NAME (never
        // its bytes — see gen-core.js), so an image upload has nothing real
        // to point at later. Normalize it to the fixture we actually ship
        // (fixtures/tije-test-logo.png) right at record time, so the editor,
        // in-browser playback and generated code all agree on one value
        // instead of each silently substituting it independently.
        if (step.action === "upload" && IMAGE_EXT.test(step.value || "")) {
          step.value = "tije-test-logo.png";
          step.files = ["tije-test-logo.png"];
        }
        step.id = stepId(sc.steps.length);
        step.timestamp = new Date().toISOString();
        sc.steps.push(step);
        await setSession(session);
        sendResponse({ ok: true, count: sc.steps.length });
        return;
      }

      default:
        sendResponse({ ok: false, reason: "unknown message" });
    }
}

/* ---------------------------- playback driver ---------------------------- */

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sameUrl(a, b) {
  const norm = (u) => String(u || "").replace(/#.*$/, "").replace(/\/$/, "");
  return norm(a) === norm(b);
}

function firstUrlOf(sc) {
  if (!sc) return null;
  for (const st of sc.steps || []) {
    if (st && st.url) return st.url;
  }
  return null;
}

function sendToTab(tabId, msg, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error("tab message timed out"));
      }
    }, timeout);
    try {
      chrome.tabs.sendMessage(tabId, msg, (res) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res || {});
      });
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(to);
        reject(e);
      }
    }
  });
}

// Runs in the PAGE (main world). While <html data-cyp-playing> is set, any
// attempt to open the OS file picker is swallowed so playback never stalls on a
// native "Open" dialog. Inert otherwise.
function blockFilePickers() {
  if (window.__cypNoPicker) return;
  window.__cypNoPicker = true;
  const P = HTMLInputElement.prototype;
  const playing = () => document.documentElement.hasAttribute("data-cyp-playing");
  const origClick = P.click;
  P.click = function () {
    if (this.type === "file" && playing()) return;
    return origClick.apply(this, arguments);
  };
  if (P.showPicker) {
    const origShow = P.showPicker;
    P.showPicker = function () {
      if (this.type === "file" && playing()) return;
      return origShow.apply(this, arguments);
    };
  }
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      if (playing() && t && t.tagName === "INPUT" && t.type === "file") {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );
}

// Guarantee the playback engine is present in the tab. Manifest content scripts
// are NOT injected into tabs that were open before the extension (re)loaded, and
// chrome.tabs.update() to the same URL does not re-inject them — so we force it.
async function ensurePlayer(tabId) {
  let injected = false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ["content/player.js"]
    });
    injected = true;
  } catch (e) {
    /* restricted page */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: "MAIN",
      func: blockFilePickers
    });
  } catch (e) {
    /* older Chrome without world:"MAIN", or restricted page */
  }
  return injected;
}

// Send one step, injecting the engine and retrying once if the tab has no receiver.
async function sendStep(tabId, step, n, total) {
  const msg = { type: "PLAY_STEP", step, n, total };
  try {
    return await sendToTab(tabId, msg, 25000);
  } catch (e) {
    await ensurePlayer(tabId);
    await delay(250);
    return await sendToTab(tabId, msg, 25000);
  }
}

// A click / submit / keypress that navigates tears the page down before the
// player can answer, so "no reply" is expected for those — but it is also
// exactly what a hung or crashed tab looks like. What tells them apart is
// whether the tab really started loading something while the step ran, so
// watch for that from before the step is sent.
const NAVIGATING_ACTIONS = ["click", "submit", "keydown"];
const NAV_GRACE_MS = 1500; // how long to keep looking once no reply has come

function watchNavigation(tabId) {
  const watch = { seen: false };
  const onUpd = (id, info) => {
    if (id === tabId && (info.status === "loading" || info.url)) watch.seen = true;
  };
  chrome.tabs.onUpdated.addListener(onUpd);
  watch.stop = () => chrome.tabs.onUpdated.removeListener(onUpd);
  return watch;
}

async function navigationStarted(watch, tabId) {
  const deadline = Date.now() + NAV_GRACE_MS;
  while (true) {
    if (watch.seen) return true;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "loading") return true;
    } catch (e) {
      return false; // the tab is gone — not a navigation
    }
    if (Date.now() >= deadline) return false;
    await delay(100);
  }
}

function waitForComplete(tabId, cap = 25000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(t);
      resolve();
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpd);
    const t = setTimeout(finish, cap);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab && tab.status === "complete") finish();
      })
      .catch(finish);
  });
}

async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: true });
  await delay(150);
  await waitForComplete(tabId);
  await ensurePlayer(tabId);
  await delay(120);
}

async function waitForTabIdle(tabId) {
  await delay(200);
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return;
  }
  if (tab.status === "loading") {
    await waitForComplete(tabId);
    await ensurePlayer(tabId);
    await delay(150);
  } else {
    await delay(150);
  }
}

async function doVisit(tabId, step) {
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !sameUrl(tab.url, step.url)) {
      await navigate(tabId, step.url);
    } else {
      await waitForComplete(tabId);
      await ensurePlayer(tabId);
    }
    return { status: "passed", message: "visit " + step.url, ms: 0 };
  } catch (e) {
    return {
      status: "failed",
      message: String((e && e.message) || e),
      code: "visit_failed",
      ms: 0
    };
  }
}

// Turns a failure/skip `code` (set by content/player.js, or by doVisit /
// sendStep above) into an Indonesian { judul, penjelasan, solusi } for the
// play log. Falls back to a generic entry for anything not in the table —
// new codes should still show *something* useful, not a blank block.
function diagnosePlayFailure(step, res, hadSkippedUploadBefore) {
  const sel = step.selector || "-";
  const target = step.targetSelector || step.targetName || "-";
  // An assertion keeps what it expects in `assertion.value`; `value` is null
  // for it, which used to print empty quotes in every failed-assertion message.
  // A password never goes into the log (it is shown in the popup).
  const raw = step.action === "assert" ? (step.assertion || {}).value : step.value;
  const secret = step.sensitive === true || step.inputType === "password";
  const val = secret ? "••••••" : raw == null ? "" : String(raw);
  const url = step.url || "-";

  const TABLE = {
    no_selector: {
      judul: "Step ini tidak punya selector",
      penjelasan:
        "Step tidak menyimpan selector elemen sama sekali, jadi player tidak tahu elemen mana yang harus dipakai.",
      solusi:
        "Buka step ini di editor skenario dan isi kolom Selector, atau rekam ulang step tersebut."
    },
    element_not_found: {
      judul: "Elemen tidak ditemukan di halaman",
      penjelasan: `Selector "${sel}" tidak cocok dengan elemen manapun saat step ini dijalankan. Biasanya karena halaman belum selesai dimuat, elemen berada di dalam iframe, atau markup halaman sudah berubah sejak direkam.`,
      solusi:
        "Pastikan halaman sudah termuat penuh sebelum step ini (tambahkan jeda/assert sebelumnya), pastikan elemen bukan di dalam iframe, atau rekam ulang step ini karena selector kemungkinan sudah berubah."
    },
    bad_selector: {
      judul: "Selector tidak valid",
      penjelasan: `"${sel}" bukan CSS selector yang sah, sehingga browser tidak bisa memprosesnya.`,
      solusi: "Perbaiki selector pada step ini secara manual, atau rekam ulang step tersebut."
    },
    upload_skip: {
      judul: "Upload file dilewati",
      penjelasan:
        "Browser tidak mengizinkan ekstensi mengisi dialog pilih file dari script, jadi step upload tidak bisa diputar langsung di tab.",
      solusi:
        'Gunakan tombol "Export" pada suite ini untuk menghasilkan proyek Cypress/Playwright/WebdriverIO, lalu jalankan di sana — upload file didukung penuh di ketiganya.'
    },
    file_input_skip: {
      judul: "Klik pada input file dilewati",
      penjelasan:
        "Mengklik elemen ini akan membuka dialog pilih file bawaan OS, yang tidak bisa dikendalikan dari script sehingga akan membuat pemutaran macet.",
      solusi:
        'Gunakan tombol "Export" untuk menjalankan skenario ini lewat Cypress/Playwright/WebdriverIO, yang punya cara resmi mengisi file tanpa dialog.'
    },
    drag_no_distance: {
      judul: "Step drag tidak punya jarak yang tersimpan",
      penjelasan: "Jarak geser (dx, dy) pada step ini bernilai 0, jadi tidak ada gerakan yang bisa diputar ulang.",
      solusi:
        'Buka step ini di editor skenario, isi "Drag X (px)" / "Drag Y (px)" secara manual, atau rekam ulang drag-nya.'
    },
    drag_no_effect: {
      judul: "Drag tidak berpengaruh",
      penjelasan:
        "Perintah drag sudah dijalankan, tetapi posisi elemen sama sekali tidak berubah — kemungkinan elemen sebenarnya tidak bisa digeser, atau widget di halaman butuh event tambahan yang tidak dihasilkan oleh pemutaran di tab.",
      solusi:
        'Pastikan elemen yang direkam memang bagian yang bisa digeser (drag handle), atau jalankan skenario ini lewat proyek Cypress/Playwright/WebdriverIO hasil "Export" — drag di sana memakai driver otomasi asli, bukan event tiruan.'
    },
    drop_no_target: {
      judul: "Step drop tidak punya target",
      penjelasan: "Step ini tidak menyimpan selector elemen tujuan drop.",
      solusi: "Rekam ulang step drop ini, atau isi selector target secara manual di editor skenario."
    },
    drop_target_not_found: {
      judul: "Target drop tidak ditemukan",
      penjelasan: `Selector target "${target}" tidak cocok dengan elemen manapun di halaman saat ini.`,
      solusi: "Rekam ulang step drop ini, atau perbaiki selector target di editor skenario."
    },
    resize_no_distance: {
      judul: "Step resize tidak punya jarak yang tersimpan",
      penjelasan: "Jarak geser (dx, dy) pada handle resize ini bernilai 0, jadi tidak ada perubahan ukuran yang bisa diputar ulang.",
      solusi:
        'Buka step ini di editor skenario, isi "Drag X (px)" / "Drag Y (px)" secara manual, atau rekam ulang resize-nya.'
    },
    resize_no_effect: {
      judul: "Resize tidak berpengaruh",
      penjelasan:
        "Handle sudah digeser, tetapi ukuran elemen tidak berubah sama sekali — kemungkinan handle resize sudah tidak ada di posisi yang direkam.",
      solusi:
        'Cek apakah tampilan halaman berubah sejak direkam, rekam ulang resize-nya, atau jalankan lewat proyek hasil "Export".'
    },
    option_not_found: {
      judul: "Opsi dropdown tidak ditemukan",
      penjelasan: `Opsi dengan teks "${val}" yang direkam sudah tidak ada lagi di dropdown ini.`,
      solusi: "Buka dropdown secara manual untuk melihat opsi yang tersedia sekarang, lalu perbarui Value pada step ini."
    },
    check_failed: {
      judul: "Checkbox/radio gagal diubah",
      penjelasan: "Klik pada elemen ini tidak mengubah status checked-nya seperti yang diharapkan.",
      solusi: "Pastikan elemen tidak disabled, dan selectornya masih menunjuk ke checkbox/radio yang benar."
    },
    no_form: {
      judul: "Tidak ada <form> untuk di-submit",
      penjelasan: "Elemen target bukan bagian dari elemen <form>, sehingga aksi submit tidak bisa dijalankan.",
      solusi: 'Ubah aksi step ini menjadi "click" pada tombolnya — kemungkinan yang terekam seharusnya klik tombol, bukan submit form.'
    },
    unsupported_action: {
      judul: "Aksi ini belum didukung saat pemutaran di browser",
      penjelasan: `Aksi "${step.action}" belum ada implementasinya di player.`,
      solusi: "Hapus atau ubah step ini di editor skenario. Kode generate (Cypress/Playwright/WebdriverIO) tetap mendukungnya bila didukung frameworknya."
    },
    url_mismatch: {
      judul: "URL tidak sesuai harapan",
      penjelasan: `URL halaman saat ini tidak mengandung "${val}" seperti yang diharapkan assertion ini.`,
      solusi: "Cek apakah alur navigasi sebelumnya berhasil, atau perbarui nilai yang diharapkan pada step assertion ini."
    },
    text_not_found: {
      judul: "Teks yang diharapkan tidak ditemukan",
      penjelasan: sel !== "-"
        ? `Elemen "${sel}" ditemukan, tetapi tidak mengandung teks "${val}" seperti yang diharapkan.`
        : `Halaman tidak mengandung teks "${val}" seperti yang diharapkan.`,
      solusi: "Cek apakah teks di halaman sudah berubah sejak direkam, lalu perbarui nilai assertion pada step ini."
    },
    value_mismatch: {
      judul: "Nilai elemen tidak sesuai harapan",
      penjelasan: `Nilai elemen saat ini tidak sama dengan "${val}" seperti yang diharapkan assertion ini.`,
      solusi: "Cek apakah step-step sebelumnya benar-benar mengisi nilai yang diharapkan, atau perbarui nilai assertion ini."
    },
    not_visible: {
      judul: "Elemen ditemukan tapi tidak terlihat",
      penjelasan:
        "Elemen ada di halaman, namun sedang tersembunyi (display:none, ukurannya 0, atau di luar layar) sehingga assertion \"visible\" gagal.",
      solusi:
        'Tambahkan step untuk membuka/scroll ke elemen tersebut sebelum assertion ini, atau ganti jadi assertion "exist" bila elemen memang boleh tersembunyi.'
    },
    visit_failed: {
      judul: "Gagal membuka halaman",
      penjelasan: `Terjadi error saat berpindah ke "${url}": ${res.message || "-"}.`,
      solusi: "Pastikan URL tersebut masih valid dan bisa diakses, cek koneksi internet, lalu klik Play lagi."
    },
    no_response: {
      judul: "Tab tidak merespons",
      penjelasan:
        "Ekstensi mengirim perintah ke tab yang direkam, tetapi tidak ada balasan dalam waktu yang ditentukan — biasanya karena halaman sedang memuat ulang, macet, atau tabnya sudah ditutup.",
      solusi: "Reload tab yang sedang diputar, lalu klik Play lagi. Jika masih terjadi, tutup dan buka ulang tab tersebut."
    },
    no_result: {
      judul: "Tidak ada hasil dari halaman",
      penjelasan: "Script di dalam tab tidak mengembalikan hasil apapun untuk step ini.",
      solusi: "Reload halaman yang sedang diputar, lalu jalankan Play lagi."
    },
    js_error: {
      judul: "Terjadi error saat menjalankan step",
      penjelasan: `Script pemutaran mengalami error tak terduga: ${res.message || "-"}.`,
      solusi: "Reload halaman lalu coba Play lagi. Jika terus terjadi, kemungkinan ada perubahan besar di halaman yang membuat step ini tidak relevan lagi — pertimbangkan merekam ulang."
    }
  };

  const base = TABLE[res.code] || {
    judul: "Step gagal dijalankan",
    penjelasan: res.message || "Tidak ada rincian tambahan untuk kegagalan ini.",
    solusi: "Cek kembali step ini di editor skenario, atau rekam ulang bila halaman sudah berubah."
  };

  // A step that depends on UI which only appears after a real file upload
  // (a crop/preview dialog, an "attachment added" panel, ...) will always
  // fail to find its element in the live tab, because upload itself was
  // already skipped a few steps earlier (browsers block scripts from
  // filling the native file picker — see upload_skip above). The generic
  // "iframe or stale selector" explanation is technically true but points
  // the user at the wrong fix here, so call out the real cause directly.
  if (hadSkippedUploadBefore && (res.code === "element_not_found" || res.code === "not_visible")) {
    return {
      judul: base.judul,
      penjelasan:
        base.penjelasan +
        " Kemungkinan besar penyebabnya: skenario ini punya step upload file lebih awal yang dilewati " +
        "(browser tidak mengizinkan ekstensi mengisi file picker), jadi UI yang seharusnya muncul setelah " +
        "upload — misalnya dialog crop/preview gambar — tidak pernah terbuka, dan step ini tidak menemukan apapun.",
      solusi:
        'Ini bukan sesuatu yang bisa diperbaiki lewat "Play in browser" — jalankan skenario ini lewat proyek ' +
        'hasil "Export" (Cypress/Playwright/WebdriverIO) dengan file gambar asli sebagai fixture. Di sana upload ' +
        "berjalan dengan file sungguhan, jadi dialog crop/preview akan terbuka normal dan step-step setelahnya bisa jalan."
    };
  }

  return base;
}

async function pushResult(step, res) {
  const pb = await getPlayback();
  const entry = {
    scenarioIndex: pb.scenarioIndex,
    stepIndex: pb.stepIndex,
    action: step.action,
    name: step.elementName || step.url || step.action,
    status: res.status,
    message: res.message || "",
    ms: res.ms || 0
  };
  // Skips are deliberate ("can't do this in-browser, use the export")
  // rather than errors, so only failures get the full log breakdown.
  if (res.status === "failed") {
    const hadSkippedUploadBefore = pb.results.some(
      (r) => r.scenarioIndex === pb.scenarioIndex && r.action === "upload" && r.status === "skipped"
    );
    entry.diagnosis = diagnosePlayFailure(step, res, hadSkippedUploadBefore);
  }
  pb.results.push(entry);
  await setPlayback(pb);
}

async function markSkipped(sc, from) {
  const pb = await getPlayback();
  for (let k = from; k < (sc.steps || []).length; k++) {
    const st = sc.steps[k];
    pb.results.push({
      scenarioIndex: pb.scenarioIndex,
      stepIndex: k,
      action: st.action,
      name: st.elementName || st.url || st.action,
      status: "skipped",
      message: "Dilewati karena step sebelumnya gagal.",
      ms: 0
    });
  }
  await setPlayback(pb);
}

async function recordScenarioResult(sc) {
  const pb = await getPlayback();
  const mine = pb.results.filter((r) => r.scenarioIndex === pb.scenarioIndex);
  const failed = mine.filter((r) => r.status === "failed").length;
  const passed = mine.filter((r) => r.status === "passed").length;
  const { lastPlay } = await chrome.storage.local.get("lastPlay");
  const map = lastPlay || {};
  if (sc && sc.id) {
    map[sc.id] = {
      status: failed ? "failed" : "passed",
      passed,
      failed,
      total: mine.length,
      at: Date.now()
    };
  }
  await storageSet({ lastPlay: map });
}

async function finishPlayback() {
  const pb = await getPlayback();
  pb.active = false;
  pb.finishedAt = Date.now();
  if (pb.status === "running") {
    pb.status = pb.results.some((r) => r.status === "failed") ? "failed" : "passed";
  }
  await setPlayback(pb);
  try {
    await sendToTab(pb.tabId, { type: "PLAY_STOP" }, 2000);
  } catch (e) {}
  // A suite finishing on its own (not via Stop) is exactly when the play
  // queue should move on to the next suite, if there is one.
  await settleSuiteQueueEntry(pb, true);
}

async function nextScenario(session) {
  const pb = await getPlayback();
  if (!pb.queue.length) return false;
  pb.scenarioIndex = pb.queue.shift();
  pb.stepIndex = 0;
  await setPlayback(pb);
  const url =
    firstUrlOf(session.scenarios[pb.scenarioIndex]) || session.targetUrl;
  if (url) {
    try {
      await navigate(pb.tabId, url);
    } catch (e) {}
  }
  return true;
}

async function runPlayback(gen) {
  if (ticking) {
    pendingRun = gen; // the latest request wins; see the finally block
    return;
  }
  ticking = true;
  try {
    // Position the tab for the very first step of a fresh run.
    {
      const pb = await getPlayback();
      const session = await getSession();
      const sc = (session.scenarios || [])[pb.scenarioIndex];
      if (pb.active && sc && (pb.results || []).length === 0) {
        const first = (sc.steps || [])[0];
        const url = firstUrlOf(sc) || session.targetUrl;
        if (url && (!first || first.action !== "visit")) {
          try {
            await navigate(pb.tabId, url);
          } catch (e) {}
        } else {
          await ensurePlayer(pb.tabId);
        }
      }
    }

    while (true) {
      if (gen !== playGen) break;
      let pb = await getPlayback();
      if (!pb.active) break;
      const session = await getSession();
      const sc = (session.scenarios || [])[pb.scenarioIndex];

      // scenario complete (ran out of steps)?
      if (!sc || pb.stepIndex >= (sc.steps || []).length) {
        if (sc) await recordScenarioResult(sc);
        if (await nextScenario(session)) continue;
        await finishPlayback();
        break;
      }

      const step = sc.steps[pb.stepIndex];
      const total = sc.steps.length;

      let res;
      if (step.action === "visit") {
        res = await doVisit(pb.tabId, step);
      } else {
        const nav = watchNavigation(pb.tabId);
        try {
          res = await sendStep(pb.tabId, step, pb.stepIndex + 1, total);
        } catch (e) {
          // No reply. Only a step that can navigate, on a tab that really did
          // start navigating, counts as passed; anything else is a hung,
          // crashed or closed tab and must fail rather than turn the run green.
          res =
            NAVIGATING_ACTIONS.includes(step.action) && (await navigationStarted(nav, pb.tabId))
              ? { status: "passed", message: "(halaman berpindah)", ms: 0 }
              : {
                  status: "failed",
                  message:
                    "halaman tidak merespons — reload halaman, lalu Play lagi",
                  code: "no_response",
                  ms: 0
                };
        } finally {
          nav.stop();
        }
      }

      if (!res || !res.status) {
        res = { status: "failed", message: "tidak ada hasil dari halaman", code: "no_result", ms: 0 };
      }
      await pushResult(step, res);

      pb = await getPlayback();
      if (!pb.active || gen !== playGen) break;

      if (res.status === "failed") {
        await markSkipped(sc, pb.stepIndex + 1);
        await recordScenarioResult(sc);
        if (pb.mode === "all" && (await nextScenario(session))) continue;
        await finishPlayback();
        break;
      }

      pb.stepIndex += 1;
      await setPlayback(pb);
      if (step.action !== "visit") await waitForTabIdle(pb.tabId);
    }
  } catch (e) {
    const pb = await getPlayback();
    pb.active = false;
    pb.status = "failed";
    pb.finishedAt = Date.now();
    pb.results.push({
      scenarioIndex: pb.scenarioIndex,
      stepIndex: pb.stepIndex,
      action: "error",
      name: "playback",
      status: "failed",
      message: String((e && e.message) || e),
      ms: 0
    });
    await setPlayback(pb);
  } finally {
    ticking = false;
    // A run was requested while this loop was still going (the next suite of
    // a multi-suite queue, or a fresh Play right after Stop). Start it now.
    // If it has been superseded or stopped since, its loop sees the stale
    // generation / inactive playback and exits straight away.
    if (pendingRun !== null) {
      const next = pendingRun;
      pendingRun = null;
      runPlayback(next);
    }
  }
}

function notifyRecordingStopped(reason) {
  if (!chrome.notifications || !chrome.notifications.create) return;
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Perekaman dihentikan",
      message: reason
    });
  } catch (e) {
    /* notifications not available on this platform */
  }
}

// Goes through the same queue as the message handlers — it rewrites `session`
// too, and a step still in flight from the closing tab must not overwrite it.
chrome.tabs.onRemoved.addListener((tabId) =>
  serialize(async () => {
    const session = await getSession();
    if (session.tabId === tabId && session.active) {
      session.active = false;
      session.paused = false;
      await setSession(session);
      // The popup only polls while it's open, so without this the user has no
      // way to know recording stopped until they reopen it — a direct cause of
      // the "kehilangan data" (data loss surprise) complaint.
      notifyRecordingStopped("Tab yang direkam ditutup. Langkah yang sudah terekam tetap tersimpan.");
    }
    const pb = await getPlayback();
    if (pb.active && pb.tabId === tabId) {
      playGen++;
      pb.active = false;
      pb.status = "stopped";
      pb.finishedAt = Date.now();
      await setPlayback(pb);
      await settleSuiteQueueEntry(pb, false);
    }
  })
);

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const session = await getSession();
  if (session.tabId === tabId && session.active && !session.paused) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "STATE_CHANGED", recording: true });
    } catch (e) {
      /* not ready */
    }
  }
});

// Resume an interrupted playback if the service worker was recycled mid-run.
(async () => {
  const pb = await getPlayback();
  if (pb.active && !ticking) runPlayback(playGen);
})();
