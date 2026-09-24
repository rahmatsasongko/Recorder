/* Cypress Recorder — popup controller (v2, multi-scenario suites) */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ------------------------------ icon system (Lucide) ------------------------------ */
// Every icon in the UI used to be an emoji, which renders inconsistently
// across OS emoji fonts. These are inline Lucide icons instead — no CDN/font
// dependency (safe under the extension's default CSP), colored via
// `currentColor` so they follow the button's text color automatically.

const ICON_PATHS = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  "circle-help": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  "trash-2": '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "triangle-alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" x2="7" y1="2" y2="22"/><line x1="17" x2="17" y1="2" y2="22"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="2" x2="7" y1="7" y2="7"/><line x1="2" x2="7" y1="17" y2="17"/><line x1="17" x2="22" y1="17" y2="17"/><line x1="17" x2="22" y1="7" y2="7"/>',
  "mouse-pointer-click": '<path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'
};

function svgIcon(name, size = 14) {
  const inner = ICON_PATHS[name];
  if (!inner) return "";
  return (
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
  );
}

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
let framework = window.Generators.DEFAULT_ID; // cypress | playwright | webdriverio | selenium

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
      const r = res || {};
      // background.js surfaces a full/broken chrome.storage.local as
      // reason:"storage_error" instead of silently dropping the write —
      // show it everywhere a call site just fires-and-forgets the result.
      if (r.ok === false && r.reason === "storage_error") {
        setFoot("Gagal menyimpan — penyimpanan penuh atau bermasalah: " + (r.message || ""));
      }
      resolve(r);
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
  updateCrumb(id);
  if (id === "view-recording") startPolling();
  else stopPolling();
  if (id !== "view-play") stopPlayPoll();
}
function setFoot(m) {
  $("#foot-status").textContent = m;
}

// The topbar switcher used to be a plain "Semua suite" button in the
// sidebar; it now doubles as a breadcrumb showing which suite is open,
// which is why every view change refreshes it here instead of leaving it
// static.
async function updateCrumb(viewId) {
  const label = $("#crumb-suite");
  if (!label) return;
  if (viewId === "view-suites") {
    label.textContent = "Semua suite";
    return;
  }
  const session = await getSession();
  label.textContent = (session && session.suiteName) || "Suite baru";
}

