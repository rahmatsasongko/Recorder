// Reconstruct a recorder `session` from an exported Cypress project.
//
// Two shapes are supported:
//   1. Projects exported by this extension's generator (lib/generator.js) — a
//      near-perfect round-trip.
//   2. Hand-written Page-Object projects — best effort. Method calls are
//      inlined (including `this.x()` and `cy.login()` custom commands), nested
//      JSON data / locator / message constants are resolved, `arr.forEach(...)`
//      loops over data are unrolled, and `cy.get(...)` / `cy.contains(...)` /
//      `cy.url()` chains are turned into flat steps. Statements the flat player
//      cannot replay (`.then`, `.within`, `.filter`, conditionals, RegExp
//      matchers, random generators, …) are skipped per-statement and collected
//      as warnings — the rest of the scenario still imports.
//
//   window.CypressImport.projectToSession({ "path": "file text" | Uint8Array })
//     -> session (+ session._warnings, session._report)

(function () {
  "use strict";

  /* ============================== utils ============================== */

  function textOf(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
      return new TextDecoder().decode(v);
    } catch (e) {
      return "";
    }
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
    return w[0].toLowerCase() + w.slice(1).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join("");
  }
  function humanize(s) {
    return words(s).join(" ").toLowerCase().slice(0, 60) || "element";
  }
  function unquote(s) {
    s = String(s == null ? "" : s).trim();
    const m = /^(['"`])([\s\S]*)\1$/.exec(s);
    if (!m) return s;
    return m[2]
      .replace(/\\(['"`\\])/g, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  function abs(path, baseUrl) {
    if (path == null || path === "") return baseUrl || "";
    if (/^https?:\/\//i.test(path)) return path;
    try {
      return new URL(path, baseUrl || "http://localhost").href;
    } catch (e) {
      return String(path);
    }
  }
  function pageKeyOf(url) {
    try {
      const u = new URL(url);
      const seg = u.pathname.split("/").filter(Boolean);
      return camel(seg[seg.length - 1] || seg[0] || "home") || "home";
    } catch (e) {
      return "home";
    }
  }
  function classToKey(cls) {
    return camel(String(cls || "").replace(/Page$/, "")) || "";
  }

  function selType(sel) {
    if (!sel) return null;
    if (/^\(*\s*\.?\/\//.test(sel)) return "xpath";
    if (/^#/.test(sel)) return "id";
    if (/^\[data-(test|cy|qa|e2e|automation)/i.test(sel)) return "data-testid";
    if (/^\[/.test(sel)) return "attr";
    return "css";
  }

  function Unresolvable(msg) {
    const e = new Error(msg || "cannot translate");
    e.unresolvable = true;
    return e;
  }

  /* ==================== string / comment-aware blanking ==================== */
  // Replace the *contents* of strings, template literals, regex literals and
  // comments with spaces (length + newlines preserved) so structural scanning
  // (bracket matching, top-level splitting) never trips on punctuation inside a
  // string literal.
  function blankOut(src) {
    let out = "";
    let i = 0;
    let prev = "";
    const regexOk = () => prev === "" || "([{,;=:?!&|+-*%<>^~".indexOf(prev) >= 0;
    while (i < src.length) {
      const c = src[i];
      const d = src[i + 1];
      if (c === "/" && d === "/") {
        while (i < src.length && src[i] !== "\n") {
          out += " ";
          i++;
        }
        continue;
      }
      if (c === "/" && d === "*") {
        out += "  ";
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
          out += src[i] === "\n" ? "\n" : " ";
          i++;
        }
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        out += c;
        i++;
        while (i < src.length && src[i] !== c) {
          if (src[i] === "\\") {
            out += "  ";
            i += 2;
            continue;
          }
          out += src[i] === "\n" ? "\n" : " ";
          i++;
        }
        out += i < src.length ? c : "";
        i++;
        prev = "z";
        continue;
      }
      if (c === "/" && regexOk()) {
        out += " ";
        i++;
        let cls = false;
        while (i < src.length) {
          const e = src[i];
          if (e === "\\") {
            out += "  ";
            i += 2;
            continue;
          }
          if (e === "[") cls = true;
          else if (e === "]") cls = false;
          else if (e === "/" && !cls) {
            out += " ";
            i++;
            break;
          }
          out += e === "\n" ? "\n" : " ";
          i++;
        }
        while (i < src.length && /[a-z]/i.test(src[i])) {
          out += " ";
          i++;
        }
        prev = "z";
        continue;
      }
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return out;
  }

  // Strip `//` and `/* */` comments (→ spaces, newlines kept) but leave string
  // and regex contents intact. Used before parsing object literals so a
  // `// comment` line above a key doesn't get swallowed into the key name.
  function deComment(src) {
    let out = "";
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      const d = src[i + 1];
      if (c === "/" && d === "/") {
        while (i < src.length && src[i] !== "\n") {
          out += " ";
          i++;
        }
        continue;
      }
      if (c === "/" && d === "*") {
        out += "  ";
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
          out += src[i] === "\n" ? "\n" : " ";
          i++;
        }
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        out += c;
        i++;
        while (i < src.length && src[i] !== c) {
          if (src[i] === "\\") {
            out += src[i] + (src[i + 1] || "");
            i += 2;
            continue;
          }
          out += src[i];
          i++;
        }
        out += i < src.length ? src[i] : "";
        i++;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  function matchBracket(blank, openIdx) {
    const open = blank[openIdx];
    const close = open === "{" ? "}" : open === "(" ? ")" : open === "[" ? "]" : "";
    if (!close) return -1;
    let depth = 0;
    for (let i = openIdx; i < blank.length; i++) {
      const c = blank[i];
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // Split `inner` on top-level occurrences of `sep` (using its blanked twin).
  function splitTop(inner, blankInner, sep) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < blankInner.length; i++) {
      const c = blankInner[i];
      if ("([{".indexOf(c) >= 0) depth++;
      else if (")]}".indexOf(c) >= 0) depth--;
      else if (depth === 0 && c === sep) {
        parts.push(inner.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(inner.slice(start));
    return parts.map((s) => s.trim()).filter((s) => s.length);
  }

  /* ==================== JS object-literal value parser ==================== */
  // Handles the subset used by locator / data / message files: nested objects &
  // arrays, single/double/back-quoted strings, numbers, booleans, null, unquoted
  // or quoted keys, trailing commas, comments.
  function parseLiteral(src) {
    src = deComment(String(src == null ? "" : src)).trim();
    if (!src) return undefined;
    const blank = blankOut(src);
    const c = src[0];

    if (c === "{") {
      const end = matchBracket(blank, 0);
      if (end < 0) return src;
      const innerS = src.slice(1, end);
      const innerB = blank.slice(1, end);
      const obj = {};
      for (const pair of splitTop(innerS, innerB, ",")) {
        const pb = blankOut(pair);
        let depth = 0;
        let ci = -1;
        for (let k = 0; k < pb.length; k++) {
          const ch = pb[k];
          if ("([{".indexOf(ch) >= 0) depth++;
          else if (")]}".indexOf(ch) >= 0) depth--;
          else if (depth === 0 && ch === ":") {
            ci = k;
            break;
          }
        }
        if (ci < 0) continue;
        const key = unquote(pair.slice(0, ci).trim());
        obj[key] = parseLiteral(pair.slice(ci + 1));
      }
      return obj;
    }

    if (c === "[") {
      const end = matchBracket(blank, 0);
      if (end < 0) return src;
      return splitTop(src.slice(1, end), blank.slice(1, end), ",").map((x) => parseLiteral(x));
    }

    if (c === '"' || c === "'" || c === "`") {
      let j = 1;
      while (j < blank.length && blank[j] !== c) j++;
      return unquote(src.slice(0, j + 1));
    }

    if (/^true\b/.test(src)) return true;
    if (/^false\b/.test(src)) return false;
    if (/^null\b/.test(src)) return null;
    const num = /^-?\d+(?:\.\d+)?/.exec(src);
    if (num && num[0].length === src.length) return Number(num[0]);
    return src; // identifier / expression — keep as string
  }

  /* ============================ file index ============================ */

  function normPath(p) {
    p = String(p).replace(/\\/g, "/").replace(/^\.\//, "");
    const idx = p.indexOf("cypress/");
    return idx >= 0 ? p.slice(idx) : p.replace(/^[^/]+\//, "");
  }

  function makeIndex(files) {
    const all = Object.keys(files).map((p) => ({
      path: String(p).replace(/\\/g, "/"),
      norm: normPath(p),
      text: textOf(files[p])
    }));
    const byNorm = {};
    all.forEach((f) => {
      byNorm[f.norm] = f;
    });
    return {
      all,
      byNorm,
      pick(re) {
        return all.find((f) => re.test(f.path)) || null;
      },
      pickAll(re) {
        return all.filter((f) => re.test(f.path));
      },
      resolve(fromNorm, rel) {
        const stack = fromNorm.split("/").slice(0, -1);
        rel.split("/").forEach((seg) => {
          if (seg === "" || seg === ".") return;
          if (seg === "..") stack.pop();
          else stack.push(seg);
        });
        let p = stack.join("/");
        if (!/\.[a-z]+$/i.test(p)) p += ".js";
        return byNorm[p] || byNorm[p.replace(/\.js$/, "/index.js")] || null;
      }
    };
  }

  /* ==================== constants (locator/data/message) ==================== */

  function findExports(text) {
    const blank = blankOut(text);
    const out = {};
    const re = /export\s+const\s+([A-Za-z0-9_$]+)\s*=/g;
    let m;
    while ((m = re.exec(blank))) {
      let j = re.lastIndex;
      while (j < text.length && /\s/.test(blank[j])) j++;
      let depth = 0;
      let k = j;
      for (; k < blank.length; k++) {
        const ch = blank[k];
        if ("([{".indexOf(ch) >= 0) depth++;
        else if (")]}".indexOf(ch) >= 0) depth--;
        else if (ch === ";" && depth === 0) break;
        else if (ch === "\n" && depth === 0) {
          // stop at a blank-ish line break that clearly ends the value
          let n = k + 1;
          while (n < blank.length && /[ \t]/.test(blank[n])) n++;
          if (/^(export|const|let|var|class|function|import|\/\/)/.test(blank.slice(n, n + 8))) break;
        }
      }
      out[m[1]] = text.slice(j, k);
    }
    return out;
  }

  function buildConsts(index) {
    const consts = {};
    index.all.forEach((f) => {
      if (!/\.js$/.test(f.path)) return;
      const ex = findExports(f.text);
      for (const name of Object.keys(ex)) {
        if (name in consts) continue;
        try {
          consts[name] = parseLiteral(ex[name]);
        } catch (e) {
          /* ignore an unparseable constant */
        }
      }
    });
    return consts;
  }

  /* ============================ page classes ============================ */

  const NOT_METHOD = new Set(["if", "for", "while", "switch", "catch", "function", "return", "constructor"]);

  function parseClasses(index) {
    const byNorm = {};
    const byName = {};
    const commands = {};

    index.all.forEach((f) => {
      if (!/(^|\/)cypress\/(pages|support)\/.+\.js$/.test(f.path)) return;
      const blank = blankOut(f.text);
      const cm = /class\s+([A-Za-z0-9_$]+)/.exec(blank);
      const rec = { className: cm ? cm[1] : null, norm: f.norm, methods: {} };

      const mre = /(^|[\n;{}])[ \t]{2,}(?:async[ \t]+)?([A-Za-z0-9_$]+)[ \t]*\(([^)]*)\)[ \t]*\{/g;
      let mm;
      while ((mm = mre.exec(blank))) {
        const name = mm[2];
        if (NOT_METHOD.has(name)) continue;
        const braceIdx = mm.index + mm[0].length - 1;
        const end = matchBracket(blank, braceIdx);
        if (end < 0) continue;
        rec.methods[name] = {
          params: mm[3]
            .split(",")
            .map((s) => s.trim().replace(/=.*/, "").replace(/[{}[\].]/g, "").trim())
            .filter(Boolean),
          body: f.text.slice(braceIdx + 1, end)
        };
        mre.lastIndex = end;
      }

      byNorm[f.norm] = rec;
      if (rec.className && !byName[rec.className]) byName[rec.className] = rec;

      if (/(^|\/)cypress\/support\//.test(f.path)) {
        // Name + params from the real text (they'd be blanked inside the string);
        // body span from the blanked twin.
        const cre = /Cypress\.Commands\.add\(\s*['"`]([A-Za-z0-9_$]+)['"`]\s*,\s*(?:function\s*)?\(([^)]*)\)\s*(?:=>\s*)?\{/g;
        let cc;
        while ((cc = cre.exec(f.text))) {
          const braceIdx = cc.index + cc[0].length - 1;
          const end = matchBracket(blank, braceIdx);
          if (end < 0) continue;
          commands[cc[1]] = {
            params: cc[2].split(",").map((s) => s.trim().replace(/=.*/, "").trim()).filter(Boolean),
            body: f.text.slice(braceIdx + 1, end)
          };
          cre.lastIndex = end;
        }
      }
    });

    return { byNorm, byName, commands };
  }

  /* ======================= expression resolution ======================= */

  function resolveExpr(expr, scope, consts) {
    expr = String(expr == null ? "" : expr).trim();
    if (!expr) return undefined;
    if (Object.prototype.hasOwnProperty.call(scope, expr)) return scope[expr];
    if (/^['"`]/.test(expr)) return unquote(expr);
    if (/^-?\d+(?:\.\d+)?$/.test(expr)) return Number(expr);
    if (expr === "true") return true;
    if (expr === "false") return false;
    if (expr === "null" || expr === "undefined") return null;

    // template literal with no interpolation
    const tpl = /^`([^`$]*)`$/.exec(expr);
    if (tpl) return tpl[1];

    // dotted / bracketed path: a.b['c'].d
    const parts = expr
      .split(/[.\[\]]+/)
      .map((s) => s.replace(/['"`]/g, "").trim())
      .filter(Boolean);
    if (parts.length) {
      let base = Object.prototype.hasOwnProperty.call(scope, parts[0])
        ? scope[parts[0]]
        : Object.prototype.hasOwnProperty.call(consts, parts[0])
        ? consts[parts[0]]
        : undefined;
      for (let k = 1; k < parts.length && base != null; k++) base = base[parts[k]];
      if (base !== undefined) return base;
    }
    return undefined;
  }

  function selectorOf(expr, scope, consts) {
    const v = resolveExpr(expr, scope, consts);
    if (typeof v === "string" && v) return v;
    // a bare string literal that isn't a known const
    if (/^['"`]/.test(String(expr).trim())) {
      const u = unquote(expr);
      if (u) return u;
    }
    return null;
  }

  function isRegexy(expr) {
    return /new\s+RegExp|^\/.*\/[a-z]*$/i.test(String(expr).trim());
  }

  /* ======================= statement / chain walker ======================= */

  function splitStatements(body) {
    const blank = blankOut(body);
    const raw = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < blank.length; i++) {
      const c = blank[i];
      if ("([{".indexOf(c) >= 0) depth++;
      else if (")]}".indexOf(c) >= 0) depth--;
      else if (depth === 0 && (c === ";" || c === "\n")) {
        raw.push(body.slice(start, i));
        start = i + 1;
      }
    }
    raw.push(body.slice(start));

    const out = [];
    for (const piece of raw) {
      const t = piece.trim();
      if (!t) continue;
      const prev = out.length ? out[out.length - 1].replace(/\s+$/, "") : "";
      const prevEnd = prev.slice(-1);
      const cont =
        out.length &&
        (".)]}?:&|".indexOf(t[0]) >= 0 ||
          "(,.{[=+-&|?:<>".indexOf(prevEnd) >= 0 ||
          /=>$/.test(prev) ||
          /\b(return|const|let|var|await)$/.test(prev));
      if (cont) out[out.length - 1] += "\n" + piece;
      else out.push(piece);
    }
    return out;
  }

  // The `.foo(...).bar(...)` calls that trail a `cy.get(...)` / `cy.contains(...)`.
  // `end` is the index of the closing `)` of that first call in `s`.
  function tailCalls(s, end) {
    return chainCalls("cy" + s.slice(end + 1));
  }

  // Enumerate the `.name(args)` segments of a chain expression (top level only).
  function chainCalls(expr) {
    const blank = blankOut(expr);
    const calls = [];
    const re = /([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(blank))) {
      const openIdx = m.index + m[0].length - 1;
      // depth of this call's `(` — 0 means top-level chain segment
      let depth = 0;
      for (let i = 0; i < openIdx; i++) {
        const c = blank[i];
        if ("([{".indexOf(c) >= 0) depth++;
        else if (")]}".indexOf(c) >= 0) depth--;
      }
      if (depth !== 0) continue;
      const end = matchBracket(blank, openIdx);
      if (end < 0) break;
      calls.push({ name: m[1], args: expr.slice(openIdx + 1, end) });
      re.lastIndex = end;
    }
    return calls;
  }

  const CHAIN_NOISE = new Set([
    "scrollIntoView", "first", "last", "eq", "focus", "blur", "wait", "trigger",
    "scrollTo", "find", "children", "next", "prev", "clock", "tick"
  ]);
  const CHAIN_HARD = new Set([
    "then", "within", "each", "invoke", "filter", "parents", "parent", "closest",
    "siblings", "as", "spread", "its", "pipe"
  ]);

  function pushStep(ctx, step) {
    step.url = ctx.url;
    if (!step.elementName) step.elementName = step.action === "assert" ? "assertion" : "element";
    if (step.selector === undefined) step.selector = null;
    step.selectorType = step.selectorType || selType(step.selector);
    if (step.selectorStable === undefined) step.selectorStable = true;
    if (step.value === undefined) step.value = null;
    ctx.steps.push(step);
  }

  function nameFromSelectorExpr(expr) {
    const last = String(expr || "").split(".").pop();
    return humanize(last || "element");
  }

  // cy.get(<selExpr>)<chain>
  function handleGet(selExpr, restCalls, scope, ctx) {
    const sel = selectorOf(selExpr, scope, ctx.consts);
    const elName = nameFromSelectorExpr(selExpr);
    const actions = [];
    const asserts = [];

    for (const call of restCalls) {
      const { name, args } = call;
      if (CHAIN_HARD.has(name)) throw Unresolvable("." + name + "()");
      if (CHAIN_NOISE.has(name)) continue;
      if (name === "realClick" || name === "click" || name === "rightclick" || name === "dblclick") {
        actions.push({ action: "click" });
      } else if (name === "type" || name === "realType") {
        actions.push({ action: "type", value: resolveArgVal(args, scope, ctx, 0) });
      } else if (name === "clear") {
        actions.push({ action: "clear" });
      } else if (name === "check") {
        actions.push({ action: "check" });
      } else if (name === "uncheck") {
        actions.push({ action: "uncheck" });
      } else if (name === "select") {
        actions.push({ action: "select", value: resolveArgVal(args, scope, ctx, 0) });
      } else if (name === "selectFile" || name === "attachFile") {
        const v = resolveArgVal(args, scope, ctx, 0);
        const nm = typeof v === "string" ? v.split(/[\\/]/).pop() : String(v || "file");
        actions.push({ action: "upload", value: nm, files: [nm] });
      } else if (name === "should" || name === "and") {
        const a = splitTop(args, blankOut(args), ",");
        const kind = unquote(a[0] || "");
        if (/^not[.\s]/.test(kind) || kind === "not.exist" || kind === "not.be.visible") {
          ctx.warn("negative assertion skipped: " + kind);
          continue;
        }
        if (kind === "exist" || kind === "be.visible" || kind === "be.enabled" || kind === "be.checked" || kind === "be.focused") {
          asserts.push({ type: kind === "exist" ? "exist" : "visible" });
        } else if (kind === "have.value") {
          asserts.push({ type: "value", value: resolveExpr(a[1], scope, ctx.consts) });
        } else if (kind === "have.text" || kind === "contain" || kind === "include.text" || kind === "contain.text" || kind === "have.contain") {
          asserts.push({ type: "contain", value: resolveExpr(a[1], scope, ctx.consts) });
        }
        // have.attr / have.class / have.length etc — not expressible, drop quietly
      } else {
        throw Unresolvable("." + name + "()");
      }
    }

    // merge `.clear().type(x)`; a lone `.type("{enter}")` is a keypress
    const merged = [];
    for (let k = 0; k < actions.length; k++) {
      const a = actions[k];
      if (a.action === "clear" && actions[k + 1] && actions[k + 1].action === "type") continue;
      if (a.action === "type") {
        const preClear = k > 0 && actions[k - 1].action === "clear";
        const v = String(a.value == null ? "" : a.value).trim();
        if (!preClear && /^(\{[a-zA-Z]+\})+$/.test(v)) {
          merged.push({ action: "keydown", value: v, key: specialKeyName(v) });
          continue;
        }
      }
      merged.push(a);
    }

    if (!merged.length) {
      // `.should("be.visible").and("contain", x)` is one assertion on one
      // element — emit only the most specific check.
      let list = asserts;
      if (asserts.some((a) => a.type === "contain" || a.type === "value")) {
        list = asserts.filter((a) => a.type === "contain" || a.type === "value");
      } else {
        const seen = new Set();
        list = asserts.filter((a) => !seen.has(a.type) && seen.add(a.type));
      }
      if (!list.length) list = [{ type: "visible" }];
      for (const as of list) {
        pushStep(ctx, {
          action: "assert",
          assertion: { type: as.type, value: as.value == null ? "" : String(as.value) },
          selector: sel,
          elementName: elName
        });
      }
      return;
    }
    for (const a of merged) {
      const step = { action: a.action, selector: sel, elementName: elName };
      if (a.key) step.key = a.key;
      if (a.value !== undefined) step.value = a.value == null ? null : String(a.value);
      if (a.files) step.files = a.files;
      pushStep(ctx, step);
    }
  }

  function specialKeyName(v) {
    const m = /^\{([a-zA-Z]+)\}/.exec(v);
    const k = (m ? m[1] : "enter").toLowerCase();
    return (
      { enter: "Enter", tab: "Tab", esc: "Escape", backspace: "Backspace",
        uparrow: "ArrowUp", downarrow: "ArrowDown", leftarrow: "ArrowLeft", rightarrow: "ArrowRight" }[k] ||
      "Enter"
    );
  }

  function resolveArgVal(argsStr, scope, ctx, idx) {
    const a = splitTop(argsStr, blankOut(argsStr), ",");
    return resolveExpr(a[idx], scope, ctx.consts);
  }

  // cy.contains(<args>)<chain>
  function handleContains(argsStr, restCalls, scope, ctx) {
    const a = splitTop(argsStr, blankOut(argsStr), ",");
    let selExpr = null;
    let textExpr;
    if (a.length >= 2) {
      selExpr = a[0];
      textExpr = a[1];
    } else {
      textExpr = a[0];
    }
    if (isRegexy(textExpr)) throw Unresolvable("cy.contains(RegExp)");
    const sel = selExpr ? selectorOf(selExpr, scope, ctx.consts) : null;
    const text = resolveExpr(textExpr, scope, ctx.consts);
    if (text == null) throw Unresolvable("cy.contains(<unresolved>)");

    let negative = false;
    let terminalClick = false;
    for (const call of restCalls) {
      if (CHAIN_HARD.has(call.name)) throw Unresolvable("." + call.name + "()");
      if (CHAIN_NOISE.has(call.name)) continue;
      if (call.name === "should" || call.name === "and") {
        const kind = unquote(splitTop(call.args, blankOut(call.args), ",")[0] || "");
        if (/^not[.\s]/.test(kind)) negative = true;
        continue;
      }
      if (call.name === "click" || call.name === "realClick") terminalClick = true;
      else throw Unresolvable("." + call.name + "() after contains");
    }
    if (negative) {
      ctx.warn('negative "contains" assertion skipped: "' + String(text).slice(0, 30) + '"');
      return;
    }
    if (terminalClick) {
      pushStep(ctx, {
        action: "click",
        selector: sel,
        value: null,
        elementName: humanize(String(text)),
        containsText: String(text)
      });
      return;
    }
    pushStep(ctx, {
      action: "assert",
      assertion: { type: "contain", value: String(text) },
      selector: sel,
      elementName: sel ? nameFromSelectorExpr(selExpr) : humanize(String(text))
    });
  }

  function handleForEach(stmt, scope, ctx, cls) {
    const blank = blankOut(stmt);
    const feIdx = blank.indexOf(".forEach");
    if (feIdx < 0) throw Unresolvable("forEach");
    const arrExpr = stmt.slice(0, feIdx).trim();
    const arr = resolveExpr(arrExpr, scope, ctx.consts);
    if (!Array.isArray(arr)) throw Unresolvable("forEach over non-array: " + arrExpr.slice(0, 40));

    const parenIdx = blank.indexOf("(", feIdx);
    const parenEnd = matchBracket(blank, parenIdx);
    const cbSrc = stmt.slice(parenIdx + 1, parenEnd);
    const cbBlank = blank.slice(parenIdx + 1, parenEnd);
    const arrowIdx = cbBlank.indexOf("=>");
    if (arrowIdx < 0) throw Unresolvable("forEach callback");
    const paramsSrc = cbSrc.slice(0, arrowIdx);
    const pm = /\(?\s*([A-Za-z0-9_$]+)/.exec(paramsSrc);
    const itemVar = pm ? pm[1] : "item";
    let cbBody = cbSrc.slice(arrowIdx + 2).trim();
    if (cbBody[0] === "{") cbBody = cbBody.slice(1, -1);

    arr.forEach((item) => {
      const s2 = Object.assign(Object.create(null), scope);
      s2[itemVar] = item;
      walk(splitStatements(cbBody), s2, ctx, cls);
    });
  }

  function expandCall(objExpr, method, argExprs, scope, ctx, cls) {
    let rec = null;
    if (objExpr === "this") rec = cls;
    else rec = ctx.imports[objExpr] || ctx.classes.byName[objExpr] || null;

    if (!rec || !rec.methods[method]) {
      // a page-object getter used as a value, or an unknown helper
      throw Unresolvable(objExpr + "." + method + "()");
    }
    if (ctx.depth > 30) throw Unresolvable("call nesting too deep");

    // A page-object method operates on its own page. Advancing the running URL
    // on the class name keeps steps attributed to the right page even though
    // the generated code carries no intermediate cy.visit() (also how the
    // generator itself decides page grouping — keeps its round-trip exact).
    if (objExpr !== "this" && /Page$/.test(rec.className || "")) {
      const key = classToKey(rec.className);
      if (key && key !== pageKeyOf(ctx.url)) ctx.url = abs("/" + key, ctx.baseUrl);
    }

    const def = rec.methods[method];
    const resolved = argExprs.map((e) => resolveExpr(e, scope, ctx.consts));
    const s2 = Object.create(null);
    def.params.forEach((p, k) => {
      s2[p] = resolved[k];
    });
    ctx.depth++;
    walk(splitStatements(def.body), s2, ctx, rec);
    ctx.depth--;
  }

  function expandCommand(name, argExprs, scope, ctx, cls) {
    const cmd = ctx.classes.commands[name];
    if (!cmd) throw Unresolvable("cy." + name + "()");
    if (ctx.depth > 30) throw Unresolvable("command nesting too deep");
    const resolved = argExprs.map((e) => resolveExpr(e, scope, ctx.consts));
    const s2 = Object.create(null);
    cmd.params.forEach((p, k) => {
      s2[p] = resolved[k];
    });
    ctx.depth++;
    walk(splitStatements(cmd.body), s2, ctx, cls);
    ctx.depth--;
  }

  const CY_IGNORE = /^cy\.(wait|log|viewport|intercept|wrap|screenshot|reload|debug|pause|clearCookies|clearLocalStorage|setCookie|readFile|writeFile|fixture|clock|tick|scrollTo|window|document|title|go)\b/;

  function handleStatement(stmt, scope, ctx, cls) {
    const s = stmt.trim();
    if (!s || s.startsWith("//")) return;
    const blank = blankOut(s);

    // control flow / imperative constructs the flat player can't run
    if (/^(if|for|while|switch|try|do|return|throw|expect)\b/.test(s) || /^Cypress\./.test(s)) {
      throw Unresolvable(s.split("\n")[0].slice(0, 60));
    }

    // const X = <literal>  -> add to scope, best effort
    let m = /^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*([\s\S]+)$/.exec(s);
    if (m) {
      try {
        const v = parseLiteral(m[2]);
        if (v !== undefined && typeof v !== "string") {
          scope[m[1]] = v;
          return;
        }
        const rv = resolveExpr(m[2], scope, ctx.consts);
        if (rv !== undefined) {
          scope[m[1]] = rv;
          return;
        }
      } catch (e) {
        /* fall through */
      }
      throw Unresolvable("const " + m[1] + " = …");
    }

    if (CY_IGNORE.test(s)) return;

    // cy.visit(...)
    m = /^cy\s*\.\s*visit\s*\(/.exec(s);
    if (m) {
      const open = blank.indexOf("(");
      const inner = s.slice(open + 1, matchBracket(blank, open));
      const arg0 = splitTop(inner, blankOut(inner), ",")[0];
      let path = resolveExpr(arg0, scope, ctx.consts);
      if (path == null) path = unquote(arg0 || "/");
      ctx.url = abs(path, ctx.baseUrl);
      pushStep(ctx, { action: "visit", selector: null, value: null, elementName: "page" });
      return;
    }

    // cy.url() / cy.location() assertions
    m = /^cy\s*\.\s*(url|location)\s*\(/.exec(s);
    if (m) {
      const inc = /\.\s*should\s*\(\s*(['"`])(?:include|eq|contain|equal|match)\1\s*,\s*([^)]*)\)/.exec(s);
      if (inc) {
        let val = resolveExpr(inc[2].trim(), scope, ctx.consts);
        if (val == null) val = unquote(inc[2].trim());
        val = String(val).replace(/^https?:\/\/[^/]+/i, "");
        ctx.url = abs(val, ctx.baseUrl);
        pushStep(ctx, {
          action: "assert",
          assertion: { type: "url", value: val },
          selector: null,
          elementName: "url"
        });
        return;
      }
      return; // a bare cy.url() with no usable assertion
    }

    // cy.contains(...)
    m = /^cy\s*\.\s*contains\s*\(/.exec(s);
    if (m) {
      const open = blank.indexOf("(");
      const end = matchBracket(blank, open);
      handleContains(s.slice(open + 1, end), tailCalls(s, end), scope, ctx);
      return;
    }

    // cy.get(...)
    m = /^cy\s*\.\s*get\s*\(/.exec(s);
    if (m) {
      const open = blank.indexOf("(");
      const end = matchBracket(blank, open);
      const selExpr = splitTop(s.slice(open + 1, end), blankOut(s.slice(open + 1, end)), ",")[0];
      handleGet(selExpr, tailCalls(s, end), scope, ctx);
      return;
    }

    // cy.<customCommand>(...)
    m = /^cy\s*\.\s*([A-Za-z0-9_$]+)\s*\(/.exec(s);
    if (m && ctx.classes.commands[m[1]]) {
      const open = blank.indexOf("(");
      const end = matchBracket(blank, open);
      const args = splitTop(s.slice(open + 1, end), blankOut(s.slice(open + 1, end)), ",");
      expandCommand(m[1], args, scope, ctx, cls);
      return;
    }

    // arr.forEach((x) => ...)
    if (/^[A-Za-z0-9_$.\[\]'"` ]+\.forEach\s*\(/.test(s)) {
      handleForEach(s, scope, ctx, cls);
      return;
    }

    // Page.method(...) or this.method(...)
    m = /^(this|[A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(s);
    if (m) {
      const open = blank.indexOf("(");
      const end = matchBracket(blank, open);
      // reject if there is a chain after the call (e.g. Page.foo().then(...))
      const tail = s.slice(end + 1).trim();
      if (tail && tail[0] === ".") throw Unresolvable(m[1] + "." + m[2] + "()" + tail.split("(")[0]);
      const args = splitTop(s.slice(open + 1, end), blankOut(s.slice(open + 1, end)), ",");
      expandCall(m[1], m[2], args, scope, ctx, cls);
      return;
    }

    throw Unresolvable(s.split("\n")[0].slice(0, 60));
  }

  function walk(statements, scope, ctx, cls) {
    for (const stmt of statements) handleStatement(stmt, scope, ctx, cls);
  }

  /* ===================== spec extraction ===================== */

  function callBody(blank, src, headerEnd) {
    // headerEnd points just past `it(` / `describe(` / `beforeEach(`
    const openParen = headerEnd - 1;
    const closeParen = matchBracket(blank, openParen);
    if (closeParen < 0) return null;
    // last top-level `{ ... }` inside the call args = the callback body
    let depth = 0;
    let lastOpen = -1;
    for (let i = openParen + 1; i < closeParen; i++) {
      const c = blank[i];
      if ("([".indexOf(c) >= 0) depth++;
      else if (")]".indexOf(c) >= 0) depth--;
      else if (c === "{" && depth === 0) {
        const e = matchBracket(blank, i);
        lastOpen = i;
        i = e;
      }
    }
    if (lastOpen < 0) return null;
    const end = matchBracket(blank, lastOpen);
    return { body: src.slice(lastOpen + 1, end), after: closeParen };
  }

  function readStringAfter(blank, src, from) {
    let i = from;
    while (i < src.length && /\s/.test(blank[i])) i++;
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== "`") return null;
    let j = i + 1;
    while (j < blank.length && blank[j] !== q) j++;
    return { value: unquote(src.slice(i, j + 1)), end: j + 1 };
  }

  function extractDescribes(text) {
    const blank = blankOut(text);
    const out = [];
    const re = /\bdescribe\s*(?:\.\s*(?:skip|only))?\s*\(/g;
    let m;
    while ((m = re.exec(blank))) {
      const title = readStringAfter(blank, text, re.lastIndex);
      const cb = callBody(blank, text, re.lastIndex);
      if (!cb) continue;
      out.push({ title: title ? title.value : "", body: cb.body });
      re.lastIndex = cb.after;
    }
    if (!out.length) out.push({ title: "", body: text });
    return out;
  }

  function extractHooks(body) {
    const blank = blankOut(body);
    const re = /\b(?:beforeEach|before)\s*\(/g;
    let m;
    let combined = "";
    while ((m = re.exec(blank))) {
      const cb = callBody(blank, body, re.lastIndex);
      if (!cb) continue;
      combined += "\n" + cb.body;
      re.lastIndex = cb.after;
    }
    return combined;
  }

  function extractIts(body) {
    const blank = blankOut(body);
    const re = /\bit\s*(?:\.\s*(skip|only))?\s*\(/g;
    const out = [];
    let m;
    while ((m = re.exec(blank))) {
      const title = readStringAfter(blank, body, re.lastIndex);
      const cb = callBody(blank, body, re.lastIndex);
      if (!cb) continue;
      out.push({ title: title ? title.value : "scenario", skip: m[1] === "skip", body: cb.body });
      re.lastIndex = cb.after;
    }
    return out;
  }

  function specImports(index, classes, specFile) {
    const map = {};
    const re = /import\s+([A-Za-z0-9_$]+)\s*(?:,\s*\{[^}]*\})?\s+from\s+['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = re.exec(specFile.text))) {
      const target = index.resolve(specFile.norm, m[2]);
      if (target && classes.byNorm[target.norm]) {
        map[m[1]] = classes.byNorm[target.norm];
        continue;
      }
      // Import path didn't resolve (common when a project's folders were
      // rearranged). Fall back to a page file with the same basename —
      // exact case first, then case-insensitive.
      const base = m[2].split("/").pop().replace(/\.[a-z]+$/i, "");
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const keys = Object.keys(classes.byNorm);
      const hit =
        keys.find((p) => new RegExp("/" + esc + "\\.(js|ts)$").test(p)) ||
        keys.find((p) => new RegExp("/" + esc + "\\.(js|ts)$", "i").test(p));
      if (hit) map[m[1]] = classes.byNorm[hit];
    }
    return map;
  }

  /* ============================== main ============================== */

  function collectSpecs(index) {
    const specs = index
      .pickAll(/(^|\/)cypress\/e2e\/.+\.cy\.(js|ts)$/)
      .concat(index.pickAll(/(^|\/)cypress\/(integration|tests)\/.+\.(spec|cy)\.(js|ts)$/));
    const out = [];
    const seen = new Set();
    for (const s of specs) {
      if (seen.has(s.norm)) continue;
      seen.add(s.norm);
      out.push(s);
    }
    return out;
  }

  // A lightweight listing for the "which spec?" picker — one entry per .cy.js
  // file, since each maps to one importable Test Suite.
  function listSpecs(files) {
    const index = makeIndex(files);
    const specs = collectSpecs(index);
    if (!specs.length) {
      throw new Error(
        "ZIP tidak berisi session.json maupun spec Cypress (cypress/e2e/**/*.cy.js) — tidak bisa direkonstruksi."
      );
    }
    return specs.map((s) => {
      const describes = extractDescribes(s.text);
      let count = 0;
      for (const d of describes) count += extractIts(d.body).length;
      const title = describes.map((d) => d.title).filter(Boolean)[0];
      return {
        path: s.norm,
        file: s.norm.split("/").pop(),
        name: title || s.norm.replace(/.*\/e2e\//, "").replace(/\.cy\.(js|ts)$/, ""),
        scenarios: count
      };
    });
  }

  // `specPath` (a spec's normalised path) limits the import to that one file so
  // it becomes a single Test Suite; omit it to merge every spec into one suite.
  function projectToSession(files, specPath) {
    const index = makeIndex(files);

    let uniqueSpecs = collectSpecs(index);
    if (specPath) uniqueSpecs = uniqueSpecs.filter((s) => s.norm === specPath || s.path === specPath);
    if (!uniqueSpecs.length) {
      throw new Error(
        "ZIP tidak berisi session.json maupun spec Cypress (cypress/e2e/**/*.cy.js) — tidak bisa direkonstruksi."
      );
    }
    // One spec file == one Test Suite: keep it() titles verbatim and name the
    // suite after its describe().
    const singleSpec = uniqueSpecs.length === 1;

    let baseUrl = "http://localhost";
    const cfg = index.pick(/(^|\/)cypress\.config\.(js|ts)$/) || index.pick(/(^|\/)cypress\.json$/);
    if (cfg) {
      const bm = /baseUrl\s*[:=]\s*(['"`])([^'"`]+)\1/.exec(cfg.text);
      if (bm) baseUrl = bm[2].replace(/\/+$/, "");
    }

    const consts = buildConsts(index);
    const classes = parseClasses(index);

    let projectName = "";
    const anyPath = uniqueSpecs[0].path.replace(/\\/g, "/");
    const rootSeg = /^([^/]+)\//.exec(anyPath);
    if (rootSeg && !/^cypress$/i.test(rootSeg[1])) projectName = rootSeg[1];
    const pkg = index.pick(/(^|\/)package\.json$/);
    if (!projectName && pkg) {
      try {
        const j = JSON.parse(pkg.text);
        if (j && j.name) projectName = j.name;
      } catch (e) {
        /* ignore */
      }
    }
    if (!projectName) projectName = "Imported project";

    const scenarios = [];
    const warnings = [];
    const describeTitles = new Set();
    let scNum = 0;
    let okScenarios = 0;

    for (const specFile of uniqueSpecs) {
      const specTag = specFile.norm.replace(/.*\/e2e\//, "").replace(/\.cy\.(js|ts)$/, "");
      const imports = specImports(index, classes, specFile);

      for (const desc of extractDescribes(specFile.text)) {
        if (desc.title) describeTitles.add(desc.title);
        const hookSrc = extractHooks(desc.body);
        const its = extractIts(desc.body);
        for (const it of its) {
          scNum++;
          const scenarioWarns = [];
          const ctx = {
            baseUrl,
            url: null,
            steps: [],
            depth: 0,
            consts,
            classes,
            imports,
            warn(msg) {
              scenarioWarns.push(msg);
            }
          };

          const runList = (src) => {
            for (const stmt of splitStatements(src)) {
              const mark = ctx.steps.length;
              try {
                handleStatement(stmt, Object.create(null), ctx, null);
              } catch (e) {
                ctx.steps.length = mark;
                scenarioWarns.push((e && e.message) || String(e));
              }
            }
          };

          runList(hookSrc);
          runList(it.body);

          // finalise steps
          const steps = ctx.steps.map((st, k) => {
            st.id = "step-" + String(k + 1).padStart(3, "0");
            st.timestamp = new Date().toISOString();
            if (!st.url) st.url = ctx.url || abs("/", baseUrl);
            return st;
          });

          // One spec = one suite: keep the it() title as written. Merging every
          // spec into one suite: prefix with the describe/file so names stay
          // unique and you can tell which module a scenario came from.
          let name;
          if (singleSpec) {
            name = (it.skip ? "⏭ " : "") + it.title;
          } else {
            const cleanTitle = it.title.replace(/^\s*[\w .]+ - \d+ \|\s*/, "").trim() || it.title;
            const ctxLabel = desc.title || specTag;
            name =
              (it.skip ? "⏭ " : "") +
              (ctxLabel && cleanTitle.toLowerCase().indexOf(ctxLabel.toLowerCase()) !== 0
                ? ctxLabel + " · " + cleanTitle
                : cleanTitle);
          }
          scenarios.push({
            id: "sc-" + Date.now().toString(36) + "-" + scNum,
            name,
            steps,
            saved: true
          });
          if (steps.length && !scenarioWarns.length) okScenarios++;
          if (scenarioWarns.length) {
            warnings.push({
              scenario: name,
              steps: steps.length,
              issues: scenarioWarns.slice(0, 8)
            });
          }
        }
      }
    }

    if (!scenarios.length) {
      throw new Error("Spec Cypress ditemukan tapi tidak ada it() yang bisa dibaca.");
    }

    const withSteps = scenarios.filter((s) => s.steps.length);
    const firstUrl = (withSteps[0] && withSteps[0].steps.find((s) => s.url) || {}).url;

    let suiteName;
    if (singleSpec) {
      suiteName =
        (describeTitles.size === 1 && Array.from(describeTitles)[0]) ||
        uniqueSpecs[0].norm.split("/").pop().replace(/\.cy\.(js|ts)$/, "");
    } else {
      suiteName = describeTitles.size === 1 ? Array.from(describeTitles)[0] : projectName;
    }

    const session = {
      projectName,
      suiteName,
      targetUrl: firstUrl || abs("/", baseUrl),
      scenarios
    };
    session._report = {
      specs: uniqueSpecs.length,
      spec: singleSpec ? uniqueSpecs[0].norm.split("/").pop() : null,
      scenarios: scenarios.length,
      clean: okScenarios,
      partial: warnings.length,
      empty: scenarios.length - withSteps.length
    };
    session._warnings = warnings;
    return session;
  }

  window.CypressImport = { projectToSession, listSpecs };
})();
