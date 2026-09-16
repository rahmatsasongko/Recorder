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

  // A text selector holds the element's visible label, not CSS, so it is
  // matched by scanning elements of the recorded tag.
  function resolveByText(text, tag) {
    const wanted = String(text).replace(/\s+/g, " ").trim();
    const list = document.getElementsByTagName(tag || "*");
    for (let i = 0; i < list.length; i++) {
      if ((list[i].textContent || "").replace(/\s+/g, " ").trim() === wanted) {
        return list[i];
      }
    }
    return null;
  }

  function resolveEl(sel, type, tag) {
    if (!sel) return null;
    try {
      if (type === "text") return resolveByText(sel, tag);
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function waitForEl(sel, { visible = false, type, tag } = {}, timeout = 10000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const el = resolveEl(sel, type, tag);
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

  // Drag a resize grip by (dx, dy). Resizable widgets listen for mousemove /
  // mouseup on `document` once the drag starts, and they need several
  // intermediate moves — one jump from start to end is usually ignored.
  async function dragBy(el, dx, dy, steps = 10) {
    const r = el.getBoundingClientRect();
    const x0 = r.left + r.width / 2;
    const y0 = r.top + r.height / 2;

    const at = (type, x, y, target) =>
      (target || el).dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: type === "mouseup" ? 0 : 1,
          clientX: Math.round(x),
          clientY: Math.round(y)
        })
      );

    at("mouseover", x0, y0);
    at("mousedown", x0, y0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      at("mousemove", x0 + dx * t, y0 + dy * t, document);
      await sleep(16);
    }
    at("mouseup", x0 + dx, y0 + dy, document);
  }

  // Drag from one element onto another, ending over the target's centre.
  async function dragOnto(src, dst, steps = 12) {
    const a = src.getBoundingClientRect();
    const b = dst.getBoundingClientRect();
    return dragBy(
      src,
      b.left + b.width / 2 - (a.left + a.width / 2),
      b.top + b.height / 2 - (a.top + a.height / 2),
      steps
    );
  }

  // HTML5 drag-and-drop ignores synthetic mouse moves: the browser only
  // reacts to dragstart/dragover/drop, and all three must share one
  // DataTransfer so the payload survives the trip.
  function html5DragOnto(src, dst) {
    const dt = new DataTransfer();
    const fire = (el, type) =>
      el.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    fire(src, "dragstart");
    fire(dst, "dragenter");
    fire(dst, "dragover");
    fire(dst, "drop");
    fire(src, "dragend");
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

  // `code` is a stable identifier for WHY the step failed — background.js
  // turns it into an Indonesian explanation + solution for the play log.
  // `message` stays the short technical line for anyone reading raw logs.
  const ok = (el, message) => ({ status: "passed", message: message || "", el });
  const bad = (message, el, code) => ({ status: "failed", message, el: el || null, code });
  const skip = (message, el, code) => ({ status: "skipped", message, el: el || null, code });

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
        resolveEl(step.selector, step.selectorType, step.tagName),
        "upload_skip"
      );
    }

    if (!step.selector) return bad(`no selector for ${a}`, null, "no_selector");

    const needVisible = a === "click" || a === "type" || a === "clear" || a === "select";
    const el = await waitForEl(step.selector, {
      visible: needVisible,
      type: step.selectorType,
      tag: step.tagName
    });
    if (!el) return bad(`element not found: ${step.selector}`, null, "element_not_found");

    // Clicking a file input opens the native picker and stalls playback.
    if (el.tagName === "INPUT" && el.type === "file") {
      return skip("klik file input dilewati (butuh Cypress cy.selectFile)", el, "file_input_skip");
    }

    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (e) {
      /* jsdom-less browsers */
    }

    switch (a) {
      case "drag": {
        const dx = Number(step.dx) || 0;
        const dy = Number(step.dy) || 0;
        if (!dx && !dy) return skip("drag has no recorded distance", el, "drag_no_distance");
        const before = el.getBoundingClientRect();
        await dragBy(el, dx, dy);
        await sleep(120);
        const after = el.getBoundingClientRect();
        if (
          Math.round(before.left) === Math.round(after.left) &&
          Math.round(before.top) === Math.round(after.top)
        ) {
          return bad("drag had no effect — the element did not move", el, "drag_no_effect");
        }
        return ok(el, `dragged ${dx}, ${dy}`);
      }

      case "drop": {
        if (!step.targetSelector) return bad("drop has no target selector", el, "drop_no_target");
        const target = await waitForEl(step.targetSelector, {
          visible: true,
          type: step.targetSelectorType,
          tag: step.targetTagName
        });
        if (!target)
          return bad(`drop target not found: ${step.targetSelector}`, el, "drop_target_not_found");
        if (step.dnd === "html5") {
          html5DragOnto(el, target);
        } else {
          await dragOnto(el, target);
        }
        await sleep(150);
        return ok(target, `dropped on ${truncate(step.targetName || step.targetSelector)}`);
      }

      case "resize": {
        const dx = Number(step.dx) || 0;
        const dy = Number(step.dy) || 0;
        if (!dx && !dy) return skip("resize has no recorded distance", el, "resize_no_distance");
        const box = el.parentElement || el;
        const before = box.getBoundingClientRect();
        await dragBy(el, dx, dy);
        await sleep(120);
        const after = box.getBoundingClientRect();
        const w = Math.round(after.width);
        const h = Math.round(after.height);
        if (Math.round(before.width) === w && Math.round(before.height) === h) {
          return bad(`resize had no effect — still ${w}x${h}`, el, "resize_no_effect");
        }
        return ok(el, `resized to ${w}x${h}`);
      }

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
        if (!opt) return bad(`option not found: "${want}"`, el, "option_not_found");
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
        return el.checked === target
          ? ok(el, a + "ed")
          : bad(`could not ${a}`, el, "check_failed");
      }

      case "submit": {
        const form = el.tagName === "FORM" ? el : el.closest("form");
        if (!form) return bad("no <form> to submit", el, "no_form");
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
        return bad(`unsupported action: ${a}`, el, "unsupported_action");
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
        : bad(`url "${location.pathname}" does not include "${val}"`, null, "url_mismatch");
    }

    if (type === "contain") {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      if (!step.selector) {
        await waitForEl("body");
        const text = norm(document.body.innerText || document.body.textContent);
        return text.includes(val)
          ? ok(null, `page contains "${truncate(val)}"`)
          : bad(`page does not contain "${truncate(val)}"`, null, "text_not_found");
      }
      // cy.contains(selector, text): any element matching the selector whose
      // text includes the value — not just the first one.
      await waitForEl(step.selector, { type: step.selectorType, tag: step.tagName });
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(step.selector));
      } catch (e) {
        return bad(`bad selector: ${step.selector}`, null, "bad_selector");
      }
      if (!matches.length)
        return bad(`element not found: ${step.selector}`, null, "element_not_found");
      const hit = matches.find((el) => norm(el.innerText || el.textContent).includes(val));
      if (hit) return ok(hit, `contains "${truncate(val)}"`);
      return bad(`no ${step.selector} contains "${truncate(val)}"`, matches[0], "text_not_found");
    }

    if (!step.selector) return bad("no selector for assertion", null, "no_selector");

    if (type === "value") {
      const el = await waitForEl(step.selector, { type: step.selectorType, tag: step.tagName });
      if (!el) return bad(`element not found: ${step.selector}`, null, "element_not_found");
      const actual = el.value == null ? "" : String(el.value);
      return actual === val
        ? ok(el, `value is "${truncate(val)}"`)
        : bad(`value is "${truncate(actual)}", expected "${truncate(val)}"`, el, "value_mismatch");
    }

    // visible | exist
    const el = await waitForEl(step.selector, {
      visible: type === "visible",
      type: step.selectorType,
      tag: step.tagName
    });
    if (!el) return bad(`element not found: ${step.selector}`, null, "element_not_found");
    if (type === "visible" && !isVisible(el)) return bad("element is not visible", el, "not_visible");
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
        border: 2px solid #0969da; border-radius: 5px;
        background: rgba(9,105,218,.10);
        box-shadow: 0 0 0 2px rgba(255,255,255,.65), 0 2px 8px rgba(9,105,218,.25);
        transition: all .12s ease-out;
      }
      .cyp-box.cyp-fail { border-color: #cf222e; background: rgba(207,34,46,.12); box-shadow: 0 0 0 2px rgba(255,255,255,.65), 0 2px 8px rgba(207,34,46,.25); }
      .cyp-cap {
        background: #0969da; color: #fff; padding: 3px 8px; border-radius: 5px;
        font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,.2);
        max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .cyp-cap.cyp-fail { background: #cf222e; }
      .cyp-toast {
        top: 14px; left: 50%; transform: translateX(-50%);
        background: rgba(13,17,23,.92); color: #e6edf3;
        padding: 7px 16px; border-radius: 999px; max-width: 80vw;
        font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,.3);
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
      res = { status: "failed", message: String((e && e.message) || e), code: "js_error", el: null };
    }
    if (!res || !res.status) res = { status: "failed", message: "no result", code: "no_result", el: null };
    const ms = Math.round(performance.now() - t0);
    const good = res.status !== "failed";
    try {
      if (res.el) flash(res.el, `${step.action}: ${name}`, good);
      if (res.status === "failed") showToast(`✗  ${step.action}  —  ${res.message}`, false);
      else if (res.status === "skipped") showToast(`⤼  ${step.action}  —  ${res.message}`);
    } catch (e) {}
    return { status: res.status, message: res.message || "", code: res.code || null, ms };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PLAY_STEP") {
      execStep(msg).then(sendResponse, (e) =>
        sendResponse({
          status: "failed",
          message: String((e && e.message) || e),
          code: "js_error",
          ms: 0
        })
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
