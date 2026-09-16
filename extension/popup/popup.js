/* Cypress Recorder — popup controller (v2, multi-scenario suites) */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const ACTIONS = [
  "visit", "click", "type", "clear", "select",
  "check", "uncheck", "keydown", "submit", "scroll", "upload",
  "drag", "drop", "resize", "assert"
];
const ASSERTIONS = [
  { v: "visible", t: "be visible" },
  { v: "exist", t: "exist" },
  { v: "contain", t: "contain text" },
  { v: "value", t: "have value" },
  { v: "url", t: "url includes" }
];

let pollTimer = null;
let editingIndex = -1;
let generated = null;
let codeSource = "suite"; // "suite" (active session) | "project" (all suites combined)
let generatedSuitesRaw = null; // [{ id, suiteName, ... }] backing the last "project" generation, for Play all
let activeCodeTab = "spec";
let activeFile = null;
let pendingImport = null; // { files } while the spec picker is shown
let framework = window.Generators.DEFAULT_ID; // cypress | playwright | webdriverio

// The renderer for the framework currently selected in the sidebar. Recording
// and playback never look at this — only code generation does.
function gen() {
  return window.Generators.get(framework);
}

/* ------------------------------ messaging ------------------------------ */

function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (res) => {
      void chrome.runtime.lastError;
      resolve(res || {});
    });
  });
}
function getSession() {
  return new Promise((r) =>
    chrome.storage.local.get("session", ({ session }) => r(session || null))
  );
}
function getLastPlay() {
  return new Promise((r) =>
    chrome.storage.local.get("lastPlay", ({ lastPlay }) => r(lastPlay || {}))
  );
}

/* ------------------------------ views ------------------------------ */

const STEP_OF_VIEW = {
  "view-suites": 0,
  "view-setup": 0,
  "view-recording": 1,
  "view-suite": 2,
  "view-scenario": 2,
  "view-play": 3,
  "view-code": 3
};

function updateStepper(active) {
  $$("#stepper .step-node").forEach((n) => {
    const s = Number(n.dataset.step);
    n.classList.toggle("current", s === active);
    n.classList.toggle("done", s < active);
  });
}

function showView(id) {
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  updateStepper(id in STEP_OF_VIEW ? STEP_OF_VIEW[id] : 0);
  if (id === "view-recording") startPolling();
  else stopPolling();
  if (id !== "view-play") stopPlayPoll();
}
function setFoot(m) {
  $("#foot-status").textContent = m;
}

/* ------------------------------ setup ------------------------------ */

$("#btn-start").addEventListener("click", async () => {
  const projectName = $("#projectName").value.trim() || "MyProject";
  const suiteName = $("#suiteName").value.trim() || "My Suite";
  const targetUrl = $("#targetUrl").value.trim();
  const err = $("#setup-error");
  err.textContent = "";

  let url;
  try {
    url = new URL(targetUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error("bad");
  } catch (e) {
    err.textContent = "URL tidak valid.";
    return;
  }

  await send("START", { projectName, suiteName, targetUrl: url.href, scenarioName: "Scenario 1" });
  setFoot("Recording Scenario 1");
  showView("view-recording");
});

/* ------------------------------ recording ------------------------------ */

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
function elapsedOf(session) {
  if (!session.startTime) return 0;
  const base = session.startTime + (session.pausedAccum || 0);
  if (session.paused && session.pausedAt) return session.pausedAt - base;
  return Date.now() - base;
}
function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshRecording, 500);
  refreshRecording();
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
async function refreshRecording() {
  const session = await getSession();
  if (!session) return;
  if (!session.active) {
    stopPolling();
    openScenario(session.recordingIndex);
    return;
  }
  const sc = session.scenarios[session.recordingIndex] || { steps: [], name: "" };
  $("#rec-timer").textContent = fmtTime(elapsedOf(session));
  $("#rec-count").textContent = sc.steps.length;
  $("#rec-scenario").textContent =
    "Scenario " + (session.recordingIndex + 1) + " — " + sc.name;
  const paused = session.paused;
  $("#rec-dot").classList.toggle("paused", paused);
  $("#rec-label").textContent = paused ? "Paused" : "Recording";
  $("#btn-pause").textContent = paused ? "▶ Resume" : "⏸ Pause";
}

$("#btn-pause").addEventListener("click", async () => {
  const session = await getSession();
  await send(session && session.paused ? "RESUME" : "PAUSE");
  refreshRecording();
});
$("#btn-stop").addEventListener("click", async () => {
  await send("STOP");
  const session = await getSession();
  openScenario(session.recordingIndex);
});

/* ------------------------------ suites library ------------------------------ */

function fmtWhen(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + "h ago";
  return Math.round(hr / 24) + "d ago";
}

async function enterSuitesList() {
  showView("view-suites");
  const res = await send("LIST_SUITES");
  renderSuitesList((res && res.suites) || [], res && res.activeSuiteId);
}

function renderSuitesList(suites, activeId) {
  const list = $("#suites-list");
  $("#suites-empty").style.display = suites.length ? "none" : "block";
  list.innerHTML = suites
    .map((s, i) => {
      const isActive = s.id === activeId;
      return `
      <div class="scn${isActive ? " current" : ""}" data-id="${escapeAttr(s.id)}">
        <span class="num">${i + 1}</span>
        <span class="meta" data-op="open">
          <div class="nm">${escapeHtml(s.suiteName || "Untitled suite")}</div>
          <div class="sub">
            <span>${escapeHtml(s.projectName || "")}</span>
            <span>${s.scenarioCount} scenario${s.scenarioCount === 1 ? "" : "s"}</span>
            ${isActive ? '<span class="chip recorded">current</span>' : s.updatedAt ? `<span>${fmtWhen(s.updatedAt)}</span>` : ""}
          </div>
        </span>
        <span class="tools">
          <button class="icon-btn gen" data-op="gen" title="Generate Cypress code">⚙</button>
          <button class="icon-btn play" data-op="open" title="Open this suite">→</button>
          <button class="icon-btn del" data-op="del" title="Delete suite">🗑</button>
        </span>
      </div>`;
    })
    .join("");
}

