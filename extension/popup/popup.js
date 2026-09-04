/* Cypress Recorder — popup controller (v2, multi-scenario suites) */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const ACTIONS = [
  "visit", "click", "type", "clear", "select",
  "check", "uncheck", "keydown", "submit", "scroll", "upload", "assert"
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
let activeCodeTab = "spec";
let activeFile = null;
let pendingImport = null; // { files } while the spec picker is shown

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
  "view-setup": 0,
  "view-recording": 1,
  "view-suite": 2,
  "view-scenario": 2,
  "view-play": 3,
  "view-code": 3,
  "view-run": 3
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
  if (id !== "view-run") stopRunPoll();
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

function badgeClass(action) {
  if (action === "visit" || action === "scroll") return "nav";
  if (action === "click") return "click";
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
    else if (e.target.classList.contains("fld-assert")) {
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

/* ------------------------------ generate + code ------------------------------ */

async function hasSteps() {
  const session = await getSession();
  return session && (session.scenarios || []).some((s) => (s.steps || []).length);
}

$("#btn-generate").addEventListener("click", async () => {
  const session = await getSession();
  if (!(await hasSteps())) {
    setFoot("Record at least one step first");
    return;
  }
  generated = window.CypressGen.generateFiles(session);
  setFoot("Generated " + Object.keys(generated.files).length + " files");
  activeCodeTab = "spec";
  syncTabs();
  showView("view-code");
});

function filesForTab(tab) {
  const p = Object.keys(generated.files);
  if (tab === "spec") return p.filter((x) => x.endsWith(".cy.js"));
  if (tab === "page") return p.filter((x) => x.includes("/pages/"));
  if (tab === "locator") return p.filter((x) => x.includes("/locator/"));
  if (tab === "message") return p.filter((x) => x.includes("/messages/"));
  if (tab === "data") return p.filter((x) => x.includes("/data/"));
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
$("#btn-code-back").addEventListener("click", () => enterSuite());

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

async function exportProject() {
  const session = await getSession();
  if (!(await hasSteps())) {
    setFoot("Nothing to export");
    return;
  }
  const { files } = window.CypressGen.generateFiles(session);
  const root = safeName(session.projectName || session.suiteName);
  const prefixed = {};
  Object.keys(files).forEach((p) => (prefixed[root + "/" + p] = files[p]));
  // Tuck the raw session into the ZIP so the whole thing can be re-imported.
  prefixed[root + "/.cypress-recorder/session.json"] = JSON.stringify(session, null, 2);
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
$("#btn-export-1").addEventListener("click", exportProject);
$("#btn-export-2").addEventListener("click", exportProject);

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
  currentRunId = null;
  lastPlayArgs = null;
  stopRunPoll();
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

function stopPlayPoll() {
  if (playPollTimer) clearInterval(playPollTimer);
  playPollTimer = null;
}

async function startPlayback(args) {
  const res = await send("PLAY_START", args);
  if (!res.ok) {
    setFoot(res.reason ? "Can't play: " + res.reason : "Can't play");
    return;
  }
  lastPlayArgs = args;
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
  $("#play-title").textContent =
    plan.length > 1
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
          </span>
        </div>`);
    });
  });
  $("#play-steps").innerHTML = html.join("");
  const running = $("#play-steps .play-step.running");
  if (running) running.scrollIntoView({ block: "nearest" });

  if (!pb.active && pb.status && pb.status !== "idle") {
    stopPlayPoll();
    $("#btn-play-stop").style.display = "none";
    $("#btn-play-again").style.display = "";
    renderPlaySummary(pb);
    setFoot("Playback " + pb.status);
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
      : `${skipped} step${skipped === 1 ? "" : "s"} skipped — can't run in the browser (e.g. file upload). Use “Run via agent”.`
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

$("#btn-play-all").addEventListener("click", () => startPlayback({ mode: "all" }));
$("#btn-play-2").addEventListener("click", () => startPlayback({ mode: "all" }));
$("#btn-play-scenario").addEventListener("click", async () => {
  await saveScenarioName();
  startPlayback({ mode: "one", index: editingIndex });
});
$("#btn-play-stop").addEventListener("click", async () => {
  await send("PLAY_STOP");
  renderPlayback();
});
$("#btn-play-again").addEventListener("click", () => {
  if (lastPlayArgs) startPlayback(lastPlayArgs);
});
$("#btn-play-back").addEventListener("click", () => {
  stopPlayPoll();
  enterSuite();
});

/* ------------------------------ run automation ------------------------------ */

const DEFAULT_AGENT = "http://127.0.0.1:47654";
let runPollTimer = null;
let currentRunId = null;

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
function agentUrl() {
  return ($("#agentUrl").value.trim() || DEFAULT_AGENT).replace(/\/+$/, "");
}
async function fetchJson(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
  try {
    const res = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}
function setAgentBadge(state, text) {
  const b = $("#agent-badge");
  b.className = "agent-badge " + state;
  b.textContent = text;
}
async function checkAgent() {
  setAgentBadge("checking", "checking…");
  $("#agent-hint").textContent = "";
  try {
    const { ok, body } = await fetchJson(agentUrl() + "/health", {}, 3000);
    if (ok && body.ok) {
      if (!body.cypressInstalled) {
        setAgentBadge("offline", "no cypress");
        $("#agent-hint").textContent =
          "Agent is up but Cypress isn't installed — run `npm install` in the agent folder.";
        return false;
      }
      setAgentBadge("online", "connected");
      $("#agent-hint").textContent = "Agent v" + body.version + (body.busy ? " · busy" : " · ready");
      return true;
    }
    throw new Error("bad");
  } catch (e) {
    setAgentBadge("offline", "offline");
    $("#agent-hint").innerHTML =
      "Can't reach the agent. Start it: <code>cd agent &amp;&amp; npm install &amp;&amp; npm start</code>";
    return false;
  }
}
async function enterRun() {
  const s = await getSettings();
  $("#agentUrl").value = s.agentUrl || DEFAULT_AGENT;
  $("#runEnv").value = s.runEnv || "";
  $("#run-progress").style.display = "none";
  $("#run-result").style.display = "none";
  showView("view-run");
  const up = await checkAgent();
  if (up && s.lastRunId) {
    currentRunId = s.lastRunId;
    const r = await fetchJson(agentUrl() + "/run/" + currentRunId, {}, 5000).catch(() => null);
    if (r && r.ok && r.body && r.body.status) {
      if (["passed", "failed", "error"].includes(r.body.status)) renderRunResult(r.body);
      else pollRun();
    } else {
      currentRunId = null;
      await saveSettings({ lastRunId: null });
    }
  }
}
function parseEnv() {
  const raw = $("#runEnv").value.trim();
  if (!raw) return {};
  return JSON.parse(raw);
}
async function runViaAgent() {
  const session = await getSession();
  if (!(await hasSteps())) {
    $("#agent-hint").textContent = "No recorded steps to run.";
    return;
  }
  let env;
  try {
    env = parseEnv();
  } catch (e) {
    $("#agent-hint").textContent = "Cypress env is not valid JSON.";
    return;
  }
  await saveSettings({ agentUrl: agentUrl(), runEnv: $("#runEnv").value.trim() });
  if (!(await checkAgent())) return;

  const { model, files } = window.CypressGen.generateFiles(session);

  $("#run-result").style.display = "none";
  $("#run-progress").style.display = "block";
  $("#run-phase").textContent = "Uploading project…";
  $("#run-log").textContent = "";
  $("#btn-run-now").disabled = true;
  $("#btn-run-again").disabled = true;

  try {
    const { ok, status, body } = await fetchJson(
      agentUrl() + "/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: session.projectName,
          suiteName: session.suiteName,
          baseUrl: model.baseUrl,
          files,
          env
        })
      },
      20000
    );
    if (!ok) {
      $("#run-phase").textContent = "Agent error: " + (body.error || status);
      $("#btn-run-now").disabled = false;
      $("#btn-run-again").disabled = false;
      return;
    }
    currentRunId = body.runId;
    await saveSettings({ lastRunId: currentRunId });
    $("#run-phase").textContent = "Running Cypress…";
    pollRun();
  } catch (e) {
    $("#run-phase").textContent = "Failed to start run: " + e.message;
    $("#btn-run-now").disabled = false;
    $("#btn-run-again").disabled = false;
  }
}
function stopRunPoll() {
  if (runPollTimer) clearInterval(runPollTimer);
  runPollTimer = null;
}
function pollRun() {
  stopRunPoll();
  const tick = async () => {
    if (!currentRunId) return stopRunPoll();
    let data;
    try {
      const r = await fetchJson(agentUrl() + "/run/" + currentRunId, {}, 8000);
      if (!r.ok) {
        $("#run-phase").textContent = "Run not found on agent.";
        stopRunPoll();
        currentRunId = null;
        await saveSettings({ lastRunId: null });
        $("#btn-run-now").disabled = false;
        $("#btn-run-again").disabled = false;
        return;
      }
      data = r.body;
    } catch (e) {
      $("#run-phase").textContent = "Lost connection to agent…";
      return;
    }
    $("#run-progress").style.display = "block";
    $("#run-log").textContent = (data.log || []).join("\n");
    $("#run-log").scrollTop = $("#run-log").scrollHeight;
    $("#run-elapsed").textContent = data.elapsed ? " " + (data.elapsed / 1000).toFixed(0) + "s" : "";
    const phaseMap = {
      preparing: "Preparing…",
      running: "Running Cypress…",
      passed: "Passed",
      failed: "Failed",
      error: "Error"
    };
    $("#run-phase").textContent = phaseMap[data.status] || data.status;
    if (["passed", "failed", "error"].includes(data.status)) {
      stopRunPoll();
      $("#btn-run-now").disabled = false;
      $("#btn-run-again").disabled = false;
      renderRunResult(data);
    }
  };
  tick();
  runPollTimer = setInterval(tick, 2000);
}
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
  );
}
function renderRunResult(data) {
  $("#run-progress").style.display = "none";
  const box = $("#run-result");
  box.style.display = "block";

  if (data.status === "error") {
    $("#run-summary").innerHTML = `<div class="run-banner err"><span class="big">⚠</span> ${esc(
      data.error || "Run error"
    )}</div>`;
    $("#run-specs").innerHTML = `<pre class="code">${esc((data.log || []).join("\n"))}</pre>`;
    return;
  }
  const r = data.result || {};
  const pass = data.status === "passed";
  $("#run-summary").innerHTML = `
    <div class="run-banner ${pass ? "pass" : "fail"}">
      <span class="big">${pass ? "✓" : "✕"}</span> ${pass ? "PASSED" : "FAILED"}
    </div>
    <div class="run-grid">
      <div class="cell"><div class="k">Duration</div><div class="v">${((r.duration || 0) / 1000).toFixed(1)}s</div></div>
      <div class="cell"><div class="k">Tests</div><div class="v">${r.totalTests || 0}</div></div>
      <div class="cell"><div class="k">Passed</div><div class="v">${r.passed || 0}</div></div>
      <div class="cell"><div class="k">Failed</div><div class="v">${r.failed || 0}</div></div>
      <div class="cell"><div class="k">Browser</div><div class="v">${esc(r.browser || "electron")}</div></div>
      <div class="cell"><div class="k">Cypress</div><div class="v">${esc(r.cypressVersion || "-")}</div></div>
    </div>`;

  const base = agentUrl() + "/run/" + currentRunId + "/file?path=";
  $("#run-specs").innerHTML = (r.specs || [])
    .map((sp) => {
      const tests = sp.tests
        .map(
          (t) => `
        <div class="test-line">
          <span class="st ${t.state}">${t.state === "passed" ? "✓" : t.state === "failed" ? "✕" : "•"}</span>
          <span>${esc(t.title)}${t.error ? `<div class="err">${esc(t.error)}</div>` : ""}</span>
        </div>`
        )
        .join("");
      const shots = (sp.screenshots || [])
        .map((p) => `<img src="${base}${encodeURIComponent(p)}" alt="screenshot" />`)
        .join("");
      const video = sp.video
        ? `<video controls src="${base}${encodeURIComponent(sp.video)}"></video>`
        : "";
      return `<div class="spec-block"><h4>${esc(sp.spec)}</h4>${tests}${
        shots || video ? `<div class="shots">${shots}${video}</div>` : ""
      }</div>`;
    })
    .join("");
}

$("#btn-run-1").addEventListener("click", enterRun);
$("#btn-run-2").addEventListener("click", enterRun);
$("#btn-run-back").addEventListener("click", () => enterSuite());
$("#btn-agent-recheck").addEventListener("click", checkAgent);
$("#btn-run-now").addEventListener("click", runViaAgent);
$("#btn-run-again").addEventListener("click", runViaAgent);

/* ------------------------------ reset ------------------------------ */

$("#btn-reset").addEventListener("click", async () => {
  await send("PLAY_STOP");
  await send("RESET");
  await saveSettings({ lastRunId: null });
  generated = null;
  currentRunId = null;
  lastPlayArgs = null;
  stopRunPoll();
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
  showView("view-setup");
}

document.addEventListener("DOMContentLoaded", boot);
