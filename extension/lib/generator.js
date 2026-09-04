// Cypress Code Generator (v2 — prd2 layout)
// ------------------------------------------
// One Test Suite  ->  one <suite>.cy.js with many it() scenarios.
//
//   cypress/
//   ├── e2e/<suite>/<suite>.cy.js
//   ├── pages/<page>/<page>Page.js       class + `export default new XPage()`
//   ├── locator/<page>/locator-<page>.js `export const locatorX = { ... }`
//   ├── messages/<page>/<page>.message.js `export const XMessage = { ... }`
//   ├── data/<page>/<page>.data.js       `export const XData = { ... }`
//   ├── support/commands.js              cy.login(), cy.getByTestId()
//   └── support/e2e.js
//   cypress.config.js                    defineConfig({ ... })
//
// window.CypressGen.generateFiles(session) -> { model, files: { path: contents } }

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

  /* ------------------------------ model ------------------------------ */

  function buildModel(session) {
    const suiteName = session.suiteName || session.projectName || "Suite";
    const suiteKey = camel(suiteName) || "suite";
    const suiteLabel = words(suiteName)[0] || "Test";
    const baseUrl = originOf(session);

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
      const entry = {
        field: name,
        base,
        selector: st.selector,
        type: st.selectorType,
        stable: st.selectorStable !== false,
      };
      page.locators.push(entry);
      page.locatorBySelector[st.selector] = entry;
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

    function getMethod(page, name, def) {
      // Reuse a method only when its body matches; otherwise pick a fresh name.
      let finalName = name;
      let i = 2;
      while (
        page.methodByKey[finalName] &&
        page.methodByKey[finalName].body !== def.body
      ) {
        finalName = name + i++;
      }
      if (page.methodByKey[finalName]) return page.methodByKey[finalName];
      const m = { name: finalName, params: def.params || [], body: def.body };
      page.methods.push(m);
      page.methodByKey[finalName] = m;
      return m;
    }

    // Turn one recorded step into a spec instruction (and register page assets).
    function compile(step, ctx) {
      // The page a step belongs to is decided by its own URL, so steps that
      // follow a navigation land on the right Page Object even when the
      // recorder produced no explicit `visit` for it.
      if (step.url) {
        const k = pageKey(step.url);
        if (!ctx.page || ctx.page.key !== k) ctx.page = ensurePage(step.url);
      }
      if (step.action === "visit") {
        return { kind: "visit", path: pathOf(step.url) };
      }
      if (!ctx.page) ctx.page = ensurePage(step.url || session.targetUrl);
      const page = ctx.page;

      const call = (m, args) => ({
        kind: "call",
        page: page.className,
        method: m.name,
        args: args || [],
      });

      if (step.action === "scroll") {
        const xy = (step.value || "0,0")
          .split(",")
          .map((n) => Number(n) || 0)
          .join(", ");
        return { kind: "raw", code: `cy.scrollTo(${xy});` };
      }

      if (step.action === "assert" && (step.assertion || {}).type === "url") {
        const val = (step.assertion || {}).value || pathOf(step.url) || "/";
        const seg = pascal(words(val).slice(-2).join(" ")) || "Page";
        const m = getMethod(page, "verifyUrl" + seg, {
          body: `    cy.url().should("include", ${dq(val)});`,
        });
        return call(m);
      }

      if (!step.selector)
        return { kind: "comment", text: `skipped ${step.action}: no selector` };

      const loc = getLocator(page, step);
      const g = `cy.get(${page.locatorConst}.${loc.field})`;

      if (step.action === "assert") {
        const a = step.assertion || { type: "exist" };
        if (a.type === "contain") {
          const key = getMessageKey(page, a.value || "");
          // Scope the text check to the recorded element — a bare cy.contains()
          // can match several nodes / partial text and is a common flake source.
          const m = getMethod(
            page,
            "verify" +
              (pascal(words(a.value).slice(0, 3).join(" ")) ||
                pascal(loc.base)),
            {
              body: `    ${g}.should("be.visible").and("contain", ${page.messageConst}.${key});`,
            },
          );
          return call(m);
        }
        if (a.type === "value") {
          const m = getMethod(page, "verify" + pascal(loc.base) + "Value", {
            params: ["value"],
            body: `    ${g}.should("have.value", value);`,
          });
          return call(m, [dq(a.value || "")]);
        }
        const suffix = a.type === "exist" ? "Exists" : "Visible";
        const should = a.type === "exist" ? '"exist"' : '"be.visible"';
        const m = getMethod(page, "verify" + pascal(loc.base) + suffix, {
          body: `    ${g}.should(${should});`,
        });
        return call(m);
      }

      // interactions
      const param = camel(loc.base) || "value";
      if (step.action === "type") {
        const m = getMethod(page, "input" + pascal(loc.base), {
          params: [param],
          body: `    ${g}.clear().type(${param});`,
        });
        const dk = getDataKey(page, loc.base, step.value);
        return call(m, [`${page.dataConst}.${dk}`]);
      }
      if (step.action === "clear") {
        return call(
          getMethod(page, "clear" + pascal(loc.base), {
            body: `    ${g}.clear();`,
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
        const fixtures = names.map((n) => `"cypress/fixtures/${n}"`).join(", ");
        const arg = names.length > 1 ? `[${fixtures}]` : fixtures;
        const m = getMethod(page, "upload" + pascal(loc.base), {
          body:
            `    // TODO: put ${names.join(", ")} in cypress/fixtures/\n` +
            `    ${g}.selectFile(${arg}, { force: true });`,
        });
        return call(m);
      }
      if (step.action === "select") {
        const m = getMethod(page, "select" + pascal(loc.base), {
          params: [param],
          body: `    ${g}.select(${param});`,
        });
        const dk = getDataKey(page, loc.base, step.value);
        return call(m, [`${page.dataConst}.${dk}`]);
      }
      if (step.action === "check" || step.action === "uncheck") {
        return call(
          getMethod(page, step.action + pascal(loc.base), {
            body: `    ${g}.${step.action}();`,
          }),
        );
      }
      if (step.action === "submit") {
        return call(
          getMethod(page, "submit" + pascal(loc.base), {
            body: `    ${g}.submit();`,
          }),
        );
      }
      if (step.action === "keydown") {
        return call(
          getMethod(page, "press" + pascal(step.key || "key"), {
            body: `    ${g}.type(${dq(step.value || "{enter}")});`,
          }),
        );
      }
      if (step.action === "click") {
        return call(
          getMethod(page, "click" + pascal(loc.field), {
            body: `    ${g}.click();`,
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

          // Detect the post-login landing page so beforeEach can go straight
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
          // no fallback: if we can't tell where login lands, let cy.login()'s
          // own redirect decide and don't emit a stray cy.visit().
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
      pages: pageOrder.map((k) => pages[k]),
      scenarios,
      beforeVisit,
      loginBody,
      loginName,
      loginPath: beforeVisit,
      landingPath,
      hasLogin: !!loginBody,
    };
  }

  /* ------------------------------ renderers ------------------------------ */

  function renderInstr(instr, indent) {
    const pad = " ".repeat(indent);
    const lines = [];
    for (const s of instr) {
      if (s.kind === "visit") lines.push(`${pad}cy.visit(${dq(s.path)});`);
      else if (s.kind === "raw") lines.push(`${pad}${s.code}`);
      else if (s.kind === "comment") lines.push(`${pad}// ${s.text}`);
      else if (s.kind === "call")
        lines.push(`${pad}${s.page}.${s.method}(${s.args.join(", ")});`);
    }
    return lines;
  }

  function renderLocator(page) {
    const rows = page.locators.map((l) => {
      const warn = l.stable
        ? ""
        : `  // WARNING: ${l.type || "css"} selector may be unstable\n`;
      return `${warn}  ${l.field}: ${sq(l.selector)},`;
    });
    return `export const ${page.locatorConst} = {
${rows.join("\n") || "  //"}
};
`;
  }

  function renderMessage(page) {
    const rows = Object.keys(page.messages).map(
      (k) => `  ${k}: ${dq(page.messages[k])},`,
    );
    return `export const ${page.messageConst} = {
${rows.join("\n") || "  //"}
};
`;
  }

  function renderData(page) {
    const rows = Object.keys(page.data).map(
      (k) => `  ${k}: ${dq(page.data[k])},`,
    );
    return `export const ${page.dataConst} = {
${rows.join("\n") || "  //"}
};
`;
  }

  function renderPage(page) {
    const imports = [];
    if (page.locators.length)
      imports.push(
        `import { ${page.locatorConst} } from "../../locator/${page.key}/${page.locatorFile}";`,
      );
    if (page.usesData)
      imports.push(
        `import { ${page.dataConst} } from "../../data/${page.key}/${page.dataFile}";`,
      );
    if (page.usesMessage)
      imports.push(
        `import { ${page.messageConst} } from "../../messages/${page.key}/${page.messageFile}";`,
      );

    const methods = page.methods.map(
      (m) => `  ${m.name}(${m.params.join(", ")}) {\n${m.body}\n  }`,
    );

    return `${imports.join("\n")}

class ${page.className} {

${methods.join("\n\n") || "  //"}

}

export default new ${page.className}();
`;
  }

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

  function renderSpec(model) {
    // The spec imports only what its it() bodies reference; the shared
    // beforeEach steps live in commands.js and are imported there.
    const { usedPages, usedData } = collectUses(
      model.scenarios.map((s) => s.instr),
    );

    const imports = [];
    for (const p of model.pages) {
      if (usedPages.has(p.className)) {
        imports.push(
          `import ${p.className} from "../../pages/${p.key}/${p.fileBase}";`,
        );
      }
    }
    for (const p of model.pages) {
      if (usedData.has(p.dataConst)) {
        imports.push(
          `import { ${p.dataConst} } from "../../data/${p.key}/${p.dataFile}";`,
        );
      }
    }

    const before = [];
    if (model.hasLogin) {
      // cy.login() drives the UI and ends on the app's post-login page, so no
      // extra cy.visit() here — scenarios navigate themselves from there.
      before.push(`    cy.${model.loginName}();`);
    } else if (model.beforeVisit) {
      before.push(`    cy.visit(${dq(model.beforeVisit)});`);
    }

    const beforeBlock = before.length
      ? `  beforeEach(() => {\n${before.join("\n")}\n  });\n\n`
      : "";

    const its = model.scenarios
      .map((sc, i) => {
        const title = `${model.suiteLabel} - ${i + 1} | ${sc.name}`;
        let body = renderInstr(sc.instr, 4);
        if (!body.length) body = ["    // covered by beforeEach"];
        return `  it(${dq(title)}, () => {\n${body.join("\n")}\n  });`;
      })
      .join("\n\n");

    return `${imports.join("\n")}

describe(${dq(model.suiteName)}, () => {

${beforeBlock}${its}

});
`;
  }

  function renderCommands(model) {
    const lines = [];
    lines.push(
      'Cypress.Commands.add("getByTestId", (id) => cy.get(`[data-testid="${id}"]`));',
    );
    lines.push("");

    if (model.hasLogin) {
      const { usedPages, usedData } = collectUses([model.loginBody]);
      const imp = [];
      for (const p of model.pages) {
        if (usedPages.has(p.className))
          imp.push(
            `import ${p.className} from "../pages/${p.key}/${p.fileBase}";`,
          );
      }
      const dataConsts = [];
      for (const p of model.pages) {
        if (usedData.has(p.dataConst)) {
          imp.push(
            `import { ${p.dataConst} } from "../data/${p.key}/${p.dataFile}";`,
          );
          dataConsts.push(p.dataConst);
        }
      }

      // The session key changes with the credentials so a new user re-logs in.
      const sessionKey =
        dataConsts.length === 1
          ? dataConsts[0]
          : dataConsts.length > 1
            ? "[" + dataConsts.join(", ") + "]"
            : dq(model.loginName);

      const login = [];
      if (model.loginPath) login.push(`  cy.visit(${dq(model.loginPath)});`);
      renderInstr(model.loginBody, 2).forEach((l) => login.push(l));
      if (model.loginPath) {
        login.push(
          `  // fail fast if the login did not go through`,
          `  cy.location("pathname", { timeout: 15000 }).should("not.eq", ${dq(model.loginPath)});`,
        );
      }
      const guardPath = model.landingPath || "/";

      const sessionBlock = [
        `// FASTER (opt-in): if your app keeps auth in cookies / localStorage,`,
        `// swap the command above for this one. cy.session() caches the login`,
        `// across tests + specs and re-runs it automatically when it goes stale,`,
        `// so a backend that won't persist the session degrades to per-test`,
        `// login rather than breaking.`,
        `//`,
        `// Cypress.Commands.add(${dq(model.loginName)}, () => {`,
        `//   cy.session(`,
        `//     ${sessionKey},`,
        `//     () => {`,
        ...login.map((l) => "//       " + l.trimStart()),
        `//     },`,
        `//     {`,
        `//       cacheAcrossSpecs: true,`,
        ...(model.loginPath
          ? [
              `//       validate() {`,
              `//         cy.visit(${dq(guardPath)});`,
              `//         cy.location("pathname", { timeout: 10000 }).should("not.eq", ${dq(model.loginPath)});`,
              `//       },`,
            ]
          : []),
        `//     },`,
        `//   );`,
        `// });`,
      ].join("\n");

      return `${imp.join("\n")}

// Logs in through the UI. Works on any app; runs once per test.
Cypress.Commands.add(${dq(model.loginName)}, () => {
${login.join("\n")}
});

${sessionBlock}

${lines.join("\n")}`;
    }

    return `// Shared login — fill in the steps for your app.
Cypress.Commands.add("login", () => {
  // cy.visit("/login");
  // cy.getByTestId("email-input").type(Cypress.env("email"));
  // cy.getByTestId("input-password").type(Cypress.env("password"));
  // cy.getByTestId("button-login").click();
  // cy.location("pathname", { timeout: 15000 }).should("not.eq", "/login");
});

// FASTER (opt-in): wrap the body above in cy.session([...], () => { ... },
// { cacheAcrossSpecs: true }) once your app is known to persist auth in
// cookies / localStorage.

${lines.join("\n")}`;
  }

  function renderSupportE2E() {
    return `import "./commands";

// Ignore app errors that are not the test's fault (keeps real failures).
Cypress.on("uncaught:exception", () => false);

// Neutralise CSS animations / transitions / smooth scrolling. Elements that are
// still animating when Cypress tries to click or read them are a top flake cause.
Cypress.on("window:before:load", (win) => {
  const style = win.document.createElement("style");
  style.setAttribute("data-cypress-no-motion", "");
  style.textContent = \`*, *::before, *::after {
    transition-duration: 0ms !important;
    transition-delay: 0ms !important;
    animation-duration: 0ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
  }\`;
  (win.document.head || win.document.documentElement).appendChild(style);
});
`;
  }

  function renderConfig(model) {
    return `const { defineConfig } = require("cypress");

module.exports = defineConfig({
  // Retry a failed test before reporting it as broken.
  retries: { runMode: 2, openMode: 0 },

  e2e: {
    baseUrl: ${dq(model.baseUrl)},
    pageLoadTimeout: 60000,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 15000,
    viewportWidth: 1920,
    viewportHeight: 1080,
    scrollBehavior: "center",
    experimentalMemoryManagement: true,
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
`;
  }

  function renderPackageJson(model) {
    return (
      JSON.stringify(
        {
          name:
            words(model.suiteName)
              .map((w) => w.toLowerCase())
              .join("-") || "cypress-project",
          version: "1.0.0",
          private: true,
          scripts: { "cy:open": "cypress open", "cy:run": "cypress run" },
          devDependencies: { cypress: "^15.0.0" },
        },
        null,
        2,
      ) + "\n"
    );
  }

  function renderReadme(model) {
    return `# ${model.suiteName}

Generated by **Cypress Recorder Extension**.

\`\`\`bash
npm install
npx cypress open
npx cypress run
\`\`\`

## Layout

| Folder | Contents |
| ------ | -------- |
| \`cypress/e2e/\`      | Test suites — one file, many \`it()\` scenarios |
| \`cypress/pages/\`    | Page Objects (business/action layer) |
| \`cypress/locator/\`  | \`export const locatorX = { ... }\` selectors |
| \`cypress/messages/\` | \`export const XMessage = { ... }\` assertion text |
| \`cypress/data/\`     | \`export const XData = { ... }\` test data |
| \`cypress/support/\`  | \`cy.login()\`, \`cy.getByTestId()\`, hooks |
${model.hasLogin ? "\n> The shared opening steps of every scenario were extracted into `cy." + model.loginName + "()` and run in `beforeEach`.\n" : ""}
## Anti-flake measures baked in

- **Test retries** — \`retries: { runMode: 2 }\`; a test is retried twice before it fails.
- **Longer timeouts** — \`defaultCommandTimeout\` 10s, request/response 15s (vs 4s default).
- **Animations off** — \`support/e2e.js\` injects CSS to zero out transitions/animations and smooth scrolling.
- **\`scrollBehavior: "center"\`** — elements are centred before Cypress acts, avoiding sticky-header overlaps.
- **Scoped text assertions** — \`cy.get(locator).should("contain", ...)\` instead of a bare \`cy.contains()\`.
- **Login guard** — \`cy.${model.loginName}()\` asserts the URL changed before the test continues.
- **Stable selectors** — \`data-*\` → \`id\` → \`name\` → \`aria-label\` → stable content attrs; unstable ones flagged in the locator file.

Next steps if a spec is still flaky:

1. Switch \`cy.${model.loginName}()\` to the commented \`cy.session()\` version in \`support/commands.js\` (much faster, one login per run).
2. Add \`cy.intercept()\` + \`cy.wait("@alias")\` for the XHR each page depends on — the recorder can't infer these.
`;
  }

  /* ------------------------------ assemble ------------------------------ */

  function generateFiles(session) {
    const model = buildModel(session);
    const files = {};
    const s = model.suiteKey;

    for (const page of model.pages) {
      if (page.locators.length)
        files[`cypress/locator/${page.key}/${page.locatorFile}.js`] =
          renderLocator(page);
      if (page.usesMessage)
        files[`cypress/messages/${page.key}/${page.messageFile}.js`] =
          renderMessage(page);
      if (page.usesData)
        files[`cypress/data/${page.key}/${page.dataFile}.js`] =
          renderData(page);
      if (page.methods.length)
        files[`cypress/pages/${page.key}/${page.fileBase}.js`] =
          renderPage(page);
    }

    files[`cypress/e2e/${s}/${s}.cy.js`] = renderSpec(model);
    files["cypress/support/commands.js"] = renderCommands(model);
    files["cypress/support/e2e.js"] = renderSupportE2E();
    files["cypress.config.js"] = renderConfig(model);
    files["package.json"] = renderPackageJson(model);
    files["README.md"] = renderReadme(model);

    return { model, files };
  }

  window.CypressGen = { buildModel, generateFiles, camel, pascal };
})();