$("#suites-list").addEventListener("click", async (e) => {
  const row = e.target.closest(".scn");
  if (!row) return;
  const id = row.dataset.id;
  const op = e.target.closest("[data-op]")?.dataset.op;
  if (op === "del") {
    await send("DELETE_SUITE", { id });
    enterSuitesList();
    return;
  }
  if (op === "gen") {
    setFoot("Preparing Cypress code…");
    const res = await send("SWITCH_SUITE", { id });
    if (!res.ok) {
      setFoot("Could not open that suite");
      return;
    }
    const session = await getSession();
    if (session && session.active) {
      // Mid-recording — nothing to generate yet, land on the recording view
      // like the plain "open" action does.
      showView("view-recording");
      return;
    }
    if (!session || !(session.scenarios || []).some((s) => (s.steps || []).length)) {
      setFoot("This suite has no recorded steps yet");
      enterSuite();
      return;
    }
    generated = gen().generateFiles(session);
    generatedSuitesRaw = null;
    activeFile = null;
    setFoot("Generated " + Object.keys(generated.files).length + " " + gen().label + " files");
    setCodeSource("suite");
    activeCodeTab = "spec";
    syncTabs();
    showView("view-code");
    return;
  }
  setFoot("Opening suite…");
  const res = await send("SWITCH_SUITE", { id });
  if (!res.ok) {
    setFoot("Could not open that suite");
    return;
  }
  setFoot("Suite opened");
  const session = await getSession();
  if (session && session.active) showView("view-recording");
  else enterSuite();
});

$("#btn-suites").addEventListener("click", enterSuitesList);
$("#btn-add-suite").addEventListener("click", () => {
  $("#setup-error").textContent = "";
  showView("view-setup");
});

/* ---------------------- bulk export / import (all suites) ---------------------- */

async function exportAllSuites() {
  const res = await send("EXPORT_ALL_SUITES");
  const suites = (res && res.suites) || [];
  if (!res.ok || !suites.length) {
    setFoot("No suites to export");
    return;
  }
  const bundle = {
    kind: "cypress-recorder-suite-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    suites
  };
  const json = JSON.stringify(bundle, null, 2);
  const filename = "cypress-recorder-suites-" + suites.length + ".json";
  try {
    const dataUrl = await blobToDataUrl(new Blob([json], { type: "application/json" }));
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: dataUrl, filename }, () => void chrome.runtime.lastError);
    } else {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setFoot("Exported " + suites.length + " suite(s)");
  } catch (e) {
    setFoot("Export failed: " + e.message);
  }
}

async function handleImportAllFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data && Array.isArray(data.suites) ? data.suites : null;
    if (!list) throw new Error("bukan file bundle suite yang valid");
    const res = await send("IMPORT_ALL_SUITES", { suites: list });
    if (!res.ok) throw new Error(res.reason || "import gagal");
    setFoot("Imported " + res.added + " suite(s)");
    enterSuitesList();
  } catch (e) {
    setFoot("Import gagal: " + (e && e.message ? e.message : e));
  }
}

$("#btn-export-suites").addEventListener("click", exportAllSuites);
$("#btn-import-suites").addEventListener("click", () => $("#import-suites-file").click());
$("#import-suites-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) await handleImportAllFile(file);
});

/* ------------------------------ suite hub ------------------------------ */

async function enterSuite() {
  const session = await getSession();
  if (!session) return showView("view-setup");
  $("#suite-name").textContent = session.suiteName || "—";
  $("#suite-url").textContent = session.targetUrl || "—";

  const list = $("#scenario-list");
  list.innerHTML = "";
  const scs = session.scenarios || [];
  const lastPlay = await getLastPlay();
  $("#scenario-empty").style.display = scs.length ? "none" : "block";

  scs.forEach((sc, i) => {
    const row = document.createElement("div");
    row.className = "scn" + (sc.saved ? "" : " unsaved");
    row.dataset.i = i;

    const lp = sc.id && lastPlay[sc.id];
    let chip;
    if (lp && lp.status === "passed") chip = `<span class="chip passed">✓ passed</span>`;
    else if (lp && lp.status === "failed")
      chip = `<span class="chip failed">✗ ${lp.failed} failed</span>`;
    else if (!sc.saved) chip = `<span class="chip unsaved">unsaved</span>`;
    else chip = `<span class="chip recorded">recorded</span>`;

    row.innerHTML = `
      <button class="icon-btn play" data-op="play" title="Play this scenario in the browser">▶</button>
      <span class="meta" data-op="edit">
        <div class="nm">${escapeHtml(sc.name || "Scenario " + (i + 1))}</div>
        <div class="sub">
          <span>${sc.steps.length} step${sc.steps.length === 1 ? "" : "s"}</span>
          ${chip}
        </div>
      </span>
      <span class="tools">
        <button class="icon-btn" data-op="edit" title="Edit steps">✎</button>
        <button class="icon-btn del" data-op="del" title="Delete scenario">🗑</button>
      </span>`;
    list.appendChild(row);
  });
  showView("view-suite");
}

$("#scenario-list").addEventListener("click", async (e) => {
  const row = e.target.closest(".scn");
  if (!row) return;
  const i = Number(row.dataset.i);
  const op = e.target.closest("[data-op]")?.dataset.op;
  if (op === "del") {
    await send("DELETE_SCENARIO", { index: i });
    enterSuite();
  } else if (op === "play") {
    lastPlayQueueEntries = null;
    startPlayback({ mode: "one", index: i });
  } else {
    openScenario(i);
  }
});

$("#btn-add-scenario").addEventListener("click", async () => {
  const res = await send("ADD_SCENARIO");
  if (!res.ok) {
    setFoot("Could not add scenario");
    return;
  }
  setFoot("Recording Scenario " + (res.index + 1));
  showView("view-recording");
});

/* ------------------------------ scenario editor ------------------------------ */

