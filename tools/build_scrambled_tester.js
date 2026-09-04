#!/usr/bin/env node
/* tools/build_scrambled_tester.js — one file you can open, or email to a phone.
 *
 *   node tools/build_scrambled_tester.js
 *   -> scrambled-tester.html  (gitignored; not part of the site)
 *
 * WHY THIS IS GENERATED RATHER THAN WRITTEN
 *
 * A hand-written test harness is a second implementation of the game, and a
 * second implementation drifts from the first — which is this project's whole
 * fault pattern, and would be worse here than usual: the harness would look
 * right while testing something the site does not do.
 *
 * So nothing here is retyped. Every library, every endpoint handler and the
 * engine itself are read from their real files, mechanically stripped of their
 * `import` and `export` lines, and inlined. The only thing this file adds is a
 * fetch() shim that routes /api/scrambled/* into the same handler functions
 * Cloudflare would invoke. If a handler is wrong, the tester is wrong the same
 * way — which is the point of testing in it.
 *
 * WHAT IT CANNOT TELL YOU. There is no server, so today's XI is in the file
 * you are holding: View Source shows every name. On the site the names never
 * leave the Worker. Do not hand this to anybody you want to play the board.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* Strip ESM plumbing so the module body can run as a plain script. Comments
   and code are untouched — this is the only transformation applied, and it is
   deliberately dumb so that nothing can be quietly rewritten on the way in. */
function plain(src) {
  const out = src
    .replace(/^import\s[\s\S]*?;\s*$/gm, "")
    /* `async` was missing from this list on the first build, so all three
       endpoint handlers kept their `export` keyword and the whole tester was
       a syntax error in a browser. It looked fine because `node --check` on a
       .js file sees ESM syntax, decides the file is a module, and checks it as
       one — a green light that meant the opposite of what it appeared to. The
       assertion below is what actually guards this now. */
    .replace(/^export\s+(?=(async\s+)?(const|function|class|let|var)\b)/gm, "")
    /* And a bare re-export list, `export { A, B };`. sc-round.js has one: it
       re-exports the page's own scoring rule and bench prices so there is a
       single statement of each. Here those names are already globals, so the
       line carries nothing and dropping it loses nothing. */
    .replace(/^export\s*\{[^}]*\}\s*;\s*$/gm, "");
  const survived = out.split("\n").filter((l) => /^\s*(import|export)\s/.test(l));
  if (survived.length) {
    throw new Error("ESM plumbing survived the strip, so the tester would not " +
      "run in a browser:\n  " + survived.slice(0, 5).join("\n  "));
  }
  return out;
}

/* A handler file becomes a namespaced object, because two of the three export
   a symbol called onRequestPost and inlining them flat would silently leave
   only the last one standing. */
function handler(file, names) {
  return `var ${names.as} = (function () {\n${plain(read(file))}\n  return { ${names.exports.join(", ")} };\n})();`;
}

/* THE TESTER GETS THE WHOLE BANK, not the four-board sample that ships.
   sc-boards.js became a sample when the bank moved outside the repository and
   the tester inherited it — a review tool that can show four boards out of two
   hundred and sixty-two is not a review tool. This file is gitignored, has no
   server, and says on its own face that the answers are inside it, so the bank
   is exactly what belongs in it.
   Built through the builder's own build(), so the tester plays the boards the
   import sends to D1 rather than a second rendering of them. Falls back to the
   shipped sample when the bank is absent, so a fresh clone still works. */
