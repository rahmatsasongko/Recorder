// Content script: Recorder Engine + Selector Engine.
// Runs on every page; only captures events while the session is recording
// and this tab is the recorded tab.

(() => {
  if (window.__cypressRecorderInjected) return;
  window.__cypressRecorderInjected = true;

  let recording = false;
  const focusValues = new WeakMap();

  /* ---------------------------------------------------------------------- *
   * Selector Engine
   * ---------------------------------------------------------------------- */

  const DYNAMIC_CLASS = /(^|[-_])(ng|css|jsx|sc|emotion|hash|[0-9a-f]{5,})([-_]|$)|\d{3,}/i;

  function isUnique(selector, root = document) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function attrSelector(el, attr) {
    const v = el.getAttribute(attr);
    if (!v) return null;
    return `[${attr}="${v.replace(/"/g, '\\"')}"]`;
  }

  function niceClassSelector(el) {
    const classes = Array.from(el.classList).filter(
      (c) => c && !DYNAMIC_CLASS.test(c)
    );
    if (!classes.length) return null;
    return el.tagName.toLowerCase() + "." + classes.map(cssEscape).join(".");
  }

  function nthSelector(el) {
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const tag = el.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter(
      (c) => c.tagName === el.tagName
    );
    if (sameTag.length === 1) return tag;
    const idx = sameTag.indexOf(el) + 1;
    return `${tag}:nth-of-type(${idx})`;
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = niceClassSelector(node) || nthSelector(node);
      const idAttr = node.getAttribute && node.getAttribute("id");
      if (idAttr && !DYNAMIC_CLASS.test(idAttr)) {
        part = `#${cssEscape(idAttr)}`;
        parts.unshift(part);
        break;
      }
      parts.unshift(part);
      if (isUnique(parts.join(" > "))) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function xPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const segs = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let i = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) i++;
        sib = sib.previousElementSibling;
      }
      segs.unshift(`${node.tagName.toLowerCase()}[${i}]`);
      node = node.parentElement;
    }
    return "//" + segs.join("/");
  }

  // Test-id attributes, highest priority first. data-testid wins.
  const TEST_ID_ATTRS = [
    "data-testid",
    "data-test-id",
    "data-test",
    "data-cy",
    "data-qa",
    "data-automation-id",
    "data-e2e"
  ];

  function attrEq(attr, value) {
    return `[${attr}="${String(value).replace(/"/g, '\\"')}"]`;
  }

  function firstTestId(el) {
    if (!el || !el.getAttribute) return null;
    for (const attr of TEST_ID_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return { attr, value: v };
    }
    return null;
  }

  // Build the best selector that is anchored on a test-id, or null if there
  // is no usable test-id on the element or a nearby ancestor.
  function testIdSelector(el) {
    const own = firstTestId(el);
    if (own) {
      const base = attrEq(own.attr, own.value);
      if (isUnique(base)) return { selector: base, type: own.attr, stable: true };

      const tagScoped = el.tagName.toLowerCase() + base;
      if (isUnique(tagScoped)) return { selector: tagScoped, type: own.attr, stable: true };

      let anc = el.parentElement;
      let depth = 0;
      while (anc && depth < 5) {
        const a = firstTestId(anc);
        if (a) {
          const scoped = `${attrEq(a.attr, a.value)} ${base}`;
          if (isUnique(scoped)) return { selector: scoped, type: own.attr, stable: true };
          break;
        }
        anc = anc.parentElement;
        depth++;
      }
      // Duplicate test-ids on the page — still the most meaningful selector.
      return { selector: base, type: own.attr, stable: false };
    }

    // No test-id on the element itself: anchor on a nearby ancestor that has one.
    let anc = el.parentElement;
    let depth = 0;
    while (anc && depth < 4) {
      const a = firstTestId(anc);
      if (a) {
        const ancSel = attrEq(a.attr, a.value);
        for (const suffix of [el.tagName.toLowerCase(), nthSelector(el)]) {
          const scoped = `${ancSel} ${suffix}`;
          if (isUnique(scoped)) {
            return { selector: scoped, type: a.attr + "-scope", stable: true };
          }
        }
        break;
      }
      anc = anc.parentElement;
      depth++;
    }
    return null;
  }

  // Returns { selector, type, stable }
  function buildSelector(el) {
    // 1. A test-id anywhere on the element or a close wrapper — always preferred.
    const testId = testIdSelector(el);
    if (testId) return testId;

    const priority = [
      { attr: "id", type: "id" },
      { attr: "name", type: "name" },
      { attr: "aria-label", type: "aria-label" }
    ];

    for (const p of priority) {
      const sel = attrSelector(el, p.attr);
      if (!sel) continue;
      if (p.attr === "id" && DYNAMIC_CLASS.test(el.id)) continue;
      if (p.attr === "name") {
        const scoped = `${el.tagName.toLowerCase()}${sel}`;
        if (isUnique(scoped)) return { selector: scoped, type: p.type, stable: true };
      }
      if (isUnique(sel)) return { selector: sel, type: p.type, stable: true };
    }

    // Stable content attributes before falling back to a positional CSS path.
    for (const attr of ["placeholder", "title", "alt", "type", "role", "href"]) {
      const sel = attrSelector(el, attr);
      if (!sel) continue;
      const scoped = `${el.tagName.toLowerCase()}${sel}`;
      if (isUnique(scoped)) return { selector: scoped, type: attr, stable: true };
    }

    const css = cssPath(el);
    if (css && isUnique(css)) {
      return { selector: css, type: "css", stable: !DYNAMIC_CLASS.test(css) };
    }

    return { selector: xPath(el), type: "xpath", stable: false };
  }

  function elementName(el) {
    // Name the element after its test-id first — that is what the locator/method
    // names are built from, so they line up with the selector.
    const tid = firstTestId(el);
    const byLabel =
      (tid && tid.value) ||
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name");
    if (byLabel) return humanize(byLabel);

    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && lab.textContent.trim()) return humanize(lab.textContent.trim());
    }
    const wrapLabel = el.closest && el.closest("label");
    if (wrapLabel && wrapLabel.textContent.trim())
      return humanize(wrapLabel.textContent.trim());

    const text = (el.textContent || "").trim();
    if (text && text.length <= 40) return humanize(text);

    if (el.tagName === "INPUT" && el.type) return humanize(el.type + " input");
    return humanize(el.tagName.toLowerCase());
  }

  function humanize(s) {
    return String(s)
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  }

  /* ---------------------------------------------------------------------- *
   * Recorder Engine
   * ---------------------------------------------------------------------- */

  function sendStep(step) {
    try {
      chrome.runtime.sendMessage({ type: "ADD_STEP", step }, () => void chrome.runtime.lastError);
    } catch (e) {
      /* extension context invalidated */
    }
  }

  function describe(el) {
    const { selector, type, stable } = buildSelector(el);
    return {
      selector,
      selectorType: type,
      selectorStable: stable,
      elementName: elementName(el),
      tagName: (el.tagName || "").toLowerCase(),
      inputType: el.type || null,
      url: location.href
    };
  }

  function isEditable(el) {
    return (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable
    );
  }

  // A form field that produces its own step via `change` / `keydown`
  // (text inputs, textarea, select, checkbox, radio, contentEditable).
  // Buttons that happen to be <input> are NOT fields.
  const NON_FIELD_INPUT = ["button", "submit", "reset", "image"];
  function isFormField(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.tagName === "INPUT") {
      return !NON_FIELD_INPUT.includes((el.type || "text").toLowerCase());
    }
    return el.isContentEditable === true;
  }

  const INTERACTIVE =
    "a,button,input[type=button],input[type=submit],input[type=reset]," +
    "input[type=image],summary,[role=button],[role=link]," +
    "[role=tab],[role=menuitem],[onclick]";

  function onClick(e) {
    if (!recording) return;

    const raw = e.target;

    // Clicking into a text box / dropdown / checkbox is noise — the value
    // is captured directly by the change / keydown handler. No click step.
    if (isFormField(raw)) return;
    const innerField = raw.closest && raw.closest("input, textarea, select");
    if (innerField && isFormField(innerField)) return;
    const label = raw.closest && raw.closest("label");
    if (label) {
      const ctrl = label.control || label.querySelector("input, textarea, select");
      if (ctrl && isFormField(ctrl)) return;
    }

    // Prefer the nearest genuinely interactive ancestor.
    let el = raw.closest(INTERACTIVE);

    // Otherwise accept the clicked element only if it looks clickable.
    if (!el) {
      const cursor = raw && getComputedStyle(raw).cursor;
      if (raw && (cursor === "pointer" || raw.hasAttribute("tabindex"))) el = raw;
    }
    if (!el || isFormField(el)) return;

    sendStep({ action: "click", value: null, ...describe(el) });
  }

  function onFocusIn(e) {
    const el = e.target;
    if (isEditable(el)) focusValues.set(el, el.value ?? "");
  }

  function onChange(e) {
    if (!recording) return;
    const el = e.target;

    if (el.tagName === "SELECT") {
      const opt = el.options[el.selectedIndex];
      sendStep({
        action: "select",
        value: opt ? opt.text : el.value,
        ...describe(el)
      });
      return;
    }

    if (el.tagName === "INPUT" && el.type === "file") {
      const names = Array.from(el.files || []).map((f) => f.name);
      sendStep({
        action: "upload",
        value: names.join(", "),
        files: names,
        ...describe(el)
      });
      return;
    }

    if (el.tagName === "INPUT" && el.type === "checkbox") {
      sendStep({
        action: el.checked ? "check" : "uncheck",
        value: null,
        ...describe(el)
      });
      return;
    }

    if (el.tagName === "INPUT" && el.type === "radio") {
      if (el.checked)
        sendStep({ action: "check", value: null, ...describe(el) });
      return;
    }

    if (isEditable(el)) {
      const newVal = el.value ?? el.textContent ?? "";
      const oldVal = focusValues.get(el) ?? "";

      if (newVal === "" && oldVal !== "") {
        sendStep({ action: "clear", value: null, ...describe(el) });
        return;
      }
      if (newVal === oldVal) return;

      sendStep({
        action: "type",
        value: newVal,
        ...describe(el)
      });
    }
  }

  const SPECIAL_KEYS = {
    Enter: "{enter}",
    Tab: "{tab}",
    Escape: "{esc}",
    ArrowUp: "{upArrow}",
    ArrowDown: "{downArrow}",
    ArrowLeft: "{leftArrow}",
    ArrowRight: "{rightArrow}",
    Backspace: "{backspace}"
  };

  function onKeyDown(e) {
    if (!recording) return;
    const mapped = SPECIAL_KEYS[e.key];
    if (!mapped) return;
    if (e.key === "Backspace") return; // too noisy
    const el = e.target;

    // Flush a pending value edit first, so steps stay in order
    // (type "foo" -> press {enter}), since `change` fires after keydown.
    if (isEditable(el)) {
      const newVal = el.value ?? el.textContent ?? "";
      const oldVal = focusValues.get(el);
      if (oldVal !== undefined && newVal !== oldVal && newVal !== "") {
        sendStep({ action: "type", value: newVal, ...describe(el) });
        focusValues.set(el, newVal);
      }
    }

    sendStep({
      action: "keydown",
      value: mapped,
      key: e.key,
      ...describe(el)
    });
  }

  let lastScroll = 0;
  function onScroll() {
    if (!recording) return;
    const now = Date.now();
    if (now - lastScroll < 800) return;
    lastScroll = now;
    sendStep({
      action: "scroll",
      value: `${Math.round(window.scrollX)},${Math.round(window.scrollY)}`,
      selector: null,
      selectorType: null,
      elementName: "window",
      url: location.href
    });
  }

  function recordVisit() {
    sendStep({
      action: "visit",
      value: null,
      selector: null,
      selectorType: null,
      elementName: "page",
      url: location.href
    });
  }

  /* ---------------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------------- */

  // NOTE: no "submit" listener on purpose. A button press inside a <form> is
  // already recorded as a `click` step (and any resulting page load as a
  // `visit`), so recording the form's `submit` event too would double up the
  // step. We never want a standalone `submit` step from recording.
  document.addEventListener("click", onClick, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);

  // SPA navigation
  const _push = history.pushState;
  history.pushState = function () {
    _push.apply(this, arguments);
    if (recording) setTimeout(recordVisit, 50);
  };
  window.addEventListener("popstate", () => {
    if (recording) setTimeout(recordVisit, 50);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATE_CHANGED") {
      const was = recording;
      recording = !!msg.recording;
      if (recording && !was) recordVisit();
    }
  });

  // On (re)load, ask whether we should be recording. If yes, log the visit.
  function syncState() {
    try {
      chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
        if (chrome.runtime.lastError || !state) return;
        recording = !!state.recording;
        if (recording) recordVisit();
      });
    } catch (e) {
      /* ignore */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncState);
  } else {
    syncState();
  }
})();
