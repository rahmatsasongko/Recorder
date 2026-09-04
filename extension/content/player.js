// Content script: Playback Engine.
// Runs on every page alongside content.js. Executes ONE recorded step at a time
// on request from the background playback driver, draws a highlight on the target
// element, and reports pass / fail back.

(() => {
  if (window.__cypressPlayerInjected) return;
  window.__cypressPlayerInjected = true;

  /* ---------------------------------------------------------------------- *
   * Element resolution
   * ---------------------------------------------------------------------- */

  function isXPath(sel) {
    return /^\(*\s*\.?\/\//.test(sel) || sel.startsWith("(//");
  }

  function resolveEl(sel) {
    if (!sel) return null;
    try {
      if (isXPath(sel)) {
        const r = document.evaluate(
          sel,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return r.singleNodeValue || null;
      }
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function isVisible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0)
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function waitForEl(sel, { visible = false } = {}, timeout = 10000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const el = resolveEl(sel);
        if (el && (!visible || isVisible(el))) return resolve(el);
        if (Date.now() - started >= timeout) return resolve(el || null);
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  /* ---------------------------------------------------------------------- *
   * Event synthesis
   * ---------------------------------------------------------------------- */

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
  }

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fireMouse(el, type) {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2
      })
    );
  }

  const KEY_MAP = {
    "{enter}": "Enter",
    "{tab}": "Tab",
    "{esc}": "Escape",
    "{upArrow}": "ArrowUp",
    "{downArrow}": "ArrowDown",
    "{leftArrow}": "ArrowLeft",
    "{rightArrow}": "ArrowRight",
    "{backspace}": "Backspace"
  };

  /* ---------------------------------------------------------------------- *
   * Actions — each returns { status, message?, el? }
   * ---------------------------------------------------------------------- */

  const ok = (el, message) => ({ status: "passed", message: message || "", el });
  const bad = (message, el) => ({ status: "failed", message, el: el || null });
  const skip = (message, el) => ({ status: "skipped", message, el: el || null });

  async function runAction(step) {
    const a = step.action;

    if (a === "scroll") {
      const [x, y] = String(step.value || "0,0").split(",").map((n) => Number(n) || 0);
      window.scrollTo(x, y);
      return ok(null, `scrolled to ${x}, ${y}`);
    }

    if (a === "assert") return runAssert(step);

    // A real file upload needs the OS file picker + the file on disk — neither is
    // possible from a page script. Skip it here; the generated Cypress uses
    // cy.selectFile() with a fixture.
    if (a === "upload") {
      return skip(
        `upload "${truncate(step.value)}" dilewati — jalankan lewat Cypress (cy.selectFile + fixture)`,
        resolveEl(step.selector)
      );
    }

    if (!step.selector) return bad(`no selector for ${a}`);

    const needVisible = a === "click" || a === "type" || a === "clear" || a === "select";
    const el = await waitForEl(step.selector, { visible: needVisible });
    if (!el) return bad(`element not found: ${step.selector}`);

    // Clicking a file input opens the native picker and stalls playback.
    if (el.tagName === "INPUT" && el.type === "file") {
      return skip("klik file input dilewati (butuh Cypress cy.selectFile)", el);
    }

    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (e) {
      /* jsdom-less browsers */
    }

    switch (a) {
      case "click": {
        fireMouse(el, "mousedown");
        try {
          el.focus({ preventScroll: true });
        } catch (e) {}
        fireMouse(el, "mouseup");
        el.click();
        return ok(el, "clicked");
      }

      case "type": {
        try {
          el.focus({ preventScroll: true });
        } catch (e) {}
        if (el.isContentEditable) {
          el.textContent = step.value == null ? "" : String(step.value);
          el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        } else {
          setNativeValue(el, step.value == null ? "" : String(step.value));
          fireInput(el);
        }
        return ok(el, `typed "${truncate(step.value)}"`);
      }

      case "clear": {
        if (el.isContentEditable) {
          el.textContent = "";
          el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        } else {
          setNativeValue(el, "");
          fireInput(el);
        }
        return ok(el, "cleared");
      }

      case "select": {
        const want = String(step.value == null ? "" : step.value).trim();
        const opts = Array.from(el.options || []);
        const opt =
          opts.find((o) => o.text.trim() === want) ||
          opts.find((o) => o.value === want) ||
          opts.find((o) => o.text.trim().includes(want));
        if (!opt) return bad(`option not found: "${want}"`, el);
        el.value = opt.value;
        fireInput(el);
        return ok(el, `selected "${opt.text.trim()}"`);
      }

      case "check":
      case "uncheck": {
        const target = a === "check";
        if (el.checked !== target) el.click();
        if (el.checked !== target) {
          el.checked = target;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return el.checked === target ? ok(el, a + "ed") : bad(`could not ${a}`, el);
      }

      case "submit": {
        const form = el.tagName === "FORM" ? el : el.closest("form");
        if (!form) return bad("no <form> to submit", el);
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
        return ok(el, "submitted");
      }

      case "keydown": {
        const key = step.key || KEY_MAP[step.value] || "Enter";
        let notPrevented = true;
        for (const t of ["keydown", "keypress", "keyup"]) {
          const ev = new KeyboardEvent(t, { key, bubbles: true, cancelable: true });
          const dispatched = el.dispatchEvent(ev);
          if (t === "keydown") notPrevented = dispatched;
        }
        if (key === "Enter" && notPrevented && el.form) {
          if (el.form.requestSubmit) el.form.requestSubmit();
          else el.form.submit();
        }
        return ok(el, `pressed ${key}`);
      }

      default:
        return bad(`unsupported action: ${a}`, el);
    }
  }

  async function runAssert(step) {
    const as = step.assertion || { type: "exist" };
    const type = as.type || "exist";
    const val = as.value == null ? "" : String(as.value);

    if (type === "url") {
      const hay = location.href + " " + location.pathname;
      return hay.includes(val)
        ? ok(null, `url includes "${val}"`)
        : bad(`url "${location.pathname}" does not include "${val}"`);
    }

    if (type === "contain") {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      if (!step.selector) {
        await waitForEl("body");
        const text = norm(document.body.innerText || document.body.textContent);
        return text.includes(val)
          ? ok(null, `page contains "${truncate(val)}"`)
          : bad(`page does not contain "${truncate(val)}"`);
      }
      // cy.contains(selector, text): any element matching the selector whose
      // text includes the value — not just the first one.
      await waitForEl(step.selector);
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(step.selector));
      } catch (e) {
        return bad(`bad selector: ${step.selector}`);
      }
      if (!matches.length) return bad(`element not found: ${step.selector}`);
      const hit = matches.find((el) => norm(el.innerText || el.textContent).includes(val));
      if (hit) return ok(hit, `contains "${truncate(val)}"`);
      return bad(`no ${step.selector} contains "${truncate(val)}"`, matches[0]);
    }

    if (!step.selector) return bad("no selector for assertion");

    if (type === "value") {
      const el = await waitForEl(step.selector);
      if (!el) return bad(`element not found: ${step.selector}`);
      const actual = el.value == null ? "" : String(el.value);
      return actual === val
        ? ok(el, `value is "${truncate(val)}"`)
        : bad(`value is "${truncate(actual)}", expected "${truncate(val)}"`, el);
    }

    // visible | exist
    const el = await waitForEl(step.selector, { visible: type === "visible" });
    if (!el) return bad(`element not found: ${step.selector}`);
    if (type === "visible" && !isVisible(el)) return bad("element is not visible", el);
    return ok(el, type === "visible" ? "is visible" : "exists");
  }

  function truncate(s, n = 40) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  /* ---------------------------------------------------------------------- *
   * Highlight overlay
   * ---------------------------------------------------------------------- */

  let box = null;
  let cap = null;
  let toast = null;

  function host() {
    return document.body || document.documentElement;
  }

  function ensureStyle() {
    if (document.getElementById("cyp-style")) return;
    const style = document.createElement("style");
    style.id = "cyp-style";
    style.textContent = `
      .cyp-box, .cyp-cap, .cyp-toast {
        position: fixed; pointer-events: none;
        z-index: 2147483647;
        font: 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .cyp-box {
        border: 2px solid #0969da; border-radius: 3px;
        background: rgba(9,105,218,.10);
        box-shadow: 0 0 0 2px rgba(255,255,255,.65);
        transition: all .12s ease-out;
      }
      .cyp-box.cyp-fail { border-color: #cf222e; background: rgba(207,34,46,.12); }
      .cyp-cap {
        background: #0969da; color: #fff; padding: 2px 6px; border-radius: 4px;
        max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .cyp-cap.cyp-fail { background: #cf222e; }
      .cyp-toast {
        top: 12px; left: 50%; transform: translateX(-50%);
        background: rgba(13,17,23,.92); color: #e6edf3;
        padding: 6px 14px; border-radius: 999px; max-width: 80vw;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearBox() {
    if (box) box.remove();
    if (cap) cap.remove();
    box = cap = null;
  }

  function clearAll() {
    clearBox();
    if (toast) toast.remove();
    toast = null;
  }

  function flash(el, label, good) {
    ensureStyle();
    clearBox();
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    box = document.createElement("div");
    box.className = "cyp-box" + (good ? "" : " cyp-fail");
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    cap = document.createElement("div");
    cap.className = "cyp-cap" + (good ? "" : " cyp-fail");
    cap.textContent = label;
    cap.style.left = r.left + "px";
    cap.style.top = Math.max(2, r.top - 20) + "px";
    host().appendChild(box);
    host().appendChild(cap);
  }

  function showToast(text, good) {
    ensureStyle();
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "cyp-toast";
      host().appendChild(toast);
    }
    toast.textContent = text;
    toast.style.background = good === false ? "rgba(207,34,46,.95)" : "rgba(13,17,23,.92)";
  }

  /* ---------------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------------- */

  // While this attribute is on <html>, the MAIN-world guard (injected by the
  // background driver) swallows any attempt to open a native file picker.
  let playingTimer = null;
  function markPlaying() {
    try {
      document.documentElement.setAttribute("data-cyp-playing", "1");
    } catch (e) {}
    clearTimeout(playingTimer);
    playingTimer = setTimeout(clearPlaying, 8000);
  }
  function clearPlaying() {
    clearTimeout(playingTimer);
    try {
      document.documentElement.removeAttribute("data-cyp-playing");
    } catch (e) {}
  }

  async function execStep(msg) {
    const step = msg.step || {};
    const name = step.elementName || step.url || step.action;
    const t0 = performance.now();
    markPlaying();
    let res;
    try {
      try {
        showToast(`#${msg.n || "?"}/${msg.total || "?"}  ${step.action}  —  ${name}`);
      } catch (e) {}
      res = await runAction(step);
    } catch (e) {
      res = { status: "failed", message: String((e && e.message) || e), el: null };
    }
    if (!res || !res.status) res = { status: "failed", message: "no result", el: null };
    const ms = Math.round(performance.now() - t0);
    const good = res.status !== "failed";
    try {
      if (res.el) flash(res.el, `${step.action}: ${name}`, good);
      if (res.status === "failed") showToast(`✗  ${step.action}  —  ${res.message}`, false);
      else if (res.status === "skipped") showToast(`⤼  ${step.action}  —  ${res.message}`);
    } catch (e) {}
    return { status: res.status, message: res.message || "", ms };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PLAY_STEP") {
      execStep(msg).then(sendResponse, (e) =>
        sendResponse({ status: "failed", message: String((e && e.message) || e), ms: 0 })
      );
      return true;
    }
    if (msg.type === "PLAY_STOP") {
      clearPlaying();
      clearAll();
      sendResponse({ ok: true });
      return;
    }
  });

  // Tell the driver a (possibly fresh, post-navigation) content script is ready —
  // but only while a playback is actually running, so idle pages stay quiet.
  function hello() {
    try {
      chrome.storage.local.get("playback", ({ playback }) => {
        if (chrome.runtime.lastError || !playback || !playback.active) return;
        markPlaying();
        chrome.runtime.sendMessage({ type: "PLAY_HELLO" }, () => void chrome.runtime.lastError);
      });
    } catch (e) {
      /* extension context invalidated */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hello);
  } else {
    hello();
  }
})();
