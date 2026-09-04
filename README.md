# Cypress Recorder Extension

A Manifest V3 browser extension (Chrome / Edge) that records website activity and
turns it into a **Cypress** project with a **Page Object Model** structure:
Locator → Page → Spec, plus Messages and Data modules.

Implements [`prd.md`](prd.md) and [`prd2.md`](prd2.md) (multi-scenario suites,
shared `beforeEach`, one spec file per suite).

---

## Layout

```text
d:\Recorder\
├── extension\   ← load THIS folder in Chrome
└── agent\       ← optional local runner (Node.js)
```

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select **`d:\Recorder\extension`**.
4. Pin the **Cypress Recorder** icon to the toolbar.

No build step — plain ES modules.

---

## Usage — a Test Suite with many Scenarios

A four-step stepper across the top of the popup — **Setup › Record › Review ›
Run** — always shows where you are.

| Step | Action |
| ---- | ------ |
| 1 | Icon → enter **Project name**, **Test suite name** (e.g. `Login`), **Target URL**. |
| 2 | **Start recording — Scenario 1** → a tab opens; do your actions. |
| 3 | Back to the popup → **Stop** → name the scenario. In the editor, **tap a step to expand it** — reorder, edit selectors, add assertions → **Save scenario**. |
| 4 | **＋ Add scenario** → the **same tab is reused** (not closed), records Scenario 2 → Stop → Save. |
| 5 | Repeat for as many scenarios as you want. |
| 6 | **▶ Play in browser** — replay a scenario (or **▶ Play all**) live in the tab. No install. |
| 7 | **⚙ Generate Cypress** — preview Spec / Pages / Locators / Messages / Data / Structure. |
| 8 | **Export ZIP** — or, under *More*, **Run via agent** for a real headless Cypress run. |

All scenarios land in **one** `<suite>.cy.js` as separate `it()` blocks. The
opening steps shared by every scenario (typically login) are lifted into
`cy.login()` and a `beforeEach`.

---

## Play in browser (no install)

Suite hub → **▶** on a scenario, or **▶ Play all**. The recorded tab is driven
step by step: each target element is outlined with a caption (`click: Login
button`) as it happens, and the popup fills a live pass/fail checklist. A broken
selector stops playback and shows the error on that step; remaining steps are
marked *skipped*. Results show as ✓/✗ chips back on the suite hub.

This runs entirely in the browser — no Node, no Cypress, no agent. It replays the
**recorded steps**, not the generated spec, so it is the fast way to sanity-check
a recording before generating or exporting.

**File uploads are skipped during Play** — a real `<input type="file">` needs the
OS file picker and the file on disk, which a page script can't drive. The step is
marked *skipped* (playback continues), and the browser's native "Open" dialog is
suppressed so it never stalls. The generated Cypress handles it with
`cy.get(...).selectFile("cypress/fixtures/<name>", { force: true })` — drop the
file into `cypress/fixtures/` and run it via the agent or `npx cypress`.

---

## Run it as real Cypress (optional local agent)

```bash
cd agent
npm install     # once — downloads Cypress
npm start       # keep open  →  http://127.0.0.1:47654
```

Popup → suite hub → *More* → **Run via agent** → **Agent: connected** → **Run
now**. Live logs, then Status / Duration / Passed–Failed with screenshots and
video inline. Real credentials go in the **Cypress env** box, e.g.
`{ "password": "secret" }`.

Cypress runs headless in its bundled Electron browser — Chrome is not required.
See [`agent/README.md`](agent/README.md).

## Or export and run yourself

```bash
npm install
npx cypress open
npx cypress run
```

---

## What gets captured

`visit` · `click` · `type` · `clear` · `select` · `check` / `uncheck` ·
`keydown` (Enter/Tab/Esc/arrows) · `scroll` · `submit` · `upload` (file inputs →
`cy.selectFile`)

Clicking into a text box, textarea, dropdown or checkbox produces **no click
step** — only the resulting `type` / `select` / `check` with its value. Typed
values (passwords included) are recorded exactly as entered.

### Selector priority

1. **Test-id attributes** — `data-testid` first, then `data-test-id` · `data-test` ·
   `data-cy` · `data-qa` · `data-automation-id` · `data-e2e`. If the id is
   duplicated on the page it is scoped under the nearest ancestor test-id
   (`[data-testid="row-2"] [data-testid="view"]`). If the clicked element has no
   test-id but a close ancestor does, the selector is anchored there
   (`[data-testid="toolbar"] button`).
2. `id` → `name` → `aria-label`
3. Stable content attrs — `placeholder` · `title` · `type` · `role` · `href`
4. Unique CSS path → XPath (fallback)

