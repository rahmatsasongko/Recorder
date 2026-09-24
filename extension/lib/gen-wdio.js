// WebdriverIO renderer (v8 / v9, mocha)
// -------------------------------------
// One Test Suite  ->  one <suite>.spec.js with many it() scenarios.
//
//   test/specs/<suite>/<suite>.spec.js     describe + it()
//   test/pages/<page>/<page>Page.js        class + `module.exports = new XPage()`
//   test/locator/<page>/locator-<page>.js  exports.locatorX = { ... }
//   test/messages/<page>/<page>.message.js exports.XMessage = { ... }
//   test/data/<page>/<page>.data.js        exports.XData = { ... }
//   test/support/auth.js                   async function login()
//   wdio.conf.js                           exports.config = { ... }
//
// CommonJS throughout, and `$`, `browser` and `expect` come from the WDIO
// test runner's injected globals — that is the combination that runs with no
// extra setup.

(function () {
  const C = window.GenCore;
  const { camel, pascal, words, dq, sq, collectUses, originWarning } = C;

  const KEY_ALIAS = { Esc: "Escape", Spacebar: "Space", Del: "Delete" };

  function key(k) {
    return KEY_ALIAS[k] || k || "Enter";
  }

  /* ------------------------------ operations ------------------------------ */

  function renderBody(page, m, indent) {
    const pad = " ".repeat(indent);
    const op = m.op;
    const el = `$(${page.locatorConst}.${op.field})`;
    const p = m.params[0];
    const line = (s) => pad + s;

    switch (op.t) {
      case "assertUrl":
        return [
          line(`await expect(browser).toHaveUrl(expect.stringContaining(${dq(op.value)}));`),
        ];
      case "assertText":
        return [
          line(`await expect(${el}).toBeDisplayed();`),
          line(
            `await expect(${el}).toHaveText(expect.stringContaining(${page.messageConst}.${op.msgKey}));`,
          ),
        ];
      case "assertPageText":
        return [
          line(
            `await expect($("body")).toHaveText(expect.stringContaining(${page.messageConst}.${op.msgKey}));`,
          ),
        ];
      case "assertValue":
        return [line(`await expect(${el}).toHaveValue(${p});`)];
      case "assertExists":
        return [line(`await expect(${el}).toExist();`)];
      case "assertVisible":
        return [line(`await expect(${el}).toBeDisplayed();`)];
      case "type":
        return [line(`await ${el}.setValue(${p});`)];
      case "clear":
        return [line(`await ${el}.clearValue();`)];
      case "select":
        // The recorder stores the option's visible text, not its value.
        return [line(`await ${el}.selectByVisibleText(${p});`)];
      case "check":
        return [
          line(`const el = await ${el};`),
          line(`if (!(await el.isSelected())) await el.click();`),
        ];
      case "uncheck":
        return [
          line(`const el = await ${el};`),
          line(`if (await el.isSelected()) await el.click();`),
        ];
      case "submit":
        return [line(`await browser.execute((form) => form.submit(), await ${el});`)];
      case "press":
        return [
          line(`await ${el}.click();`),
          line(`await browser.keys(${dq(key(op.key))});`),
        ];
      case "click":
        return [line(`await ${el}.click();`)];
      case "upload": {
        const multi = op.files.length > 1;
        const names = op.files.map((n, i) =>
          multi ? `remote${i + 1}` : `remote${pascal(n.replace(/\.[^.]+$/, "")) || "File"}`,
        );
        const lines = [line(`// TODO: put ${op.files.join(", ")} in test/fixtures/`)];
        op.files.forEach((n, i) => {
          lines.push(
            line(`const ${names[i]} = await browser.uploadFile(${dq("./test/fixtures/" + n)});`),
          );
        });
        // A file input takes several files as newline-separated remote paths.
        const arg = multi ? `[${names.join(", ")}].join("\\n")` : names[0];
        lines.push(line(`await ${el}.setValue(${arg});`));
        return lines;
      }
      case "resize": {
        // dragAndDrop with an offset holds the button down and moves in
        // increments over `duration`, which drag widgets need.
        const size = op.width && op.height ? ` → about ${op.width}x${op.height}` : "";
        return [
          line(`// drag the handle ${op.dx}px right, ${op.dy}px down${size}`),
          line(`await ${el}.dragAndDrop({ x: ${op.dx}, y: ${op.dy} }, { duration: 600 });`),
        ];
      }
      case "drag":
        return [
          line(`// drag ${op.dx}px right, ${op.dy}px down`),
          line(`await ${el}.dragAndDrop({ x: ${op.dx}, y: ${op.dy} }, { duration: 600 });`),
        ];
      case "drop": {
        const target = `$(${page.locatorConst}.${op.targetField})`;
        const lines = [];
        if (op.html5) {
          // dragAndDrop drives the WebDriver pointer, which HTML5 drag-and-drop
          // does not listen to in every browser.
          lines.push(
            line(`// TODO: this app uses HTML5 drag-and-drop — if this step does`),
            line(`// nothing, dispatch dragstart/dragover/drop via browser.execute()`),
          );
        }
        lines.push(line(`await ${el}.dragAndDrop(await ${target}, { duration: 600 });`));
        return lines;
      }
    }
    return [line(`// unsupported operation: ${op.t}`)];
  }

  function renderInstr(instr, indent) {
    const pad = " ".repeat(indent);
    const lines = [];
    for (const s of instr) {
      if (s.kind === "visit") lines.push(`${pad}await browser.url(${dq(s.path)});`);
      else if (s.kind === "scroll")
        lines.push(
          `${pad}await browser.execute((x, y) => window.scrollTo(x, y), ${s.x}, ${s.y});`,
        );
      else if (s.kind === "comment") lines.push(`${pad}// ${s.text}`);
      else if (s.kind === "call")
        lines.push(`${pad}await ${s.page}.${s.method}(${s.args.join(", ")});`);
    }
    return lines;
  }

  /* ------------------------------ page assets ------------------------------ */

  // WebdriverIO's $() understands "tag=Text" for an exact text match, so a
  // text locator needs no special accessor — only a different stored value.
  function locatorValue(l) {
    if (l.kind === "text") return sq(`${l.tag || "*"}=${l.selector}`);
    return sq(l.selector);
  }

  function renderLocator(page) {
    const rows = page.locators.map((l) => {
      const warn = l.stable
        ? ""
        : `  // WARNING: ${l.type || "css"} selector may be unstable\n`;
      return `${warn}  ${l.field}: ${locatorValue(l)},`;
    });
    return `exports.${page.locatorConst} = {
${rows.join("\n") || "  //"}
};
`;
  }

  function renderMessage(page) {
    const rows = Object.keys(page.messages).map(
      (k) => `  ${k}: ${dq(page.messages[k])},`,
    );
    return `exports.${page.messageConst} = {
${rows.join("\n") || "  //"}
};
`;
  }

  function renderData(page) {
    const rows = C.dataRows(page);
    return `${C.secretHelper(page, "node")}exports.${page.dataConst} = {
${rows.join("\n") || "  //"}
};
`;
  }

  function renderPage(page) {
    const usesMessage = page.methods.some((m) =>
      ["assertText", "assertPageText"].includes(m.op.t),
    );

    const imports = [];
    if (page.locators.length)
      imports.push(
        `const { ${page.locatorConst} } = require("../../locator/${page.key}/${page.locatorFile}");`,
      );
    if (usesMessage)
      imports.push(
        `const { ${page.messageConst} } = require("../../messages/${page.key}/${page.messageFile}");`,
      );

    const methods = page.methods.map(
      (m) =>
        `  async ${m.name}(${m.params.join(", ")}) {\n${renderBody(page, m, 4).join("\n")}\n  }`,
    );

    return `${imports.join("\n")}

class ${page.className} {

${methods.join("\n\n") || "  //"}

}

module.exports = new ${page.className}();
`;
  }

  /* ------------------------------ spec ------------------------------ */

  function renderSpec(model) {
    const { usedPages, usedData } = collectUses(
      model.scenarios.map((s) => s.instr),
    );

    const imports = [];
    for (const p of model.pages) {
      if (usedPages.has(p.className)) {
        imports.push(
          `const ${p.className} = require("../../pages/${p.key}/${p.fileBase}");`,
        );
      }
    }
    for (const p of model.pages) {
      if (usedData.has(p.dataConst)) {
        imports.push(
          `const { ${p.dataConst} } = require("../../data/${p.key}/${p.dataFile}");`,
        );
      }
    }
    if (model.hasLogin) {
      imports.push(`const { ${model.loginName} } = require("../../support/auth");`);
    }

    const before = [];
    if (model.hasLogin) {
      // The login helper drives the UI and ends on the app's post-login page,
      // so no extra browser.url() here.
      before.push(`    await ${model.loginName}();`);
    } else if (model.beforeVisit) {
      before.push(`    await browser.url(${dq(model.beforeVisit)});`);
    }

    const beforeBlock = before.length
      ? `  beforeEach(async () => {\n${before.join("\n")}\n  });\n\n`
      : "";

    const its = model.scenarios
      .map((sc, i) => {
        const title = `${model.suiteLabel} - ${i + 1} | ${sc.name}`;
        let body = renderInstr(sc.instr, 4);
        if (!body.length) body = ["    // covered by beforeEach"];
        return `  it(${dq(title)}, async () => {\n${body.join("\n")}\n  });`;
      })
      .join("\n\n");

    return `${imports.join("\n")}

describe(${dq(model.suiteName)}, () => {

${beforeBlock}${its}

});
`;
  }

  /* ------------------------------ auth ------------------------------ */

  function renderLoginFn(model, comment) {
    const { usedPages, usedData } = collectUses([model.loginBody]);
    const imp = [];
    for (const p of model.pages) {
      if (usedPages.has(p.className))
        imp.push(
          `const ${p.className} = require("../pages/${p.key}/${p.fileBase}");`,
        );
    }
    for (const p of model.pages) {
      if (usedData.has(p.dataConst)) {
        imp.push(
          `const { ${p.dataConst} } = require("../data/${p.key}/${p.dataFile}");`,
        );
      }
    }

    const body = [];
    if (model.loginPath) body.push(`  await browser.url(${dq(model.loginPath)});`);
    renderInstr(model.loginBody, 2).forEach((l) => body.push(l));
    if (model.loginPath) {
      body.push(
        `  // fail fast if the login did not go through`,
        `  await browser.waitUntil(`,
        `    async () => !(await browser.getUrl()).includes(${dq(model.loginPath)}),`,
        `    {`,
        `      timeout: 15000,`,
        `      timeoutMsg: ${dq("still on " + model.loginPath + " — the login did not go through")},`,
        `    },`,
        `  );`,
      );
    }

    const code = `${comment}
async function ${model.loginName}() {
${body.join("\n")}
}`;

    return { imports: imp, code };
  }

  function sessionNote(model) {
    return [
      `// FASTER (opt-in): skip the UI login by restoring cookies instead.`,
      `//`,
      `//   1. After a successful ${model.loginName}(), save them once:`,
      `//        const cookies = await browser.getCookies();`,
      `//   2. In later tests, set them before the first navigation:`,
      `//        await browser.setCookies(cookies);`,
      `//`,
      `// Cookies set in \`before\` (wdio.conf.js) apply to the whole run.`,
    ].join("\n");
  }

  function renderAuth(suiteModels) {
    const withLogin = suiteModels.filter((m) => m.hasLogin);
    if (!withLogin.length) return null;

    const allImports = [];
    const blocks = withLogin.map((model) => {
      const { imports, code } = renderLoginFn(
        model,
        withLogin.length > 1
          ? `// ${model.suiteName} — logs in through the UI.`
          : `// Logs in through the UI. Works on any app; runs once per test.`,
      );
      allImports.push(...imports);
      return code;
    });
    const uniqueImports = Array.from(new Set(allImports));
    const names = withLogin.map((m) => m.loginName);

    return `${uniqueImports.join("\n")}

${blocks.join("\n\n")}

${sessionNote(withLogin[0])}

module.exports = { ${names.join(", ")} };
`;
  }

  /* ------------------------------ project files ------------------------------ */

  function renderConfig(model, useEnv) {
    return `${useEnv ? '// Loads .env, where the credentials the tests need live (see .env.example).\nrequire("dotenv").config();\n\n' : ""}// How long each test took. Collected and printed inside the worker —
// onComplete() runs in the launcher process and would not see these.
const timings = [];
const secs = (ms) => (ms / 1000).toFixed(2) + "s";

exports.config = {
  runner: "local",
  specs: ["./test/specs/**/*.spec.js"],
  exclude: [],

  maxInstances: 1,
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--window-size=1920,1080", "--disable-dev-shm-usage"],
      },
    },
  ],

  logLevel: "error",
  bail: 0,
  baseUrl: ${dq(model.baseUrl)},

  // Retry a failed command / test before reporting it as broken.
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  specFileRetries: 1,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 90000,
  },

  afterTest(test, context, { duration, passed }) {
    timings.push({ title: test.title, ms: duration, passed });
    console.log(
      "  ⏱  " + secs(duration).padStart(8) + "  " + (passed ? "✓" : "✗") + " " + test.title,
    );
  },

  after() {
    if (!timings.length) return;
    const total = timings.reduce((sum, t) => sum + t.ms, 0);
    const avg = total / timings.length;
    console.log(
      "  ⏱  TOTAL " + timings.length + " test(s) in " + secs(total) +
        " (avg " + secs(avg) + ")",
    );
  },
};
`;
  }

  function renderPackageJson(model, useEnv) {
    return (
      JSON.stringify(
        {
          name:
            words(model.suiteName)
              .map((w) => w.toLowerCase())
              .join("-") || "wdio-project",
          version: "1.0.0",
          private: true,
          scripts: { test: "wdio run wdio.conf.js" },
          devDependencies: {
            "@wdio/cli": "^9.0.0",
            "@wdio/local-runner": "^9.0.0",
            "@wdio/mocha-framework": "^9.0.0",
            "@wdio/spec-reporter": "^9.0.0",
            ...(useEnv ? { dotenv: "^16.4.5" } : {}),
          },
        },
        null,
        2,
      ) + "\n"
    );
  }

  const SECRETS_HOW =
    "Copy `.env.example` to `.env` (git-ignored) and fill in the values. " +
    "In CI, set them as (secret) environment variables instead — `wdio.conf.js` loads `.env` through `dotenv` and leaves anything already set alone.";

  const GITIGNORE = `node_modules/
logs/
.env
`;

  // Files that only exist when the recording typed a password: the names of
  // the variables to fill in (never their values) and the ignore rules that
  // keep the real ones out of git.
  function secretFiles(pages, files) {
    if (!C.secretsOf(pages).length) return;
    files[".env.example"] = C.envExample(pages);
    files[".gitignore"] = GITIGNORE;
  }

  const LAYOUT = `| Folder | Contents |
| ------ | -------- |
| \`test/specs/\`    | Test suites — one file, many \`it()\` scenarios |
| \`test/pages/\`    | Page Objects (business/action layer), exported as singletons |
| \`test/locator/\`  | \`exports.locatorX = { ... }\` selectors |
| \`test/messages/\` | \`exports.XMessage = { ... }\` assertion text |
| \`test/data/\`     | \`exports.XData = { ... }\` test data |
| \`test/support/\`  | \`auth.js\` — the login helper used in \`beforeEach\` |`;

  const ANTIFLAKE = `- **Auto-waiting assertions** — \`expect($(...)).toBeDisplayed()\` from expect-webdriverio retries until \`waitforTimeout\`.
- **Spec retries** — \`specFileRetries: 1\` re-runs a failed spec once before reporting it.
- **Generous timeouts** — 15s for element waits, 90s per test.
- **Stable selectors** — \`data-*\` → \`id\` → \`name\` → \`aria-label\` → stable content attrs; unstable ones flagged in the locator file.
- **Timing** — the afterTest / after hooks in wdio.conf.js print each test's duration and a total per session.`;

  function renderReadme(model) {
    return `# ${model.suiteName}

Generated by **QA Web Recorder** — WebdriverIO.

\`\`\`bash
npm install
npx wdio run wdio.conf.js
\`\`\`

## Layout

${LAYOUT}
${model.hasLogin ? "\n> The shared opening steps of every scenario were extracted into `" + model.loginName + "()` in `test/support/auth.js` and run in `beforeEach`.\n" : ""}${C.secretsReadme(model.pages, SECRETS_HOW)}
## Anti-flake measures baked in

${ANTIFLAKE}

Next steps:

1. Reuse cookies instead of driving the UI login — see the note at the bottom of \`test/support/auth.js\`.
2. Add \`browser.waitUntil()\` around the XHR each page depends on — the recorder can't infer these.
3. \`$\`, \`browser\` and \`expect\` are injected globals from the WDIO runner; no imports needed for them.
`;
  }

  function renderProjectReadme(suiteModels, projectName, baseUrl, pages) {
    const warn = originWarning(suiteModels, baseUrl, "wdio.conf.js");
    const rows = suiteModels
      .map((m) => {
        const count = m.scenarios.length;
        const login = m.hasLogin ? ` (shared \`${m.loginName}()\`)` : "";
        return `| \`test/specs/${m.suiteKey}/${m.suiteKey}.spec.js\` | ${m.suiteName} — ${count} scenario${count === 1 ? "" : "s"}${login} |`;
      })
      .join("\n");

    return `# ${projectName}

Generated by **QA Web Recorder** — WebdriverIO, merged from ${suiteModels.length} test suite${suiteModels.length === 1 ? "" : "s"}.

\`\`\`bash
npm install
npx wdio run wdio.conf.js
\`\`\`
${warn}
## Test suites in this project

| Spec | Contents |
| ---- | -------- |
${rows}

## Layout

${LAYOUT}

Page Objects are shared automatically when two suites touch the same page.
${C.secretsReadme(pages, SECRETS_HOW)}
## Anti-flake measures baked in

${ANTIFLAKE}
`;
  }

  /* ------------------------------ assemble ------------------------------ */

  function pageFiles(pages, files) {
    for (const page of pages) {
      if (page.locators.length)
        files[`test/locator/${page.key}/${page.locatorFile}.js`] = renderLocator(page);
      if (page.usesMessage)
        files[`test/messages/${page.key}/${page.messageFile}.js`] = renderMessage(page);
      if (page.usesData)
        files[`test/data/${page.key}/${page.dataFile}.js`] = renderData(page);
      if (page.methods.length)
        files[`test/pages/${page.key}/${page.fileBase}.js`] = renderPage(page);
    }
  }

  function generateFiles(session) {
    const model = C.buildModel(session);
    const files = {};
    const s = model.suiteKey;

    pageFiles(model.pages, files);

    files[`test/specs/${s}/${s}.spec.js`] = renderSpec(model);
    const auth = renderAuth([model]);
    if (auth) files["test/support/auth.js"] = auth;
    const useEnv = C.secretsOf(model.pages).length > 0;
    files["wdio.conf.js"] = renderConfig(model, useEnv);
    files["package.json"] = renderPackageJson(model, useEnv);
    files["README.md"] = renderReadme(model);
    secretFiles(model.pages, files);

    return { model, files };
  }

  function generateProjectFiles(suites) {
    const project = C.buildProject(suites);
    const { suiteModels, pages, baseUrl, projectName } = project;
    if (!suiteModels.length) return { suiteModels: [], files: {} };

    const files = {};
    pageFiles(pages, files);

    for (const model of suiteModels) {
      files[`test/specs/${model.suiteKey}/${model.suiteKey}.spec.js`] =
        renderSpec(model);
    }

    const auth = renderAuth(suiteModels);
    if (auth) files["test/support/auth.js"] = auth;
    const useEnv = C.secretsOf(pages).length > 0;
    files["wdio.conf.js"] = renderConfig({ baseUrl }, useEnv);
    files["package.json"] = renderPackageJson({ suiteName: projectName }, useEnv);
    files["README.md"] = renderProjectReadme(suiteModels, projectName, baseUrl, pages);
    secretFiles(pages, files);

    return { suiteModels, baseUrl, projectName, files };
  }

  window.GenWdio = {
    id: "webdriverio",
    label: "WebdriverIO",
    specSuffix: ".spec.js",
    generateFiles,
    generateProjectFiles,
  };
})();
