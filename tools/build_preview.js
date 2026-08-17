#!/usr/bin/env node
/* tools/build_preview.js — one HTML file you can open straight from disk.
 *
 *   node tools/build_preview.js
 *   -> crosswordxi-preview-<build>.html
 *
 * The deployed site is index.html plus css/, js/ and a Cloudflare Functions
 * API. Opened from a local file that does not work: relative asset paths are
 * fine, but every /api/ call fails, so the board never loads and there is
 * nothing to look at.
 *
 * This inlines the stylesheet and scripts, then installs a fetch shim that
 * answers the API from the development puzzles. Same markup, same CSS, same
 * game code — only the transport is faked, so what you see is what deploys.
 *
 * ---------------------------------------------------------------------------
 * PREVIEW ONLY. NEVER UPLOAD THIS FILE.
 * The shim has to answer check-answer and reveal, so the puzzle's answers are
 * inside it. That is exactly what moving the bank to D1 removed. It carries a
 * banner and a noindex tag, it is gitignored, and it is not in the deploy zip.
 * ---------------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let html = read("index.html");
const build = (html.match(/\?v=([^"]+)"/) || [, "dev"])[1];

/* The sample puzzles are an ES module; take the object literal out of it. */
const sampleSrc = read("functions/_lib/sample-puzzles.js");
const SAMPLE = sampleSrc.slice(sampleSrc.indexOf("=") + 1).trim().replace(/;\s*$/, "");

const shim = `
/* ===================== PREVIEW SHIM — NOT FOR DEPLOYMENT =====================
   Answers the API from baked-in development puzzles so this file runs offline.
   The real site talks to Cloudflare Functions backed by D1 and never receives
   an answer it was not explicitly asked for. This file contains answers.
   ========================================================================== */
(function () {
  var SAMPLE = ${SAMPLE};
  var norm = function (s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); };

  function publicPuzzle(p) {
    var cells = {};
    Object.keys(p.cells).forEach(function (k) {
      var c = p.cells[k];
      cells[k] = { across: c.across, down: c.down, num: c.num };   // no solution letter
    });
    return {
      width: p.width, height: p.height, cells: cells, stats: p.stats,
      entries: p.entries.map(function (e) {
        return { num: e.num, dir: e.dir, x: e.x, y: e.y, len: e.len, cells: e.cells,
          row: { id: e.row.id, clue: e.row.clue, enum: e.row.enum,
                 breaks: e.row.breaks || [], cat: e.row.cat, era: e.row.era, diff: e.row.diff } };
      })
    };
  }
  function solutionString(p) {
    return Object.keys(p.cells).sort().map(function (k) { return p.cells[k].ch; }).join("");
  }
  function byToken(token) {
    var m = /^(daily|practice):(\\d+)$/.exec(String(token || ""));
    if (!m) return null;
    if (m[1] === "daily") return SAMPLE.daily[(Number(m[2]) - 1) % SAMPLE.daily.length];
    var hit = SAMPLE.practice.filter(function (p) { return String(p.rowId) === m[2]; })[0];
    return hit || SAMPLE.practice[0];
  }
  function reply(body) {
    return Promise.resolve({
      ok: true, status: 200,
      json: function () { return Promise.resolve(body); },
      headers: { get: function () { return null; } }
    });
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf("/api/") === -1) return realFetch ? realFetch(url, opts) : Promise.reject();
    var body = {};
    try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch (e) {}

    if (u.indexOf("/api/daily") === 0 || u.indexOf("/api/daily") > 0) {
      var d = SAMPLE.daily[0];
      return reply({ mode: "daily", dailyNo: 4, token: "daily:1", puzzle: publicPuzzle(d.puzzle) });
    }
    if (u.indexOf("/api/categories") !== -1) {
      var cats = [];
      SAMPLE.practice.forEach(function (p) {
        if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category);
      });
      return reply({ categories: cats.sort() });
    }
    if (u.indexOf("/api/practice") !== -1) {
      var want = (u.match(/[?&]category=([^&]*)/) || [])[1];
      var pool = SAMPLE.practice;
      if (want) {
        want = decodeURIComponent(want);
        pool = pool.filter(function (p) { return p.category === want; });
        if (!pool.length) pool = SAMPLE.practice;
      }
      var pick = pool[Math.floor(Math.random() * pool.length)];
      return reply({ mode: "practice", poolId: pick.rowId, category: pick.category || null,
                     token: "practice:" + pick.rowId, puzzle: publicPuzzle(pick.puzzle) });
    }
    if (u.indexOf("/api/check-answer") !== -1) {
      var s1 = byToken(body.token); if (!s1) return reply({ correct: false });
      var p1 = s1.puzzle;
      if (typeof body.grid === "string") {
        var want2 = norm(solutionString(p1)), got = norm(body.grid), bad = 0;
        for (var i = 0; i < want2.length; i++) if (got[i] && got[i] !== want2[i]) bad++;
        return reply(body.detail ? { correct: got === want2, wrongCells: bad, total: want2.length }
                                 : { correct: got === want2 });
      }
      var ans = norm(p1.entries[Number(body.entry)].row.grid), typed = norm(body.guess);
      var ok = typed.length === ans.length && typed === ans;
      if (!body.detail) return reply({ correct: ok });
      var wrong = [];
      for (var j = 0; j < ans.length; j++) if (typed[j] && typed[j] !== ans[j]) wrong.push(j);
      return reply({ correct: ok, wrong: wrong, length: ans.length });
    }
    if (u.indexOf("/api/reveal") !== -1) {
      var s2 = byToken(body.token); if (!s2) return reply({});
      var a = norm(s2.puzzle.entries[Number(body.entry)].row.grid);
      if (body.index === undefined || body.index === null) return reply({ entry: body.entry, answer: a });
      return reply({ entry: body.entry, index: body.index, letter: a[Number(body.index)] });
    }
    return reply({});
  };
})();
`;

/* Inline the stylesheet and scripts, dropping the ?v= tags. */
/* The analytics beacon is stripped: the preview must run from disk with no
   network, and counting a page view from a file that says "do not upload" would
   be wrong even if it worked. */
html = html.replace(
  /<script[^>]*cloudflareinsights[\s\S]*?<\/script>/g,
  "<!-- analytics removed from the preview build -->");

html = html.replace(/<link rel="stylesheet" href="css\/style\.css[^"]*">/,
  "<style>\n" + read("css/style.css") + "\n</style>");
html = html.replace(/<meta name="viewport"([^>]*)>/,
  '<meta name="viewport"$1>\n<meta name="robots" content="noindex">');

for (const f of ["seasons", "engine", "game"]) {
  const tag = new RegExp('<script src="js/' + f + '\\.js[^"]*"></script>');
  let code = read("js/" + f + ".js");
  if (f === "game") code = shim + "\n" + code;      // shim must install before the game boots
  html = html.replace(tag, "<script>\n" + code + "\n</script>");
}

const banner = `
<div style="position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#7a1f1f;color:#fff;
  font:600 11px/1.6 system-ui,sans-serif;letter-spacing:.08em;text-align:center;padding:3px 8px">
  PREVIEW BUILD ${build} &middot; ANSWERS ARE IN THIS FILE &middot; DO NOT UPLOAD
</div>`;
html = html.replace("</body>", banner + "\n</body>");

const out = path.join(ROOT, "..", `crosswordxi-preview-${build}.html`);
fs.writeFileSync(out, html);
console.log(`Wrote ${out}  (${(fs.statSync(out).size / 1024).toFixed(0)}KB, build ${build})`);
console.log("Open it in any browser. Preview only — never commit it.");
