// Cypress renderer (prd2 layout)
// ------------------------------
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

(function () {
  const C = window.GenCore;
  const { camel, pascal, words, dq, sq, collectUses, originWarning } = C;

  /* ------------------------------ operations ------------------------------ */

  // Drag an element by a pixel delta. A drag widget binds mousemove/mouseup
  // on document once the drag starts and ignores a single jump to the
  // destination, so the move is walked across in steps.
  function dragByCode(g, dx, dy, comment) {
    return [
      `    // ${comment}`,
      `    ${g}.then(($el) => {`,
      `      const box = $el[0].getBoundingClientRect();`,
      `      const x = box.left + box.width / 2;`,
      `      const y = box.top + box.height / 2;`,
      `      cy.wrap($el).trigger("mouseover", { force: true });`,
      `      cy.wrap($el).trigger("mousedown", { which: 1, button: 0, clientX: x, clientY: y, force: true });`,
      `      for (let i = 1; i <= 10; i++) {`,
      `        cy.document().trigger("mousemove", {`,
      `          which: 1,`,
      `          buttons: 1,`,
      `          clientX: x + (${dx} * i) / 10,`,
      `          clientY: y + (${dy} * i) / 10,`,
      `        });`,
      `      }`,
      `      cy.document().trigger("mouseup", { which: 1, button: 0, clientX: x + ${dx}, clientY: y + ${dy} });`,
      `    });`,
    ].join("\n");
  }

  // How to reach one locator. A text locator holds a visible label, so it
  // needs cy.contains() rather than cy.get().
  function elFor(page, field) {
    const ref = `${page.locatorConst}.${field}`;
    const l = page.locatorByField[field];
    if (l && l.kind === "text") {
      return l.tag ? `cy.contains(${dq(l.tag)}, ${ref})` : `cy.contains(${ref})`;
    }
    return `cy.get(${ref})`;
  }

  function renderBody(page, m) {
    const op = m.op;
    const g = elFor(page, op.field);
    const p = m.params[0];
    switch (op.t) {
      case "assertUrl":
        return `    cy.url().should("include", ${dq(op.value)});`;
      case "assertText":
        return `    ${g}.should("be.visible").and("contain", ${page.messageConst}.${op.msgKey});`;
      case "assertValue":
        return `    ${g}.should("have.value", ${p});`;
      case "assertExists":
        return `    ${g}.should("exist");`;
      case "assertVisible":
        return `    ${g}.should("be.visible");`;
      case "type":
        return `    ${g}.clear().type(${p});`;
      case "clear":
        return `    ${g}.clear();`;
      case "select":
        return `    ${g}.select(${p});`;
      case "check":
      case "uncheck":
        return `    ${g}.${op.t}();`;
      case "submit":
        return `    ${g}.submit();`;
      case "press":
        return `    ${g}.type(${dq(op.token)});`;
      case "click":
        return `    ${g}.click();`;
      case "upload": {
        const fixtures = op.files.map((n) => `"cypress/fixtures/${n}"`).join(", ");
        const arg = op.files.length > 1 ? `[${fixtures}]` : fixtures;
        return (
          `    // TODO: put ${op.files.join(", ")} in cypress/fixtures/\n` +
          `    ${g}.selectFile(${arg}, { force: true });`
        );
      }
      case "resize": {
        const size = op.width && op.height ? ` → about ${op.width}x${op.height}` : "";
        return dragByCode(
          g,
          op.dx,
          op.dy,
          `drag the handle ${op.dx}px right, ${op.dy}px down${size}`,
        );
      }
      case "drag":
        return dragByCode(g, op.dx, op.dy, `drag ${op.dx}px right, ${op.dy}px down`);
      case "drop": {
        const target = elFor(page, op.targetField);
        if (op.html5) {
          // HTML5 drag-and-drop ignores synthetic mouse moves; the events
          // must carry one shared DataTransfer instead.
          return [
            `    const dataTransfer = new DataTransfer();`,
            `    ${g}.trigger("dragstart", { dataTransfer });`,
            `    ${target}.trigger("dragenter", { dataTransfer });`,
            `    ${target}.trigger("dragover", { dataTransfer });`,
            `    ${target}.trigger("drop", { dataTransfer });`,
            `    ${g}.trigger("dragend", { dataTransfer });`,
          ].join("\n");
        }
        return [
          `    ${target}.then(($target) => {`,
          `      const t = $target[0].getBoundingClientRect();`,
          `      const tx = t.left + t.width / 2;`,
          `      const ty = t.top + t.height / 2;`,
          `      ${g}.then(($source) => {`,
          `        const s = $source[0].getBoundingClientRect();`,
          `        const sx = s.left + s.width / 2;`,
          `        const sy = s.top + s.height / 2;`,
          `        cy.wrap($source).trigger("mousedown", { which: 1, button: 0, clientX: sx, clientY: sy, force: true });`,
          `        for (let i = 1; i <= 10; i++) {`,
          `          cy.document().trigger("mousemove", {`,
          `            which: 1,`,
          `            buttons: 1,`,
          `            clientX: sx + ((tx - sx) * i) / 10,`,
          `            clientY: sy + ((ty - sy) * i) / 10,`,
          `          });`,
          `        }`,
          `        cy.document().trigger("mouseup", { which: 1, button: 0, clientX: tx, clientY: ty });`,
          `      });`,
          `    });`,
        ].join("\n");
      }
    }
    return `    // unsupported operation: ${op.t}`;
  }

  function renderInstr(instr, indent) {
    const pad = " ".repeat(indent);
    const lines = [];
    for (const s of instr) {
      if (s.kind === "visit") lines.push(`${pad}cy.visit(${dq(s.path)});`);
      else if (s.kind === "scroll") lines.push(`${pad}cy.scrollTo(${s.x}, ${s.y});`);
      else if (s.kind === "comment") lines.push(`${pad}// ${s.text}`);
      else if (s.kind === "call")
        lines.push(`${pad}${s.page}.${s.method}(${s.args.join(", ")});`);
    }
    return lines;
  }

  /* ------------------------------ page assets ------------------------------ */

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
      (m) => `  ${m.name}(${m.params.join(", ")}) {\n${renderBody(page, m)}\n  }`,
    );

    return `${imports.join("\n")}

class ${page.className} {

${methods.join("\n\n") || "  //"}

}

export default new ${page.className}();
`;
  }

  /* ------------------------------ spec ------------------------------ */

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

  /* ------------------------------ support ------------------------------ */

  function renderLoginBlock(model, comment) {
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

    const code = `${comment}
Cypress.Commands.add(${dq(model.loginName)}, () => {
${login.join("\n")}
});

${sessionBlock}`;

    return { imports: imp, code };
  }

  function renderCommands(model) {
    const lines = [];
    lines.push(
      'Cypress.Commands.add("getByTestId", (id) => cy.get(`[data-testid="${id}"]`));',
    );
    lines.push("");

    if (model.hasLogin) {
      const { imports, code } = renderLoginBlock(
        model,
        "// Logs in through the UI. Works on any app; runs once per test.",
      );
      return `${imports.join("\n")}

${code}

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

  // Merges every suite's login command into one commands.js. Names are
  // namespaced by gen-core when more than one suite needs a login, so they
  // can't clobber each other.
  function renderProjectCommands(suiteModels) {
    const header =
      'Cypress.Commands.add("getByTestId", (id) => cy.get(`[data-testid="${id}"]`));';
    const withLogin = suiteModels.filter((m) => m.hasLogin);
    if (!withLogin.length) return `${header}\n`;

    const allImports = [];
    const blocks = withLogin.map((model) => {
      const { imports, code } = renderLoginBlock(
        model,
        `// ${model.suiteName} — logs in through the UI.`,
      );
      allImports.push(...imports);
      return code;
    });
    const uniqueImports = Array.from(new Set(allImports));

    return `${uniqueImports.join("\n")}

${header}

${blocks.join("\n\n")}
`;
  }

  function renderSupportE2E() {
    return `import "./commands";

// How long each test took, and a total for the spec. The numbers are printed
// in the terminal by the matching tasks in cypress.config.js.
const timings = [];
let startedAt = 0;

beforeEach(() => {
  startedAt = Date.now();
});

afterEach(function () {
  const ms = Date.now() - startedAt;
  timings.push(ms);
  cy.task("timing:test", { title: this.currentTest.title, ms }, { log: false });
});

after(() => {
  const total = timings.reduce((sum, ms) => sum + ms, 0);
  cy.task("timing:total", { count: timings.length, total }, { log: false });
});

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
    setupNodeEvents(on) {
      const secs = (ms) => (ms / 1000).toFixed(2) + "s";

      // Printed from support/e2e.js as the run goes.
      on("task", {
        "timing:test"({ title, ms }) {
          console.log("  ⏱  " + secs(ms).padStart(8) + "  " + title);
          return null;
        },
        "timing:total"({ count, total }) {
          const avg = count ? total / count : 0;
          console.log(
            "  ⏱  TOTAL " + count + " test(s) in " + secs(total) +
              " (avg " + secs(avg) + ")",
          );
          return null;
        },
      });
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
- **Timing** — every test's duration and a per-spec total are printed in the terminal (support/e2e.js + the tasks in cypress.config.js).

Next steps if a spec is still flaky:

1. Switch \`cy.${model.loginName}()\` to the commented \`cy.session()\` version in \`support/commands.js\` (much faster, one login per run).
2. Add \`cy.intercept()\` + \`cy.wait("@alias")\` for the XHR each page depends on — the recorder can't infer these.
`;
  }

  function renderProjectReadme(suiteModels, projectName, baseUrl) {
    const warn = originWarning(suiteModels, baseUrl, "cypress.config.js");
    const rows = suiteModels
      .map((m) => {
        const count = m.scenarios.length;
        const login = m.hasLogin ? ` (shared \`cy.${m.loginName}()\`)` : "";
        return `| \`cypress/e2e/${m.suiteKey}/${m.suiteKey}.cy.js\` | ${m.suiteName} — ${count} scenario${count === 1 ? "" : "s"}${login} |`;
      })
      .join("\n");

    return `# ${projectName}

Generated by **Cypress Recorder Extension** — merged from ${suiteModels.length} test suite${suiteModels.length === 1 ? "" : "s"}.

\`\`\`bash
npm install
npx cypress open
npx cypress run
\`\`\`
${warn}
## Test suites in this project

| Spec | Contents |
| ---- | -------- |
${rows}

## Layout

| Folder | Contents |
| ------ | -------- |
| \`cypress/e2e/\`      | One folder per suite, one spec file, many \`it()\` scenarios |
| \`cypress/pages/\`    | Page Objects — shared automatically when two suites touch the same page |
| \`cypress/locator/\`  | \`export const locatorX = { ... }\` selectors |
| \`cypress/messages/\` | \`export const XMessage = { ... }\` assertion text |
| \`cypress/data/\`     | \`export const XData = { ... }\` test data |
| \`cypress/support/\`  | one login command per suite that needs one, \`cy.getByTestId()\`, hooks |

## Anti-flake measures baked in

- **Test retries** — \`retries: { runMode: 2 }\`; a test is retried twice before it fails.
- **Longer timeouts** — \`defaultCommandTimeout\` 10s, request/response 15s (vs 4s default).
- **Animations off** — \`support/e2e.js\` injects CSS to zero out transitions/animations and smooth scrolling.
- **\`scrollBehavior: "center"\`** — elements are centred before Cypress acts, avoiding sticky-header overlaps.
- **Scoped text assertions** — \`cy.get(locator).should("contain", ...)\` instead of a bare \`cy.contains()\`.
- **Stable selectors** — \`data-*\` → \`id\` → \`name\` → \`aria-label\` → stable content attrs; unstable ones flagged in the locator file.
- **Timing** — every test's duration and a per-spec total are printed in the terminal (support/e2e.js + the tasks in cypress.config.js).
`;
  }

  /* ------------------------------ assemble ------------------------------ */

  function pageFiles(pages, files) {
    for (const page of pages) {
      if (page.locators.length)
        files[`cypress/locator/${page.key}/${page.locatorFile}.js`] =
          renderLocator(page);
      if (page.usesMessage)
        files[`cypress/messages/${page.key}/${page.messageFile}.js`] =
          renderMessage(page);
      if (page.usesData)
        files[`cypress/data/${page.key}/${page.dataFile}.js`] = renderData(page);
      if (page.methods.length)
        files[`cypress/pages/${page.key}/${page.fileBase}.js`] = renderPage(page);
    }
  }

  function generateFiles(session) {
    const model = C.buildModel(session);
    const files = {};
    const s = model.suiteKey;

    pageFiles(model.pages, files);

    files[`cypress/e2e/${s}/${s}.cy.js`] = renderSpec(model);
    files["cypress/support/commands.js"] = renderCommands(model);
    files["cypress/support/e2e.js"] = renderSupportE2E();
    files["cypress.config.js"] = renderConfig(model);
    files["package.json"] = renderPackageJson(model);
    files["README.md"] = renderReadme(model);

    return { model, files };
  }

  function generateProjectFiles(suites) {
    const project = C.buildProject(suites);
    const { suiteModels, pages, baseUrl, projectName } = project;
    if (!suiteModels.length) return { suiteModels: [], files: {} };

    const files = {};
    pageFiles(pages, files);

    for (const model of suiteModels) {
      files[`cypress/e2e/${model.suiteKey}/${model.suiteKey}.cy.js`] =
        renderSpec(model);
    }

    files["cypress/support/commands.js"] = renderProjectCommands(suiteModels);
    files["cypress/support/e2e.js"] = renderSupportE2E();
    files["cypress.config.js"] = renderConfig({ baseUrl });
    files["package.json"] = renderPackageJson({ suiteName: projectName });
    files["README.md"] = renderProjectReadme(suiteModels, projectName, baseUrl);

    return { suiteModels, baseUrl, projectName, files };
  }

  window.GenCypress = {
    id: "cypress",
    label: "Cypress",
    specSuffix: ".cy.js",
    generateFiles,
    generateProjectFiles,
  };
})();
