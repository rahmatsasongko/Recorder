// Shared, framework-agnostic model for every code generator.
// ----------------------------------------------------------
// Recorded steps -> a Page Object Model that says WHAT each step does, never
// how a given framework spells it:
//
//   registry  pages / locators / data / messages / methods, shared across
//             suites so a page touched twice yields one Page Object.
//   method    { name, params, op } — `op` is an abstract operation
//             ({ t: "click", field: "buttonLogin" }), turned into real code
//             by lib/gen-cypress.js, gen-playwright.js and gen-wdio.js.
//   instr     one line of a scenario: visit / call / scroll / comment.
//
// window.GenCore.buildProject(suites) -> { suiteModels, pages, baseUrl, ... }

(function () {
  // Any recorded upload filename ending in one of these gets swapped for the
  // bundled fixtures/tije-test-logo.png (see the "upload" case below).
  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i;

  /* ------------------------------ string utils ------------------------------ */

  function cap(s) {
    s = String(s || "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function words(s) {
    return String(s || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  function camel(s) {
    const w = words(s);
    if (!w.length) return "";
    return (
      w[0].toLowerCase() +
      w
        .slice(1)
        .map((x) => cap(x.toLowerCase()))
        .join("")
    );
  }
  function pascal(s) {
    return cap(camel(s));
  }
  function screamer(s) {
    return (
      words(s)
        .slice(0, 6)
        .map((x) => x.toUpperCase())
        .join("_") || "MESSAGE"
    );
  }
  // Escapes `s` to sit between two `quote` characters in JS source. Line
  // terminators have to be escaped too: a raw newline ends a string literal,
  // so a multi-line <textarea> value would otherwise generate a syntax error.
  function jsEscape(s, quote) {
    let out = "";
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === quote || ch === "\\") out += "\\" + ch;
      else if (c === 10) out += "\\n";
      else if (c === 13) out += "\\r";
      else if (c === 9) out += "\\t";
      // other control characters, plus U+2028 / U+2029 which end a line in JS
      else if (c < 0x20 || c === 0x2028 || c === 0x2029) out += "\\u" + c.toString(16).padStart(4, "0");
      else out += ch;
    }
    return out;
  }

  function dq(v) {
    return '"' + jsEscape(v == null ? "" : v, '"') + '"';
  }
  function sq(v) {
    v = String(v == null ? "" : v);
    if (v.includes("'") && !v.includes('"')) return '"' + jsEscape(v, '"') + '"';
    return "'" + jsEscape(v, "'") + "'";
  }
  function pathOf(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search + u.hash || "/";
    } catch (e) {
      return url || "/";
    }
  }
  /* ------------------------------ page identity ------------------------------ */

  // A path segment that names one record rather than a page: /users/123,
  // /orders/3f2b8c1e-..., /files/507f1f77bcf86cd799439011, or a route
  // placeholder someone typed in by hand (:id, {id}, [id]).
  const UUID_SEG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isDynamicSegment(seg) {
    return (
      /^\d+$/.test(seg) ||
      UUID_SEG.test(seg) ||
      /^[0-9a-f]{16,}$/i.test(seg) || // Mongo ObjectId, hashes
      (/^[A-Za-z0-9]{20,}$/.test(seg) && /\d/.test(seg)) || // Firebase / cuid / ULID style ids
      /^(:[\w-]+|\{[\w-]+\}|\[[\w-]+\])$/.test(seg)
    );
  }

  // The route of a URL as segments. A hash-routed app (/#/users/list) keeps
  // its whole route after the "#", so its pathname alone is always "/".
  function pathSegments(url) {
    try {
      const u = new URL(url);
      let path = u.pathname;
      if ((path === "/" || path === "") && /^#!?\//.test(u.hash)) {
        path = u.hash.replace(/^#!?/, "").replace(/[?#].*$/, "");
      }
      return path.split("/").filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  // What makes two URLs "the same page": the route with ids folded away, so
  // /users/1 and /users/2 are one page while /users and /users/1 are two.
  function pageTemplate(url) {
    return pathSegments(url)
      .map((s) => (isDynamicSegment(s) ? ":id" : s.toLowerCase()))
      .join("/");
  }

  // A valid identifier stem for a page. `depth` is how many of the trailing
  // static segments to use: 1 gives "edit", 2 gives "productEdit". A route
  // that ends in an id is a detail page of whatever precedes it.
  function pageKeyFor(segs, depth) {
    const statics = segs.filter((s) => !isDynamicSegment(s));
    const detail = segs.length > 0 && isDynamicSegment(segs[segs.length - 1]);
    let key = camel(statics.slice(-depth).join(" "));
    if (detail) key = key ? key + "Detail" : "detail";
    if (!key) key = "home";
    // A class / const name cannot start with a digit (/2024-report).
    if (/^\d/.test(key)) key = "page" + cap(key);
    return key;
  }

  // The shortest key for a URL that no page in `taken` already uses. Two
  // different routes with the same last segment (/admin/edit, /product/edit)
  // used to collapse into one Page Object; the later one now widens with its
  // parent segment instead (edit, productEdit).
  function uniquePageKey(segs, taken) {
    const statics = segs.filter((s) => !isDynamicSegment(s)).length;
    for (let depth = 1; depth <= Math.max(1, statics); depth++) {
      const key = pageKeyFor(segs, depth);
      if (!taken[key]) return key;
    }
    const base = pageKeyFor(segs, Math.max(1, statics));
    let i = 2;
    while (taken[base + i]) i++;
    return base + i;
  }

  // Short key for one URL in isolation (no other pages to collide with).
  function pageKey(url) {
    return uniquePageKey(pathSegments(url), {});
  }
  function originOf(session) {
    for (const sc of session.scenarios || []) {
      for (const st of sc.steps || []) {
        if (st && st.url) {
          try {
            return new URL(st.url).origin;
          } catch (e) {}
        }
      }
    }
    try {
      return new URL(session.targetUrl).origin;
    } catch (e) {
      return "http://localhost:3000";
    }
  }
  function safeFileName(s) {
    return (
      String(s).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
      "project"
    );
  }

  /* ------------------------------ naming ------------------------------ */

  const TAG_TYPE = {
    input: "input",
    textarea: "input",
    select: "dropdown",
    button: "button",
    a: "link",
  };
  const TYPE_WORDS = [
    "button",
    "btn",
    "input",
    "field",
    "textbox",
    "textfield",
    "dropdown",
    "select",
    "link",
    "checkbox",
    "radio",
    "icon",
    "menu",
    "tab",
    "handle",
  ];

  function splitBase(elementName) {
    let w = words(elementName).map((x) => x.toLowerCase());
    if (!w.length) w = ["element"];
    let typeWord = null;
    const norm = (x) => (x === "btn" ? "button" : x);
    // strip a trailing type word ("login button", "email input")
    if (w.length > 1 && TYPE_WORDS.includes(w[w.length - 1])) {
      typeWord = norm(w[w.length - 1]);
      w = w.slice(0, -1);
    }
    // strip a leading type word ("button login", "input password")
    if (w.length > 1 && TYPE_WORDS.includes(w[0])) {
      typeWord = typeWord || norm(w[0]);
      w = w.slice(1);
    }
    return { base: camel(w.join(" ")) || "element", typeWord };
  }

  function isPasswordStep(st) {
    return (
      st.inputType === "password" ||
      /pass(word)?|sandi/i.test(st.elementName || "") ||
      /pass(word)?|sandi/i.test(st.selector || "")
    );
  }

  // A value that must not be written into generated code. The recorder marks
  // password fields `sensitive`; type=password covers steps recorded before
  // that, and the naming check catches a "show password" toggle that flipped
  // the input to type=text. Narrower than isPasswordStep on purpose — that
  // one is only used to spot a login, and its bare "pass" also matches
  // "passport", which is ordinary test data.
  const SECRET_NAME = /pass(word|wd|code|phrase)|pwd|sandi/i;
  const NON_TEXT_INPUT = ["checkbox", "radio", "button", "submit", "reset", "image", "file", "hidden"];
  function isSecretStep(st) {
    if (!st) return false;
    if (st.sensitive === true || st.inputType === "password") return true;
    if (NON_TEXT_INPUT.includes(st.inputType)) return false;
    return SECRET_NAME.test(st.elementName || "") || SECRET_NAME.test(st.selector || "");
  }

  // Where a secret is used, for the file that tells whoever runs the tests
  // which variables to provide.
  function secretUse(ctx) {
    return { label: ctx.label || "" };
  }

  /* ------------------------------ registry ------------------------------ */

  // The shared "pages" state steps are compiled against. One session -> one
  // throwaway registry; a whole project -> one registry shared by every suite,
  // so a page visited by two suites accumulates both suites' locators and
  // methods into the same Page Object instead of colliding.
  function createRegistry() {
    const pages = {};
    const pageOrder = [];
    const pageByTemplate = {};
    const usedEnv = new Set();

    // A page is identified by its route template, not by its final URL
    // segment — the key (and so the class / file names) is derived from it
    // and made unique against the pages already registered.
    function ensurePage(url) {
      const tpl = pageTemplate(url);
      if (pageByTemplate[tpl]) return pageByTemplate[tpl];
      const key = uniquePageKey(pathSegments(url), pages);
      const page = {
        key,
        template: tpl,
        className: pascal(key) + "Page",
        fileBase: camel(key) + "Page",
        locatorConst: "locator" + pascal(key),
        locatorFile: "locator-" + key,
        messageConst: pascal(key) + "Message",
        messageFile: key + ".message",
        dataConst: pascal(key) + "Data",
        dataFile: key + ".data",
        locators: [],
        locatorBySelector: {},
        locatorByField: {},
        methods: [],
        methodByKey: {},
        messages: {},
        messageByText: {},
        data: {},
        dataByValue: {},
        // data key -> { env, uses } for values that must never be written
        // into the generated files (passwords).
        secrets: {},
        usesData: false,
        usesMessage: false,
      };
      pages[key] = page;
      pageByTemplate[tpl] = page;
      pageOrder.push(key);
      return page;
    }

    // Environment variable a secret is read from: LOGIN_PASSWORD. Unique
    // across the whole project, since the variables are global.
    function envName(page, dataKey) {
      const base =
        words(page.key + " " + dataKey)
          .map((w) => w.toUpperCase())
          .join("_") || "SECRET";
      let env = base;
      let i = 2;
      while (usedEnv.has(env)) env = base + "_" + i++;
      usedEnv.add(env);
      return env;
    }

    function getLocator(page, st) {
      if (page.locatorBySelector[st.selector])
        return page.locatorBySelector[st.selector];
      const { base, typeWord } = splitBase(st.elementName || "element");
      const tw = typeWord || TAG_TYPE[(st.tagName || "").toLowerCase()] || "";
      let field = tw ? tw + pascal(base) : camel(base);
      field = field || "element";
      let name = field;
      let i = 2;
      const used = new Set(page.locators.map((l) => l.field));
      while (used.has(name)) name = field + i++;
      // How the selector has to be looked up, which differs per framework:
      // "text" holds a visible label, "xpath" a path, "css" everything else.
      const kind =
        st.selectorType === "text"
          ? "text"
          : /^\(*\s*\.?\/\//.test(String(st.selector || ""))
            ? "xpath"
            : "css";

      const entry = {
        field: name,
        base,
        selector: st.selector,
        type: st.selectorType,
        kind,
        tag: (st.tagName || "").toLowerCase(),
        stable: st.selectorStable !== false,
      };
      page.locators.push(entry);
      page.locatorBySelector[st.selector] = entry;
      page.locatorByField[name] = entry;
      return entry;
    }

    // `secret` ({ label } — where it is used) marks a value that must not be
    // written into the generated project. It still gets a data key, so call
    // sites read the same (LoginData.password); the data file resolves the
    // key from an environment variable instead of embedding the value.
    function getDataKey(page, base, value, secret) {
      const stored = String(value == null ? "" : value);
      const sig = base + "=" + stored;
      let name = page.dataByValue[sig];
      if (!name) {
        const key = camel(base) || "value";
        name = key;
        let i = 2;
        while (Object.prototype.hasOwnProperty.call(page.data, name))
          name = key + i++;
        page.data[name] = stored;
        page.dataByValue[sig] = name;
        page.usesData = true;
      }
      if (secret) {
        const s = page.secrets[name] || (page.secrets[name] = { env: envName(page, name), uses: [] });
        if (secret.label && !s.uses.includes(secret.label)) s.uses.push(secret.label);
      }
      return name;
    }

    function getMessageKey(page, text) {
      const t = String(text || "").trim();
      if (page.messageByText[t]) return page.messageByText[t];
      let key = screamer(t);
      let name = key;
      let i = 2;
      while (Object.prototype.hasOwnProperty.call(page.messages, name))
        name = key + "_" + i++;
      page.messages[name] = t;
      page.messageByText[t] = name;
      page.usesMessage = true;
      return name;
    }

    function opSig(op) {
      return JSON.stringify(op);
    }

    function getMethod(page, name, def) {
      // Reuse a method only when it does the same thing; otherwise pick a
      // fresh name (verifyToast, verifyToast2, ...).
      const sig = opSig(def.op);
      let finalName = name;
      let i = 2;
      while (
        page.methodByKey[finalName] &&
        opSig(page.methodByKey[finalName].op) !== sig
      ) {
        finalName = name + i++;
      }
      if (page.methodByKey[finalName]) return page.methodByKey[finalName];
      const m = { name: finalName, params: def.params || [], op: def.op };
      page.methods.push(m);
      page.methodByKey[finalName] = m;
      return m;
    }

    return {
      pages,
      pageOrder,
      ensurePage,
      getLocator,
      getDataKey,
      getMessageKey,
      getMethod,
    };
  }

  /* ------------------------------ suite model ------------------------------ */

  function buildSuiteModel(session, reg) {
    const suiteName = session.suiteName || session.projectName || "Suite";
    const suiteKey = camel(suiteName) || "suite";
    const suiteLabel = words(suiteName)[0] || "Test";
    const baseUrl = originOf(session);

    // Turn one recorded step into a scenario instruction, registering the
    // page assets (locator / data / message / method) it needs on the way.
    function compile(step, ctx) {
      // The page a step belongs to is decided by its own URL, so steps that
      // follow a navigation land on the right Page Object even when the
      // recorder produced no explicit `visit` for it.
      if (step.url) {
        const p = reg.ensurePage(step.url);
        if (p !== ctx.page) ctx.page = p;
      }
      if (step.action === "visit") {
        return { kind: "visit", path: pathOf(step.url) };
      }
      if (!ctx.page) ctx.page = reg.ensurePage(step.url || session.targetUrl);
      const page = ctx.page;

      const call = (m, args) => ({
        kind: "call",
        page: page.className,
        pageKey: page.key,
        method: m.name,
        args: args || [],
      });

      if (step.action === "scroll") {
        const [x, y] = (step.value || "0,0")
          .split(",")
          .map((n) => Number(n) || 0);
        return { kind: "scroll", x: x || 0, y: y || 0 };
      }

      if (step.action === "assert" && (step.assertion || {}).type === "url") {
        const val = (step.assertion || {}).value || pathOf(step.url) || "/";
        const seg = pascal(words(val).slice(-2).join(" ")) || "Page";
        const m = reg.getMethod(page, "verifyUrl" + seg, {
          op: { t: "assertUrl", value: val },
        });
        return call(m);
      }

      // A "contain text" assertion with no element picked (typed straight
      // into the popup, or an assert-mode click on plain body text) checks
      // the whole page rather than one locator — e.g. asserting "Dashboard"
      // or "Charlie Chaplin" appears somewhere after login.
      if (
        step.action === "assert" &&
        (step.assertion || {}).type === "contain" &&
        !step.selector
      ) {
        const a = step.assertion;
        const key = reg.getMessageKey(page, a.value || "");
        const m = reg.getMethod(
          page,
          "verifyPageContains" +
            (pascal(words(a.value).slice(0, 3).join(" ")) || "Text"),
          { op: { t: "assertPageText", msgKey: key } },
        );
        return call(m);
      }

      if (!step.selector)
        return { kind: "comment", text: `skipped ${step.action}: no selector` };

      const loc = reg.getLocator(page, step);

      if (step.action === "assert") {
        const a = step.assertion || { type: "exist" };
        if (a.type === "contain") {
          const key = reg.getMessageKey(page, a.value || "");
          // Scope the text check to the recorded element — an unscoped text
          // match can hit several nodes and is a common flake source.
          const m = reg.getMethod(
            page,
            "verify" +
              (pascal(words(a.value).slice(0, 3).join(" ")) ||
                pascal(loc.base)),
            { op: { t: "assertText", field: loc.field, msgKey: key } },
          );
          return call(m);
        }
        if (a.type === "value") {
          const m = reg.getMethod(page, "verify" + pascal(loc.base) + "Value", {
            params: ["value"],
            op: { t: "assertValue", field: loc.field },
          });
          // Asserting a password field's value would otherwise write the
          // password straight into the spec.
          if (isSecretStep(step)) {
            const dk = reg.getDataKey(page, loc.base, a.value || "", secretUse(ctx));
            return call(m, [`${page.dataConst}.${dk}`]);
          }
          return call(m, [dq(a.value || "")]);
        }
        const suffix = a.type === "exist" ? "Exists" : "Visible";
        const m = reg.getMethod(page, "verify" + pascal(loc.base) + suffix, {
          op: {
            t: a.type === "exist" ? "assertExists" : "assertVisible",
            field: loc.field,
          },
        });
        return call(m);
      }

      // interactions
      const param = camel(loc.base) || "value";
      if (step.action === "type") {
        const m = reg.getMethod(page, "input" + pascal(loc.base), {
          params: [param],
          op: { t: "type", field: loc.field },
        });
        const dk = reg.getDataKey(
          page,
          loc.base,
          step.value,
          isSecretStep(step) ? secretUse(ctx) : null,
        );
        return call(m, [`${page.dataConst}.${dk}`]);
      }
      if (step.action === "clear") {
        return call(
          reg.getMethod(page, "clear" + pascal(loc.base), {
            op: { t: "clear", field: loc.field },
          }),
        );
      }
      if (step.action === "upload") {
        const rawNames =
          Array.isArray(step.files) && step.files.length
            ? step.files
            : step.value
              ? String(step.value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : ["file.pdf"];
        // The recorder never captures the actual file bytes (privacy/size),
        // only the filename picked at record time — so a generated project
        // pointing at that original name has nothing to actually find in its
        // fixtures folder and errors immediately. For images specifically we
        // ship a real fixture (fixtures/tije-test-logo.png) with the
        // extension, so swap any image upload over to that file — it exists,
        // so the exported test runs out of the box instead of erroring on a
        // missing fixture. Non-image uploads (pdf, csv, ...) keep the
        // recorded name, since we have no generic stand-in for those.
        const names = rawNames.map((n) => (IMAGE_EXT.test(n) ? "tije-test-logo.png" : n));
        const m = reg.getMethod(page, "upload" + pascal(loc.base), {
          op: { t: "upload", field: loc.field, files: names },
        });
        return call(m);
      }
      if (step.action === "select") {
        const m = reg.getMethod(page, "select" + pascal(loc.base), {
          params: [param],
          op: { t: "select", field: loc.field },
        });
        const dk = reg.getDataKey(page, loc.base, step.value);
        return call(m, [`${page.dataConst}.${dk}`]);
      }
      if (step.action === "check" || step.action === "uncheck") {
        return call(
          reg.getMethod(page, step.action + pascal(loc.base), {
            op: { t: step.action, field: loc.field },
          }),
        );
      }
      if (step.action === "submit") {
        return call(
          reg.getMethod(page, "submit" + pascal(loc.base), {
            op: { t: "submit", field: loc.field },
          }),
        );
      }
      if (step.action === "resize") {
        // The grip is dragged by a pixel delta — that is what replays, while
        // the resulting size is only good for a comment.
        return call(
          reg.getMethod(page, "resize" + pascal(loc.base), {
            op: {
              t: "resize",
              field: loc.field,
              dx: Math.round(Number(step.dx) || 0),
              dy: Math.round(Number(step.dy) || 0),
              width: Math.round(Number(step.width) || 0),
              height: Math.round(Number(step.height) || 0),
            },
          }),
        );
      }
      if (step.action === "drag") {
        return call(
          reg.getMethod(page, "drag" + pascal(loc.base), {
            op: {
              t: "drag",
              field: loc.field,
              dx: Math.round(Number(step.dx) || 0),
              dy: Math.round(Number(step.dy) || 0),
            },
          }),
        );
      }
      if (step.action === "drop") {
        if (!step.targetSelector)
          return { kind: "comment", text: "skipped drop: no target selector" };
        // The drop target earns a locator of its own on the same page.
        const target = reg.getLocator(page, {
          selector: step.targetSelector,
          selectorType: step.targetSelectorType,
          selectorStable: step.targetSelectorStable,
          elementName: step.targetName || "drop target",
          tagName: step.targetTagName || "",
        });
        return call(
          reg.getMethod(
            page,
            "drag" + pascal(loc.base) + "To" + pascal(target.base),
            {
              op: {
                t: "drop",
                field: loc.field,
                targetField: target.field,
                html5: step.dnd === "html5",
              },
            },
          ),
        );
      }
      if (step.action === "keydown") {
        return call(
          reg.getMethod(page, "press" + pascal(step.key || "key"), {
            op: {
              t: "press",
              field: loc.field,
              key: step.key || "Enter",
              token: step.value || "{enter}",
            },
          }),
        );
      }
      if (step.action === "click") {
        return call(
          reg.getMethod(page, "click" + pascal(loc.field), {
            op: { t: "click", field: loc.field },
          }),
        );
      }
      return { kind: "comment", text: `unhandled action ${step.action}` };
    }

    // Compile every scenario.
    const compiled = (session.scenarios || [])
      .filter((sc) => sc && (sc.steps || []).length)
      .map((sc) => {
        const ctx = {
          page: null,
          label: (suiteName + " › " + (sc.name || "scenario")).replace(/\s+/g, " "),
        };
        return {
          name: sc.name || "scenario",
          steps: sc.steps.filter(Boolean),
          instr: sc.steps.filter(Boolean).map((st) => compile(st, ctx)),
        };
      });

    /* ---- shared-prefix (login) extraction ---- */

    function sig(st) {
      return (
        st.action +
        "|" +
        (st.selector || "") +
        "|" +
        ((st.assertion || {}).type || "")
      );
    }

    let beforeVisit = null;
    let loginBody = null; // array of instr
    let loginName = "login";
    let landingPath = null; // where the app is right after login
    const scenarios = compiled.map((c) => ({
      name: c.name,
      instr: c.instr.slice(),
    }));

    if (compiled.length >= 2) {
      // longest common prefix by signature
      let lcp = compiled[0].steps.length;
      for (const c of compiled.slice(1)) {
        let k = 0;
        while (
          k < lcp &&
          k < c.steps.length &&
          sig(c.steps[k]) === sig(compiled[0].steps[k])
        )
          k++;
        lcp = k;
      }
      if (lcp > 0) {
        const prefixSteps = compiled[0].steps.slice(0, lcp);
        const prefixInstr = compiled[0].instr.slice(0, lcp);
        // leading visit -> beforeEach
        let start = 0;
        if (prefixInstr[0] && prefixInstr[0].kind === "visit") {
          beforeVisit = prefixInstr[0].path;
          start = 1;
        }
        const rest = prefixInstr.slice(start);
        const restSteps = prefixSteps.slice(start);
        const hasPassword = restSteps.some(isPasswordStep);
        if (rest.length >= 1 && (hasPassword || rest.length >= 2)) {
          loginBody = rest;
          loginName = hasPassword ? "login" : "prepare";
          for (const s of scenarios) s.instr = s.instr.slice(lcp);

          // Detect the post-login landing page so the hook can go straight
          // there instead of re-driving the UI login.
          for (const c of compiled) {
            const st = c.steps[lcp];
            if (
              st &&
              st.action === "assert" &&
              (st.assertion || {}).type === "url" &&
              st.assertion.value
            ) {
              landingPath = st.assertion.value;
              break;
            }
          }
          if (!landingPath) {
            for (const c of compiled) {
              const st = c.steps[lcp];
              if (st && st.url) {
                const p = pathOf(st.url);
                if (p && p !== beforeVisit) {
                  landingPath = p;
                  break;
                }
              }
            }
          }
          // A successful login often reloads the app at `/`; that browser
          // navigation is not a user-recorded scenario action.
          if (landingPath === "/") {
            for (const s of scenarios) {
              if (
                s.instr[0] &&
                s.instr[0].kind === "visit" &&
                s.instr[0].path === "/"
              ) {
                s.instr = s.instr.slice(1);
              }
            }
          }
          // no fallback: if we can't tell where login lands, let the login
          // helper's own redirect decide and don't emit a stray visit.
        } else if (beforeVisit) {
          // only the visit is shared
          for (const s of scenarios) {
            if (
              s.instr[0] &&
              s.instr[0].kind === "visit" &&
              s.instr[0].path === beforeVisit
            ) {
              s.instr = s.instr.slice(1);
            }
          }
        }
      }
    } else if (compiled.length === 1) {
      const c = compiled[0];
      if (c.instr[0] && c.instr[0].kind === "visit") {
        beforeVisit = c.instr[0].path;
        scenarios[0].instr = c.instr.slice(1);
      }
    }

    return {
      suiteName,
      suiteKey,
      suiteLabel,
      baseUrl,
      pages: reg.pageOrder.map((k) => reg.pages[k]),
      scenarios,
      beforeVisit,
      loginBody,
      loginName,
      loginPath: beforeVisit,
      landingPath,
      hasLogin: !!loginBody,
    };
  }

  function buildModel(session) {
    return buildSuiteModel(session, createRegistry());
  }

  // Every suite merged into one project: one model per suite (its own spec and
  // login), all sharing one registry so Page Objects are deduplicated.
  function buildProject(suites) {
    const list = (suites || []).filter(
      (s) => s && (s.scenarios || []).some((sc) => (sc.steps || []).length),
    );
    if (!list.length) return { suiteModels: [], pages: [], baseUrl: "", projectName: "" };

    const reg = createRegistry();
    const suiteModels = [];
    const usedKeys = new Set();
    for (const s of list) {
      const m = buildSuiteModel(s, reg);
      // De-duplicate suite keys (e.g. two suites both named "Login") so their
      // spec files never overwrite one another.
      let key = m.suiteKey;
      let i = 2;
      while (usedKeys.has(key)) key = m.suiteKey + i++;
      usedKeys.add(key);
      m.suiteKey = key;
      suiteModels.push(m);
    }

    // Once more than one suite has its own extracted login, namespace the
    // helper name per suite — otherwise the last one defined would silently
    // win for every suite's hook.
    if (suiteModels.filter((m) => m.hasLogin).length > 1) {
      for (const m of suiteModels) {
        if (m.hasLogin) m.loginName = camel(m.suiteKey) + pascal(m.loginName);
      }
    }

    return {
      suiteModels,
      pages: reg.pageOrder.map((k) => reg.pages[k]),
      baseUrl:
        (suiteModels.find((m) => m.baseUrl) || {}).baseUrl ||
        "http://localhost:3000",
      projectName: list[0].projectName || list[0].suiteName || "Test Project",
    };
  }

  /* ------------------------------ render helpers ------------------------------ */

  // Which Page Objects / data files a set of scenario instructions touches,
  // so a spec imports only what it actually uses.
  function collectUses(instrLists) {
    const usedPages = new Set();
    const usedData = new Set();
    for (const list of instrLists)
      for (const it of list || []) {
        if (it.kind === "call") usedPages.add(it.page);
        (it.args || []).forEach((a) => {
          const m = /^([A-Za-z0-9]+Data)\./.exec(a);
          if (m) usedData.add(m[1]);
        });
      }
    return { usedPages, usedData };
  }

  function originWarning(suiteModels, baseUrl, configName) {
    const origins = Array.from(
      new Set(suiteModels.map((m) => m.baseUrl).filter(Boolean)),
    );
    if (origins.length < 2) return "";
    return (
      `\n> ⚠ These suites were recorded against different origins (${origins.join(
        ", ",
      )}). \`${configName}\` uses **${baseUrl}** as the base URL — a suite on a ` +
      `different origin may need full URLs instead of paths.\n`
    );
  }

  /* ------------------------------ secrets ------------------------------ */

  // The lines of a page's data object. A secret is looked up through
  // secret(NAME) (defined by secretHelper) instead of being written out.
  function dataRows(page) {
    const secrets = page.secrets || {};
    return Object.keys(page.data).map((k) =>
      secrets[k]
        ? `  ${k}: secret(${dq(secrets[k].env)}),`
        : `  ${k}: ${dq(page.data[k])},`,
    );
  }

  // Source of the secret() lookup a data file starts with when it holds one.
  //   "node"    process.env       Playwright, WebdriverIO, Selenium
  //   "cypress" Cypress.env       cypress.env.json and CYPRESS_* variables
  function secretHelper(page, kind) {
    if (!Object.keys(page.secrets || {}).length) return "";
    const cy = kind === "cypress";
    return [
      `// Secrets come from the ${cy ? "Cypress env" : "environment"} — never write real credentials here.`,
      cy
        ? `// Fill in cypress.env.json (git-ignored); cypress.env.example.json lists the names.`
        : `// Copy .env.example to .env and fill it in (.env is git-ignored).`,
      `const secret = (name) => {`,
      `  const value = ${cy ? "Cypress.env(name)" : "process.env[name]"};`,
      `  if (!value) {`,
      cy
        ? `    throw new Error("Missing Cypress env " + name + " — copy cypress.env.example.json to cypress.env.json and fill it in.");`
        : `    throw new Error("Missing environment variable " + name + " — copy .env.example to .env and fill it in.");`,
      `  }`,
      `  return value;`,
      `};`,
      ``,
      ``,
    ].join("\n");
  }

  // Every secret in a project, in page order.
  function secretsOf(pages) {
    const out = [];
    for (const p of pages || []) {
      for (const k of Object.keys(p.secrets || {})) {
        const s = p.secrets[k];
        out.push({ env: s.env, page: p.key, field: k, uses: s.uses });
      }
    }
    return out;
  }

  // .env.example — names only, never values.
  function envExample(pages) {
    const list = secretsOf(pages);
    if (!list.length) return "";
    const lines = [
      "# Credentials the generated tests need. Copy this file to .env and fill it in.",
      "# .env is git-ignored — never commit real credentials.",
      "",
    ];
    for (const s of list) {
      lines.push(
        `# ${s.page} › ${s.field}${s.uses.length ? " — " + s.uses.join("; ") : ""}`,
        `${s.env}=`,
        "",
      );
    }
    return lines.join("\n");
  }

  // cypress.env.example.json — the same list, in the shape Cypress reads.
  function envExampleJson(pages) {
    const list = secretsOf(pages);
    if (!list.length) return "";
    const obj = {};
    for (const s of list) obj[s.env] = "";
    return JSON.stringify(obj, null, 2) + "\n";
  }

  // README section: which variables exist and where to put them.
  function secretsReadme(pages, howToProvide) {
    const list = secretsOf(pages);
    if (!list.length) return "";
    const rows = list
      .map(
        (s) =>
          `| \`${s.env}\` | ${s.page} › ${s.field}${s.uses.length ? " — " + s.uses.join("; ") : ""} |`,
      )
      .join("\n");
    return `
## Secrets

Passwords are **not** stored in this project — the data files read them from the environment, so nothing sensitive gets committed.

| Variable | Used for |
| -------- | -------- |
${rows}

${howToProvide}
`;
  }

  window.GenCore = {
    cap,
    words,
    camel,
    pascal,
    screamer,
    dq,
    sq,
    pathOf,
    pageKey,
    pageTemplate,
    originOf,
    safeFileName,
    createRegistry,
    buildSuiteModel,
    buildModel,
    buildProject,
    collectUses,
    originWarning,
    isSecretStep,
    dataRows,
    secretHelper,
    secretsOf,
    envExample,
    envExampleJson,
    secretsReadme,
  };
})();
