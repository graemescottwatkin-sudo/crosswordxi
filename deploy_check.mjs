/* deploy_check.mjs — the pre-upload checklist from the deployment standard,
   §12, run rather than eyeballed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const has = (f) => fs.existsSync(path.join(DIR, f));

t("index.html is at the repository root", has("index.html"));
t("functions/ is at the repository root", has("functions/api/daily.js"));
t("css and js are present", has("css/style.css") && has("js/game.js") && has("js/engine.js"));

const html = read("index.html");
const refs = [...html.matchAll(/(?:src|href)="(?!data:|#|https?:|mailto:)([^"]+)"/g)]
  .map((m) => m[1].split("?")[0]);   // drop the cache-busting ?v= tag
t("every relative reference resolves, exact case", refs.every(has), refs.join(", "));

/* The bug this guards against: index.html revalidated but css/ and js/ had no
   cache rule, so browsers served stale assets after a deploy and the site
   looked unchanged however many times it was uploaded. */
const headers = read("_headers");
t("css and js have cache rules, not just the HTML",
  /\/css\/\*/.test(headers) && /\/js\/\*/.test(headers));
t("index.html is never stored, so a player cannot be pinned to an old build", (() => {
  // A stale index.html names stale asset URLs, so the ?v= tags cannot rescue it.
  const html = headers.slice(headers.indexOf("/index.html"));
  return /Cache-Control: no-store/.test(html.split("\n").slice(0, 3).join("\n"));
})());
t("asset URLs carry a build tag so a cached copy cannot be reused", (() => {
  const tagged = [...html.matchAll(/(?:src|href)="(?:css|js)\/[^"?]+\?v=([^"]+)"/g)].map((m) => m[1]);
  const assets = [...html.matchAll(/(?:src|href)="(?:css|js)\/[^"]+"/g)].length;
  return tagged.length === assets && new Set(tagged).size === 1;
})());
/* The tag has to have MOVED, not merely be consistent.

   V54 to V58 all shipped tagged v50: the packaging step copied files from a
   working folder still on v50 and then ran a find-and-replace for the previous
   version, which matched nothing. Every check below passed, because all three
   places agreed — they just agreed on the wrong number. Worse, ?v=v50 is a URL
   browsers had genuinely cached when v50 was live, so the old script was served
   back and the site looked unchanged.

   LAST_SHIPPED is the version that is live now. Bump it when you deploy. */
const LAST_SHIPPED = "v88";   // <- bump this after each deploy
t("the build tag has moved past the version now live",
  (() => {
    const now = (html.match(/<span id="buildTag">([^<]+)</) || [])[1] || "";
    const n = (v) => parseInt(String(v).replace(/\D/g, ""), 10);
    return !!now && n(now) > n(LAST_SHIPPED);
  })(),
  `now ${(html.match(/<span id="buildTag">([^<]+)</) || [])[1]}, live ${LAST_SHIPPED}`);

t("the build tag matches the one the script reports",
  read("js/game.js").includes('var BUILD = "' + (html.match(/\?v=([^"]+)"/) || [])[1] + '"'),
  (html.match(/\?v=([^"]+)"/) || [])[1]);
/* A comment that lost its opening marker renders as page content. It happened:
   moving a block cut the "<!--" and left the "-->" behind, and three lines of
   explanation about board width appeared on the live site above the puzzle.
   Cheap to check, invisible until someone looks at the page. */
t("HTML comments are balanced, so none of them can render as text", (() => {
  const html = read("index.html");
  return (html.match(/<!--/g) || []).length === (html.match(/-->/g) || []).length;
})(), (read("index.html").match(/<!--/g) || []).length + " open, " +
      (read("index.html").match(/-->/g) || []).length + " close");

/* Nesting, not just comment markers. Moving the league table left grid-wrap
   and .grid-panel unclosed and the toolbar carrying a stray closing tag — so
   the season panel rendered inside the board and the clue lists inside the
   board column. The page still displayed, because browsers repair broken
   markup silently, which is exactly why nothing caught it for three builds. */
t("every <div> is closed, so no panel can end up inside another", (() => {
  const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
  return (html.match(/<div\b/g) || []).length === (html.match(/<\/div>/g) || []).length;
})(), (() => {
  const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
  return (html.match(/<div\b/g) || []).length + " open, " +
         (html.match(/<\/div>/g) || []).length + " close";
})());

/* The same check for the stylesheet. One unclosed brace silently swallows
   every rule after it, and the page renders with no styling at all — which is
   exactly what shipped once, while the preview suite reported 10 of 10 because
   it checks behaviour and never asks whether the CSS parsed. */
t("the stylesheet's braces and comments balance", (() => {
  const css = read("css/style.css");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return (bare.match(/\{/g) || []).length === (bare.match(/\}/g) || []).length &&
         (css.match(/\/\*/g) || []).length === (css.match(/\*\//g) || []).length;
})(), (() => {
  const bare = read("css/style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  return (bare.match(/\{/g) || []).length + " open, " +
         (bare.match(/\}/g) || []).length + " close";
})());

/* wrangler pages dev leaves a .wrangler scratch directory holding a compiled
   bundle of every Function. It is not secret, but it is a second copy of the
   server code shipped as a static asset, and it reached a package once. */
/* A Functions file cannot sit beside a directory of the same name: the route
   resolves to the directory, finds no index, and answers 404 — for an endpoint
   that exists and works. It cost a challenge that had just been created. */
t("no Functions file collides with a directory of the same name", (() => {
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(path.join(DIR, dir), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name)));
      else if (e.name.endsWith(".js")) out.push(path.join(dir, e.name));
    }
    return out;
  };
  if (!has("functions")) return true;
  return !walk("functions").some((f) =>
    has(f.replace(/\.js$/, "")) &&
    fs.statSync(path.join(DIR, f.replace(/\.js$/, ""))).isDirectory());
})());

t("no local build scratch in the package", !has(".wrangler"));

t("no absolute or machine-specific paths",
  !/localhost/.test(html) && !/file:\/\//.test(html) && !/[A-Za-z]:\\/.test(html) &&
  !/(src|href)="\//.test(html));

const all = ["index.html", "css/style.css", "js/game.js", "js/seasons.js"].map(read).join("\n");
/* Match data, not the word. `FCW_DATA` appears in a comment explaining why the
   bank is gone, and footballPhrase("answer", ...) is a label — neither is a
   clue bank, and a check that flags them teaches you to ignore it. */
t("the clue bank is not in any public file",
  !/FCW_DATA\s*=/.test(all) && !/"answer"\s*:\s*"/.test(all) &&
  !/"clue"\s*:\s*"/.test(all));
t("no solution letters in any public file", !/"ch"\s*:\s*"[A-Z]"/.test(all));
t("the sample dataset is server-only, not under data/",
  has("functions/_lib/sample-puzzles.js") && !has("data/sample-puzzles.js"));
t("API calls use relative URLs", /fetch\(/.test(read("js/game.js")) &&
  !/https?:\/\/[^"']*\/api\//.test(read("js/game.js")));

const ignore = read(".gitignore");
t("generated answer files are gitignored",
  /clues-production\.sql/.test(ignore) && /puzzles-production\.sql/.test(ignore));
t("no production SQL is present in the package",
  !has("data/clues-production.sql") && !has("data/puzzles-production.sql"));
t("no secrets are committed", !has(".env") && !has(".dev.vars") &&
  !/(api[_-]?key|password|secret)\s*[:=]\s*["'][^"']{8,}/i.test(all));
t("no node_modules in the package", !has("node_modules"));
t("no preview build is in the package", (() => {
  // A preview inlines the answers so it can run from disk. It must never reach
  // the repository, which is what the whole D1 move was for.
  return !fs.readdirSync(DIR).some((f) => /^crosswordxi-preview-.*\.html$/.test(f)) &&
    /crosswordxi-preview-\*\.html/.test(read(".gitignore"));
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
