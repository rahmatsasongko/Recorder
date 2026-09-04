# Cypress Recorder Agent

Local runner that lets the **Cypress Recorder** browser extension execute a
recorded test directly — no manual export, no `npx` typing.

```text
Browser Extension  ──HTTP──▶  Agent (this)  ──▶  cypress.run()  ──▶  result + screenshots + video
```

## Setup (once)

```bash
cd agent
npm install        # downloads Cypress (~few hundred MB, first time only)
```

## Start

```bash
npm start
# or:  ./start.sh   (macOS/Linux)   |   start.bat  (Windows, double-click)
```

Leave the window open. Default address: `http://127.0.0.1:47654`
(change with `PORT=... npm start`).

## Use

1. Record a flow in the extension and click **Generate Cypress**.
2. Open the **Run** tab in the popup — it shows **Agent: connected**.
3. (Optional) fill **Cypress env** with real values, e.g. `{"password":"secret"}`.
4. **Run Now** → live log, then Status / Duration / Passed-Failed / screenshots / video.

## How it runs

- Projects are written to `~/.cypress-recorder-agent/workspace` (persistent).
- Cypress runs headless in the **bundled Electron browser** — Chrome is not required.
- One run at a time; a second request gets `409` until the first finishes.
- Screenshots/video are served back to the popup from that workspace.

## Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/health` | agent status, whether Cypress is installed |
| POST | `/run` | `{ projectName, suiteName, baseUrl, files, env }` → `{ runId }` |
| GET  | `/run/:id` | status, log tail, result summary |
| GET  | `/run/:id/file?path=<rel>` | stream a screenshot / video from the workspace |

The agent writes its **own** `cypress.config.js` (plain object, using `baseUrl`)
into the workspace — the generated `defineConfig` file is skipped because
`require("cypress")` can't resolve inside the workspace.

## Security

Binds to `127.0.0.1` only. It writes and runs code it receives locally — only run
it for projects you produced yourself.
