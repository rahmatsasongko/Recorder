// Playwright renderer
// -------------------
// One Test Suite  ->  one <suite>.spec.js with many test() scenarios.
//
//   tests/<suite>/<suite>.spec.js        test.describe + test()
//   pages/<page>/<page>Page.js           class taking `page`, default export
//   locator/<page>/locator-<page>.js     export const locatorX = { ... }
//   messages/<page>/<page>.message.js    export const XMessage = { ... }
//   data/<page>/<page>.data.js           export const XData = { ... }
//   support/auth.js                      export async function login(page)
//   playwright.config.js                 defineConfig({ ... })
//
// ESM throughout: Playwright transpiles test files (and the config) with its
// own babel pipeline, so `import` works without "type": "module".

(function () {
  const C = window.GenCore;
  const { camel, pascal, words, dq, sq, collectUses, originWarning } = C;

  const KEY_ALIAS = { Esc: "Escape", Spacebar: " ", Del: "Delete" };

  function key(k) {
    return KEY_ALIAS[k] || k || "Enter";
  }
  function reLiteral(v) {
    // A path turned into a RegExp source: escape only what regex would eat.
    return String(v == null ? "" : v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function instanceOf(className) {
    return camel(className);
  }

  /* ------------------------------ operations ------------------------------ */

  // `steps` matters: a drag widget ignores a single jump from the grab point
  // to the destination.
  function dragByCode(loc, dx, dy, comment, pad) {
    const line = (s) => pad + s;
    return [
      line(`// ${comment}`),
      line(`const handle = ${loc};`),
      line(`const box = await handle.boundingBox();`),
      line(`const x = box.x + box.width / 2;`),
      line(`const y = box.y + box.height / 2;`),
      line(`await this.page.mouse.move(x, y);`),
      line(`await this.page.mouse.down();`),
      line(`await this.page.mouse.move(x + ${dx}, y + ${dy}, { steps: 10 });`),
      line(`await this.page.mouse.up();`),
    ];
  }

  // How to reach one locator. A text locator holds a visible label, so it
  // resolves through getByText rather than a CSS/xpath locator.
  function elFor(page, field) {
    const ref = `${page.locatorConst}.${field}`;
    const l = page.locatorByField[field];
    if (l && l.kind === "text") {
      return `this.page.getByText(${ref}, { exact: true })`;
    }
    return `this.page.locator(${ref})`;
  }

  function renderBody(page, m, indent) {
    const pad = " ".repeat(indent);
    const op = m.op;
    const loc = elFor(page, op.field);
    const p = m.params[0];
    const line = (s) => pad + s;

    switch (op.t) {
      case "assertUrl":
        return [line(`await expect(this.page).toHaveURL(new RegExp(${dq(reLiteral(op.value))}));`)];
      case "assertText":
        return [
          line(`await expect(${loc}).toBeVisible();`),
          line(`await expect(${loc}).toContainText(${page.messageConst}.${op.msgKey});`),
        ];
      case "assertValue":
        return [line(`await expect(${loc}).toHaveValue(${p});`)];
      case "assertExists":
        return [line(`await expect(${loc}).toBeAttached();`)];
      case "assertVisible":
        return [line(`await expect(${loc}).toBeVisible();`)];
      case "type":
        return [line(`await ${loc}.fill(${p});`)];
      case "clear":
        return [line(`await ${loc}.fill("");`)];
      case "select":
        // The recorder stores the option's visible text, not its value.
        return [line(`await ${loc}.selectOption({ label: ${p} });`)];
      case "check":
        return [line(`await ${loc}.check();`)];
      case "uncheck":
        return [line(`await ${loc}.uncheck();`)];
      case "submit":
        return [line(`await ${loc}.evaluate((form) => form.submit());`)];
      case "press":
        return [line(`await ${loc}.press(${dq(key(op.key))});`)];
      case "click":
        return [line(`await ${loc}.click();`)];
      case "upload": {
        const paths = op.files.map((n) => dq("fixtures/" + n));
        const arg = op.files.length > 1 ? `[${paths.join(", ")}]` : paths[0];
        return [
          line(`// TODO: put ${op.files.join(", ")} in fixtures/`),
          line(`await ${loc}.setInputFiles(${arg});`),
        ];
      }
      case "resize": {
        const size = op.width && op.height ? ` → about ${op.width}x${op.height}` : "";
        return dragByCode(
          loc,
          op.dx,
          op.dy,
          `drag the handle ${op.dx}px right, ${op.dy}px down${size}`,
          pad,
        );
      }
      case "drag":
        return dragByCode(
          loc,
          op.dx,
          op.dy,
          `drag ${op.dx}px right, ${op.dy}px down`,
          pad,
        );
      case "drop": {
        // dragTo drives a real pointer sequence and also satisfies HTML5
        // drag-and-drop, so one call covers both kinds.
        const target = elFor(page, op.targetField);
        return [line(`await ${loc}.dragTo(${target});`)];
      }
    }
    return [line(`// unsupported operation: ${op.t}`)];
  }

  // Scenario lines. `pageVar` maps a Page Object class to its local instance.
  function renderInstr(instr, indent) {
    const pad = " ".repeat(indent);
    const lines = [];
    for (const s of instr) {
      if (s.kind === "visit") lines.push(`${pad}await page.goto(${dq(s.path)});`);
      else if (s.kind === "scroll")
        lines.push(
          `${pad}await page.evaluate(([x, y]) => window.scrollTo(x, y), [${s.x}, ${s.y}]);`,
        );
      else if (s.kind === "comment") lines.push(`${pad}// ${s.text}`);
      else if (s.kind === "call")
        lines.push(
          `${pad}await ${instanceOf(s.page)}.${s.method}(${s.args.join(", ")});`,
        );
    }
    return lines;
  }

  // `const loginPage = new LoginPage(page);` for every page a block touches.
  function renderInstances(instrLists, pages, indent) {
    const { usedPages } = collectUses(instrLists);
    const pad = " ".repeat(indent);
    return pages
      .filter((p) => usedPages.has(p.className))
      .map((p) => `${pad}const ${instanceOf(p.className)} = new ${p.className}(page);`);
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
    const usesMessage = page.methods.some((m) => m.op.t === "assertText");
    const usesExpect = page.methods.some((m) => m.op.t.startsWith("assert"));

    const imports = [];
    if (usesExpect) imports.push(`import { expect } from "@playwright/test";`);
    if (page.locators.length)
      imports.push(
        `import { ${page.locatorConst} } from "../../locator/${page.key}/${page.locatorFile}";`,
      );
    if (usesMessage)
      imports.push(
        `import { ${page.messageConst} } from "../../messages/${page.key}/${page.messageFile}";`,
      );

    const methods = page.methods.map(
      (m) =>
        `  async ${m.name}(${m.params.join(", ")}) {\n${renderBody(page, m, 4).join("\n")}\n  }`,
    );

    return `${imports.join("\n")}

class ${page.className} {

  constructor(page) {
    this.page = page;
  }

${methods.join("\n\n") || "  //"}

}

export default ${page.className};
`;
  }

  /* ------------------------------ spec ------------------------------ */

  function renderSpec(model) {
    const { usedPages, usedData } = collectUses(
      model.scenarios.map((s) => s.instr),
    );

    // Assertions live in the Page Objects, so the spec only needs `test`.
    const imports = [`import { test } from "@playwright/test";`];
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
    if (model.hasLogin) {
      imports.push(`import { ${model.loginName} } from "../../support/auth";`);
    }

    const before = [];
    if (model.hasLogin) {
      // The login helper drives the UI and ends on the app's post-login page,
      // so no extra goto here — scenarios navigate themselves from there.
      before.push(`    await ${model.loginName}(page);`);
    } else if (model.beforeVisit) {
      before.push(`    await page.goto(${dq(model.beforeVisit)});`);
    }

    const beforeBlock = before.length
      ? `  test.beforeEach(async ({ page }) => {\n${before.join("\n")}\n  });\n\n`
      : "";

    const tests = model.scenarios
      .map((sc, i) => {
        const title = `${model.suiteLabel} - ${i + 1} | ${sc.name}`;
        const instances = renderInstances([sc.instr], model.pages, 4);
        let body = renderInstr(sc.instr, 4);
        if (!body.length) body = ["    // covered by beforeEach"];
        const inner = instances.length
          ? instances.join("\n") + "\n\n" + body.join("\n")
          : body.join("\n");
        return `  test(${dq(title)}, async ({ page }) => {\n${inner}\n  });`;
      })
      .join("\n\n");

    return `${imports.join("\n")}

test.describe(${dq(model.suiteName)}, () => {

${beforeBlock}${tests}

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
          `import ${p.className} from "../pages/${p.key}/${p.fileBase}";`,
        );
    }
    for (const p of model.pages) {
      if (usedData.has(p.dataConst)) {
        imp.push(
          `import { ${p.dataConst} } from "../data/${p.key}/${p.dataFile}";`,
        );
      }
    }

    const body = [];
    if (model.loginPath) body.push(`  await page.goto(${dq(model.loginPath)});`);
    renderInstances([model.loginBody], model.pages, 2).forEach((l) => body.push(l));
    if (body.length) body.push("");
    renderInstr(model.loginBody, 2).forEach((l) => body.push(l));
    if (model.loginPath) {
      body.push(
        `  // fail fast if the login did not go through`,
        `  await page.waitForURL((url) => url.pathname !== ${dq(model.loginPath)}, { timeout: 15000 });`,
      );
    }

    const code = `${comment}
export async function ${model.loginName}(page) {
${body.join("\n")}
}`;

    return { imports: imp, code };
  }

  function storageStateNote(model) {
    return [
      `// FASTER (opt-in): log in once and reuse the browser storage state`,
      `// instead of driving the UI before every test.`,
      `//`,
      `//   1. Save it at the end of ${model.loginName}():`,
      `//        await page.context().storageState({ path: "playwright/.auth/user.json" });`,
      `//   2. Point the project at it in playwright.config.js:`,
      `//        use: { storageState: "playwright/.auth/user.json" }`,
      `//`,
      `// A setup project is the fully-wired version — https://playwright.dev/docs/auth`,
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

    return `${uniqueImports.join("\n")}

${blocks.join("\n\n")}

${storageStateNote(withLogin[0])}
`;
  }

  /* ------------------------------ project files ------------------------------ */

  function renderConfig(model) {
    return `import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",

  // Retry a failed test before reporting it as broken.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: ${dq(model.baseUrl)},
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
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
              .join("-") || "playwright-project",
          version: "1.0.0",
          private: true,
          scripts: {
            test: "playwright test",
            "test:headed": "playwright test --headed",
            "test:ui": "playwright test --ui",
            report: "playwright show-report",
          },
          devDependencies: { "@playwright/test": "^1.50.0" },
        },
        null,
        2,
      ) + "\n"
    );
  }

  const LAYOUT = `| Folder | Contents |
| ------ | -------- |
| \`tests/\`     | Test suites — one file, many \`test()\` scenarios |
| \`pages/\`     | Page Objects (business/action layer), constructed with \`page\` |
| \`locator/\`   | \`export const locatorX = { ... }\` selectors |
| \`messages/\`  | \`export const XMessage = { ... }\` assertion text |
| \`data/\`      | \`export const XData = { ... }\` test data |
| \`support/\`   | \`auth.js\` — the login helper used in \`beforeEach\` |`;

  const ANTIFLAKE = `- **Web-first assertions** — \`expect(locator).toBeVisible()\` and friends auto-retry until the expect timeout.
- **Retries** — 1 locally, 2 on CI, before a test is reported as broken.
- **Generous timeouts** — 60s per test, 10s per assertion, 15s per action.
- **Trace + video on failure** — \`npx playwright show-trace\` replays the whole run step by step.
- **Stable selectors** — \`data-*\` → \`id\` → \`name\` → \`aria-label\` → stable content attrs; unstable ones flagged in the locator file.`;

  function renderReadme(model) {
    return `# ${model.suiteName}

Generated by **QA Web Recorder** — Playwright.

\`\`\`bash
npm install
npx playwright install
npx playwright test
npx playwright test --ui
\`\`\`

## Layout

${LAYOUT}
${model.hasLogin ? "\n> The shared opening steps of every scenario were extracted into `" + model.loginName + "(page)` in `support/auth.js` and run in `test.beforeEach`.\n" : ""}
## Anti-flake measures baked in

${ANTIFLAKE}

Next steps:

1. Swap the UI login for a cached \`storageState\` — see the note at the bottom of \`support/auth.js\`.
2. Add \`page.waitForResponse()\` for the XHR each page depends on — the recorder can't infer these.
3. Playwright has \`page.getByTestId()\`, \`getByRole()\` and \`getByLabel()\` built in; they are more robust than raw CSS where your app supports them.
`;
  }

  function renderProjectReadme(suiteModels, projectName, baseUrl) {
    const warn = originWarning(suiteModels, baseUrl, "playwright.config.js");
    const rows = suiteModels
      .map((m) => {
        const count = m.scenarios.length;
        const login = m.hasLogin ? ` (shared \`${m.loginName}(page)\`)` : "";
        return `| \`tests/${m.suiteKey}/${m.suiteKey}.spec.js\` | ${m.suiteName} — ${count} scenario${count === 1 ? "" : "s"}${login} |`;
      })
      .join("\n");

    return `# ${projectName}

Generated by **QA Web Recorder** — Playwright, merged from ${suiteModels.length} test suite${suiteModels.length === 1 ? "" : "s"}.

\`\`\`bash
npm install
npx playwright install
npx playwright test
\`\`\`
${warn}
## Test suites in this project

| Spec | Contents |
| ---- | -------- |
${rows}

## Layout

${LAYOUT}

Page Objects are shared automatically when two suites touch the same page.

## Anti-flake measures baked in

${ANTIFLAKE}
`;
  }

  /* ------------------------------ assemble ------------------------------ */

  function pageFiles(pages, files) {
    for (const page of pages) {
      if (page.locators.length)
        files[`locator/${page.key}/${page.locatorFile}.js`] = renderLocator(page);
      if (page.usesMessage)
        files[`messages/${page.key}/${page.messageFile}.js`] = renderMessage(page);
      if (page.usesData)
        files[`data/${page.key}/${page.dataFile}.js`] = renderData(page);
      if (page.methods.length)
        files[`pages/${page.key}/${page.fileBase}.js`] = renderPage(page);
    }
  }

  function generateFiles(session) {
    const model = C.buildModel(session);
    const files = {};
    const s = model.suiteKey;

    pageFiles(model.pages, files);

    files[`tests/${s}/${s}.spec.js`] = renderSpec(model);
    const auth = renderAuth([model]);
    if (auth) files["support/auth.js"] = auth;
    files["playwright.config.js"] = renderConfig(model);
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
      files[`tests/${model.suiteKey}/${model.suiteKey}.spec.js`] = renderSpec(model);
    }

    const auth = renderAuth(suiteModels);
    if (auth) files["support/auth.js"] = auth;
    files["playwright.config.js"] = renderConfig({ baseUrl });
    files["package.json"] = renderPackageJson({ suiteName: projectName });
    files["README.md"] = renderProjectReadme(suiteModels, projectName, baseUrl);

    return { suiteModels, baseUrl, projectName, files };
  }

  window.GenPlaywright = {
    id: "playwright",
    label: "Playwright",
    specSuffix: ".spec.js",
    generateFiles,
    generateProjectFiles,
  };
})();