async function openScenario(index) {
  const session = await getSession();
  if (!session || !session.scenarios[index]) return enterSuite();
  editingIndex = index;
  const sc = session.scenarios[index];
  $("#scenarioName").value = sc.name || "";
  renderSteps(sc.steps);
  showView("view-scenario");
}

function optionList(list, selected, labelFn) {
  return list
    .map((o) => {
      const v = typeof o === "string" ? o : o.v;
      const label = labelFn ? labelFn(o) : v;
      return `<option value="${v}" ${v === selected ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// The Indonesian explanation + solution background.js attaches to a failed
// play step (see diagnosePlayFailure in background.js), shown right under
// the raw log line for that step.
function renderDiagnosis(d) {
  if (!d) return "";
  return `
    <div class="diag">
      <div class="diag-title">${escapeHtml(d.judul || "Step gagal")}</div>
      <div class="diag-row"><b>Penjelasan:</b> ${escapeHtml(d.penjelasan || "-")}</div>
      <div class="diag-row"><b>Solusi:</b> ${escapeHtml(d.solusi || "-")}</div>
    </div>`;
}

const DRAG_ACTIONS = ["drag", "drop", "resize"];

function badgeClass(action) {
  if (action === "visit" || action === "scroll") return "nav";
  if (action === "click" || DRAG_ACTIONS.includes(action)) return "click";
  if (action === "assert") return "assert";
  return "input";
}
function previewOf(step) {
  if (step.action === "assert") {
    const a = step.assertion || {};
    return (a.type || "") + (a.value ? ` "${a.value}"` : "");
  }
  if (step.action === "visit" || step.action === "scroll")
    return step.url || step.value || "";
  if (step.action === "drop") {
    return "→ " + (step.targetName || step.targetSelector || "?");
  }
  if (step.action === "resize" || step.action === "drag") {
    const drag = `${Number(step.dx) || 0}, ${Number(step.dy) || 0} px`;
    return step.action === "resize" && step.value ? `${drag} → ${step.value}` : drag;
  }
  if (step.value != null && step.value !== "") return String(step.value);
  return step.selector || "";
}

function renderSteps(steps) {
  const list = $("#steps-list");
  const openIdx = new Set(
    $$("#steps-list .step.open").map((el) => Number(el.dataset.i))
  );
  list.innerHTML = "";
  $("#scenario-count").textContent = steps.length;
  $("#steps-empty").style.display = steps.length ? "none" : "block";

  steps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = "step" + (openIdx.has(i) ? " open" : "");
    if (step.action === "assert") row.classList.add("assertion");
    if (step.action === "visit") row.classList.add("visit");
    row.dataset.i = i;

    const unstable =
      step.selector && step.selectorStable === false
        ? `<span class="warn" title="Selector may be unstable">⚠</span>`
        : "";

    const valueRow =
      step.action === "assert"
        ? `
        <label>Assert</label>
        <select class="fld-assert">${optionList(
          ASSERTIONS,
          (step.assertion && step.assertion.type) || "visible",
          (o) => o.t
        )}</select>
        <label>Expected</label>
        <input class="fld-avalue" type="text" value="${escapeAttr(
          (step.assertion && step.assertion.value) || ""
        )}" placeholder="text / path" />`
        : step.action === "drop"
          ? `
        <label>Drop on</label>
        <input class="fld-target" type="text" value="${escapeAttr(step.targetSelector || "")}" placeholder="target selector" />`
          : step.action === "resize" || step.action === "drag"
            ? // The drag distance is what replays; the size it produced is a label.
              `
        <label>Drag X (px)</label>
        <input class="fld-dx" type="number" value="${Number(step.dx) || 0}" />
        <label>Drag Y (px)</label>
        <input class="fld-dy" type="number" value="${Number(step.dy) || 0}" />`
            : `
        <label>Value</label>
        <input class="fld-value" type="text" value="${escapeAttr(
          step.value == null ? "" : step.value
        )}" />`;

    const selectorRow =
      step.action === "visit" || step.action === "scroll"
        ? `<label>URL</label><input class="fld-url" type="text" value="${escapeAttr(step.url || "")}" />`
        : `<label>Selector</label><input class="fld-selector" type="text" value="${escapeAttr(step.selector || "")}" />`;

    row.innerHTML = `
      <div class="summary">
        <span class="chev">▸</span>
        <span class="idx">${i + 1}</span>
        <span class="act-badge ${badgeClass(step.action)}">${step.action}</span>
        <span class="name">${escapeHtml(step.elementName || step.url || "step")}</span>
        <span class="preview">${escapeHtml(previewOf(step))}</span>
        ${unstable}
      </div>
      <div class="body">
        <div class="fields">
          <label>Action</label>
          <select class="action">${optionList(ACTIONS, step.action)}</select>
          ${selectorRow}${valueRow}
        </div>
        <div class="actions">
          <button class="btn sm" data-op="up">↑ Up</button>
          <button class="btn sm" data-op="down">↓ Down</button>
          <button class="btn sm" data-op="dup">Duplicate</button>
          <button class="btn sm danger" data-op="del">Delete</button>
        </div>
      </div>`;
    list.appendChild(row);
  });
}

async function mutateSteps(fn) {
  const session = await getSession();
  const sc = session.scenarios[editingIndex];
  if (!sc) return;
  const next = fn(sc.steps.slice()) || sc.steps;
  await send("UPDATE_SCENARIO", { index: editingIndex, steps: next });
  renderSteps(next);
}