// Runs an async/sync action while a button shows a busy label and is
// disabled — Generate/Export can take a moment on a large merged project,
// and the only feedback before this was the footer text changing once it
// was already done.
async function withBusy(btn, busyLabel, fn) {
  if (!btn) return fn();
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = busyLabel;
  // Let the busy label actually paint before any synchronous, potentially
  // slow work (code generation) blocks the main thread.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ------------------------------ setup ------------------------------ */

// Non-blocking: warns if another saved suite already has this name, but
// never stops the user from starting anyway (two suites can legitimately
// share a name, e.g. re-testing the same flow later) — see Product review
// item "duplicate suite/scenario names".
async function checkSuiteNameDuplicate() {
  const box = $("#suiteName-warning");
  const name = $("#suiteName").value.trim();
  if (!box) return;
  if (!name) {
    box.hidden = true;
    return;
  }
  const res = await send("LIST_SUITES");
  const suites = (res && res.suites) || [];
  const dupe = suites.some((s) => (s.suiteName || "").trim().toLowerCase() === name.toLowerCase());
  box.innerHTML = dupe
    ? `${svgIcon("triangle-alert")} Sudah ada suite bernama "${escapeHtml(name)}" — kamu tetap bisa lanjut, tapi pertimbangkan nama yang lebih spesifik.`
    : "";
  box.hidden = !dupe;
}
$("#suiteName").addEventListener("blur", checkSuiteNameDuplicate);

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
  setFoot("Merekam Scenario 1");
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
  $("#rec-label").textContent = paused ? "Dijeda" : "Merekam";
  $("#btn-pause").innerHTML = paused ? svgIcon("play") + " Lanjut" : svgIcon("pause") + " Jeda";
  const iframeBanner = $("#iframe-banner");
  if (iframeBanner) iframeBanner.hidden = !session.hasIframes;
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
  if (min < 1) return "baru saja";
  if (min < 60) return min + "m lalu";
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + "j lalu";
  return Math.round(hr / 24) + "h lalu";
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
      const name = s.suiteName || "Suite tanpa nama";
      return `
      <div class="scn${isActive ? " current" : ""}" data-id="${escapeAttr(s.id)}">
        <span class="num">${i + 1}</span>
        <span class="meta" data-op="open">
          <div class="nm">${escapeHtml(name)}</div>
          <div class="sub">
            <span>${escapeHtml(s.projectName || "")}</span>
            <span>${s.scenarioCount} scenario${s.scenarioCount === 1 ? "" : "s"}</span>
            ${isActive ? '<span class="chip recorded">current</span>' : s.updatedAt ? `<span>${fmtWhen(s.updatedAt)}</span>` : ""}
          </div>
        </span>
        <span class="tools">
          <button class="icon-btn gen" data-op="gen" title="Generate kode" aria-label="Generate kode untuk suite ${escapeAttr(name)}">${svgIcon("code")}</button>
          <button class="icon-btn play" data-op="open" title="Buka suite ini" aria-label="Buka suite ${escapeAttr(name)}">${svgIcon("arrow-right")}</button>
          <button class="icon-btn del" data-op="del" title="Hapus suite" aria-label="Hapus suite ${escapeAttr(name)}">${svgIcon("trash-2")}</button>
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
    const nm = row.querySelector(".nm")?.textContent || "suite ini";
    if (!confirm(`Hapus "${nm}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    await send("DELETE_SUITE", { id });
    enterSuitesList();
    return;
  }
  if (op === "gen") {
    setFoot("Menyiapkan kode " + gen().label + "…");
    const res = await send("SWITCH_SUITE", { id });
    if (!res.ok) {
      setFoot("Tidak bisa membuka suite itu");
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
      setFoot("Suite ini belum punya step yang direkam");
      enterSuite();
      return;
    }
    try {
      generated = gen().generateFiles(session);
    } catch (e) {
      setFoot("Gagal generate kode: " + (e && e.message ? e.message : e));
      return;
    }
    generatedSuitesRaw = null;
    activeFile = null;
    setFoot("Berhasil generate " + Object.keys(generated.files).length + " file " + gen().label);
    setCodeSource("suite");
    activeCodeTab = "spec";
    syncTabs();
    showView("view-code");
    return;
  }
  setFoot("Membuka suite…");
  const res = await send("SWITCH_SUITE", { id });
  if (!res.ok) {
    setFoot("Tidak bisa membuka suite itu");
    return;
  }
  setFoot("Suite dibuka");
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
    setFoot("Tidak ada suite untuk diekspor");
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
    // A backup has to restore everything, so it keeps passwords — say so.
    const kept = suites.reduce((n, s) => n + countSecrets(s.scenarios, true), 0);
    setFoot(
      "Berhasil ekspor " + suites.length + " suite" +
        (kept ? " — berisi " + kept + " password dalam teks biasa, jangan dibagikan" : "")
    );
  } catch (e) {
    setFoot("Ekspor gagal: " + e.message);
  }
}

async function handleImportAllFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data && Array.isArray(data.suites) ? data.suites : null;
    if (!list) throw new Error("bukan file bundle suite yang valid");
    const res = await send("IMPORT_ALL_SUITES", { suites: list });
    if (!res.ok) throw new Error(res.reason || "import gagal");
    setFoot("Berhasil impor " + res.added + " suite");
    enterSuitesList();
  } catch (e) {
    setFoot("Import gagal: " + (e && e.message ? e.message : e));
  }
}

