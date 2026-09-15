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
  function dq(v) {
    return (
      '"' +
      String(v == null ? "" : v)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"') +
      '"'
    );
  }
  function sq(v) {
    v = String(v == null ? "" : v);
    if (v.includes("'") && !v.includes('"')) {
      return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    return "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }
  function pathOf(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search + u.hash || "/";
    } catch (e) {
      return url || "/";
    }
  }
  function pageKey(url) {
    try {
      const u = new URL(url);
      const seg = u.pathname.split("/").filter(Boolean);
      return camel(seg[seg.length - 1] || seg[0] || "home") || "home";
    } catch (e) {
      return "home";
    }
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

  /* ------------------------------ registry ------------------------------ */

  // The shared "pages" state steps are compiled against. One session -> one
  // throwaway registry; a whole project -> one registry shared by every suite,
  // so a page visited by two suites accumulates both suites' locators and
  // methods into the same Page Object instead of colliding.
  function createRegistry() {
    const pages = {};
    const pageOrder = [];

    function ensurePage(url) {
      const key = pageKey(url);
      if (!pages[key]) {
        pages[key] = {
          key,
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
          usesData: false,
          usesMessage: false,
        };
        pageOrder.push(key);
      }
      return pages[key];
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

    function getDataKey(page, base, value) {
      const stored = String(value == null ? "" : value);
      const sig = base + "=" + stored;
      if (page.dataByValue[sig]) return page.dataByValue[sig];
      let key = camel(base) || "value";
      let name = key;
      let i = 2;
      while (Object.prototype.hasOwnProperty.call(page.data, name))
        name = key + i++;
      page.data[name] = stored;
      page.dataByValue[sig] = name;
      page.usesData = true;
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
        const k = pageKey(step.url);
        if (!ctx.page || ctx.page.key !== k) ctx.page = reg.ensurePage(step.url);
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
        const dk = reg.getDataKey(page, loc.base, step.value);
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
        const names =
          Array.isArray(step.files) && step.files.length
            ? step.files
            : step.value
              ? String(step.value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : ["file.pdf"];
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
        const ctx = { page: null };
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
    originOf,
    safeFileName,
    createRegistry,
    buildSuiteModel,
    buildModel,
    buildProject,
    collectUses,
    originWarning,
  };
})();