$("#steps-list").addEventListener("click", (e) => {
  const summary = e.target.closest(".summary");
  if (summary && !e.target.closest("button")) {
    summary.closest(".step").classList.toggle("open");
    return;
  }
  const btn = e.target.closest("button[data-op]");
  if (!btn) return;
  const i = Number(btn.closest(".step").dataset.i);
  const op = btn.dataset.op;
  mutateSteps((steps) => {
    if (op === "del") steps.splice(i, 1);
    else if (op === "dup") steps.splice(i + 1, 0, JSON.parse(JSON.stringify(steps[i])));
    else if (op === "up" && i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
    else if (op === "down" && i < steps.length - 1)
      [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
    return steps;
  });
});

$("#steps-list").addEventListener("change", (e) => {
  const stepEl = e.target.closest(".step");
  if (!stepEl) return;
  const i = Number(stepEl.dataset.i);
  mutateSteps((steps) => {
    const s = steps[i];
    if (e.target.classList.contains("action")) s.action = e.target.value;
    else if (e.target.classList.contains("fld-selector")) s.selector = e.target.value;
    else if (e.target.classList.contains("fld-url")) s.url = e.target.value;
    else if (e.target.classList.contains("fld-value")) s.value = e.target.value;
    else if (e.target.classList.contains("fld-target")) {
      s.targetSelector = e.target.value;
    } else if (
      e.target.classList.contains("fld-dx") ||
      e.target.classList.contains("fld-dy")
    ) {
      const axis = e.target.classList.contains("fld-dx") ? "dx" : "dy";
      s[axis] = Math.round(Number(e.target.value) || 0);
      // The recorded end size described the original drag, not this one.
      s.value = "";
      s.width = 0;
      s.height = 0;
    } else if (e.target.classList.contains("fld-assert")) {
      s.assertion = s.assertion || {};
      s.assertion.type = e.target.value;
    } else if (e.target.classList.contains("fld-avalue")) {
      s.assertion = s.assertion || {};
      s.assertion.value = e.target.value;
    }
    return steps;
  });
});

$("#btn-add-assertion").addEventListener("click", () => {
  mutateSteps((steps) => {
    steps.push({
      id: "assert-" + Date.now(),
      action: "assert",
      assertion: { type: "visible", value: "" },
      selector: "",
      elementName: "assertion",
      url: steps.length ? steps[steps.length - 1].url : ""
    });
    return steps;
  });
});

$("#btn-record-more").addEventListener("click", async () => {
  await saveScenarioName();
  await send("RECORD_SCENARIO", { index: editingIndex });
  showView("view-recording");
});

async function saveScenarioName() {
  const name = $("#scenarioName").value.trim();
  await send("UPDATE_SCENARIO", { index: editingIndex, name });
}

$("#btn-save-scenario").addEventListener("click", async () => {
  const name = $("#scenarioName").value.trim() || "Scenario " + (editingIndex + 1);
  await send("SAVE_SCENARIO", { index: editingIndex, name });
  setFoot("Saved: " + name);
  enterSuite();
});
$("#btn-scenario-back").addEventListener("click", async () => {
  await saveScenarioName();
  enterSuite();
});

/* ------------------------------ framework ------------------------------ */

// Only code generation is framework-specific: the recording, the scenario
// editor and in-browser playback all work off the recorded steps and behave
// identically whichever button is lit here.
function syncFrameworkUi() {
  const g = gen();
  $$("#fw-switch .fw").forEach((b) =>
    b.classList.toggle("active", b.dataset.fw === framework)
  );
  $("#btn-generate").textContent = "⚙ Generate " + g.label;
  $("#btn-generate-all").textContent = "⚙ Generate " + g.label + " — all suites combined";
  $("#code-title").textContent = "Generated " + g.label;
}

async function setFramework(id) {
  if (!window.Generators.byId[id] || id === framework) return;
  framework = id;
  await saveSettings({ framework: id });
  syncFrameworkUi();

  // Re-render whatever is already on screen in the newly picked framework,
  // so the switch reads as "show me this suite as Playwright".
  if (!$("#view-code").classList.contains("active")) {
    generated = null;
    return;
  }
  if (codeSource === "project" && generatedSuitesRaw) {
    generated = gen().generateProjectFiles(generatedSuitesRaw);
  } else {
    const session = await getSession();
    if (!session || !(session.scenarios || []).some((s) => (s.steps || []).length)) return;
    generated = gen().generateFiles(session);
  }
  activeFile = null; // file paths differ per framework
  syncTabs();
  setFoot("Generated " + Object.keys(generated.files).length + " " + gen().label + " files");
}

$("#fw-switch").addEventListener("click", (e) => {
  const btn = e.target.closest(".fw");
  if (btn) setFramework(btn.dataset.fw);
});

/* ------------------------------ generate + code ------------------------------ */

async function hasSteps() {
  const session = await getSession();
  return session && (session.scenarios || []).some((s) => (s.steps || []).length);
}

// "suite" -> code came from the active session, so Play and Export act on it.
// "project" -> code is every saved suite merged into one repo, and Play chains
// through each suite in turn.
function setCodeSource(mode) {
  codeSource = mode;
  const isProject = mode === "project";
  $("#btn-play-2").title = isProject ? "Play every suite in this project, one after another" : "";
  syncFrameworkUi();
}

$("#btn-generate").addEventListener("click", async () => {
  const session = await getSession();
  if (!(await hasSteps())) {
    setFoot("Record at least one step first");
    return;
  }
  generated = gen().generateFiles(session);
  generatedSuitesRaw = null;
  activeFile = null;
  setFoot("Generated " + Object.keys(generated.files).length + " " + gen().label + " files");
  setCodeSource("suite");
  activeCodeTab = "spec";
  syncTabs();
  showView("view-code");
});

$("#btn-generate-all").addEventListener("click", async () => {
  const res = await send("EXPORT_ALL_SUITES");
  const suites = ((res && res.suites) || []).filter((s) =>
    (s.scenarios || []).some((sc) => (sc.steps || []).length)
  );
  if (!suites.length) {
    setFoot("No recorded steps in any suite yet");
    return;
  }
  generated = gen().generateProjectFiles(suites);
  if (!generated.files || !Object.keys(generated.files).length) {
    setFoot("Nothing to generate");
    return;
  }
  generatedSuitesRaw = suites;
  activeFile = null;
  setFoot(
    "Generated " +
      Object.keys(generated.files).length +
      " " +
      gen().label +
      " files from " +
      suites.length +
      " suite(s)"
  );
  setCodeSource("project");
  activeCodeTab = "spec";
  syncTabs();
  showView("view-code");
});

// Every framework lays its Page Object Model out the same way, so only the
// spec extension differs (.cy.js vs .spec.js).
function filesForTab(tab) {
  const p = Object.keys(generated.files);
  if (tab === "spec") return p.filter((x) => x.endsWith(gen().specSuffix));
  if (tab === "page") return p.filter((x) => x.includes("pages/"));
  if (tab === "locator") return p.filter((x) => x.includes("locator/"));
  if (tab === "message") return p.filter((x) => x.includes("messages/"));
  if (tab === "data") return p.filter((x) => x.includes("data/"));
  return p;
}

function syncTabs() {
  $$("#code-tabs .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === activeCodeTab)
  );
  if (!generated) {
    $("#code-out").textContent = "// Generate first";
    return;
  }
  if (activeCodeTab === "structure") {
    $("#filepick").innerHTML = "";
    $("#code-out").textContent = renderTree(Object.keys(generated.files));
    return;
  }
  const files = filesForTab(activeCodeTab);
  activeFile = files.includes(activeFile) ? activeFile : files[0];
  $("#filepick").innerHTML =
    files.length > 1
      ? `<select id="file-select">${files
          .map((f) => `<option ${f === activeFile ? "selected" : ""}>${f}</option>`)
          .join("")}</select>`
      : `<code>${activeFile || "(none)"}</code>`;
  const sel = $("#file-select");
  if (sel)
    sel.addEventListener("change", () => {
      activeFile = sel.value;
      $("#code-out").textContent = generated.files[activeFile] || "";
    });
  $("#code-out").textContent = activeFile ? generated.files[activeFile] : "// nothing on this tab";
}

function renderTree(paths) {
  const tree = {};
  paths.sort().forEach((p) => {
    let node = tree;
    p.split("/").forEach((seg) => {
      node[seg] = node[seg] || {};
      node = node[seg];
    });
  });
  const lines = [];
  (function walk(node, prefix) {
    const keys = Object.keys(node).sort();
    keys.forEach((k, idx) => {
      const last = idx === keys.length - 1;
      lines.push(prefix + (last ? "└── " : "├── ") + k);
      walk(node[k], prefix + (last ? "    " : "│   "));
    });
  })(tree, "");
  return lines.join("\n");
}

$("#code-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  activeCodeTab = tab.dataset.tab;
  syncTabs();
});
$("#btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#code-out").textContent);
    setFoot("Copied");
  } catch (e) {
    setFoot("Copy failed");
  }
});
$("#btn-code-back").addEventListener("click", () => {
  if (codeSource === "project") enterSuitesList();
  else enterSuite();
});

