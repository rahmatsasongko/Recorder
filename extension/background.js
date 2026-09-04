// Background service worker — owns the recording session.
// A session holds a Test Suite made of many Scenarios; each scenario has steps.

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
  recordingIndex: -1
};

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

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || { ...DEFAULT_SESSION };
}

async function setSession(session) {
  await chrome.storage.local.set({ session });
  return session;
}

async function getPlayback() {
  const { playback } = await chrome.storage.local.get("playback");
  return playback || { ...DEFAULT_PLAYBACK };
}

async function setPlayback(playback) {
  await chrome.storage.local.set({ playback });
  return playback;
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

async function broadcastState() {
  const session = await getSession();
  const recording = session.active && !session.paused;
  if (session.tabId == null) return;
  try {
    await chrome.tabs.sendMessage(session.tabId, { type: "STATE_CHANGED", recording });
  } catch (e) {
    /* content script not ready */
  }
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const session = await getSession();

    switch (msg.type) {
      case "GET_STATE": {
        const isThisTab = sender.tab && session.tabId === sender.tab.id;
        sendResponse({
          ...session,
          recording:
            session.active && !session.paused && (isThisTab || !sender.tab)
        });
        return;
      }

      case "START": {
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
        await setSession(fresh);
        fresh.tabId = await ensureRecordingTab(fresh);
        await setSession(fresh);
        await broadcastState();
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
        }
        sendResponse({ ok: true });
        return;
      }

      case "SET_META": {
        if (typeof msg.projectName === "string") session.projectName = msg.projectName;
        if (typeof msg.suiteName === "string") session.suiteName = msg.suiteName;
        if (typeof msg.targetUrl === "string") session.targetUrl = msg.targetUrl;
        await setSession(session);
        sendResponse({ ok: true });
        return;
      }

      case "RESET": {
        playGen++;
        await setSession({ ...DEFAULT_SESSION });
        await chrome.storage.local.set({
          playback: { ...DEFAULT_PLAYBACK },
          lastPlay: {}
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
          try {
            await chrome.tabs.sendMessage(session.tabId, {
              type: "STATE_CHANGED",
              recording: false
            });
          } catch (e) {
            /* tab gone / not ready */
          }
        }
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
        await setSession(imported);
        await chrome.storage.local.set({
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
        const scenarios = session.scenarios || [];
        const mode = msg.mode === "all" ? "all" : "one";

        let order;
        if (mode === "all") {
          order = scenarios
            .map((s, i) => i)
            .filter((i) => (scenarios[i].steps || []).length);
        } else {
          const i = msg.index;
          if (i == null || !scenarios[i] || !(scenarios[i].steps || []).length) {
            sendResponse({ ok: false, reason: "no steps to play" });
            return;
          }
          order = [i];
        }
        if (!order.length) {
          sendResponse({ ok: false, reason: "nothing to play" });
          return;
        }

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
          mode,
          plan: order.slice(),
          queue: order.slice(1),
          scenarioIndex: order[0],
          stepIndex: 0,
          startedAt: Date.now(),
          finishedAt: null,
          results: []
        };
        await setPlayback(pb);
        sendResponse({ ok: true });

        // runPlayback() flips `ticking` synchronously, so PLAY_STATE polls that
        // arrive during the first navigation won't spawn a second loop.
        runPlayback(myGen);
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
        sendResponse({ ok: true });
        return;
      }

      case "PLAY_STATE": {
        const pb = await getPlayback();
        // If the loop died (service worker recycled) but playback is still
        // marked active, restart it — same generation, so it just resumes.
        if (pb.active && !ticking) runPlayback(playGen);
        const sc = (session.scenarios || [])[pb.scenarioIndex];
        sendResponse({
          ...pb,
          scenarioName: sc
            ? sc.name || "Scenario " + (pb.scenarioIndex + 1)
            : "",
          totalSteps: sc ? (sc.steps || []).length : 0
        });
        return;
      }

      case "PLAY_HELLO": {
        // Fresh player after a navigation — keeps the service worker awake.
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
  })();
  return true;
});

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
    return { status: "failed", message: String((e && e.message) || e), ms: 0 };
  }
}

async function pushResult(step, res) {
  const pb = await getPlayback();
  pb.results.push({
    scenarioIndex: pb.scenarioIndex,
    stepIndex: pb.stepIndex,
    action: step.action,
    name: step.elementName || step.url || step.action,
    status: res.status,
    message: res.message || "",
    ms: res.ms || 0
  });
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
      message: "",
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
  await chrome.storage.local.set({ lastPlay: map });
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
  if (ticking) return;
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
        try {
          res = await sendStep(pb.tabId, step, pb.stepIndex + 1, total);
        } catch (e) {
          res = ["click", "submit", "keydown"].includes(step.action)
            ? { status: "passed", message: "(page navigated)", ms: 0 }
            : {
                status: "failed",
                message:
                  "the page did not respond — reload the page, then Play again",
                ms: 0
              };
        }
      }

      if (!res || !res.status) {
        res = { status: "failed", message: "no result from page", ms: 0 };
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
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session.tabId === tabId && session.active) {
    session.active = false;
    session.paused = false;
    await setSession(session);
  }
  const pb = await getPlayback();
  if (pb.active && pb.tabId === tabId) {
    playGen++;
    pb.active = false;
    pb.status = "stopped";
    pb.finishedAt = Date.now();
    await setPlayback(pb);
  }
});

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
