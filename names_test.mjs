/* Every identifier resolves to a declaration.
 *
 * The gap this fills: deploy_check.mjs reads source and cannot resolve a name,
 * and `node --check` proves a file parses, not that its identifiers exist.
 * Four faults reached a deployed build through that gap in one week —
 * `bulkReveal` in v146 being the expensive one, where reveal letter, reveal
 * answer and reveal everything were all dead on a live build.
 *
 * A regex attempt was written and removed, correctly: eight false positives
 * across two rounds, and a checker that cries wolf gets switched off. This
 * builds the actual scope chain instead — every binding a scope introduces,
 * every identifier that reads one, and the difference. On v148 it reports
 * zero across all three files; delete `var bulkReveal` and it names all three
 * surviving references.
 *
 * WHAT IT DOES NOT CATCH, so nothing is claimed for it that is not true:
 *   - use before initialisation. `var x` hoists, so calling x() above its
 *     assignment is undefined-is-not-a-function at runtime and resolves fine
 *     here. That was the THEME_PREFIX fault, and it needs the jsdom suites.
 *   - anything reached only through a string: eval, new Function, or an
 *     onclick="" attribute in index.html.
 *   - a name that exists but holds the wrong thing.
 * It catches exactly one class: a reference with no declaration anywhere.
 *
 * Needs a parser, and there is no zero-dependency one: node ships acorn but
 * does not export it, and jsdom no longer pulls it in. Installed the same way
 * jsdom is, and for the same reason.
 *
 *   npm install acorn --no-save
 *   node names_test.mjs
 */
import fs from "node:fs";
import * as acorn from "acorn";

/* The browser loads these three in this order and they share one global
   scope, so a name declared in seasons.js resolves from game.js. */
const FILES = ["js/seasons.js", "js/engine.js", "js/game.js"];

/* Names the browser provides. Not an allowlist of things we gave up on
   resolving — these genuinely have no declaration in the file. */
const GLOBALS = new Set([
  "window","document","console","localStorage","sessionStorage","navigator",
  "location","history","screen","fetch","Headers","Request","Response",
  "setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame",
  "cancelAnimationFrame","alert","confirm","prompt","matchMedia","getComputedStyle",
  "Object","Array","String","Number","Boolean","Math","JSON","Date","RegExp",
  "Error","TypeError","RangeError","SyntaxError","ReferenceError","Promise",
  "Map","Set","WeakMap","WeakSet","Symbol","Proxy","Reflect","BigInt",
  "parseInt","parseFloat","isNaN","isFinite","encodeURIComponent","decodeURIComponent",
  "encodeURI","decodeURI","escape","unescape","structuredClone","queueMicrotask",
  "Intl","URL","URLSearchParams","Blob","File","FileReader","FormData","AbortController",
  "TextEncoder","TextDecoder","atob","btoa","crypto","performance","Node","Element",
  "HTMLElement","Event","CustomEvent","MutationObserver","IntersectionObserver",
  "ResizeObserver","DOMParser","XMLHttpRequest","Image","Audio","Option",
  "globalThis","undefined","NaN","Infinity","arguments","this","eval",
  "Uint8Array","Uint16Array","Uint32Array","Int8Array","Int16Array","Int32Array",
  "Float32Array","Float64Array","ArrayBuffer","DataView",
  /* CommonJS guards: engine.js exports both ways so it can be required. */
  "module","exports","require",
]);

/* ---- scope model ---- */
class Scope {
  constructor(parent, kind) {
    this.parent = parent; this.kind = kind; this.vars = new Set();
  }
  add(n) { this.vars.add(n); }
  has(n) {
    let s = this;
    while (s) { if (s.vars.has(n)) return true; s = s.parent; }
    return false;
  }
  /* var/function declarations hoist to the nearest function or module scope. */
  fnScope() {
    let s = this;
    while (s && s.kind === "block") s = s.parent;
    return s;
  }
}

function declarePattern(node, scope) {
  if (!node) return;
  switch (node.type) {
    case "Identifier": scope.add(node.name); break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "RestElement") declarePattern(p.argument, scope);
        else declarePattern(p.value, scope);
      }
      break;
    case "ArrayPattern":
      for (const e of node.elements) if (e) declarePattern(e, scope);
      break;
    case "AssignmentPattern": declarePattern(node.left, scope); break;
    case "RestElement": declarePattern(node.argument, scope); break;
  }
}