/* ------------------------------ export ------------------------------ */

function safeName(s) {
  return (
    String(s).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "cypress-project"
  );
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function exportFilesAsZip(files, rootLabel) {
  const root = safeName(rootLabel);
  const prefixed = {};
  Object.keys(files).forEach((p) => (prefixed[root + "/" + p] = files[p]));
  const blob = window.makeZip(prefixed);
  const filename = root + ".zip";
  try {
    const dataUrl = await blobToDataUrl(blob);
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: dataUrl, filename }, () => void chrome.runtime.lastError);
    } else {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setFoot("Exported " + filename);
  } catch (e) {
    setFoot("Export failed: " + e.message);
  }
}

async function exportProject() {
  const session = await getSession();
  if (!(await hasSteps())) {
    setFoot("Nothing to export");
    return;
  }
  const { files } = gen().generateFiles(session);
  // Tuck the raw session into the ZIP so the whole thing can be re-imported.
  // The folder name is part of the import contract — don't rename it.
  const filesWithSession = {
    ...files,
    ".cypress-recorder/session.json": JSON.stringify(session, null, 2)
  };
  await exportFilesAsZip(filesWithSession, session.projectName || session.suiteName);
}

async function exportGeneratedProject() {
  if (!generated || !generated.files || !Object.keys(generated.files).length) {
    setFoot("Nothing to export");
    return;
  }
  await exportFilesAsZip(generated.files, generated.projectName || "cypress-project");
}

$("#btn-export-1").addEventListener("click", exportProject);
$("#btn-export-2").addEventListener("click", () => {
  if (codeSource === "project") return exportGeneratedProject();
  return exportProject();
});

/* ------------------------------ session import / export ------------------------------ */

async function exportSession() {
  const session = await getSession();
  if (!session || !(session.scenarios || []).length) {
    setFoot("Nothing to save");
    return;
  }
  const json = JSON.stringify(session, null, 2);
  const filename =
    safeName((session.projectName || "") + "-" + (session.suiteName || "session")) +
    ".session.json";
  try {
    const dataUrl = await blobToDataUrl(
      new Blob([json], { type: "application/json" })
    );
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: dataUrl, filename }, () => void chrome.runtime.lastError);
    } else {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setFoot("Saved " + filename);
  } catch (e) {
    setFoot("Save failed: " + e.message);
  }
}

// -> { kind: "session", session } | { kind: "project", files }
async function readSessionFromFile(file) {
  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".zip")) {
    return { kind: "session", session: JSON.parse(await file.text()) };
  }

  // Only pull text we can actually read — skips large fixture images/videos.
  const entries = await window.readZip(await file.arrayBuffer(), (n) =>
    /\.(js|ts|json|md|txt|cy\.js)$/i.test(n)
  );

  // 1. Preferred: the raw session we tuck into every export.
  const sessionKey = Object.keys(entries).find((k) =>
    /(^|\/)\.?cypress-recorder\/session\.json$/.test(k) || /(^|\/)session\.json$/.test(k)
  );
  if (sessionKey && entries[sessionKey]) {
    return { kind: "session", session: JSON.parse(new TextDecoder().decode(entries[sessionKey])) };
  }

  // 2. Fallback: rebuild from the generated / hand-written Cypress project.
  const textFiles = {};
  const dec = new TextDecoder();
  Object.keys(entries).forEach((k) => {
    if (entries[k] && /\.(js|json|md|txt)$/i.test(k)) {
      try {
        textFiles[k] = dec.decode(entries[k]);
      } catch (e) {
        /* skip binary / undecodable */
      }
    }
  });
  if (!Object.keys(textFiles).length) {
    throw new Error("ZIP kosong atau tidak bisa dibaca.");
  }
  return { kind: "project", files: textFiles };
}

