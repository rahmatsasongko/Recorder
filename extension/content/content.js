// Content script: Recorder Engine + Selector Engine.
// Runs on every page; only captures events while the session is recording
// and this tab is the recorded tab.

(() => {
  if (window.__cypressRecorderInjected) return;
  window.__cypressRecorderInjected = true;

  let recording = false;
  let assertMode = false;
  const focusValues = new WeakMap();

  /* ---------------------------------------------------------------------- *
   * Selector Engine
   * ---------------------------------------------------------------------- */

  const DYNAMIC_CLASS = /(^|[-_])(ng|css|jsx|sc|emotion|hash|[0-9a-f]{5,})([-_]|$)|\d{3,}/i;

  // Classes that describe a momentary state, not what the element IS.
  // Recording happens mid-interaction — a drop target is decorated with
  // ui-droppable-active / ui-droppable-hover while the drag is still in
  // flight — so keeping these would bake "was being hovered" into the
  // selector, and it would match nothing once the page settles.
  // Whole-class states: class="active", class="ui-active", class="loading".
  const STATE_EXACT =
    "active|inactive|hover|hovered|focus|focused|selected|checked|current|" +
    "open|opened|closed|show|shown|hidden|visible|over|" +
    "disabled|readonly|loading|busy|error|invalid|valid|fade|" +
    "dragging|dragover|highlight|highlighted|expanded|collapsed|" +
    "helper|placeholder|resizing|sorting";

  // Suffix states: ui-droppable-hover, drag-over, is-active, tab-selected.
  // Deliberately narrower — a class like `alert-error` names the thing, while
  // `panel-open` only describes how it looks right now.
  const STATE_SUFFIX =
    "active|inactive|hover|hovered|focus|focused|selected|checked|current|" +
    "open|opened|closed|shown|hidden|visible|over|disabled|" +
    "dragging|dragover|highlight|highlighted|expanded|collapsed|" +
    "helper|placeholder|resizing|sorting";

  const STATE_CLASS = new RegExp(
    [
      `^(?:ui-)?(?:${STATE_EXACT})$`,
      `^ui-state-[\\w-]+$`, // ui-state-hover / -active / -highlight
      // (ui-widget-content and ui-widget-header are structural — keep them)
      `^[\\w-]+-(?:${STATE_SUFFIX})$` // ui-droppable-hover, drag-over, is-active
    ].join("|"),
    "i"
  );

  function stableClasses(el) {
    return Array.from(el.classList || []).filter(
      (c) => c && !DYNAMIC_CLASS.test(c) && !STATE_CLASS.test(c)
    );
  }

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
    const classes = stableClasses(el);
    if (!classes.length) return null;
    return el.tagName.toLowerCase() + "." + classes.map(cssEscape).join(".");
  }

  // An element identified by its classes — `div.drop-box.ui-droppable`, or
  // scoped to the nearest ancestor with an id when the classes alone appear
  // more than once. A descendant selector is used on purpose: it survives
  // wrapper markup changing, which a `>` chain does not.
  function classSelector(el) {
    const base = niceClassSelector(el);
    if (!base) return null;
    if (isUnique(base)) return { selector: base, type: "class", stable: true };

    let anc = el.parentElement;
    let depth = 0;
    while (anc && depth < 5) {
      const id = anc.getAttribute && anc.getAttribute("id");
      if (id && !DYNAMIC_CLASS.test(id)) {
        const scoped = `#${cssEscape(id)} ${base}`;
        if (isUnique(scoped)) {
          return { selector: scoped, type: "class", stable: true };
        }
        break; // a closer id that doesn't disambiguate won't get better higher up
      }
      anc = anc.parentElement;
      depth++;
    }
    return null;
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

  // An explicit ARIA role, narrowed by its accessible name when it needs to be.
  // Only declared roles count — an implicit role (a <button> is role=button
  // without saying so) is not something a CSS selector can target.
  function roleSelector(el) {
    const role = el.getAttribute && el.getAttribute("role");
    if (!role) return null;
    const tag = el.tagName.toLowerCase();
    const roleSel = `[role="${role.replace(/"/g, '\\"')}"]`;
    const label = el.getAttribute("aria-label");
    const candidates = [];
    if (label) {
      const labelSel = `[aria-label="${label.replace(/"/g, '\\"')}"]`;
      candidates.push(`${roleSel}${labelSel}`, `${tag}${roleSel}${labelSel}`);
    }
    candidates.push(roleSel, `${tag}${roleSel}`);
    for (const sel of candidates) {
      if (isUnique(sel)) return { selector: sel, type: "role", stable: true };
    }
    return null;
  }

  const TEXTLESS_TAGS = ["html", "body", "head", "script", "style", "svg", "select"];

  function normText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  // The visible label of the element, when no other element of the same tag
  // carries exactly that text. Stored as plain text, not a CSS selector —
  // every framework has its own way of spelling "find by text".
  function textSelector(el) {
    const tag = el.tagName.toLowerCase();
    if (TEXTLESS_TAGS.includes(tag)) return null;
    const text = normText(el);
    if (!text || text.length > 50 || !/[a-zA-Z0-9]/.test(text)) return null;

    let seen = 0;
    const sameTag = document.getElementsByTagName(tag);
    for (let i = 0; i < sameTag.length; i++) {
      if (normText(sameTag[i]) === text && ++seen > 1) return null;
    }
    return seen === 1 ? { selector: text, type: "text", stable: true, tag } : null;
  }

  // Returns { selector, type, stable, tag? }
  //
  // Priority, most durable first:
  //   1 test-id   2 role/accessibility   3 id      4 name / aria-label
  //   5 text      6 css (classes)        7 class / attribute   8 xpath
  //
  // 6 and 7 are both CSS: a clean class selector reads better and survives
  // markup shuffling, so it is tried before the remaining attributes and the
  // positional `>` path that ends the chain.
  function buildSelector(el) {
    // 1. A test-id anywhere on the element or a close wrapper.
    const testId = testIdSelector(el);
    if (testId) return testId;

    // 2. Role / accessibility.
    const byRole = roleSelector(el);
    if (byRole) return byRole;

    // 3-4. id, then name / accessible label.
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

    // 5. Visible text.
    const byText = textSelector(el);
    if (byText) return byText;

    // 6. Meaningful classes — the only handle many drop zones and cards have.
    const byClass = classSelector(el);
    if (byClass) return byClass;

    // 7. Remaining content attributes, then a positional CSS path.
    for (const attr of ["placeholder", "title", "alt", "type", "href"]) {
      const sel = attrSelector(el, attr);
      if (!sel) continue;
      const scoped = `${el.tagName.toLowerCase()}${sel}`;
      if (isUnique(scoped)) return { selector: scoped, type: attr, stable: true };
    }

    const css = cssPath(el);
    if (css && isUnique(css)) {
      return { selector: css, type: "css", stable: !DYNAMIC_CLASS.test(css) };
    }

    // 8. Last resort.
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

  // `el` is the element the step is about, when there is one — it gets the
  // green "recorded" flash (see confirmStep) once the step is really stored.
  function sendStep(step, el) {
    // A scroll is only sent once it settles (see onScroll). If the user acts
    // before that, send it first so the steps keep the order things happened.
    if (scrollTimer && step.action !== "scroll") flushScroll();
    try {
      chrome.runtime.sendMessage({ type: "ADD_STEP", step }, (res) => {
        if (chrome.runtime.lastError) return;
        // Only a step the background actually stored is worth confirming: a
        // paused session, another tab and a repeated visit all answer without
        // adding anything (ok:false / skipped).
        if (res && res.ok && !res.skipped) confirmStep(step, el, res.count);
      });
    } catch (e) {
      /* extension context invalidated */
    }
  }

  /* ---- green flash: proof that an action became a step. The popup closes the
   * moment the page takes focus, so while recording there is otherwise no way
   * to tell whether a keystroke or click was captured. The element the step is
   * about is outlined in green with its step number, and the overlay's step
   * counter turns green too (that one also covers steps with no element —
   * visit, scroll). Never shows the step's value: a password stays hidden. ---- */
  const FLASH_MS = 1400;
  const FLASH_FADE_MS = 400;
  const activeFlashes = new Map(); // element -> { box, fade, gone }
  let counterFlashTimer = null;

  function confirmStep(step, el, count) {
    flashCounter(count);
    if (!el || el.nodeType !== 1 || !el.isConnected) return;
    flashElement(el, "✓ Step " + count + " · " + String(step.action).toUpperCase());
  }

  function dismissFlash(el) {
    const f = activeFlashes.get(el);
    if (!f) return;
    clearTimeout(f.fade);
    clearTimeout(f.gone);
    if (f.box.parentNode) f.box.parentNode.removeChild(f.box);
    activeFlashes.delete(el);
  }

  function flashElement(el, label) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return; // not rendered (display:none, detached layout)

    // Same element recorded twice in a row (type, then {enter}): the newer
    // step replaces the older badge instead of stacking on top of it.
    dismissFlash(el);

    const box = document.createElement("div");
    box.className = "cyp-rec-flash";
    box.style.cssText =
      "all:initial;display:block;position:fixed;z-index:2147483646;pointer-events:none;" +
      "box-sizing:border-box;border:2px solid #10b981;border-radius:4px;" +
      "background:rgba(16,185,129,.22);box-shadow:0 0 0 3px rgba(16,185,129,.35);" +
      "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;" +
      "opacity:1;transition:opacity " + FLASH_FADE_MS + "ms;";

    const tag = document.createElement("div");
    tag.textContent = label;
    // Above the element, unless that would fall off the top of the viewport.
    const below = r.top < 28;
    tag.style.cssText =
      // all:initial resets pointer-events too (it is inherited, and initial is
      // `auto`), so the badge needs its own — or it would eat real clicks.
      "all:initial;display:block;position:absolute;left:-2px;white-space:nowrap;pointer-events:none;" +
      (below ? "top:100%;margin-top:5px;" : "bottom:100%;margin-bottom:5px;") +
      "background:#10b981;color:#fff;padding:3px 8px;border-radius:999px;" +
      "font:600 11px/1.3 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "box-shadow:0 3px 10px rgba(0,0,0,.3);";
    box.appendChild(tag);

    // On <html>, not <body>: an extra child of <body> would shift the
    // :nth-of-type / xpath position of the page's own elements.
    document.documentElement.appendChild(box);
    activeFlashes.set(el, {
      box,
      fade: setTimeout(() => {
        box.style.opacity = "0";
      }, FLASH_MS - FLASH_FADE_MS),
      gone: setTimeout(() => dismissFlash(el), FLASH_MS)
    });
  }

  function flashCounter(count) {
    const span = overlayEl && overlayEl.querySelector('[data-role="steps"]');
    if (!span) return;
    span.textContent = count + " langkah";
    span.style.transition = "color .3s";
    span.style.color = "#34d399";
    clearTimeout(counterFlashTimer);
    counterFlashTimer = setTimeout(() => {
      span.style.color = "#d1d5db";
    }, FLASH_MS);
  }

  // A field whose value must not end up in generated code or on screen.
  // type=password is the obvious case. A "show password" toggle flips the
  // type to text, so also go by autocomplete and by how the field is named —
  // deliberately not a bare "pass", which would also match "passport".
  const SECRET_HINT = /pass(word|wd|code|phrase)|pwd|sandi/i;
  const NON_TEXT_INPUT = ["checkbox", "radio", "button", "submit", "reset", "image", "file", "hidden", "range", "color"];
  function isSensitiveField(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const type = (el.type || "text").toLowerCase();
    if (type === "password") return true;
    if (NON_TEXT_INPUT.includes(type)) return false;
    if (/(^|\s)(current|new)-password(\s|$)/i.test(el.getAttribute("autocomplete") || "")) return true;
    return SECRET_HINT.test(
      [el.name, el.id, el.getAttribute("aria-label"), el.getAttribute("placeholder")].filter(Boolean).join(" ")
    );
  }

  function describe(el) {
    const { selector, type, stable } = buildSelector(el);
    const info = {
      selector,
      selectorType: type,
      selectorStable: stable,
      elementName: elementName(el),
      tagName: (el.tagName || "").toLowerCase(),
      inputType: el.type || null,
      url: location.href
    };
    // Only ever set to true, so ordinary steps stay as small as before.
    if (isSensitiveField(el)) info.sensitive = true;
    return info;
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

  // A click on the inside of something clickable that carries a test-id — the
  // <span> holding an option's label, the <div> wrapping its icon — is a click
  // on that something. Recorded as it landed it becomes
  // `[data-testid="select-option-halte-8204"] span`: longer, tied to the
  // option's inner markup, and named after whatever text the span happens to
  // hold rather than after the test-id. The test-id already points at the
  // thing to click, so the recording points there too.
  //
  // Only the NEAREST test-id ancestor is considered, and only when it is
  // itself clickable — a test-id'd list or dialog that merely contains
  // clickable things must not swallow clicks meant for what is inside it.
  const TESTID_HOIST_DEPTH = 6;
  const CLICKABLE_ROLE = "[role=option],[role=treeitem],[role=radio],[role=checkbox],[role=switch]";
  function clickableTestIdAncestor(el) {
    if (firstTestId(el)) return null; // already addressed by its own test-id
    let anc = el.parentElement;
    for (let depth = 0; anc && depth < TESTID_HOIST_DEPTH; depth++, anc = anc.parentElement) {
      if (!firstTestId(anc)) continue;
      const clickable = getComputedStyle(anc).cursor === "pointer" || anc.matches(CLICKABLE_ROLE);
      return clickable ? anc : null;
    }
    return null;
  }

  function onClick(e) {
    if (isOverlayTarget(e.target)) return;
    if (!recording) return;

    // Assertion picker: swallow the click entirely (no navigation, no side
    // effects from the page's own handlers) and record what was clicked as
    // an assertion instead of a normal interaction. Stays on until the user
    // toggles the overlay button off again, so several elements can be
    // picked in a row.
    if (assertMode) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      captureAssertion(e.target);
      return;
    }

    if (Date.now() - lastDragAt < 400) return; // tail of a drag / resize / drop

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

    // Otherwise accept the clicked element only if it looks clickable — but
    // not a bare calendar cell inside a date-picker popup (bootstrap-
    // datepicker, jQuery UI datepicker, ...). Those get cursor:pointer from
    // the widget's own :hover CSS, yet have no selector that survives a
    // replay: the popup has to already be open on the right month/year for
    // the cell to exist, and its cells are unlabeled numbers repeated every
    // month. The date it sets is already captured as a `type` step by the
    // focusout fallback below, so recording the cell click too would only
    // add a step that can't replay.
    const inDatePicker =
      !el &&
      raw &&
      raw.closest &&
      raw.closest(".datepicker, .ui-datepicker, .flatpickr-calendar, .react-datepicker, .mat-calendar");
    if (!el && !inDatePicker) {
      const cursor = raw && getComputedStyle(raw).cursor;
      if (raw && (cursor === "pointer" || raw.hasAttribute("tabindex"))) {
        el = clickableTestIdAncestor(raw) || raw;
      }
    }
    if (!el || isFormField(el)) return;

    sendStep({ action: "click", value: null, ...describe(el) }, el);
  }

  // If the exact element under the cursor already carries its own visible
  // text (a <p>, <h2>, <span>, ...), trust it directly — that is what lets
  // `<p class="text-xs">Super Admin</p>` assert on exactly "Super Admin"
  // instead of climbing out to some larger clickable wrapper (a card, a
  // profile-menu button) it happens to sit inside, which would grab far more
  // text than the user pointed at. Only climb to the nearest interactive
  // ancestor when the clicked spot itself has no text of its own — an icon,
  // an empty toggle — so that still resolves to the whole control.
  function resolveAssertTarget(raw) {
    if (raw && raw.nodeType === 1 && normText(raw)) return raw;
    return (raw && raw.closest && raw.closest(INTERACTIVE)) || raw;
  }

  // Any text/button/whatever the user picks while assert mode is on — plain
  // text is a valid assertion target, unlike a normal click step.
  //
  // "be visible" is the default for everything picked, text or not: it is the
  // check that says the thing is on screen without freezing its wording, so a
  // copy tweak doesn't fail the test. The text still rides along in `value`,
  // so switching the step to "contain text" in the editor is one click and
  // needs no retyping (a "visible" check ignores it).
  function captureAssertion(raw) {
    const el = resolveAssertTarget(raw);
    const text = normText(el);
    const assertion = { type: "visible", value: text && text.length <= 160 ? text : "" };
    const info = describe(el);
    sendStep({ action: "assert", value: null, assertion, ...info }, el);
    flashAssertToast(text || info.elementName);
  }

  /* ---- hover box: a single highlight rect that tracks whatever element
   * resolveAssertTarget() would pick, instead of CSS :hover (which lights up
   * every ancestor of the cursor at once). ---- */
  let hoverBoxEl = null;
  let hoverTargetEl = null;

  function ensureHoverBox() {
    if (hoverBoxEl && document.documentElement.contains(hoverBoxEl)) return hoverBoxEl;
    const box = document.createElement("div");
    box.id = "cyp-rec-hoverbox";
    box.style.cssText =
      "all:initial;position:fixed;z-index:2147483646;pointer-events:none;" +
      "border:2px solid #10b981;background:rgba(16,185,129,.15);border-radius:3px;" +
      "box-sizing:border-box;display:none;";
    document.documentElement.appendChild(box);
    hoverBoxEl = box;
    return box;
  }

  function positionHoverBox() {
    const box = hoverBoxEl;
    if (!box || !hoverTargetEl || !hoverTargetEl.isConnected) {
      if (box) box.style.display = "none";
      return;
    }
    const r = hoverTargetEl.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
  }

  function hideHoverBox() {
    hoverTargetEl = null;
    if (hoverBoxEl) hoverBoxEl.style.display = "none";
  }

  function onAssertHover(e) {
    if (!assertMode) return;
    if (isOverlayTarget(e.target)) {
      hideHoverBox();
      return;
    }
    hoverTargetEl = resolveAssertTarget(e.target);
    ensureHoverBox();
    positionHoverBox();
  }

  function flashAssertToast(label) {
    const t = document.createElement("div");
    t.style.cssText =
      "all:initial;position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:#10b981;color:#fff;padding:6px 14px;border-radius:999px;max-width:70vw;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
      "font:600 12px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none;transition:opacity .3s;";
    t.textContent = "✓ Assertion ditambahkan: " + label;
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
    }, 700);
    setTimeout(() => t.remove(), 1000);
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
      sendStep(
        {
          action: "select",
          value: opt ? opt.text : el.value,
          ...describe(el)
        },
        el
      );
      return;
    }

    if (el.tagName === "INPUT" && el.type === "file") {
      const names = Array.from(el.files || []).map((f) => f.name);
      sendStep(
        {
          action: "upload",
          value: names.join(", "),
          files: names,
          ...describe(el)
        },
        el
      );
      return;
    }

    if (el.tagName === "INPUT" && el.type === "checkbox") {
      sendStep(
        {
          action: el.checked ? "check" : "uncheck",
          value: null,
          ...describe(el)
        },
        el
      );
      return;
    }

    if (el.tagName === "INPUT" && el.type === "radio") {
      if (el.checked)
        sendStep({ action: "check", value: null, ...describe(el) }, el);
      return;
    }

    if (isEditable(el)) {
      const newVal = el.value ?? el.textContent ?? "";
      const oldVal = focusValues.get(el) ?? "";

      // Whatever we do below, this value is now accounted for — keeps the
      // focusout fallback below from re-sending the same edit as a second
      // step once focus actually leaves the field.
      focusValues.set(el, newVal);

      if (newVal === "" && oldVal !== "") {
        sendStep({ action: "clear", value: null, ...describe(el) }, el);
        return;
      }
      if (newVal === oldVal) return;

      sendStep(
        {
          action: "type",
          value: newVal,
          ...describe(el)
        },
        el
      );
    }
  }

  // Fallback for widgets (date pickers, typeaheads, ...) that set an
  // editable field's value through their own JS/jQuery API and only fire a
  // library-internal event for it — never a real DOM "change"/"input" that
  // `onChange` above listens for. A native `focusout` always fires when the
  // field loses focus no matter how its value got there, so diffing against
  // the value seen on focus-in catches the edit `onChange` missed. Example:
  // clicking a day in a bootstrap-datepicker calendar sets `.value` via
  // jQuery and calls jQuery's `.trigger("change")`, which (on the jQuery
  // versions these apps ship) never reaches a native `addEventListener`
  // listener, so nothing would otherwise get recorded for "pick a date".
  function onFocusOut(e) {
    if (!recording) return;
    const el = e.target;
    if (!isEditable(el) || !focusValues.has(el)) return;

    const newVal = el.value ?? el.textContent ?? "";
    const oldVal = focusValues.get(el);
    focusValues.delete(el);
    if (newVal === oldVal) return;

    if (newVal === "" && oldVal !== "") {
      sendStep({ action: "clear", value: null, ...describe(el) }, el);
      return;
    }
    sendStep({ action: "type", value: newVal, ...describe(el) }, el);
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
        sendStep({ action: "type", value: newVal, ...describe(el) }, el);
        focusValues.set(el, newVal);
      }
    }

    sendStep(
      {
        action: "keydown",
        value: mapped,
        key: e.key,
        ...describe(el)
      },
      el
    );
  }

  /* ------------------------ drag: resize / move / drop ------------------------ *
   * None of these surface as a click or change event — each has to be
   * assembled from mousedown → mouseup. What is recognised on mousedown:
   *   - a resize handle (jQuery UI's .ui-resizable-handle and friends), or a
   *     native CSS `resize` corner (bottom-right ~16px of the element)
   *   - a draggable element (.ui-draggable, [draggable=true], …)
   * and on mouseup, where it landed:
   *   - over a drop target  -> a `drop` step (source + target)
   *   - anywhere else       -> a `resize` or `drag` step (pointer delta)
   * The pointer delta is what replays reliably; sizes and target names are
   * recorded for readability.
   */

  const HANDLE_SELECTOR =
    ".ui-resizable-handle,.resizable-handle,[class*='resize-handle']," +
    "[data-resize-handle],[class*='ui-resizable-']";
  const NATIVE_GRIP = 18; // px corner of a CSS `resize: both` element

  const DRAGGABLE_SELECTOR =
    "[draggable='true'],.ui-draggable,.draggable,[data-draggable]," +
    "[class*='draggable'],[class*='ui-sortable-']";
  const DROPPABLE_SELECTOR =
    ".ui-droppable,.droppable,[data-droppable],[data-drop-target]," +
    "[class*='droppable'],[class*='dropzone'],[class*='drop-zone']";

  function draggableOf(el) {
    if (!el || !el.closest) return null;
    const drag = el.closest(DRAGGABLE_SELECTOR);
    // A resize grip often lives inside a draggable box — the grip wins.
    if (!drag || drag.closest(HANDLE_SELECTOR)) return null;
    return drag;
  }

  // What sits under the pointer at drop time, ignoring the element being
  // dragged (it follows the cursor and would shadow everything below it).
  function dropTargetUnder(x, y, source) {
    const stack =
      (document.elementsFromPoint && document.elementsFromPoint(x, y)) || [];
    for (const el of stack) {
      if (el === source || (source.contains && source.contains(el))) continue;
      const hit = el.closest && el.closest(DROPPABLE_SELECTOR);
      if (hit) return hit;
    }
    return null;
  }

  function resizeHandleOf(el) {
    if (!el || !el.closest) return null;
    const handle = el.closest(HANDLE_SELECTOR);
    if (handle) return { handle, box: handle.parentElement || handle };
    return null;
  }

  function nativeResizeCornerOf(el, e) {
    if (!el || el.nodeType !== 1) return null;
    const resize = getComputedStyle(el).resize;
    if (!resize || resize === "none") return null;
    const r = el.getBoundingClientRect();
    const inCorner =
      e.clientX >= r.right - NATIVE_GRIP && e.clientY >= r.bottom - NATIVE_GRIP;
    return inCorner ? { handle: el, box: el } : null;
  }

  // Name the step after the box being resized, not the grip (which has no
  // text of its own). "handle" is a type word to the generator, so this
  // becomes locator `handleResizableBox` + method `resizeResizableBox`.
  function resizeTargetName(box) {
    const tid = firstTestId(box);
    const raw =
      (tid && tid.value) || box.id || box.getAttribute("aria-label") || "";
    return (raw ? humanize(raw) : elementName(box)) + " handle";
  }

  let dragStart = null;
  let lastDragAt = 0;

  function onMouseDown(e) {
    if (isOverlayTarget(e.target)) return;
    if (!recording || e.button !== 0) return;
    const el = e.target;

    const resize = resizeHandleOf(el) || nativeResizeCornerOf(el, e);
    if (resize) {
      const r = resize.box.getBoundingClientRect();
      dragStart = {
        kind: "resize",
        el: resize.handle,
        box: resize.box,
        x: e.clientX,
        y: e.clientY,
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
      return;
    }

    const drag = draggableOf(el);
    if (drag) {
      dragStart = { kind: "drag", el: drag, box: drag, x: e.clientX, y: e.clientY };
    }
  }

  function onMouseUp(e) {
    if (isOverlayTarget(e.target)) return;
    if (!recording || !dragStart) return;
    const start = dragStart;
    dragStart = null;

    const dx = Math.round(e.clientX - start.x);
    const dy = Math.round(e.clientY - start.y);
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // a click, not a drag

    lastDragAt = Date.now(); // the mouseup also fires a click — ignore it

    if (start.kind === "drag") {
      const target = dropTargetUnder(e.clientX, e.clientY, start.el);
      if (target) {
        const t = describe(target);
        sendStep(
          {
            action: "drop",
            value: t.elementName,
            dx,
            dy,
            targetSelector: t.selector,
            targetSelectorType: t.selectorType,
            targetSelectorStable: t.selectorStable,
            targetTagName: t.tagName,
            targetName: t.elementName,
            ...describe(start.el)
          },
          start.el
        );
        return;
      }
      sendStep({ action: "drag", value: `${dx},${dy}`, dx, dy, ...describe(start.el) }, start.el);
      return;
    }

    // The widget settles asynchronously, so read the final size on the next
    // frame rather than mid-drag.
    requestAnimationFrame(() => {
      const r = start.box.getBoundingClientRect();
      const width = Math.round(r.width);
      const height = Math.round(r.height);
      sendStep(
        {
          action: "resize",
          value: `${width}x${height}`,
          dx,
          dy,
          width,
          height,
          fromWidth: start.w,
          fromHeight: start.h,
          ...describe(start.el),
          elementName: resizeTargetName(start.box)
        },
        start.box
      );
    });
  }

  /* HTML5 drag-and-drop fires its own events and never a mouseup, so it needs
   * its own pair of listeners. Replaying it needs a DataTransfer rather than
   * synthetic mouse moves, hence the `dnd` marker on the step. */
  let html5Src = null;

  function onDragStart(e) {
    if (!recording) return;
    dragStart = null; // this is not a mouse drag after all
    html5Src = e.target;
  }

  function onHtml5Drop(e) {
    if (!recording || !html5Src) return;
    const src = html5Src;
    html5Src = null;
    const raw = e.target;
    const target = (raw.closest && raw.closest(DROPPABLE_SELECTOR)) || raw;
    lastDragAt = Date.now();
    const t = describe(target);
    sendStep(
      {
        action: "drop",
        value: t.elementName,
        dnd: "html5",
        targetSelector: t.selector,
        targetSelectorType: t.selectorType,
        targetSelectorStable: t.selectorStable,
        targetTagName: t.tagName,
        targetName: t.elementName,
        ...describe(src)
      },
      src
    );
  }

  // Only the PAGE scrolling is a step — replay does window.scrollTo(x, y). The
  // listener below is a capture listener on window, so it also hears every
  // scrollable <div>, <textarea> and dropdown list on the page; each of those
  // used to be recorded as a window scroll to wherever the window happened to
  // be. It is also recorded once scrolling SETTLES, at the position it
  // settled on: the first event of a burst fires a few pixels from where the
  // scroll began, which is not where a replay needs to go.
  const SCROLL_SETTLE_MS = 400;
  const SCROLL_MIN_DELTA = 40; // px — a nudge is not worth a step
  let scrollTimer = null;
  let lastScrollX = 0;
  let lastScrollY = 0;

  function resetScrollBaseline() {
    clearTimeout(scrollTimer);
    scrollTimer = null;
    lastScrollX = Math.round(window.scrollX);
    lastScrollY = Math.round(window.scrollY);
  }

  function flushScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = null;
    if (!recording) return;
    const x = Math.round(window.scrollX);
    const y = Math.round(window.scrollY);
    if (Math.abs(x - lastScrollX) < SCROLL_MIN_DELTA && Math.abs(y - lastScrollY) < SCROLL_MIN_DELTA) return;
    lastScrollX = x;
    lastScrollY = y;
    sendStep({
      action: "scroll",
      value: `${x},${y}`,
      selector: null,
      selectorType: null,
      elementName: "window",
      url: location.href
    });
  }

  function onScroll(e) {
    if (!recording) return;
    if (e.target !== document) return; // an element inside the page, not the page
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(flushScroll, SCROLL_SETTLE_MS);
  }

  function recordVisit() {
    // A new page (or route) starts from wherever the window is now.
    resetScrollBaseline();
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
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("mousemove", onAssertHover, true);
  window.addEventListener(
    "scroll",
    () => {
      if (assertMode) positionHoverBox();
    },
    true
  );
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("drop", onHtml5Drop, true);
  window.addEventListener("scroll", onScroll, true);

  // SPA navigation. A page's own history.pushState / replaceState calls run in
  // the PAGE's JS world, and a content script's copy of `history` is a
  // different object — patching it here never saw them. content/page-hook.js
  // (a "world": "MAIN" content script) patches the real one and raises this
  // event. popstate (back / forward) is a DOM event, so it reaches us as is.
  window.addEventListener("cyp:navigate", () => {
    if (recording) setTimeout(recordVisit, 50);
  });
  window.addEventListener("popstate", () => {
    if (recording) setTimeout(recordVisit, 50);
  });

  /* ---------------------------------------------------------------------- *
   * Recording overlay — Chrome closes the popup the instant this tab gets
   * focus, which is exactly what happens the moment the user does the thing
   * they're recording. Without an on-page control, the only way to check
   * step count or hit Pause/Stop mid-recording is to reopen the popup. This
   * floating pill mirrors that status directly on the page, and forwards
   * Pause/Resume/Stop to the same background messages the popup itself uses.
   * ---------------------------------------------------------------------- */

  const OVERLAY_ID = "cyp-rec-overlay";
  let overlayEl = null;
  let overlayPollTimer = null;
  let overlayPaused = false;

  function isOverlayTarget(t) {
    return !!(t && t.closest && t.closest("#" + OVERLAY_ID));
  }

  function fmtOverlayTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function overlayElapsed(session) {
    if (!session.startTime) return 0;
    const base = session.startTime + (session.pausedAccum || 0);
    if (session.paused && session.pausedAt) return session.pausedAt - base;
    return Date.now() - base;
  }

  const OVERLAY_ICON_PAUSE =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect></svg>';
  const OVERLAY_ICON_PLAY =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
  const OVERLAY_ICON_STOP =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="18" height="18" rx="2"></rect></svg>';
  const OVERLAY_ICON_ASSERT =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="m9 12 2 2 4-4"></path></svg>';

  function overlayBtnStyle(bg) {
    return (
      "all:unset;display:inline-flex;align-items:center;gap:5px;cursor:pointer;" +
      "padding:5px 10px;border-radius:999px;font:600 11.5px/1 inherit;color:#fff;" +
      "background:" + (bg || "rgba(255,255,255,.14)") + ";"
    );
  }

  function ensureOverlay() {
    if (overlayEl && document.documentElement.contains(overlayEl)) return overlayEl;
    if (!document.getElementById("cyp-rec-overlay-style")) {
      const style = document.createElement("style");
      style.id = "cyp-rec-overlay-style";
      style.textContent =
        "@keyframes cyp-rec-pulse{0%,100%{opacity:1}50%{opacity:.25}}" +
        "#" + OVERLAY_ID + " button:hover{filter:brightness(1.2);}" +
        "html.cyp-assert-mode,html.cyp-assert-mode *{cursor:crosshair !important;}" +
        "html.cyp-assert-mode #" + OVERLAY_ID + ",html.cyp-assert-mode #" + OVERLAY_ID + " *{cursor:pointer !important;}";
      document.documentElement.appendChild(style);
    }
    const el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.style.cssText =
      "all:initial;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "display:flex;align-items:center;gap:10px;padding:8px 12px;" +
      "background:#111827;color:#f3f4f6;border-radius:999px;" +
      "font:600 12px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:auto;";
    el.innerHTML =
      '<span data-role="dot" style="width:9px;height:9px;border-radius:50%;background:#ef4444;flex:0 0 auto;animation:cyp-rec-pulse 1.1s infinite;"></span>' +
      '<span data-role="timer" style="font-variant-numeric:tabular-nums;color:#f3f4f6;">00:00</span>' +
      '<span style="width:1px;height:14px;background:rgba(255,255,255,.2);"></span>' +
      '<span data-role="steps" style="color:#d1d5db;white-space:nowrap;">0 langkah</span>' +
      '<button data-role="pause" type="button" style="' + overlayBtnStyle() + '">' + OVERLAY_ICON_PAUSE + " Jeda</button>" +
      '<button data-role="stop" type="button" style="' + overlayBtnStyle("#ef4444") + '">' + OVERLAY_ICON_STOP + " Berhenti</button>" +
      '<button data-role="assert" type="button" style="' + overlayBtnStyle("#7c3aed") + '">' + OVERLAY_ICON_ASSERT + " Assert</button>";
    el.querySelector('[data-role="assert"]').addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setAssertMode(!assertMode);
    });
    el.querySelector('[data-role="pause"]').addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage(
        { type: overlayPaused ? "RESUME" : "PAUSE" },
        () => void chrome.runtime.lastError
      );
    });
    el.querySelector('[data-role="stop"]').addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "STOP" }, () => void chrome.runtime.lastError);
    });
    (document.body || document.documentElement).appendChild(el);
    overlayEl = el;
    return el;
  }

  // Toggles the element picker: crosshair cursor everywhere (via the
  // html.cyp-assert-mode rule above), the tracking hover box, and the
  // overlay button's own on/off look.
  function setAssertMode(on) {
    assertMode = on;
    document.documentElement.classList.toggle("cyp-assert-mode", assertMode);
    if (!assertMode) hideHoverBox();
    const btn = overlayEl && overlayEl.querySelector('[data-role="assert"]');
    if (!btn) return;
    btn.style.cssText = overlayBtnStyle(assertMode ? "#10b981" : "#7c3aed");
    btn.innerHTML = OVERLAY_ICON_ASSERT + (assertMode ? " Klik elemen…" : " Assert");
  }

  function removeOverlay() {
    if (overlayPollTimer) clearInterval(overlayPollTimer);
    overlayPollTimer = null;
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
    setAssertMode(false);
  }

  function refreshOverlay() {
    // GET_STATE (not a direct storage read) because `session` in storage is
    // global — a page open in ANY tab would otherwise show the overlay for a
    // recording actually happening in a different tab. Background's
    // `isThisTab` is the only place that distinction is computed correctly.
    try {
      // OVERLAY_STATE, not GET_STATE: this runs twice a second, and GET_STATE
      // answers with every scenario and step of the session.
      chrome.runtime.sendMessage({ type: "OVERLAY_STATE" }, (session) => {
        if (chrome.runtime.lastError || !session || !session.active || !session.isThisTab) {
          removeOverlay();
          return;
        }
        const el = ensureOverlay();
        overlayPaused = !!session.paused;
        el.querySelector('[data-role="timer"]').textContent = fmtOverlayTime(overlayElapsed(session));
        el.querySelector('[data-role="steps"]').textContent = session.stepCount + " langkah";
        const dot = el.querySelector('[data-role="dot"]');
        dot.style.animation = overlayPaused ? "none" : "cyp-rec-pulse 1.1s infinite";
        dot.style.opacity = overlayPaused ? ".4" : "1";
        el.querySelector('[data-role="pause"]').innerHTML = overlayPaused
          ? OVERLAY_ICON_PLAY + " Lanjut"
          : OVERLAY_ICON_PAUSE + " Jeda";
      });
    } catch (e) {
      removeOverlay();
    }
  }

  // Optimistic on every STATE_CHANGED / GET_STATE tick rather than only when
  // `recording` flips true: a paused session is still active (session.active
  // stays true) but broadcasts recording:false, so gating on that boolean
  // alone would hide the overlay the moment the user paused.
  function startOverlayPoll() {
    if (overlayPollTimer) return;
    refreshOverlay();
    overlayPollTimer = setInterval(refreshOverlay, 500);
  }

  // Elements inside an <iframe> can't be recorded or replayed — content
  // scripts only run in the top frame here (manifest all_frames:false) — so
  // rather than let the user discover this reactively when playback fails,
  // flag it once per recording pass as soon as we know we're recording.
  let iframeChecked = false;
  function checkIframes() {
    if (iframeChecked) return;
    // Run at document_start, before the DOM is parsed — wait for it so
    // <iframe> elements actually exist to find.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", checkIframes, { once: true });
      return;
    }
    iframeChecked = true;
    if (document.querySelectorAll("iframe").length > 0) {
      try {
        chrome.runtime.sendMessage({ type: "IFRAME_WARNING" }, () => void chrome.runtime.lastError);
      } catch (e) {
        /* ignore */
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATE_CHANGED") {
      const was = recording;
      recording = !!msg.recording;
      if (recording && !was) {
        iframeChecked = false;
        recordVisit();
        checkIframes();
      }
      if (!recording) {
        clearTimeout(scrollTimer); // paused / stopped: whatever was pending is not part of the recording
        scrollTimer = null;
      }
      startOverlayPoll();
    }
  });

  // On (re)load, ask whether we should be recording. If yes, log the visit.
  function syncState() {
    try {
      chrome.runtime.sendMessage({ type: "OVERLAY_STATE" }, (state) => {
        if (chrome.runtime.lastError || !state) return;
        recording = !!state.recording;
        if (recording) {
          recordVisit();
          checkIframes();
        }
        // A paused (but still active) recording also needs the overlay, and
        // `state.recording` alone can't tell that apart from fully stopped
        // (or from a recording happening in a different tab).
        if (state.active && state.isThisTab) startOverlayPoll();
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