All selectors are checked for uniqueness against the live DOM; dynamic-looking
classes/ids are skipped and unstable ones get a `// WARNING` comment in the
locator file.

---

## Anti-flake

The generated project is hardened against the usual recorder-code flakiness:

| Measure | Where |
| ------- | ----- |
| `retries: { runMode: 2 }` | `cypress.config.js` |
| `defaultCommandTimeout` 10s, request/response 15s | `cypress.config.js` |
| `scrollBehavior: "center"` (avoids sticky-header overlap) | `cypress.config.js` |
| `experimentalMemoryManagement` (long suites don't OOM) | `cypress.config.js` |
| CSS transitions / animations / smooth-scroll disabled | `support/e2e.js` |
| Scoped text checks — `cy.get(loc).should("contain", …)` not bare `cy.contains()` | page objects |
| `cy.login()` asserts the URL changed before the test proceeds | `support/commands.js` |
| Optional one-login-per-run via `cy.session()` (commented, opt-in) | `support/commands.js` |

The recorder can't know your XHRs, so the last-mile fix for a stubborn spec is
`cy.intercept()` + `cy.wait("@alias")`.

---

## Generated structure

```text
<Project>/
├── cypress/
│   ├── e2e/<suite>/<suite>.cy.js        one describe(), many it()
│   ├── pages/<page>/<page>Page.js       class + export default new XPage()
│   ├── locator/<page>/locator-<page>.js export const locatorX = { ... }
│   ├── messages/<page>/<page>.message.js export const XMessage = { ... }
│   ├── data/<page>/<page>.data.js       export const XData = { ... }
│   └── support/{commands,e2e}.js        cy.login(), cy.getByTestId()
├── cypress.config.js                    defineConfig({ e2e: { ... } })
├── package.json
└── README.md
```

Each visited URL path becomes its own page group (`/login` → `login/`,
`/user` → `user/`).

### Example output

`cypress/locator/login/locator-login.js`

```javascript
export const locatorLogin = {
  inputEmail: '[data-testid="email-input"]',
  inputPassword: '[data-testid="input-password"]',
  buttonLogin: '[data-testid="button-login"]',
};
```

`cypress/pages/login/loginPage.js`

```javascript
import { locatorLogin } from "../../locator/login/locator-login";
import { LoginData } from "../../data/login/login.data";

class LoginPage {

  inputEmail(email) {
    cy.get(locatorLogin.inputEmail).clear().type(email);
  }

  clickButtonLogin() {
    cy.get(locatorLogin.buttonLogin).click();
  }

}

export default new LoginPage();
```

`cypress/e2e/user/user.cy.js`

```javascript
import LoginPage from "../../pages/login/loginPage";
import UserPage from "../../pages/user/userPage";

describe("User Page", () => {

  beforeEach(() => {
    cy.visit("/login");
    cy.login();
  });

  it("User - 1 | Admin dapat melihat User Page", () => {
    UserPage.clickLinkMenuUser();
    UserPage.verifySearchBarVisible();
  });

  it("User - 2 | Admin dapat search user", () => {
    UserPage.clickLinkMenuUser();
    UserPage.inputSearchBar(UserData.searchBar);
    UserPage.pressEnter();
    UserPage.verifyUserRowVisible();
  });

});
```

---

## Security

- Every typed value — including passwords — is recorded as-is and written to the
  `data/` module so the generated test runs without extra editing. Review the
  `data/*.data.js` files before committing them.
- Recording data stays in `chrome.storage.local`. **Play in browser** runs locally
  and sends nothing anywhere. Only **Run via agent** transmits the project — and
  only to your local agent.

---

## Architecture

```text
extension/popup/            UI: setup → record → suite hub → scenario editor → play → code → run
extension/content/content.js Recorder Engine + Selector Engine (injected on every page)
extension/content/player.js  Playback Engine — runs one recorded step + draws the highlight
extension/background.js      Suite/scenario state owner + playback driver + message router
extension/lib/generator.js   Cypress + POM + Messages + Data generator
extension/lib/zip.js         Dependency-free ZIP writer (STORE)
agent/                      Local runner: receives the project, runs Cypress, returns results
```

### Notes

- Vanilla ES modules, no build step.
- **Playback** is driven from `background.js`: it navigates the tab, hands each
  step to `content/player.js`, waits for the page to settle (including full
  navigations) and records the result. Playback survives the popup being closed
  and the service worker being recycled.
- `type` / `select` captured on the `change` event (on blur) — one step per field.
- The exported `cypress.config.js` uses `defineConfig`. The **agent** writes its
  own plain-object config into its workspace, because `require("cypress")` cannot
  resolve there.
- The browser tab is reused across scenarios (re-navigated to the target URL at
  the start of each), so it is never closed mid-suite.