const bankDir = path.join(ROOT, "..", "scrambledxi-source", "xi");
let bankJs = null;
if (fs.existsSync(bankDir)) {
  const { gate, parseFormation, build } = await import(
    "file://" + path.join(ROOT, "tools", "build_scrambled.js").split(path.sep).join("/"));
  const built = fs.readdirSync(bankDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort()
    .map((f) => {
      const src = JSON.parse(fs.readFileSync(path.join(bankDir, f), "utf8"));
      const problems = gate(src, parseFormation(src.formation)) || [];
      if (problems.length) { console.error("REFUSED: " + f + "\n  x " + problems[0]); process.exit(1); }
      return build(src, f);
    });
  bankJs = "var SC_BOARDS = " + JSON.stringify(built) + ";";
  console.log("  bank: " + built.length + " boards");
} else {
  /* ONE SERIALISATION, BOTH PATHS. This branch used to inline the module's
     own source text while the branch above emitted JSON — the same boards in
     two shapes, and anything reading the generated file had to know which
     path had produced it. tester_test counted board titles as JSON and read
     zero on every machine without the bank, which is every CI runner: the
     suite went red for the shape of the file rather than for anything wrong
     with the tester. */
  const mod = await import(
    "file://" + path.join(ROOT, "functions", "_lib", "sc-boards.js").split(path.sep).join("/"));
  bankJs = "var SC_BOARDS = " + JSON.stringify(mod.SC_BOARDS) + ";";
  console.log("  bank not found — using the " + mod.SC_BOARDS.length + "-board sample");
}

/* EVERY LIBRARY THE INLINED HANDLERS REACCH FOR. Order matters: these are
   concatenated as plain script with their imports stripped, so a file must
   come after anything it reads at load time — archive.js after daily.js,
   because it calls utcDay.

   archive.js also imports currentUser from auth.js, which is NOT inlined and
   does not need to be: the tester passes no env, so accountsOffered() is
   false and the session is never looked up. A name referenced inside a branch
   that cannot run is not a missing dependency.

   Adding an import to a handler and not adding it here produces a tester
   whose shim throws on the first board — tester_test asserts the pair now, so
   it is caught in the build rather than in the file. */
const libs = [
  "functions/_lib/sc-names.js",
  "functions/_lib/daily.js",
  "functions/_lib/archive.js",
  "functions/_lib/sc-board.js",
  /* sc-round.js reaches for SCX_SCORING and SCX_CONFIG, which are inlined
     further down with the rest of scrambled/js/ — and that is soon enough,
     because it only reads them inside functions, and with no env every one of
     them answers null before it gets that far. */
  "functions/_lib/sc-round.js",
].map((f) => `/* ===== ${f} ===== */\n${plain(read(f))}`).join("\n\n");

/* Bank first: sc-board.js reads SC_BOARDS. */
const libsAll = "/* ===== the board bank ===== */" + String.fromCharCode(10) +
  bankJs + String.fromCharCode(10, 10) + libs;

const handlers = [
  handler("functions/api/scrambled/daily.js", { as: "API_DAILY", exports: ["onRequestGet"] }),
  handler("functions/api/scrambled/guess.js", { as: "API_GUESS", exports: ["onRequestPost"] }),
  handler("functions/api/scrambled/reveal.js", { as: "API_REVEAL", exports: ["onRequestPost"] }),
].join("\n\n");

/* The page's own body, minus the shared chrome. xi-chrome.js is not inlined:
   it is the family bar and drawer, it links to games that are not in this
   file, and a tester that carries the squad list would name an unreleased game
   in markup somebody could screenshot. */
const page = read("scrambled/index.html");
const body = page
  .slice(page.indexOf("<body>") + 6, page.indexOf("</body>"))
  .replace(/<header class="xic-bar">[\s\S]*?<\/header>/, "")
  .replace(/<footer class="xic-foot"><\/footer>/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

const out = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>Scrambled XI — local tester</title>
<!-- GENERATED by tools/build_scrambled_tester.js. Do not edit: edit the real
     files and rebuild, or the tester stops being evidence about the game.

     THE ANSWERS ARE IN THIS FILE. There is no server here, so the whole XI is
     inlined below. On the site the names never leave the Worker. -->
<style>
${read("shared/xi-tokens.css")}
${read("scrambled/css/style.css")}

/* ---- tester chrome, which is not part of the game ---- */
.tst {
  max-width: 720px; margin: 0 auto; padding: 10px 14px 0;
  font-family: var(--body); font-size: 13px; color: var(--ink-soft);
}
.tst .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tst button, .tst select {
  min-height: 34px; padding: 0 10px; font: inherit;
  background: var(--card); color: var(--ink);
  border: 1px solid var(--line); border-radius: 8px; cursor: pointer;
}
.tst .warn {
  margin: 8px 0 0; padding: 8px 10px; border-radius: 8px;
  background: var(--tint); color: var(--ink); line-height: 1.45;
}
.tst .key { margin: 8px 0 0; display: none; }
.tst .key.open { display: block; }
.tst .key ol { margin: 6px 0 0; padding-left: 22px; }
.tst .key li { padding: 2px 0; }
.tst .key b { font-family: var(--disp); letter-spacing: .04em; }
</style>
</head>
<body>

<div class="tst">
  <div class="row">
    <span class="xi-mark">SCRAMBLED XI</span>
    <span>local tester</span>
    <select id="tstBoard" aria-label="Which board"></select>
    <select id="tstClock" aria-label="Clock speed">
      <option value="900">Real clock (15 min)</option>
      <option value="180">Fast (3 min)</option>
      <option value="90">Very fast (90 sec)</option>
    </select>
    <button id="tstReset">Clear saved progress</button>
    <button id="tstKey">Show the answers</button>
    <button id="tstTheme">Dark / light</button>
  </div>
  <p class="warn">No server. The whole XI is inlined in this file, so View
    Source gives the answers away — on the site the names never leave the
    Worker. The shared bar, drawer and family footer are not here either.
    <span id="tstStore"></span></p>
  <div class="key" id="tstKeyPanel"></div>
</div>

${body}

<script>
/* ============================================================
   The real libraries, inlined verbatim from functions/_lib/
   ============================================================ */
${libsAll}

/* ============================================================
   The real endpoint handlers, inlined from functions/api/scrambled/
   ============================================================ */
${handlers}

/* ============================================================
   The network hop, and only the network hop, faked.
   ============================================================ */
(function () {
  var ROUTES = {
    "/api/scrambled/daily":  function (req) { return API_DAILY.onRequestGet({ request: req }); },
    "/api/scrambled/guess":  function (req) { return API_GUESS.onRequestPost({ request: req }); },
    "/api/scrambled/reveal": function (req) { return API_REVEAL.onRequestPost({ request: req }); }
  };
  window.fetch = function (input, init) {
    /* file:// has no origin to resolve against, so one is supplied. The
       handlers only ever read the path and the query. */
    var url = new URL(String(input), "https://tester.invalid");
    var route = ROUTES[url.pathname];
    if (!route) return Promise.reject(new Error("no route for " + url.pathname));
    return Promise.resolve(route(new Request(url.href, init)));
  };
})();

/* ============================================================
   The game, inlined from scrambled/js/
   ============================================================ */
${read("scrambled/js/config.js")}
${read("scrambled/js/scoring.js")}

/* The tester's own overrides, applied BEFORE the engine reads them. The clock
   is the one that matters: half time is 45', and waiting seven and a half real
   minutes to see the team talk is not a test anybody runs twice. */
(function () {
  var q = new URLSearchParams(location.search);
  var clock = Number(q.get("clock"));
  if (clock > 0) window.SCX_CONFIG.MATCH_CLOCK_REAL_SECONDS = clock;
})();

${read("scrambled/js/game.js")}

/* ============================================================
   Tester controls. Nothing below this line exists on the site.
   ============================================================ */
(function () {
  var q = new URLSearchParams(location.search);
  var boardSel = document.getElementById("tstBoard");
  SC_BOARDS.forEach(function (b, i) {
    var o = document.createElement("option");
    o.value = String(i + 1);
    o.textContent = "#" + (i + 1) + "  " + b.title;
    boardSel.appendChild(o);
  });
  /* THE PICKER MUST SAY WHAT IS ON SCREEN. It defaulted to "#1" while the
     engine loaded whichever board today's number lands on — so with two boards
     in the ring the tester showed the 1966 side and captioned it 1999 on every
     other day. Derived from the same rotation the server uses rather than
     written down again. */
  var todaysNo = ((dailyNumber() - 1) % SC_BOARDS.length) + 1;
  boardSel.value = q.get("no") || String(todaysNo);
  document.getElementById("tstClock").value = q.get("clock") || "900";

  function go(params) {
    var next = new URLSearchParams(location.search);
    Object.keys(params).forEach(function (k) { next.set(k, params[k]); });
    location.search = next.toString();
  }
  boardSel.addEventListener("change", function () { go({ no: boardSel.value }); });
  document.getElementById("tstClock").addEventListener("change", function () {
    go({ clock: document.getElementById("tstClock").value });
  });

  document.getElementById("tstReset").addEventListener("click", function () {
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf("xisc.") === 0) localStorage.removeItem(k);
    });
    location.reload();
  });

  /* Content proofing: the board as authored, beside what the player sees. This
     is how a wrong position or a scramble that reads as a real word gets
     caught before it is a board. */
  var panel = document.getElementById("tstKeyPanel");
  document.getElementById("tstKey").addEventListener("click", function () {
    if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
    var b = SC_BOARDS[Number(boardSel.value) - 1];
    var rows = b.slots.map(function (s) {
      return "<li><b>" + s.pos + "</b> " + s.scramble + " &rarr; <b>" + s.name + "</b>" +
        (s.fixed ? " <em>(" + s.fixed + " letter stuck, unavoidable)</em>" : "") +
        "<br><small>" + (s.club || "") + " &middot; " + (s.nationality || "") +
        (s.aliases.length ? " &middot; also accepts: " + s.aliases.join(", ") : "") +
        "</small></li>";
    }).join("");
    panel.innerHTML = "<strong>" + b.title + "</strong> &middot; " + b.formation +
      " &middot; sells " + b.hintField + "<ol>" + rows + "</ol>" +
      "<small>Source: " + b.source + "</small>";
    panel.classList.add("open");
  });

  /* The theme is a family fact and lives under "xi." — the same key the shared
     chrome sets on the site, so a theme chosen here is the theme there. */
  document.getElementById("tstTheme").addEventListener("click", function () {
    var now = document.documentElement.getAttribute("data-theme") === "dark" ? "" : "dark";
    if (now) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("xi.theme", now || "light"); } catch (e) {}
  });
  try {
    if (localStorage.getItem("xi.theme") === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) {}

  /* SOME BROWSERS REFUSE localStorage ON file://, and the engine catches that
     silently by design — a blocked store must never end a game. Silent is
     right on the site and wrong here: it looks like the save is broken. So the
     tester says which one it is, and the Clear button says so too. */
  var storeOk = true;
  try { localStorage.setItem("xisc.probe", "1"); localStorage.removeItem("xisc.probe"); }
  catch (e) { storeOk = false; }
  if (!storeOk) {
    document.getElementById("tstStore").textContent =
      " This browser blocks storage on file:// URLs, so progress will not " +
      "survive a reload here. It does on the site.";
    document.getElementById("tstReset").disabled = true;
  }
})();
</script>
</body>
</html>
`;

const dest = path.join(ROOT, "scrambled-tester.html");
fs.writeFileSync(dest, out);
console.log(`\nWritten ${path.relative(ROOT, dest)}  (${Math.round(out.length / 1024)} KB)`);
console.log("Open it directly. No server, no build step, no network.\n");
