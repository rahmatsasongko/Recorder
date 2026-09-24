// Selenium WebDriver (JS) renderer — selenium-webdriver + mocha + chai
// ----------------------------------------------------------------------
// One Test Suite  ->  one <suite>.spec.js with many it() scenarios.
//
//   test/specs/<suite>/<suite>.spec.js     describe + it(), owns the driver
//   test/pages/<page>/<page>Page.js        class taking `driver`
//   test/locator/<page>/locator-<page>.js  exports.locatorX = { ... }
//   test/messages/<page>/<page>.message.js exports.XMessage = { ... }
//   test/data/<page>/<page>.data.js        exports.XData = { ... }
//   test/support/env.js                    BASE_URL + url(path)
//   test/support/auth.js                   async function login(driver)
//   .mocharc.json                          timeout / retries / reporter
//
// CommonJS throughout. selenium-webdriver's built-in Selenium Manager
// resolves a matching chromedriver on its own, so there is nothing extra to
// install to run `npm test`.

(function () {
  const C = window.GenCore;
  const { camel, pascal, words, dq, sq, collectUses, originWarning } = C;

  const KEY_MAP = {
    Enter: "ENTER",
    Escape: "ESCAPE",
    Esc: "ESCAPE",
    Tab: "TAB",
    Backspace: "BACK_SPACE",
    Delete: "DELETE",
    Del: "DELETE",
    ArrowUp: "ARROW_UP",
    ArrowDown: "ARROW_DOWN",
    ArrowLeft: "ARROW_LEFT",
    ArrowRight: "ARROW_RIGHT",
    " ": "SPACE",
    Spacebar: "SPACE",
  };

  function pressExpr(k) {
    const name = KEY_MAP[k];
    return name ? `Key.${name}` : dq(k || "Enter");
  }

  function instanceOf(className) {
    return camel(className);
  }

  /* ------------------------------ locators ------------------------------ */

  // A "text" locator only stores the visible label, so it resolves through an
  // xpath contains() match built at the call site — everything else is a
  // plain By.css / By.xpath around the stored selector.
  function byFor(page, field) {
    const l = page.locatorByField[field];
    const ref = `${page.locatorConst}.${field}`;
    const kind = l ? l.kind : "css";
    if (kind === "text") {
      const tag = (l && l.tag) || "*";
      return "By.xpath(`//" + tag + '[contains(normalize-space(.), "${' + ref + '}")]`)';
    }
    if (kind === "xpath") return `By.xpath(${ref})`;
    return `By.css(${ref})`;
  }

  function elCode(page, field) {
    return `this.driver.findElement(${byFor(page, field)})`;
  }

  /* ------------------------------ operations ------------------------------ */

  function renderBody(page, m, indent) {
    const pad = " ".repeat(indent);
    const op = m.op;
    const el = elCode(page, op.field);
    const p = m.params[0];
    const line = (s) => pad + s;

    switch (op.t) {
      case "assertUrl":
        return [
          line(`expect(await this.driver.getCurrentUrl()).to.include(${dq(op.value)});`),
        ];
      case "assertText":
        return [
          line(`const el = await ${el};`),
          line(`await this.driver.wait(until.elementIsVisible(el), 15000);`),
          line(`expect(await el.getText()).to.include(${page.messageConst}.${op.msgKey});`),
        ];
      case "assertPageText":
        return [
          line(
            `expect(await this.driver.findElement(By.css("body")).getText()).to.include(${page.messageConst}.${op.msgKey});`,
          ),
        ];
      case "assertValue":
        return [line(`expect(await (await ${el}).getAttribute("value")).to.equal(${p});`)];
      case "assertExists":
        return [line(`await this.driver.wait(until.elementLocated(${byFor(page, op.field)}), 15000);`)];
      case "assertVisible":
        return [
          line(`const el = await ${el};`),
          line(`await this.driver.wait(until.elementIsVisible(el), 15000);`),
        ];
      case "type":
        return [line(`await (await ${el}).sendKeys(${p});`)];
      case "clear":
        return [line(`await (await ${el}).clear();`)];
      case "select":
        // The recorder stores the option's visible text, not its value.
        return [
          line(`const dropdown = new Select(await ${el});`),
          line(`await dropdown.selectByVisibleText(${p});`),
        ];
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
        return [line(`await this.driver.executeScript((form) => form.submit(), await ${el});`)];
      case "press":
        return [
          line(`await (await ${el}).click();`),
          line(`await this.driver.actions().sendKeys(${pressExpr(op.key)}).perform();`),
        ];
      case "click":
        return [line(`await (await ${el}).click();`)];
      case "upload": {
        const paths = op.files.map((n) => `path.join(__dirname, "../../fixtures", ${dq(n)})`);
        // Chrome accepts several local paths for one <input multiple> when
        // they are newline-joined in a single sendKeys() call.
        const arg = paths.length > 1 ? `[${paths.join(", ")}].join("\\n")` : paths[0];
        return [
          line(`// TODO: put ${op.files.join(", ")} in test/fixtures/`),
          line(`await (await ${el}).sendKeys(${arg});`),
        ];
      }
      case "resize": {
        const size = op.width && op.height ? ` → about ${op.width}x${op.height}` : "";
        return [
          line(`// drag the handle ${op.dx}px right, ${op.dy}px down${size}`),
          line(`const handle = await ${el};`),
          line(
            `await this.driver.actions({ bridge: true }).move({ origin: handle }).press().move({ origin: handle, x: ${op.dx}, y: ${op.dy} }).release().perform();`,
          ),
        ];
      }
      case "drag":
        return [
          line(`// drag ${op.dx}px right, ${op.dy}px down`),
          line(`const handle = await ${el};`),
          line(
            `await this.driver.actions({ bridge: true }).move({ origin: handle }).press().move({ origin: handle, x: ${op.dx}, y: ${op.dy} }).release().perform();`,
          ),
        ];
      case "drop": {
        const target = elCode(page, op.targetField);
        const lines = [];
        if (op.html5) {
          lines.push(
            line(`// TODO: this app uses HTML5 drag-and-drop — if the CDP-backed`),
            line(`// Actions bridge below doesn't trigger it, dispatch`),
            line(`// dragstart/dragover/drop via this.driver.executeScript()`),
          );
        }
        lines.push(
          line(`const source = await ${el};`),
          line(`const target = await ${target};`),
          line(`await this.driver.actions({ bridge: true }).dragAndDrop(source, target).perform();`),
        );
        return lines;
      }
    }
    return [line(`// unsupported operation: ${op.t}`)];
  }

  // Scenario lines at spec/auth level, where the driver is a plain local
  // variable rather than `this.driver` on a Page Object.
  function renderInstr(instr, indent) {
    const pad = " ".repeat(indent);
    const lines = [];
    for (const s of instr) {
      if (s.kind === "visit") lines.push(`${pad}await driver.get(url(${dq(s.path)}));`);
      else if (s.kind === "scroll")
        lines.push(
          `${pad}await driver.executeScript((x, y) => window.scrollTo(x, y), ${s.x}, ${s.y});`,
        );
      else if (s.kind === "comment") lines.push(`${pad}// ${s.text}`);
      else if (s.kind === "call")
        lines.push(`${pad}await ${instanceOf(s.page)}.${s.method}(${s.args.join(", ")});`);
    }
    return lines;
  }

  // `const loginPage = new LoginPage(driver);` for every page a block touches.
  function renderInstances(instrLists, pages, indent) {
    const { usedPages } = collectUses(instrLists);
    const pad = " ".repeat(indent);
    return pages
      .filter((p) => usedPages.has(p.className))
      .map((p) => `${pad}const ${instanceOf(p.className)} = new ${p.className}(driver);`);
  }

  /* ------------------------------ page assets ------------------------------ */

  function renderLocator(page) {
    const rows = page.locators.map((l) => {
      const warn = l.stable
        ? ""
        : `  // WARNING: ${l.type || "css"} selector may be unstable\n`;
      return `${warn}  ${l.field}: ${sq(l.selector)},`;
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
    const usesExpect = page.methods.some((m) => m.op.t.startsWith("assert"));
    const usesUntil = page.methods.some((m) =>
      ["assertText", "assertVisible", "assertExists"].includes(m.op.t),
    );
    const usesSelect = page.methods.some((m) => m.op.t === "select");
    const usesKey = page.methods.some((m) => m.op.t === "press");
    const usesPath = page.methods.some((m) => m.op.t === "upload");

    const seleniumNames = ["By"];
    if (usesUntil) seleniumNames.push("until");
    if (usesKey) seleniumNames.push("Key");

    const imports = [`const { ${seleniumNames.join(", ")} } = require("selenium-webdriver");`];
    if (usesSelect)
      imports.push(`const { Select } = require("selenium-webdriver/lib/select");`);
    if (usesPath) imports.push(`const path = require("path");`);
    if (usesExpect) imports.push(`const { expect } = require("chai");`);
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

  constructor(driver) {
    this.driver = driver;
  }

${methods.join("\n\n") || "  //"}

}

module.exports = ${page.className};
`;
  }

  /* ------------------------------ spec ------------------------------ */

  function renderSpec(model) {
    const { usedPages, usedData } = collectUses(
      model.scenarios.map((s) => s.instr),
    );

    const imports = [
      `const { Builder } = require("selenium-webdriver");`,
      `const chrome = require("selenium-webdriver/chrome");`,
      `const { url } = require("../../support/env");`,
    ];
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
      // so no extra driver.get() here — scenarios navigate themselves from there.
      before.push(`    await ${model.loginName}(driver);`);
    } else if (model.beforeVisit) {
      before.push(`    await driver.get(url(${dq(model.beforeVisit)}));`);
    }

    const beforeBlock = before.length
      ? `  beforeEach(async () => {\n${before.join("\n")}\n  });\n\n`
      : "";

    const its = model.scenarios
      .map((sc, i) => {
        const title = `${model.suiteLabel} - ${i + 1} | ${sc.name}`;
        const instances = renderInstances([sc.instr], model.pages, 4);
        let body = renderInstr(sc.instr, 4);
        if (!body.length) body = ["    // covered by beforeEach"];
        const inner = instances.length
          ? instances.join("\n") + "\n\n" + body.join("\n")
          : body.join("\n");
        return `  it(${dq(title)}, async () => {\n${inner}\n  });`;
      })
      .join("\n\n");

    return `${imports.join("\n")}

describe(${dq(model.suiteName)}, function () {
  this.timeout(90000);
  let driver;

  before(async () => {
    driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(
        new chrome.Options().addArguments("--window-size=1920,1080", "--disable-dev-shm-usage"),
      )
      .build();
  });

  after(async () => {
    await driver.quit();
  });

${beforeBlock}${its}

});
`;
  }

  /* ------------------------------ auth ------------------------------ */

  function renderLoginFn(model, comment) {
    const { usedPages, usedData } = collectUses([model.loginBody]);
    const imp = [`const { url } = require("./env");`];
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
    if (model.loginPath) body.push(`  await driver.get(url(${dq(model.loginPath)}));`);
    renderInstances([model.loginBody], model.pages, 2).forEach((l) => body.push(l));
    if (body.length) body.push("");
    renderInstr(model.loginBody, 2).forEach((l) => body.push(l));
    if (model.loginPath) {
      body.push(
        `  // fail fast if the login did not go through`,
        `  await driver.wait(`,
        `    async () => !(await driver.getCurrentUrl()).includes(${dq(model.loginPath)}),`,
        `    15000,`,
        `    ${dq("still on " + model.loginPath + " — the login did not go through")},`,
        `  );`,
      );
    }

    const code = `${comment}
async function ${model.loginName}(driver) {
${body.join("\n")}
}`;

    return { imports: imp, code };
  }

  function sessionNote(model) {
    return [
      `// FASTER (opt-in): skip the UI login by restoring cookies instead.`,
      `//`,
      `//   1. After a successful ${model.loginName}(driver), save them once:`,
      `//        const cookies = await driver.manage().getCookies();`,
      `//   2. In later tests, navigate into the app first, then add them back:`,
      `//        for (const c of cookies) await driver.manage().addCookie(c);`,
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

  function renderEnv(model, useEnv) {
    return `${useEnv ? '// Loads .env, where the credentials the tests need live (see .env.example).\nrequire("dotenv").config();\n\n' : ""}const BASE_URL = ${dq(model.baseUrl)};

function url(path) {
  return new URL(path, BASE_URL).toString();
}

module.exports = { BASE_URL, url };
`;
  }

  function renderMocharc() {
    return (
      JSON.stringify(
        {
          timeout: 90000,
          retries: 1,
          reporter: "spec",
          spec: "test/specs/**/*.spec.js",
        },
        null,
        2,
      ) + "\n"
    );
  }

  function renderPackageJson(model, useEnv) {
    return (
      JSON.stringify(
        {
          name:
            words(model.suiteName)
              .map((w) => w.toLowerCase())
              .join("-") || "selenium-project",
          version: "1.0.0",
          private: true,
          scripts: { test: "mocha" },
          devDependencies: {
            "selenium-webdriver": "^4.23.0",
            mocha: "^10.7.0",
            chai: "^4.5.0",
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
    "In CI, set them as (secret) environment variables instead — `test/support/env.js` loads `.env` through `dotenv` and leaves anything already set alone.";

  const GITIGNORE = `node_modules/
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
| \`test/specs/\`    | Test suites — one file, many \`it()\` scenarios, owns the WebDriver session |
| \`test/pages/\`    | Page Objects (business/action layer), constructed with \`driver\` |
| \`test/locator/\`  | \`exports.locatorX = { ... }\` selectors |
| \`test/messages/\` | \`exports.XMessage = { ... }\` assertion text |
| \`test/data/\`     | \`exports.XData = { ... }\` test data |
| \`test/support/\`  | \`env.js\` (base URL) and \`auth.js\` — the login helper used in \`beforeEach\` |`;

  const ANTIFLAKE = `- **Explicit waits** — \`driver.wait(until.elementIsVisible(...), 15000)\` before every text/visibility assertion.
- **Mocha retries** — \`.mocharc.json\` re-runs a failed test once before reporting it as broken.
- **Generous timeouts** — 15s for element waits, 90s per test.
- **CDP-backed drag/drop** — the Actions API runs through Chrome's bridge (\`{ bridge: true }\`) so it also fires HTML5 drag events where the browser supports it.
- **Stable selectors** — \`data-*\` → \`id\` → \`name\` → \`aria-label\` → stable content attrs; unstable ones flagged in the locator file.
- **Selenium Manager** — \`selenium-webdriver\` resolves and downloads a matching chromedriver on its own; nothing extra to install to run \`npm test\`.`;

  function renderReadme(model) {
    return `# ${model.suiteName}

Generated by **QA Web Recorder** — Selenium WebDriver (mocha + chai).

\`\`\`bash
npm install
npm test
\`\`\`

## Layout

${LAYOUT}
${model.hasLogin ? "\n> The shared opening steps of every scenario were extracted into `" + model.loginName + "(driver)` in `test/support/auth.js` and run in `beforeEach`.\n" : ""}${C.secretsReadme(model.pages, SECRETS_HOW)}
## Anti-flake measures baked in

${ANTIFLAKE}

Next steps:

1. Reuse cookies instead of driving the UI login — see the note at the bottom of \`test/support/auth.js\`.
2. Wait on the XHR each page depends on (e.g. poll an element that only appears after it resolves) — the recorder can't infer these.
3. \`test/support/env.js\` holds the base URL; point it at a different environment there instead of editing every spec.
`;
  }

  function renderProjectReadme(suiteModels, projectName, baseUrl, pages) {
    const warn = originWarning(suiteModels, baseUrl, "test/support/env.js");
    const rows = suiteModels
      .map((m) => {
        const count = m.scenarios.length;
        const login = m.hasLogin ? ` (shared \`${m.loginName}(driver)\`)` : "";
        return `| \`test/specs/${m.suiteKey}/${m.suiteKey}.spec.js\` | ${m.suiteName} — ${count} scenario${count === 1 ? "" : "s"}${login} |`;
      })
      .join("\n");

    return `# ${projectName}

Generated by **QA Web Recorder** — Selenium WebDriver, merged from ${suiteModels.length} test suite${suiteModels.length === 1 ? "" : "s"}.

\`\`\`bash
npm install
npm test
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
    files["test/support/env.js"] = renderEnv(model, useEnv);
    files[".mocharc.json"] = renderMocharc();
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
    files["test/support/env.js"] = renderEnv({ baseUrl }, useEnv);
    files[".mocharc.json"] = renderMocharc();
    files["package.json"] = renderPackageJson({ suiteName: projectName }, useEnv);
    files["README.md"] = renderProjectReadme(suiteModels, projectName, baseUrl, pages);
    secretFiles(pages, files);

    return { suiteModels, baseUrl, projectName, files };
  }

  window.GenSelenium = {
    id: "selenium",
    label: "Selenium",
    specSuffix: ".spec.js",
    generateFiles,
    generateProjectFiles,
  };
})();
