#!/usr/bin/env node
/*
 * Cypress Recorder Agent
 * ----------------------
 * Tiny local HTTP server that the browser extension talks to so a recorded
 * test can be executed directly.  It receives a generated Cypress project,
 * writes it into a persistent workspace, runs Cypress (bundled Electron —
 * no browser install needed) and reports the result.
 *
 *   npm install      # once, installs Cypress
 *   npm start        # http://127.0.0.1:47654
 *
 * Env:
 *   PORT             override port (default 47654)
 *   CYRE_WORKSPACE   override workspace dir
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// If the launching shell exported this (Claude Code, some VS Code terminals,
// Electron-based tools), every Electron binary — including Cypress's browser —
// runs as plain Node and fails with "bad option: --smoke-test". Clear it.
delete process.env.ELECTRON_RUN_AS_NODE;

const PORT = Number(process.env.PORT) || 47654;
const HOST = "127.0.0.1";
const WORKSPACE = path.resolve(
  process.env.CYRE_WORKSPACE ||
    path.join(os.homedir(), ".cypress-recorder-agent", "workspace")
);
const AGENT_VERSION = "1.0.0";
const MAX_BODY = 64 * 1024 * 1024;

fs.mkdirSync(WORKSPACE, { recursive: true });

/* --------------------------------- state --------------------------------- */

const runs = new Map(); // id -> run record
let activeRun = null;

/* ------------------------------- utilities ------------------------------- */

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeJoin(base, target) {
  const resolvedBase = path.resolve(base);
  const p = path.resolve(resolvedBase, target);
  const rel = path.relative(resolvedBase, p);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    throw new Error("path escapes workspace: " + target);
  }
  return p;
}

function relToWs(abs) {
  return path.relative(WORKSPACE, abs).split(path.sep).join("/");
}

function launchHint(msg) {
  if (
    /smoke-test|Cypress failed to start|cachedDataRejected|missing library|required-dependencies|Could not find Cypress test run results/i.test(
      msg
    )
  ) {
    return (
      msg +
      "\n\nCypress could not launch its browser. Verify the install first:\n" +
      "  cd agent && npx cypress verify\n" +
      "If that fails too, see https://on.cypress.io/required-dependencies " +
      "(and check antivirus / Controlled Folder Access is not blocking Cypress.exe)."
    );
  }
  return msg;
}