function renderImportReport(report, warnings) {
  const box = $("#import-report");
  if (!box) return;
  if (!report) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const parts = [];
  parts.push(`<h4>Imported ${report.scenarios} scenario(s) from ${report.specs} spec file(s)</h4>`);
  parts.push(
    `<div class="sum">${report.clean} play cleanly · ${report.partial} partial` +
      (report.empty ? ` · ${report.empty} empty` : "") +
      `</div>`
  );
  if (warnings && warnings.length) {
    const items = warnings
      .map(
        (w) =>
          `<li><span class="scn">${escapeHtml(w.scenario)}</span> — ${w.steps} step(s) kept` +
          `<br><span class="iss">${w.issues.map((i) => escapeHtml(i)).join(" · ")}</span></li>`
      )
      .join("");
    parts.push(
      `<details><summary>${warnings.length} scenario(s) had lines that can't replay in the browser</summary>` +
        `<ul>${items}</ul></details>`
    );
  }
  box.innerHTML = parts.join("");
  box.hidden = false;
}

async function installSession(session) {
  const report = session && session._report;
  const warnings = (session && session._warnings) || [];
  const res = await send("IMPORT_SESSION", { session });
  if (!res.ok) throw new Error(res.reason || "format tidak dikenali");
  generated = null;
  lastPlayArgs = null;
  stopPlayPoll();
  setFoot(
    "Imported “" + (res.suiteName || "session") + "” — " + (res.scenarios || 0) + " scenario(s)"
  );
  await boot();
  if (report) {
    showView("view-suite");
    renderImportReport(report, warnings);
  }
}

function renderSpecPicker(specs) {
  const box = $("#spec-picker");
  if (!box) return;
  const total = specs.reduce((n, s) => n + s.scenarios, 0);
  const opts = specs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (s) =>
        `<option value="${escapeAttr(s.path)}">${escapeHtml(s.name)} — ${s.scenarios} scenario${
          s.scenarios === 1 ? "" : "s"
        } (${escapeHtml(s.file)})</option>`
    )
    .join("");
  box.innerHTML = `
    <h4>${specs.length} test suites in this project</h4>
    <div class="sum">Each <code>.cy.js</code> file imports as one suite; every <code>it()</code> becomes a scenario.</div>
    <select id="spec-select">
      ${opts}
      <option value="__all">— All suites merged into one (${total} scenarios) —</option>
    </select>
    <div class="row">
      <button id="btn-spec-import" class="btn primary sm">Import selected suite</button>
      <button id="btn-spec-cancel" class="btn ghost sm">Cancel</button>
    </div>`;
  box.hidden = false;
  $("#btn-spec-import").addEventListener("click", importChosenSpec);
  $("#btn-spec-cancel").addEventListener("click", () => {
    pendingImport = null;
    box.hidden = true;
    box.innerHTML = "";
  });
}

async function importChosenSpec() {
  if (!pendingImport) return;
  const choice = $("#spec-select").value;
  const btn = $("#btn-spec-import");
  if (btn) btn.disabled = true;
  try {
    const session =
      choice === "__all"
        ? window.CypressImport.projectToSession(pendingImport.files)
        : window.CypressImport.projectToSession(pendingImport.files, choice);
    pendingImport = null;
    $("#spec-picker").hidden = true;
    $("#spec-picker").innerHTML = "";
    await installSession(session);
  } catch (e) {
    if (btn) btn.disabled = false;
    const err = $("#setup-error");
    const m = "Import gagal: " + (e && e.message ? e.message : e);
    if (err) err.textContent = m;
    setFoot(m);
  }
}

async function handleImportFile(file) {
  const err = $("#setup-error");
  if (err) err.textContent = "";
  renderImportReport(null);
  pendingImport = null;
  if ($("#spec-picker")) $("#spec-picker").hidden = true;
  try {
    const parsed = await readSessionFromFile(file);
    if (parsed.kind === "session") {
      await installSession(parsed.session);
      return;
    }
    // A Cypress project. One spec -> import straight; many -> let the user pick.
    const specs = window.CypressImport.listSpecs(parsed.files);
    if (specs.length > 1) {
      pendingImport = { files: parsed.files };
      showView("view-setup");
      renderSpecPicker(specs);
      setFoot(specs.length + " test suites found — pick one to import");
      return;
    }
    await installSession(window.CypressImport.projectToSession(parsed.files));
  } catch (e) {
    const m = "Import gagal: " + (e && e.message ? e.message : e);
    if (err) err.textContent = m;
    setFoot(m);
  }
}

$("#btn-export-session").addEventListener("click", exportSession);
$("#btn-import").addEventListener("click", () => $("#import-file").click());
$("#btn-import-2").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // let the same file be picked again later
  if (file) await handleImportFile(file);
});

/* ------------------------- playback (in-browser) ------------------------- */

let playPollTimer = null;
let lastPlayArgs = null;
let lastPlayQueueEntries = null; // last "play every suite" list, for Play again

function stopPlayPoll() {
  if (playPollTimer) clearInterval(playPollTimer);
  playPollTimer = null;
}

async function startPlayback(args) {
  const res = await send("PLAY_START", args);
  if (!res.ok) {
    setFoot(res.reason ? "Can't play: " + res.reason : "Can't play");
    return false;
  }
  lastPlayArgs = args;
  $("#play-summary").style.display = "none";
  $("#play-summary").innerHTML = "";
  $("#play-steps").innerHTML = "";
  $("#btn-play-again").style.display = "none";
  $("#btn-play-stop").style.display = "";
  showView("view-play");
  startPlayPoll();
  return true;
}