/* Pass 1 over a scope body: collect the bindings this scope introduces,
   including var/function hoisting out of nested blocks. */
function hoist(node, scope, isFnBody) {
  const walk = (n, inNested) => {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "VariableDeclaration":
        for (const d of n.declarations) {
          declarePattern(d.id, n.kind === "var" ? scope.fnScope() : scope);
        }
        break;
      case "FunctionDeclaration":
        if (n.id) scope.fnScope().add(n.id.name);
        return;                       // body handled when we descend into it
      case "ClassDeclaration":
        if (n.id) scope.add(n.id.name);
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return;                       // own scope
    }
    for (const k in n) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, true));
      else if (v && typeof v.type === "string") walk(v, true);
    }
  };
  const body = Array.isArray(node) ? node : [node];
  body.forEach((s) => walk(s, false));
}

const problems = [];

function visit(node, scope, src, file) {
  if (!node || typeof node.type !== "string") return;

  const child = (n, s) => visit(n, s, src, file);

  switch (node.type) {
    case "Program": {
      hoist(node.body, scope, true);
      node.body.forEach((n) => child(n, scope));
      return;
    }
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const s = new Scope(scope, "function");
      if (node.type === "FunctionExpression" && node.id) s.add(node.id.name);
      node.params.forEach((p) => declarePattern(p, s));
      if (node.body.type === "BlockStatement") {
        hoist(node.body.body, s, true);
        node.body.body.forEach((n) => child(n, s));
      } else {
        child(node.body, s);
      }
      return;
    }
    case "BlockStatement": {
      const s = new Scope(scope, "block");
      hoist(node.body, s, false);
      node.body.forEach((n) => child(n, s));
      return;
    }
    case "ForStatement": case "ForInStatement": case "ForOfStatement": {
      const s = new Scope(scope, "block");
      if (node.init) hoist(node.init, s, false);
      if (node.left) hoist(node.left, s, false);
      for (const k of ["init", "test", "update", "left", "right", "body"]) {
        if (node[k]) child(node[k], s);
      }
      return;
    }
    case "CatchClause": {
      const s = new Scope(scope, "block");
      if (node.param) declarePattern(node.param, s);
      hoist(node.body.body, s, false);
      node.body.body.forEach((n) => child(n, s));
      return;
    }
    case "MemberExpression": {
      child(node.object, scope);
      if (node.computed) child(node.property, scope);
      return;                          // .foo is a property, not a binding
    }
    case "Property": {
      if (node.computed) child(node.key, scope);
      child(node.value, scope);        // { foo: bar } — foo is a key
      return;
    }
    case "LabeledStatement": { child(node.body, scope); return; }
    case "BreakStatement": case "ContinueStatement": return;  // labels
    case "Identifier": {
      const n = node.name;
      if (GLOBALS.has(n) || scope.has(n)) return;
      const line = src.slice(0, node.start).split("\n").length;
      problems.push({ file, line, name: n });
      return;
    }
  }

  for (const k in node) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => child(c, scope));
    else if (v && typeof v.type === "string") child(v, scope);
  }
}

const files = process.argv.length > 2 ? process.argv.slice(2) : FILES;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "script" });
  visit(ast, new Scope(null, "function"), src, f);
}

/* Names declared in ANY checked file count as resolved — engine.js and game.js
   share a global scope in the browser. */
const declaredAnywhere = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "script" });
  const top = new Scope(null, "function");
  hoist(ast.body, top, true);
  top.vars.forEach((v) => declaredAnywhere.add(v));
}

const real = problems.filter((p) => !declaredAnywhere.has(p.name));
if (!real.length) {
  console.log(`  ok  every identifier resolves  — ${files.length} files, 0 undeclared`);
  console.log("\n1 passed, 0 failed");
  process.exit(0);
}
const seen = new Set();
for (const p of real) {
  const k = p.name + ":" + p.line;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`FAIL  ${p.file}:${p.line}  '${p.name}' is not declared anywhere`);
}
console.log(`\n0 passed, ${seen.size} failed`);
process.exit(1);