function cypressAvailable() {
  try {
    require.resolve("cypress");
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------- project writing ---------------------------- */

function extractBaseUrl(files) {
  const cfg = files["cypress.config.js"] || "";
  const m = /baseUrl:\s*["']([^"']+)["']/.exec(cfg);
  return m ? m[1] : null;
}

function writeProject(files, env, baseUrl) {
  // Start from a clean cypress/ tree so removed steps don't linger.
  fs.rmSync(path.join(WORKSPACE, "cypress"), { recursive: true, force: true });

  for (const rel of Object.keys(files)) {
    // package.json and cypress.config.js are agent-managed: the generated
    // config uses `require("cypress")` / defineConfig, which cannot resolve
    // inside the agent workspace (it has no local node_modules).
    if (rel === "package.json" || rel === "cypress.config.js") continue;
    const abs = safeJoin(WORKSPACE, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(files[rel]));
  }

  fs.writeFileSync(
    path.join(WORKSPACE, "package.json"),
    JSON.stringify(
      { name: "cypress-recorder-workspace", version: "1.0.0", private: true },
      null,
      2
    )
  );

  const url = baseUrl || extractBaseUrl(files) || "http://localhost:3000";
  fs.writeFileSync(
    path.join(WORKSPACE, "cypress.config.js"),
    `module.exports = {
  retries: { runMode: 2, openMode: 0 },
  e2e: {
    baseUrl: ${JSON.stringify(url)},
    pageLoadTimeout: 60000,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 15000,
    viewportWidth: 1920,
    viewportHeight: 1080,
    scrollBehavior: "center",
    experimentalMemoryManagement: true,
    specPattern: "cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
    supportFile: "cypress/support/e2e.js",
    video: true,
    screenshotOnRunFailure: true,
  },
};
`
  );

  const envPath = path.join(WORKSPACE, "cypress.env.json");
  if (env && typeof env === "object" && Object.keys(env).length) {
    fs.writeFileSync(envPath, JSON.stringify(env, null, 2));
  } else {
    fs.rmSync(envPath, { force: true });
  }
}

/* ------------------------------- run logic ------------------------------- */

function summarize(r) {
  const specs = (r.runs || []).map((sr) => ({
    spec: (sr.spec && (sr.spec.relative || sr.spec.name)) || "spec",
    passed: sr.stats ? sr.stats.passes : 0,
    failed: sr.stats ? sr.stats.failures : 0,
    pending: sr.stats ? sr.stats.pending : 0,
    duration: sr.stats ? sr.stats.duration || sr.stats.wallClockDuration : 0,
    tests: (sr.tests || []).map((t) => {
      const last =
        t.attempts && t.attempts.length
          ? t.attempts[t.attempts.length - 1]
          : null;
      return {
        title: Array.isArray(t.title) ? t.title.join(" › ") : t.title,
        state: t.state,
        error:
          t.displayError ||
          (last && last.error && last.error.message) ||
          null
      };
    }),
    screenshots: (sr.screenshots || []).map((s) => relToWs(s.path)),
    video: sr.video ? relToWs(sr.video) : null
  }));

  return {
    totalTests: r.totalTests,
    passed: r.totalPassed,
    failed: r.totalFailed,
    pending: r.totalPending,
    skipped: r.totalSkipped,
    duration: r.totalDuration,
    browser:
      (r.browserName || "electron") + " " + (r.browserVersion || ""),
    cypressVersion: r.cypressVersion,
    specs
  };
}

function startRun(payload) {
  const id = crypto.randomBytes(6).toString("hex");
  const run = {
    id,
    status: "preparing",
    projectName: payload.projectName || "project",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    log: [],
    result: null,
    error: null
  };
  runs.set(id, run);
  activeRun = id;

  const log = (m) => {
    run.log.push(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
    if (run.log.length > 200) run.log.shift();
  };

  (async () => {
    try {
      writeProject(payload.files || {}, payload.env, payload.baseUrl);
      log("Project written to " + WORKSPACE);

      if (!cypressAvailable()) {
        run.status = "error";
        run.error =
          "Cypress is not installed. Run `npm install` in the agent folder.";
        run.finishedAt = Date.now();
        return;
      }

      const cypress = require("cypress");
      run.status = "running";
      run.startedAt = Date.now();
      log("Launching Cypress (headless)…");

      let results;
      try {
        results = await cypress.run({ project: WORKSPACE, quiet: true });
      } catch (e) {
        throw new Error(launchHint(String((e && e.message) || e)));
      }

      run.finishedAt = Date.now();

      if (results.status === "failed") {
        run.status = "error";
        run.error = launchHint(results.message || "Cypress failed to start.");
        log("ERROR: " + run.error);
        return;
      }

      run.result = summarize(results);
      run.status = run.result.failed > 0 ? "failed" : "passed";
      log(
        `Done — ${run.result.passed} passed, ${run.result.failed} failed ` +
          `in ${(run.result.duration / 1000).toFixed(1)}s`
      );
    } catch (e) {
      run.status = "error";
      run.error = String((e && e.message) || e);
      run.finishedAt = Date.now();
      log("ERROR: " + run.error);
    } finally {
      if (activeRun === id) activeRun = null;
    }
  })();

  return id;
}

/* --------------------------------- server -------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        name: "cypress-recorder-agent",
        version: AGENT_VERSION,
        cypressInstalled: cypressAvailable(),
        workspace: WORKSPACE,
        busy: !!activeRun,
        activeRun
      });
    }

    if (req.method === "POST" && pathname === "/run") {
      if (activeRun) {
        return sendJson(res, 409, {
          error: "A run is already in progress",
          runId: activeRun
        });
      }
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch (e) {
        return sendJson(res, 400, { error: "invalid JSON body" });
      }
      if (!payload.files || typeof payload.files !== "object") {
        return sendJson(res, 400, { error: "missing 'files' object" });
      }
      const id = startRun(payload);
      return sendJson(res, 202, { runId: id });
    }

    // /run/:id  and  /run/:id/file?path=...
    const m = pathname.match(/^\/run\/([a-f0-9]+)(\/file)?$/);
    if (req.method === "GET" && m) {
      const run = runs.get(m[1]);
      if (!run) return sendJson(res, 404, { error: "unknown run id" });

      if (m[2] === "/file") {
        const rel = url.searchParams.get("path") || "";
        let abs;
        try {
          abs = safeJoin(WORKSPACE, rel);
        } catch (e) {
          return sendJson(res, 400, { error: "bad path" });
        }
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: "not found" });
        const ext = path.extname(abs).toLowerCase();
        const ct =
          ext === ".png"
            ? "image/png"
            : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".mp4"
            ? "video/mp4"
            : "application/octet-stream";
        cors(res);
        res.writeHead(200, { "Content-Type": ct });
        fs.createReadStream(abs).pipe(res);
        return;
      }

      return sendJson(res, 200, {
        id: run.id,
        status: run.status,
        error: run.error,
        projectName: run.projectName,
        elapsed:
          (run.finishedAt || Date.now()) - (run.startedAt || run.createdAt),
        log: run.log.slice(-60),
        result: run.result
      });
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Cypress Recorder Agent");
  console.log("  ----------------------");
  console.log(`  Listening : http://${HOST}:${PORT}`);
  console.log(`  Workspace : ${WORKSPACE}`);
  console.log(
    `  Cypress   : ${cypressAvailable() ? "ready" : "NOT installed — run `npm install` here"}`
  );
  console.log("");
  console.log("  Keep this window open while running tests from the extension.");
  console.log("");
});