// Plays every given suite in turn, in the browser. The chain itself runs
// entirely in the background service worker (PLAY_SUITES_START), because
// Chrome closes this popup the instant the recorded tab takes focus — the
// same reason a single suite's own multi-scenario playback already lives in
// background.js instead of here. This function only kicks the chain off and
// starts polling PLAY_STATE, whose `suiteQueue` field reports progress.
async function startPlayAllSuites(entries) {
  if (!entries || !entries.length) {
    setFoot("Nothing to play");
    return;
  }
  const res = await send("PLAY_SUITES_START", { entries });
  if (!res.ok) {
    setFoot(res.reason ? "Can't play: " + res.reason : "Can't play");
    return;
  }
  lastPlayQueueEntries = entries;
  lastPlayArgs = null;
  $("#play-summary").style.display = "none";
  $("#play-summary").innerHTML = "";
  $("#play-steps").innerHTML = "";
  $("#btn-play-again").style.display = "none";
  $("#btn-play-stop").style.display = "";
  showView("view-play");
  startPlayPoll();
}

function startPlayPoll() {
  stopPlayPoll();
  renderPlayback();
  playPollTimer = setInterval(renderPlayback, 400);
}

async function renderPlayback() {
  const [pb, session] = await Promise.all([send("PLAY_STATE"), getSession()]);
  if (!session || !pb) return;
  const scenarios = session.scenarios || [];
  const plan = pb.plan && pb.plan.length ? pb.plan : [pb.scenarioIndex];

  let totalSteps = 0;
  plan.forEach((si) => {
    totalSteps += ((scenarios[si] || {}).steps || []).length;
  });
  const results = pb.results || [];
  const doneSteps = results.filter((r) => r.status !== "skipped").length;
  const pct = totalSteps ? Math.min(100, Math.round((doneSteps / totalSteps) * 100)) : 0;

  const fill = $("#play-progress-fill");
  fill.style.width = (pb.active ? pct : 100) + "%";
  fill.parentElement.classList.toggle("fail", pb.status === "failed");
  fill.parentElement.classList.toggle("pass", pb.status === "passed");

  $("#play-count").textContent = `${doneSteps} / ${totalSteps}`;
  if (pb.startedAt) {
    const end = pb.finishedAt || Date.now();
    $("#play-elapsed").textContent = ((end - pb.startedAt) / 1000).toFixed(1) + "s";
  }
  const queue = pb.suiteQueue;
  $("#play-title").textContent =
    queue && queue.entries && queue.entries.length
      ? `Suite ${Math.min(queue.idx + 1, queue.entries.length)}/${queue.entries.length}: ${(queue.entries[queue.idx] || {}).name || ""}`
      : plan.length > 1
        ? `Playing ${plan.length} scenarios`
        : "Playing: " + (pb.scenarioName || "scenario");

  const byKey = {};
  results.forEach((r) => {
    byKey[r.scenarioIndex + ":" + r.stepIndex] = r;
  });

  const html = [];
  plan.forEach((si) => {
    const sc = scenarios[si];
    if (!sc) return;
    if (plan.length > 1)
      html.push(
        `<div class="play-scn-head">${escapeHtml(sc.name || "Scenario " + (si + 1))}</div>`
      );
    (sc.steps || []).forEach((st, k) => {
      const r = byKey[si + ":" + k];
      const isCurrent = pb.active && pb.scenarioIndex === si && pb.stepIndex === k;
      let state = "pending";
      let icon = "•";
      if (r) {
        state = r.status;
        icon = r.status === "passed" ? "✓" : r.status === "failed" ? "✗" : "–";
      } else if (isCurrent) {
        state = "running";
        icon = "▸";
      }
      const name = st.elementName || st.url || st.action;
      html.push(`
        <div class="play-step ${state}">
          <span class="state ${state}">${icon}</span>
          <span class="pbody">
            <span class="pline">
              <span class="paction">${escapeHtml(st.action)}</span>
              <span class="pname">${escapeHtml(name)}</span>
              ${r && r.ms ? `<span class="pms">${r.ms}ms</span>` : ""}
            </span>
            ${
              r && r.message && (r.status === "failed" || r.status === "skipped")
                ? `<span class="err ${r.status}">${escapeHtml(r.message)}</span>`
                : ""
            }
            ${r && r.status === "failed" && r.diagnosis ? renderDiagnosis(r.diagnosis) : ""}
          </span>
        </div>`);
    });
  });
  $("#play-steps").innerHTML = html.join("");
  const running = $("#play-steps .play-step.running");
  if (running) running.scrollIntoView({ block: "nearest" });

  // While a suite queue is still active, background.js has already (or is
  // about to) start the next suite's playback — keep polling rather than
  // treating this suite's own finish as the end of the whole run.
  if (!pb.active && pb.status && pb.status !== "idle" && !(queue && queue.active)) {
    stopPlayPoll();
    $("#btn-play-stop").style.display = "none";
    $("#btn-play-again").style.display = "";
    if (queue && queue.summaries && queue.summaries.length) {
      renderMultiPlaySummary(queue.summaries);
      setFoot("Playback finished — " + queue.summaries.length + " suite(s)");
    } else {
      renderPlaySummary(pb);
      setFoot("Playback " + pb.status);
    }
  }
}

function renderPlaySummary(pb) {
  const box = $("#play-summary");
  box.style.display = "block";
  const results = pb.results || [];
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const secs = pb.startedAt ? ((pb.finishedAt || Date.now()) - pb.startedAt) / 1000 : 0;
  const cls = pb.status === "passed" ? "pass" : pb.status === "stopped" ? "err" : "fail";
  const label =
    pb.status === "passed" ? "PASSED" : pb.status === "stopped" ? "STOPPED" : "FAILED";
  const icon = pb.status === "passed" ? "✓" : pb.status === "stopped" ? "■" : "✕";
  const skipNote = skipped
    ? failed
      ? `${skipped} step${skipped === 1 ? "" : "s"} skipped (after the failure, or can't run in-browser).`
      : `${skipped} step${skipped === 1 ? "" : "s"} skipped — can't run in the browser (e.g. file upload). They are still in the exported project.`
    : "";
  box.innerHTML = `
    <div class="run-banner ${cls}"><span class="big">${icon}</span> ${label}</div>
    <div class="run-grid">
      <div class="cell"><div class="k">Duration</div><div class="v">${secs.toFixed(1)}s</div></div>
      <div class="cell"><div class="k">Steps</div><div class="v">${results.length}</div></div>
      <div class="cell"><div class="k">Passed</div><div class="v">${passed}</div></div>
      <div class="cell"><div class="k">Failed</div><div class="v">${failed}</div></div>
    </div>
    ${skipNote ? `<div class="hint">${skipNote}</div>` : ""}`;
}