$("#btn-export-suites").addEventListener("click", () =>
  withBusy($("#btn-export-suites"), svgIcon("download") + " Exporting…", exportAllSuites)
);
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
    if (lp && lp.status === "passed") chip = `<span class="chip passed">${svgIcon("check", 10)} passed</span>`;
    else if (lp && lp.status === "failed")
      chip = `<span class="chip failed">${svgIcon("x", 10)} ${lp.failed} failed</span>`;
    else if (!sc.saved) chip = `<span class="chip unsaved">unsaved</span>`;
    else chip = `<span class="chip recorded">recorded</span>`;

    const scName = sc.name || "Scenario " + (i + 1);
    row.innerHTML = `
      <button class="icon-btn play" data-op="play" title="Jalankan scenario ini di browser" aria-label="Jalankan scenario ${escapeAttr(scName)}">${svgIcon("play")}</button>
      <span class="meta" data-op="edit">
        <div class="nm">${escapeHtml(scName)}</div>
        <div class="sub">
          <span>${sc.steps.length} step${sc.steps.length === 1 ? "" : "s"}</span>
          ${chip}
        </div>
      </span>
      <span class="tools">
        <button class="icon-btn" data-op="edit" title="Edit steps" aria-label="Edit scenario ${escapeAttr(scName)}">${svgIcon("pencil")}</button>
        <button class="icon-btn del" data-op="del" title="Hapus scenario" aria-label="Hapus scenario ${escapeAttr(scName)}">${svgIcon("trash-2")}</button>
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
    const nm = row.querySelector(".nm")?.textContent || "scenario ini";
    if (!confirm(`Hapus "${nm}"? Tindakan ini tidak bisa dibatalkan.`)) return;
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
    setFoot("Tidak bisa menambah scenario");
    return;
  }
  setFoot("Merekam Scenario " + (res.index + 1));
  showView("view-recording");
});

/* ------------------------------ scenario editor ------------------------------ */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i;

// Steps recorded before the upload→fixture normalization (background.js's
// ADD_STEP) still hold their original picked filename, which has no real
// file behind it. Migrate them in place the first time their scenario is
// opened, so the Value field, live playback and generated code all agree
// instead of only the newest recordings being normalized.
async function normalizeUploadSteps(index, steps) {
  let changed = false;
  const next = steps.map((s) => {
    if (s.action === "upload" && IMAGE_EXT.test(s.value || "") && s.value !== "tije-test-logo.png") {
      changed = true;
      return { ...s, value: "tije-test-logo.png", files: ["tije-test-logo.png"] };
    }
    return s;
  });
  if (changed) await send("UPDATE_SCENARIO", { index, steps: next });
  return changed ? next : steps;
}

async function openScenario(index) {
  const session = await getSession();
  if (!session || !session.scenarios[index]) return enterSuite();
  editingIndex = index;
  const sc = session.scenarios[index];
  $("#scenarioName").value = sc.name || "";
  const warn = $("#scenarioName-warning");
  if (warn) warn.hidden = true;
  const steps = await normalizeUploadSteps(index, sc.steps);
  renderSteps(steps);
  renderSelectorWarningBanner(steps);
  showView("view-scenario");
}

// Surfaces the same per-step ⚠ (selectorStable === false) as one summary at
// the top of the editor — otherwise it's easy to save/play a scenario
// without ever noticing a small icon buried in a collapsed step row, which
// is exactly the flakiness users have reported.
function renderSelectorWarningBanner(steps) {
  const box = $("#selector-warning-banner");
  if (!box) return;
  const unstable = (steps || []).filter((s) => s.selector && s.selectorStable === false).length;
  if (!unstable) {
    box.hidden = true;
    return;
  }
  box.innerHTML = `${svgIcon("triangle-alert")} ${unstable} dari ${steps.length} step memakai selector yang mungkin tidak stabil — review sebelum disimpan.`;
  box.hidden = false;
}

// Non-blocking duplicate-name warning, mirroring checkSuiteNameDuplicate.
async function checkScenarioNameDuplicate() {
  const box = $("#scenarioName-warning");
  const name = $("#scenarioName").value.trim();
  if (!box) return;
  if (!name) {
    box.hidden = true;
    return;
  }
  const session = await getSession();
  const dupe = (session?.scenarios || []).some(
    (sc, i) => i !== editingIndex && (sc.name || "").trim().toLowerCase() === name.toLowerCase()
  );
  box.innerHTML = dupe
    ? `${svgIcon("triangle-alert")} Sudah ada scenario bernama "${escapeHtml(name)}" di suite ini.`
    : "";
  box.hidden = !dupe;
}
$("#scenarioName").addEventListener("blur", checkScenarioNameDuplicate);

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

// Lightweight JS/TS syntax highlighter that mirrors the One Dark Pro theme
// (keywords purple, class/type names gold, function calls blue, variables &
// properties salmon, strings green, numbers/constants orange) — no external
// library, just tokenize + wrap in spans.
const JS_KEYWORDS =
  "const|let|var|function|class|extends|static|get|set|import|export|from|default|async|await|new|return|try|catch|finally|throw|if|else|for|while|switch|case|break|continue|typeof|instanceof|of|in|do|void|delete|yield";
const JS_CONSTANTS = "null|undefined|true|false|this|super";
const JS_TOKEN_RE = new RegExp(
  [
    "(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)", // 1: comment
    "(`(?:\\\\[\\s\\S]|[^`\\\\])*`|\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')", // 2: string
    "\\b(" + JS_CONSTANTS + ")\\b", // 3: constant
    "(\\b\\d+\\.?\\d*\\b)", // 4: number
    "\\b(" + JS_KEYWORDS + ")\\b", // 5: keyword
    "\\b([A-Z][\\w$]*)\\b", // 6: capitalized identifier — class/type
    "\\b([a-z_$][\\w$]*)(?=\\()", // 7: function call
    "\\b([a-z_$][\\w$]*)\\b", // 8: plain variable / property
  ].join("|"),
  "g"
);
function highlightJS(code) {
  const escaped = escapeHtml(code);
  return escaped.replace(
    JS_TOKEN_RE,
    (m, comment, string, constant, number, keyword, className, fnCall, variable) => {
      if (comment) return `<span class="hl-comment">${comment}</span>`;
      if (string) return `<span class="hl-string">${string}</span>`;
      if (constant) return `<span class="hl-number">${constant}</span>`;
      if (number) return `<span class="hl-number">${number}</span>`;
      if (keyword) return `<span class="hl-keyword">${keyword}</span>`;
      if (className) return `<span class="hl-class">${className}</span>`;
      if (fnCall) return `<span class="hl-func">${fnCall}</span>`;
      if (variable) return `<span class="hl-var">${variable}</span>`;
      return m;
    }
  );
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
// A password: masked in the editor and the step list. It is still stored, in
// plain text, because playing the scenario in the browser has to type it —
// but generated projects read it from the environment instead (lib/gen-core.js).
function isSensitiveStep(step) {
  return !!step && (step.sensitive === true || step.inputType === "password");
}
const MASK = "••••••••";

// A step that carries a password. The same rule the generator uses
// (lib/gen-core.js), so what generated code reads from the environment and
// what an exported session drops always agree.
function isSecretValueStep(step) {
  const secret = window.GenCore ? window.GenCore.isSecretStep(step) : isSensitiveStep(step);
  if (!secret) return false;
  if (step.action === "type") return true;
  return step.action === "assert" && !!step.assertion && step.assertion.type === "value";
}
function secretValueOf(step) {
  return step.action === "assert" ? (step.assertion && step.assertion.value) || "" : step.value || "";
}
// How many passwords are stored in these scenarios / how many secret fields sit empty.
function countSecrets(scenarios, filled) {
  let n = 0;
  for (const sc of scenarios || []) {
    for (const st of sc.steps || []) {
      if (isSecretValueStep(st) && !!secretValueOf(st) === filled) n++;
    }
  }
  return n;
}
// A copy of `session` with every password blanked and its step kept (flagged
// sensitive), for anything that ends up in a project — a repo, a colleague —
// rather than in a personal backup.
function withoutSecrets(session) {
  const scenarios = (session.scenarios || []).map((sc) => ({
    ...sc,
    steps: (sc.steps || []).map((st) => {
      if (!isSecretValueStep(st)) return st;
      const next = { ...st, sensitive: true };
      if (st.action === "assert") next.assertion = { ...st.assertion, value: "" };
      else next.value = "";
      return next;
    })
  }));
  return { session: { ...session, scenarios }, blanked: countSecrets(session.scenarios, true) };
}

function previewOf(step) {
  if (step.action === "assert") {
    const a = step.assertion || {};
    const v = isSensitiveStep(step) ? MASK : a.value;
    return (a.type || "") + (v ? ` "${v}"` : "");
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
  if (step.value != null && step.value !== "") return isSensitiveStep(step) ? MASK : String(step.value);
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
        ? `<span class="warn" title="Selector mungkin tidak stabil">${svgIcon("triangle-alert", 12)}</span>`
        : "";

    const secret = isSensitiveStep(step);
    // autocomplete="new-password" keeps the browser from offering saved logins here.
    const secretAttrs = secret ? ' type="password" autocomplete="new-password"' : ' type="text"';

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
        <input class="fld-avalue"${secretAttrs} value="${escapeAttr(
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
        <input class="fld-value"${secretAttrs} value="${escapeAttr(
          step.value == null ? "" : step.value
        )}" />`;

    const selectorRow =
      step.action === "visit" || step.action === "scroll"
        ? `<label>URL</label><input class="fld-url" type="text" value="${escapeAttr(step.url || "")}" />`
        : `<label>Selector</label><input class="fld-selector" type="text" value="${escapeAttr(step.selector || "")}" />`;

    row.innerHTML = `
      <div class="summary" tabindex="0" role="button" aria-expanded="${openIdx.has(i)}">
        <svg class="drag-handle" title="Seret untuk mengurutkan ulang" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
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
          <button class="btn sm" data-op="up" aria-label="Pindahkan step ${i + 1} ke atas">↑ Naik</button>
          <button class="btn sm" data-op="down" aria-label="Pindahkan step ${i + 1} ke bawah">↓ Turun</button>
          <button class="btn sm" data-op="dup" aria-label="Duplikat step ${i + 1}">Duplikat</button>
          <button class="btn sm danger" data-op="del" aria-label="Hapus step ${i + 1}">Hapus</button>
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
  renderSelectorWarningBanner(next);
}

function toggleStepOpen(summary) {
  const step = summary.closest(".step");
  const open = step.classList.toggle("open");
  summary.setAttribute("aria-expanded", String(open));
}

$("#steps-list").addEventListener("click", (e) => {
  const summary = e.target.closest(".summary");
  if (summary && !e.target.closest("button")) {
    toggleStepOpen(summary);
    return;
  }
  const btn = e.target.closest("button[data-op]");
  if (!btn) return;
  const i = Number(btn.closest(".step").dataset.i);
  const op = btn.dataset.op;
  if (op === "del" && !confirm(`Hapus step ${i + 1}? Tindakan ini tidak bisa dibatalkan.`)) return;
  mutateSteps((steps) => {
    if (op === "del") steps.splice(i, 1);
    else if (op === "dup") steps.splice(i + 1, 0, JSON.parse(JSON.stringify(steps[i])));
    else if (op === "up" && i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
    else if (op === "down" && i < steps.length - 1)
      [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
    return steps;
  });
});

// Keyboard parity for the click-to-expand summary row — it's a plain <div>
// (role="button" + tabindex="0" from renderSteps), so Enter/Space need to be
// wired up manually the way a native <button> would get for free.
$("#steps-list").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const summary = e.target.closest(".summary");
  if (!summary) return;
  e.preventDefault();
  toggleStepOpen(summary);
});

/* ---- drag-to-reorder: grab the handle, drop on the step to land above/below ---- */

let dragFromIndex = null;

function clearDragMarkers() {
  $$("#steps-list .step").forEach((s) =>
    s.classList.remove("dragging", "drag-over-top", "drag-over-bottom")
  );
}

// Only the handle can start a drag — without this, `draggable` on the whole
// row would also pick up clicks meant for the summary/buttons.
$("#steps-list").addEventListener("mousedown", (e) => {
  const handle = e.target.closest(".drag-handle");
  if (!handle) return;
  const step = handle.closest(".step");
  if (step) step.draggable = true;
});
$("#steps-list").addEventListener("mouseup", () => {
  $$("#steps-list .step").forEach((s) => {
    if (!s.classList.contains("dragging")) s.draggable = false;
  });
});

$("#steps-list").addEventListener("dragstart", (e) => {
  const step = e.target.closest(".step");
  if (!step || !step.draggable) {
    e.preventDefault();
    return;
  }
  dragFromIndex = Number(step.dataset.i);
  step.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(dragFromIndex));
});

$("#steps-list").addEventListener("dragover", (e) => {
  const step = e.target.closest(".step");
  if (!step || dragFromIndex == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  $$("#steps-list .step").forEach((s) => s.classList.remove("drag-over-top", "drag-over-bottom"));
  const rect = step.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  step.classList.toggle("drag-over-top", before);
  step.classList.toggle("drag-over-bottom", !before);
});

$("#steps-list").addEventListener("drop", (e) => {
  const step = e.target.closest(".step");
  e.preventDefault();
  const from = dragFromIndex;
  dragFromIndex = null;
  clearDragMarkers();
  if (!step || from == null) return;
  const overIndex = Number(step.dataset.i);
  const rect = step.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  const to = before ? overIndex : overIndex + 1;
  if (to === from || to === from + 1) return; // dropped back where it started
  mutateSteps((steps) => {
    const [moved] = steps.splice(from, 1);
    steps.splice(from < to ? to - 1 : to, 0, moved);
    return steps;
  });
});

$("#steps-list").addEventListener("dragend", () => {
  dragFromIndex = null;
  $$("#steps-list .step").forEach((s) => (s.draggable = false));
  clearDragMarkers();
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
  setFoot("Tersimpan: " + name);
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
  $("#btn-generate").innerHTML = svgIcon("code") + " Generate " + g.label;
  $("#btn-generate-all").innerHTML = svgIcon("code") + " Generate " + g.label + " — gabungan semua suite";
  $("#code-title").textContent = "Kode " + g.label + " hasil generate";
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
  try {
    if (codeSource === "project" && generatedSuitesRaw) {
      generated = gen().generateProjectFiles(generatedSuitesRaw);
    } else {
      const session = await getSession();
      if (!session || !(session.scenarios || []).some((s) => (s.steps || []).length)) return;
      generated = gen().generateFiles(session);
    }
  } catch (e) {
    setFoot("Gagal generate kode: " + (e && e.message ? e.message : e));
    return;
  }
  activeFile = null; // file paths differ per framework
  syncTabs();
  setFoot("Berhasil generate " + Object.keys(generated.files).length + " file " + gen().label);
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
  $("#btn-play-2").title = isProject ? "Jalankan setiap suite di project ini, satu per satu" : "";
  syncFrameworkUi();
}

$("#btn-generate").addEventListener("click", async () => {
  if (!(await hasSteps())) {
    setFoot("Rekam minimal satu step dulu");
    return;
  }
  await withBusy($("#btn-generate"), svgIcon("code") + " Generating…", async () => {
    const session = await getSession();
    try {
      generated = gen().generateFiles(session);
    } catch (e) {
      setFoot("Gagal generate kode: " + (e && e.message ? e.message : e));
      return;
    }
    generatedSuitesRaw = null;
    activeFile = null;
    setFoot("Berhasil generate " + Object.keys(generated.files).length + " file " + gen().label);
    setCodeSource("suite");
    activeCodeTab = "spec";
    syncTabs();
    showView("view-code");
  });
});

$("#btn-generate-all").addEventListener("click", async () => {
  const btn = $("#btn-generate-all");
  const res = await send("EXPORT_ALL_SUITES");
  const suites = ((res && res.suites) || []).filter((s) =>
    (s.scenarios || []).some((sc) => (sc.steps || []).length)
  );
  if (!suites.length) {
    setFoot("Belum ada step yang direkam di suite manapun");
    return;
  }
  await withBusy(btn, svgIcon("code") + " Generating…", async () => {
    try {
      generated = gen().generateProjectFiles(suites);
    } catch (e) {
      setFoot("Gagal generate kode: " + (e && e.message ? e.message : e));
      return;
    }
    if (!generated.files || !Object.keys(generated.files).length) {
      setFoot("Tidak ada yang bisa di-generate");
      return;
    }
    generatedSuitesRaw = suites;
    activeFile = null;
    setFoot(
      "Generated " +
        Object.keys(generated.files).length +
        " file " +
        gen().label +
        " dari " +
        suites.length +
        " suite"
    );
    setCodeSource("project");
    activeCodeTab = "spec";
    syncTabs();
    showView("view-code");
  });
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
    $("#code-out").innerHTML = highlightJS("// Generate first");
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
      $("#code-out").innerHTML = highlightJS(generated.files[activeFile] || "");
    });
  $("#code-out").innerHTML = highlightJS(activeFile ? generated.files[activeFile] : "// nothing on this tab");
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
    setFoot("Tersalin");
  } catch (e) {
    setFoot("Gagal menyalin");
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

// Framework-appropriate folder for the fixture below — matches the "// TODO:
// put ... in <dir>" comment gen-core.js already writes next to every upload
// call, so the reference in the code and the file actually in the zip agree.
function fixtureDirFor(fw) {
  if (fw === "cypress") return "cypress/fixtures";
  if (fw === "webdriverio" || fw === "selenium") return "test/fixtures";
  return "fixtures";
}

async function exportFilesAsZip(files, rootLabel, note) {
  const root = safeName(rootLabel);
  const prefixed = {};
  Object.keys(files).forEach((p) => (prefixed[root + "/" + p] = files[p]));

  // gen-core.js swaps every recorded image-upload filename for
  // "tije-test-logo.png" (the recorder never captures real file bytes, so
  // the original name has nothing to point at). Embed the actual PNG here so
  // an exported project that references it can run immediately instead of
  // erroring on a fixture that was never there.
  if (Object.values(files).some((c) => typeof c === "string" && c.includes("tije-test-logo.png"))) {
    try {
      const res = await fetch(chrome.runtime.getURL("fixtures/tije-test-logo.png"));
      const bytes = new Uint8Array(await res.arrayBuffer());
      prefixed[root + "/" + fixtureDirFor(framework) + "/tije-test-logo.png"] = bytes;
    } catch (e) {
      /* best-effort — the code comment still tells the user where to put it */
    }
  }

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
    setFoot("Diekspor " + filename + (note || ""));
  } catch (e) {
    setFoot("Ekspor gagal: " + e.message);
  }
}

async function exportProject() {
  const session = await getSession();
  if (!(await hasSteps())) {
    setFoot("Tidak ada yang bisa diekspor");
    return;
  }
  let files;
  try {
    ({ files } = gen().generateFiles(session));
  } catch (e) {
    setFoot("Gagal generate kode: " + (e && e.message ? e.message : e));
    return;
  }
  // Tuck the session into the ZIP so the whole thing can be re-imported.
  // The folder name is part of the import contract — don't rename it.
  // Passwords are blanked first: the generated code already reads them from
  // the environment, and this file would otherwise carry them straight into
  // whatever repo the project lands in.
  const { session: safe, blanked } = withoutSecrets(session);
  const filesWithSession = {
    ...files,
    ".cypress-recorder/session.json": JSON.stringify(safe, null, 2)
  };
  await exportFilesAsZip(
    filesWithSession,
    session.projectName || session.suiteName,
    blanked ? " — " + blanked + " password tidak disertakan (isi lewat .env)" : ""
  );
}

async function exportGeneratedProject() {
  if (!generated || !generated.files || !Object.keys(generated.files).length) {
    setFoot("Tidak ada yang bisa diekspor");
    return;
  }
  await exportFilesAsZip(generated.files, generated.projectName || "cypress-project");
}

$("#btn-export-1").addEventListener("click", () =>
  withBusy($("#btn-export-1"), svgIcon("download") + " Exporting…", exportProject)
);
$("#btn-export-2").addEventListener("click", () =>
  withBusy($("#btn-export-2"), svgIcon("download") + " Exporting…", () =>
    codeSource === "project" ? exportGeneratedProject() : exportProject()
  )
);

/* ------------------------------ session import / export ------------------------------ */

async function exportSession() {
  const session = await getSession();
  if (!session || !(session.scenarios || []).length) {
    setFoot("Tidak ada yang bisa disimpan");
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
    // A backup has to restore everything, so unlike a project export it
    // keeps passwords — say so, since the file is easy to pass around.
    const kept = countSecrets(session.scenarios, true);
    setFoot(
      "Tersimpan " + filename + (kept ? " — berisi " + kept + " password dalam teks biasa, jangan dibagikan" : "")
    );
  } catch (e) {
    setFoot("Gagal menyimpan: " + e.message);
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
  parts.push(`<h4>Berhasil impor ${report.scenarios} scenario dari ${report.specs} file spec</h4>`);
  parts.push(
    `<div class="sum">${report.clean} berjalan bersih · ${report.partial} sebagian` +
      (report.empty ? ` · ${report.empty} kosong` : "") +
      `</div>`
  );
  if (warnings && warnings.length) {
    const items = warnings
      .map(
        (w) =>
          `<li><span class="scn">${escapeHtml(w.scenario)}</span> — ${w.steps} step disimpan` +
          `<br><span class="iss">${w.issues.map((i) => escapeHtml(i)).join(" · ")}</span></li>`
      )
      .join("");
    parts.push(
      `<details><summary>${warnings.length} scenario punya baris yang tidak bisa diputar ulang di browser</summary>` +
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
  // A project export leaves passwords out (see withoutSecrets) — remind whoever
  // imports it that they are empty and have to be filled in before playing.
  const empty = countSecrets(session.scenarios, false);
  setFoot(
    "Berhasil impor “" + (res.suiteName || "session") + "” — " + (res.scenarios || 0) + " scenario" +
      (empty ? " — " + empty + " password masih kosong, isi di editor sebelum Play" : "")
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
    <h4>${specs.length} test suite di project ini</h4>
    <div class="sum">Setiap file <code>.cy.js</code> diimpor sebagai satu suite; setiap <code>it()</code> menjadi satu scenario.</div>
    <select id="spec-select">
      ${opts}
      <option value="__all">— Semua suite digabung jadi satu (${total} scenario) —</option>
    </select>
    <div class="row">
      <button id="btn-spec-import" class="btn primary sm">Impor suite terpilih</button>
      <button id="btn-spec-cancel" class="btn ghost sm">Batal</button>
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
      setFoot(specs.length + " test suite ditemukan — pilih satu untuk diimpor");
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
    setFoot(res.reason ? "Tidak bisa dijalankan: " + res.reason : "Tidak bisa dijalankan");
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
    setFoot("Tidak ada yang bisa dijalankan");
    return;
  }
  const res = await send("PLAY_SUITES_START", { entries });
  if (!res.ok) {
    setFoot(res.reason ? "Tidak bisa dijalankan: " + res.reason : "Tidak bisa dijalankan");
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
        ? `Menjalankan ${plan.length} scenario`
        : "Menjalankan: " + (pb.scenarioName || "scenario");

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
      let icon = svgIcon("circle", 10);
      if (r) {
        state = r.status;
        icon = r.status === "passed" ? svgIcon("check", 12) : r.status === "failed" ? svgIcon("x", 12) : "–";
      } else if (isCurrent) {
        state = "running";
        icon = svgIcon("play", 10);
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
      setFoot("Selesai — " + queue.summaries.length + " suite");
    } else {
      renderPlaySummary(pb);
      setFoot(
        "Selesai: " +
          (pb.status === "passed" ? "berhasil" : pb.status === "stopped" ? "dihentikan" : "gagal")
      );
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
    pb.status === "passed" ? "BERHASIL" : pb.status === "stopped" ? "DIHENTIKAN" : "GAGAL";
  const icon =
    pb.status === "passed" ? svgIcon("check", 16) : pb.status === "stopped" ? svgIcon("square", 16) : svgIcon("x", 16);
  const skipNote = skipped
    ? failed
      ? `${skipped} step dilewati (setelah kegagalan, atau tidak bisa dijalankan di browser).`
      : `${skipped} step dilewati — tidak bisa dijalankan di browser (mis. upload file). Tetap ada di project hasil ekspor.`
    : "";
  box.innerHTML = `
    <div class="run-banner ${cls}"><span class="big">${icon}</span> ${label}</div>
    <div class="run-grid">
      <div class="cell"><div class="k">Durasi</div><div class="v">${secs.toFixed(1)}s</div></div>
      <div class="cell"><div class="k">Steps</div><div class="v">${results.length}</div></div>
      <div class="cell"><div class="k">Berhasil</div><div class="v">${passed}</div></div>
      <div class="cell"><div class="k">Gagal</div><div class="v">${failed}</div></div>
    </div>
    ${skipNote ? `<div class="hint">${skipNote}</div>` : ""}`;
}

function renderMultiPlaySummary(summaries) {
  const box = $("#play-summary");
  box.style.display = "block";
  if (!summaries.length) {
    box.innerHTML = `<div class="run-banner err"><span class="big">${svgIcon("square", 16)}</span> DIHENTIKAN</div>`;
    return;
  }
  const anyFailed = summaries.some((s) => s.status === "failed" || s.status === "error");
  const totalPassed = summaries.reduce((n, s) => n + (s.passed || 0), 0);
  const totalFailed = summaries.reduce((n, s) => n + (s.failed || 0), 0);
  const cls = anyFailed ? "fail" : "pass";
  const icon = anyFailed ? svgIcon("x", 16) : svgIcon("check", 16);
  const label = anyFailed ? "ADA SUITE YANG GAGAL" : "SEMUA SUITE BERHASIL";
  const rows = summaries
    .map((s) => {
      const ricon =
        s.status === "passed"
          ? svgIcon("check", 12)
          : s.status === "stopped"
            ? svgIcon("square", 12)
            : s.status === "error"
              ? svgIcon("triangle-alert", 12)
              : svgIcon("x", 12);
      const tail =
        s.status === "error"
          ? "tidak bisa dijalankan"
          : `${s.passed || 0} berhasil${s.failed ? ", " + s.failed + " gagal" : ""}`;
      return `<div class="play-scn-head">${ricon} ${escapeHtml(s.name)} — ${tail}</div>`;
    })
    .join("");
  box.innerHTML = `
    <div class="run-banner ${cls}"><span class="big">${icon}</span> ${label}</div>
    <div class="run-grid">
      <div class="cell"><div class="k">Suite</div><div class="v">${summaries.length}</div></div>
      <div class="cell"><div class="k">Step berhasil</div><div class="v">${totalPassed}</div></div>
      <div class="cell"><div class="k">Step gagal</div><div class="v">${totalFailed}</div></div>
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
      setFoot("Tidak ada yang bisa dijalankan");
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
  // This wipes the whole in-progress session (RESET in background.js) —
  // confirmed as the exact action behind the "kehilangan data" complaint,
  // since it used to fire instantly on a single click.
  if (!confirm("Hapus seluruh sesi yang sedang berjalan? Rekaman yang belum tersimpan ke suite akan hilang.")) {
    return;
  }
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
  setFoot("Sesi dihapus");
  boot();
});

/* ------------------------------ onboarding ------------------------------ */

function showOnboarding() {
  const el = $("#onboarding");
  if (el) el.hidden = false;
}
function hideOnboarding() {
  const el = $("#onboarding");
  if (el) el.hidden = true;
}
$("#btn-onboarding-done")?.addEventListener("click", async () => {
  hideOnboarding();
  await new Promise((r) => chrome.storage.local.set({ onboardingSeen: true }, r));
});
$("#btn-help")?.addEventListener("click", showOnboarding);

async function maybeShowOnboarding() {
  const { onboardingSeen } = await new Promise((r) =>
    chrome.storage.local.get("onboardingSeen", r)
  );
  if (!onboardingSeen) showOnboarding();
}

/* ------------------------------ boot ------------------------------ */

async function boot() {
  await maybeShowOnboarding();

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