function renderMultiPlaySummary(summaries) {
  const box = $("#play-summary");
  box.style.display = "block";
  if (!summaries.length) {
    box.innerHTML = `<div class="run-banner err"><span class="big">■</span> STOPPED</div>`;
    return;
  }
  const anyFailed = summaries.some((s) => s.status === "failed" || s.status === "error");
  const totalPassed = summaries.reduce((n, s) => n + (s.passed || 0), 0);
  const totalFailed = summaries.reduce((n, s) => n + (s.failed || 0), 0);
  const cls = anyFailed ? "fail" : "pass";
  const icon = anyFailed ? "✕" : "✓";
  const label = anyFailed ? "SOME SUITES FAILED" : "ALL SUITES PASSED";
  const rows = summaries
    .map((s) => {
      const ricon =
        s.status === "passed" ? "✓" : s.status === "stopped" ? "■" : s.status === "error" ? "⚠" : "✕";
      const tail =
        s.status === "error"
          ? "could not run"
          : `${s.passed || 0} passed${s.failed ? ", " + s.failed + " failed" : ""}`;
      return `<div class="play-scn-head">${ricon} ${escapeHtml(s.name)} — ${tail}</div>`;
    })
    .join("");
  box.innerHTML = `
    <div class="run-banner ${cls}"><span class="big">${icon}</span> ${label}</div>
    <div class="run-grid">
      <div class="cell"><div class="k">Suites</div><div class="v">${summaries.length}</div></div>
      <div class="cell"><div class="k">Passed steps</div><div class="v">${totalPassed}</div></div>
      <div class="cell"><div class="k">Failed steps</div><div class="v">${totalFailed}</div></div>
    </div>
    ${rows}`;
}

$("#btn-play-all").addEventListener("click", () => {
  lastPlayQueueEntries = null;
  startPlayback({ mode: "all" });
});
$("#btn-play-2").addEventListener("click", () => {
  if (codeSource === "project") {
    if (!generatedSuitesRaw || !generatedSuitesRaw.length) {
      setFoot("Nothing to play");
      return;
    }
    startPlayAllSuites(generatedSuitesRaw.map((s) => ({ id: s.id, name: s.suiteName || "Suite" })));
    return;
  }
  lastPlayQueueEntries = null;
  startPlayback({ mode: "all" });
});
$("#btn-play-scenario").addEventListener("click", async () => {
  lastPlayQueueEntries = null;
  await saveScenarioName();
  startPlayback({ mode: "one", index: editingIndex });
});
$("#btn-play-stop").addEventListener("click", async () => {
  // Stopping mid-chain ends the whole run — background.js records this
  // suite's partial result and won't advance to the next one.
  await send("PLAY_STOP");
  renderPlayback();
});
$("#btn-play-again").addEventListener("click", () => {
  if (lastPlayQueueEntries) {
    startPlayAllSuites(lastPlayQueueEntries);
    return;
  }
  if (lastPlayArgs) startPlayback(lastPlayArgs);
});
$("#btn-play-back").addEventListener("click", () => {
  stopPlayPoll();
  if (codeSource === "project") {
    showView("view-code");
    syncTabs();
    return;
  }
  enterSuite();
});

/* ------------------------------ settings ------------------------------ */

function getSettings() {
  return new Promise((r) =>
    chrome.storage.local.get("settings", ({ settings }) => r(settings || {}))
  );
}
function saveSettings(patch) {
  return getSettings().then(
    (s) => new Promise((r) => chrome.storage.local.set({ settings: { ...s, ...patch } }, r))
  );
}

/* ------------------------------ reset ------------------------------ */

$("#btn-reset").addEventListener("click", async () => {
  await send("PLAY_STOP");
  await send("RESET");
  generated = null;
  generatedSuitesRaw = null;
  codeSource = "suite";
  lastPlayArgs = null;
  stopPlayPoll();
  $("#setup-error").textContent = "";
  renderImportReport(null);
  pendingImport = null;
  if ($("#spec-picker")) {
    $("#spec-picker").hidden = true;
    $("#spec-picker").innerHTML = "";
  }
  setFoot("Session cleared");
  boot();
});

/* ------------------------------ boot ------------------------------ */

async function boot() {
  const settings = await getSettings();
  if (settings.framework && window.Generators.byId[settings.framework]) {
    framework = settings.framework;
  }
  syncFrameworkUi();

  const session = await getSession();
  if (session) {
    $("#projectName").value = session.projectName || "";
    $("#suiteName").value = session.suiteName === "My Suite" ? "" : session.suiteName || "";
    $("#targetUrl").value = session.targetUrl || "";
  }

  const pb = await send("PLAY_STATE");
  if (pb && pb.active) {
    lastPlayArgs = { mode: pb.mode || "one", index: pb.scenarioIndex };
    showView("view-play");
    startPlayPoll();
    return;
  }

  if (session && session.active) {
    showView("view-recording");
    return;
  }
  if (session && (session.scenarios || []).length) {
    enterSuite();
    return;
  }

  // Nothing currently open — offer the suite library instead of a blank
  // form when there's something in it to come back to.
  const res = await send("LIST_SUITES");
  if (res && res.suites && res.suites.length) {
    showView("view-suites");
    renderSuitesList(res.suites, res.activeSuiteId);
    return;
  }
  showView("view-setup");
}

document.addEventListener("DOMContentLoaded", boot);
