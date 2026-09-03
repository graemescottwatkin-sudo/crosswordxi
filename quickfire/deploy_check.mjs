/* deploy_check.mjs — QuickFire XI's gate.
 *
 * Carried over from the word search's, split honestly. The general checks come
 * across unchanged. The word-search-specific ones — the base-0 placement proof,
 * the ws- import resolver, the production SQL rule — are left behind rather
 * than reworded into something that passes here without meaning anything.
 *
 * Four checks are this game's own, and each one exists because of something
 * that has already happened during its build:
 *
 *   - the eleven rule, stated once. The scoring maximum, the questions per
 *     Daily and the bench size are one constant each, in js/config.js. A second
 *     copy in game.js is the one-fact-two-places fault that has cost this
 *     family a season table, a version string and a set of entrant keys.
 *   - no answers in the page. The bank lives in D1 and arrives from
 *     /api/quickfire/daily. This game has never shipped a schedule and must not
 *     acquire one.
 *   - the test hooks are guarded. QFX_TEST_REVEAL and QFX_TEST_ANSWER are how
 *     the jsdom suite drives the clock. On the live host they would be a cheat
 *     button, so they are defined only off it.
 *   - the answer row is the input. The board fixes the character count, so an
 *     alias of a different length can never be typed. A check on the client is
 *     not enough — the gate on the export refuses those rows — but the client
 *     must not claim to accept one either.
 *
 * Counts assertions, because a gate that does not count cannot tell a silent
 * skip from a pass.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, "..");
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const has = (f) => fs.existsSync(path.join(DIR, f));
const readRoot = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const hasRoot = (f) => fs.existsSync(path.join(ROOT, f));

/* What was live when this gate last let a build through. Both constants move
   together, in the post-deploy commit. vNNN with an optional minor letter;
   v001 < v001a < v001b < v002.

   NOT a sentinel. The word search's sat at "v000" from the day it shipped and
   the tag check compared every build against nothing — a tag law worn as a
   costume. QuickFire has never deployed, so this is the tag BELOW its first
   release rather than a placeholder: v001 is the first build that can pass. */
const LAST_SHIPPED = "v000z";
const LAST_SHIPPED_ASSETS = "0000000000000000";   // set after the first deploy

t("the game has its own index.html", has("index.html"));
t("functions are shared at the repository root", hasRoot("functions/api/quickfire/daily.js"));
t("css and js are present", has("css/style.css") && has("js/game.js"));

const html = has("index.html") ? read("index.html") : "";
const refs = [...html.matchAll(/(?:src|href)="(?!data:|#|https?:|mailto:)([^"]+)"/g)]
  .map((m) => m[1].split("?")[0]).filter((r) => !r.endsWith("/"));
t("every relative file reference resolves, exact case",
  refs.every((r) => fs.existsSync(path.join(DIR, r))),
  refs.filter((r) => !fs.existsSync(path.join(DIR, r))).join(", ") || `${refs.length} refs`);

/* ---- build tag: every asset, and the code ----------------------------- */
/* Discovered from the page, never a hardcoded list. This game loads seven of
   its own scripts, not one, so a check written for a single game.js would pass
   while six files carried a stale tag. */
const ownAssets = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+)\?v=(v\d+[a-z]?)"/g)]
  .map((m) => ({ file: m[1], tag: m[2] }));
const js = has("js/game.js") ? read("js/game.js") : "";
const tagJs = (js.match(/BUILD\s*=\s*"(v\d+[a-z]?)"/) || [])[1] || "";
const tags = [...new Set(ownAssets.map((a) => a.tag))];
t("every one of the game's own assets carries the same tag as the code",
  ownAssets.length >= 2 && tags.length === 1 && !!tagJs && tags[0] === tagJs,
  `${ownAssets.length} assets, tags ${tags.join("/") || "none"}, code ${tagJs || "none"}`);

const num = (v) => {
  const m = String(v).match(/^v(\d+)([a-z])?$/);
  if (!m) return 0;
  return parseInt(m[1], 10) + (m[2] ? (m[2].charCodeAt(0) - 96) / 100 : 0);
};
/* NEVER BACKWARDS, rather than always ahead — the same change the other four
   gates took. Strictly-ahead made the resting state between releases red, on
   every game, including games a commit never touched. The asset pairing below
   is what carries the law. */
t("the build tag never goes backwards",
  num(tagJs) >= num(LAST_SHIPPED), `now ${tagJs}, live ${LAST_SHIPPED}`);

function ownAssetHash() {
  const paths = ownAssets.map((a) => a.file).sort();
  if (!paths.length) return null;
  const h = crypto.createHash("sha256");
  for (const p of paths) {
    if (!has(p)) return null;
    h.update(p); h.update("\0");
    /* Normalised to LF, as in the other four: the hash describes the bytes
       that ship, and a Windows checkout writes the same file with CRLF. */
    h.update(fs.readFileSync(path.join(DIR, p), "utf8").replace(/\r\n/g, "\n"));
  }
  return h.digest("hex").slice(0, 16);
}
const assetsNow = ownAssetHash();
t("the game's own assets cannot change without its build tag moving",
  !!assetsNow && (assetsNow === LAST_SHIPPED_ASSETS || tagJs !== LAST_SHIPPED),
  assetsNow === LAST_SHIPPED_ASSETS
    ? "unchanged since " + LAST_SHIPPED
    : tagJs !== LAST_SHIPPED
      ? "changed, and the tag moved " + LAST_SHIPPED + " -> " + tagJs
      : "CHANGED with the tag still on " + tagJs +
        " — bump the tag, then set LAST_SHIPPED_ASSETS to " + assetsNow);

/* EVERY FILE IN THE GAME FOLDER IS ON THE PAGE.
   js/board_file.js was written, dropped into js/, and never given a <script>
   tag. Nothing caught it: the reference check asks whether the files the page
   NAMES exist, which is the opposite question. The game would have loaded, and
   died on the first fetch with QFXBoardFile undefined. Both directions are
   checked now — an orphan is dead weight shipped forever, a missing tag is a
   broken page. */
t("every css and js file in the folder is loaded by the page", (() => {
  const named = new Set(ownAssets.map((a) => a.file));
  const onDisk = [];
  for (const d of ["css", "js"]) {
    if (!has(d)) continue;
    for (const f of fs.readdirSync(path.join(DIR, d))) {
      if (/\.(css|js)$/.test(f)) onDisk.push(`${d}/${f}`);
    }
  }
  const orphans = onDisk.filter((f) => !named.has(f));
  const missing = [...named].filter((f) => !onDisk.includes(f));
  if (orphans.length || missing.length) {
    console.log(`        orphans: ${orphans.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}`);
    return false;
  }
  return true;
})());

/* EVERY ID THE SCRIPT LOOKS UP EXISTS IN THE MARKUP.
   The sibling of the orphan check above, and it bit the same day: the masthead
   moved into the shared bar, #dailyDate went with it, and game.js kept asking
   for it — a null dereference inside a promise, which surfaces as "could not
   load the board" and blames the endpoint. Cheap to check, impossible to spot
   by reading. */
t("every element id the script looks up is in the page", (() => {
  const listed = js.match(/\[([^\]]*?)\]\.forEach\(function \(id\)/s);
  if (!listed) return false;
  const ids = (listed[1].match(/'([A-Za-z]+)'/g) || []).map((s) => s.replace(/'/g, ""));
  const present = new Set((html.match(/id="([^"]+)"/g) || []).map((s) => s.slice(4, -1)));
  const missing = ids.filter((id) => !present.has(id));
  if (missing.length) console.log("        missing: " + missing.join(", "));
  return ids.length > 0 && missing.length === 0;
})());

/* ---- identity: one name, four places ---------------------------------- */
const NAME = "QuickFire XI";
t("title, og:title, JSON-LD and h1 agree on the name", (() => {
  /* Split the way tools/aligned_test.mjs splits, so the two cannot disagree
     about what the name is: everything before the first dash or pipe. */
  const grab = (re) => ((html.match(re) || [])[1] || "")
    .split(/&mdash;|&ndash;|—|–|\|/)[0].trim();
  const title = grab(/<title>([^<]+)<\/title>/);
  const og = grab(/property="og:title" content="([^"]+)"/);
  const ld = grab(/"name":\s*"([^"]+)"/);
  const h1 = grab(/<h1[^>]*>([^<]+)<\/h1>/);
  return [title, og, ld, h1].every((n) => n === NAME);
})(), NAME);

/* ---- markup sanity ---------------------------------------------------- */
t("HTML comments are balanced, so none can render as text",
  (html.match(/<!--/g) || []).length === (html.match(/-->/g) || []).length,
  `${(html.match(/<!--/g) || []).length} open, ${(html.match(/-->/g) || []).length} close`);
/* Comments stripped before anything counts tags. The family template's own
   index.html documents the identity rule in a comment that contains the text
   <h1>, and a gate counting raw markup reads that as a second heading — it
   fails the template as shipped. Third time this codebase has learned that a
   check must read rules, not the prose describing them. */
const markup = html.replace(/<!--[\s\S]*?-->/g, "");
t("every <div> is closed, so no panel ends up inside another",
  (markup.match(/<div\b/g) || []).length === (markup.match(/<\/div>/g) || []).length,
  `${(markup.match(/<div\b/g) || []).length} open, ${(markup.match(/<\/div>/g) || []).length} close`);
const css = has("css/style.css") ? read("css/style.css") : "";
t("the stylesheet's braces and comments balance",
  (css.match(/{/g) || []).length === (css.match(/}/g) || []).length &&
  (css.match(/\/\*/g) || []).length === (css.match(/\*\//g) || []).length,
  `${(css.match(/{/g) || []).length} braces`);
t("exactly one H1, before any other heading",
  (markup.match(/<h1\b/g) || []).length === 1 &&
  (markup.indexOf("<h2") === -1 || markup.indexOf("<h1") < markup.indexOf("<h2")),
  `${(markup.match(/<h1\b/g) || []).length} h1`);

/* The shared footer at top level. The crossword's sat inside its home overlay
   and left the screen the moment a board opened. */
t("the shared footer is at top level, not inside a view container", (() => {
  const i = markup.indexOf('<footer class="xic-foot"');
  if (i === -1) return false;
  const before = markup.slice(0, i);
  return (before.match(/<div\b/g) || []).length === (before.match(/<\/div>/g) || []).length;
})());

/* ---- SEO surface ------------------------------------------------------ */
t("canonical, og:url and JSON-LD agree on the address", (() => {
  const canon = (html.match(/rel="canonical"\s+href="([^"]+)"/) || [])[1];
  const og = (html.match(/property="og:url"\s+content="([^"]+)"/) || [])[1];
  try {
    const ld = JSON.parse((html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]);
    return !!canon && canon === og && ld.url === canon;
  } catch (e) { return false; }
})());
t("og:image and summary_large_image are declared",
  /og:image/.test(html) && /summary_large_image/.test(html));
/* The disclaimer is a FAMILY sentence, declared once in the shared chrome's
   footer and mounted by every game. Grepping this page for it fails for the
   right reason: the sentence is not in the page, and must not be. */
t("the page mounts the shared footer that carries the disclaimer",
  /class="xic-foot"/.test(html) &&
  (!hasRoot("shared/xi-chrome.js") || /Not affiliated with/.test(readRoot("shared/xi-chrome.js"))));

/* ---- noindex matches the address the page claims ---------------------- */
t("noindex matches the address the page claims", (() => {
  if (!hasRoot("_headers")) return true;
  const url = (html.match(/property="og:url"\s+content="([^"]+)"/) || [])[1] || "";
  const onSubdomain = /:\/\/(?!www\.)[a-z0-9-]+\.thexigames\.com/.test(url);
  const rules = readRoot("_headers").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const global = rules.split(/^\/api\//m)[0];
  return onSubdomain === /X-Robots-Tag:\s*noindex/i.test(global);
})());

/* ---- cache rules under THIS game's path ------------------------------- */
const GAME = path.basename(DIR);
t(`css and js have immutable cache rules under /${GAME}/`, (() => {
  if (!hasRoot("_headers")) return false;
  const h = readRoot("_headers");
  return new RegExp(`^/${GAME}/css/\\*`, "m").test(h) && new RegExp(`^/${GAME}/js/\\*`, "m").test(h);
})(), `/${GAME}/css/* and /${GAME}/js/*`);
t("the game's index.html is never stored", (() => {
  if (!hasRoot("_headers")) return false;
  const h = readRoot("_headers");
  const i = h.indexOf(`/${GAME}/index.html`);
  return i > -1 && /Cache-Control:\s*no-store/.test(h.slice(i, i + 120));
})());

/* ---- the shared layers ------------------------------------------------ */
const EXPECTED_TOKENS = "v1";
t(`xi-tokens.css exists in shared/ and is ${EXPECTED_TOKENS}`, (() => {
  if (!hasRoot("shared/xi-tokens.css")) return false;
  const m = readRoot("shared/xi-tokens.css").match(/xi-tokens\.css\s*—\s*(v\d+)/);
  return !!m && m[1] === EXPECTED_TOKENS;
})());
t("the page references the shared tokens rather than carrying a copy",
  /shared\/xi-tokens\.css/.test(html) && !/--paper\s*:/.test(css),
  "palette variables must not be restated in the game's stylesheet");
/* Comments stripped first. The stylesheet's own header explains this rule, and
   a gate that reads its own documentation as a violation fails a correct file —
   the same fault the family _headers check had to learn. */
t("the game styles no shared chrome",
  !/\.xic-/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
  "the bar, drawer and footer belong to xi-chrome.css");
t("the shared chrome is referenced, not copied",
  /shared\/xi-chrome\.css/.test(html) && /shared\/xi-chrome\.js/.test(html) &&
  !has("css/xi-chrome.css") && !has("js/xi-chrome.js"));

/* ---- the bank stays out of the page ----------------------------------- */
/* This game never shipped a schedule. These checks are here so it cannot start:
   a board arrives from /api/quickfire/daily and nowhere else. */
const publicFiles = ["index.html", "css/style.css",
  ...ownAssets.map((a) => a.file)].filter((f, i, a) => a.indexOf(f) === i);
t("no board, bank or schedule in any public file", (() => {
  for (const f of publicFiles) {
    if (!has(f)) continue;
    const src = read(f);
    if (/DAILY_SCHEDULE|QFX_DATA\s*=\s*{|const\s+(?:BANK|QUESTIONS|PUZZLES)\s*=\s*\[/.test(src)) return false;
  }
  return true;
})(), "the questions arrive from D1 at run time");
t("no answers in any public file", (() => {
  for (const f of publicFiles) {
    if (!has(f)) continue;
    /* "answer" as a property name is the engine doing its job; an ARRAY of
       answer strings is a bank. Only the latter is a leak. */
    if (/answers?\s*:\s*\[\s*["']/.test(read(f))) return false;
  }
  return true;
})());
/* The same rule the word search learned: the generated import contains every
   answer, so it is gitignored and never lives beside the game. */
t("generated production SQL is gitignored and absent from the game folder", (() => {
  const gi = hasRoot(".gitignore") ? readRoot(".gitignore") : "";
  return /qf-production\.sql|\*-production\.sql/.test(gi) && !has("qf-production.sql");
})());

t("no bank file lives beside the game", (() => {
  /* The prototype's single-file build and the old static board.json both
     carried a whole board. Neither belongs here — the questions come from the
     endpoint, and a file in this folder would be served. */
  return !has("quickfire-xi-standalone.html") && !has("data");
})(), "the questions come from the endpoint, not from a file in this folder");

/* ---- this game's own rules -------------------------------------------- */
const config = has("js/config.js") ? read("js/config.js") : "";
t("the eleven rule is stated once", (() => {
  const perDaily = (config.match(/QUESTIONS_PER_DAILY:\s*(\d+)/) || [])[1];
  if (perDaily !== "11") return false;
  /* A literal 11 in the engine, other than through CONFIG, is a second copy of
     the rule the whole family is named after. */
  const bare = js.match(/(?:length|count|slots?)\s*(?:===|!==|<|>)\s*11\b/);
  return !bare;
})(), "QUESTIONS_PER_DAILY in js/config.js, and nowhere else");
t("the scoring maximum is derived, not written down twice",
  /SCORE_BANDS\.reduce/.test(js) && !/\b1100\b/.test(js),
  "the maximum comes from the bands, so changing a band cannot leave it stale");
t("the test hooks are defined off the live host only",
  /IS_LIVE\s*=\s*location\.hostname\s*===\s*'www\.thexigames\.com'/.test(js) &&
  /QFX_TEST_REVEAL\s*=\s*IS_LIVE\s*\?\s*undefined/.test(js) &&
  /QFX_TEST_ANSWER\s*=\s*IS_LIVE\s*\?\s*undefined/.test(js),
  "on the live host they would be a cheat button");
t("the board is fetched with the family CSRF header, relatively",
  /X-XI-Games/.test(js) && /\/api\/quickfire\/daily/.test(js) &&
  !/fetch\("https?:\/\//.test(js));
t("progress is stored under this game's own prefix", (() => {
  const keys = [...js.matchAll(/(?:setItem|getItem|removeItem)\(([^,)]+)/g)].map((m) => m[1]);
  if (!keys.length) return false;
  /* The namespace is PREFIX in game.js — the same place tools/aligned_test.mjs
     reads it from, because two checks resolving it differently is how a rule
     ends up true in one gate and a costume in the other. */
  const prefix = (js.match(/var PREFIX = "([^"]+)"/) || [])[1] || "";
  if (prefix !== "qfx.") return false;
  /* And no literal key belonging to a sibling. The word search wrote the theme
     under the crossword's prefix for months. */
  return !/["'](?:fcw|xiws|xic)\./.test(js);
})(), "writing another game's prefix is what this check refuses");

/* ---- functions parse as the Pages bundler parses them ----------------- */
const fnDir = path.join(ROOT, "functions");
const fnFiles = [];
if (fs.existsSync(fnDir)) {
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      fs.statSync(p).isDirectory() ? walk(p) : /\.js$/.test(f) && fnFiles.push(p);
    }
  })(fnDir);
}
const parseFails = [];
for (const f of fnFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { parseFails.push(path.relative(ROOT, f)); }
}
t("every Functions file parses", parseFails.length === 0,
  parseFails.join(", ") || `${fnFiles.length} files`);
t("every quickfire import resolves to something the target exports", (() => {
  for (const f of fnFiles.filter((x) => x.includes("quickfire") || x.includes("qf"))) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/import\s*{([^}]+)}\s*from\s*"([^"]+)"/g)) {
      const target = path.resolve(path.dirname(f), m[2]);
      if (!fs.existsSync(target)) return false;
      const tsrc = fs.readFileSync(target, "utf8");
      for (const name of m[1].split(",").map((s) => s.trim().split(" as ")[0])) {
        if (!new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b`).test(tsrc)) return false;
      }
    }
  }
  return true;
})());
t("the daily endpoint has no sample fallback", (() => {
  const f = path.join(ROOT, "functions/api/quickfire/daily.js");
  if (!fs.existsSync(f)) return false;
  const src = fs.readFileSync(f, "utf8");
  return !/SAMPLE|sample/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")) &&
    /503/.test(src);
})(), "an unbound binding must look broken, not like a working game");

/* ---- hygiene ---------------------------------------------------------- */
t("no node_modules in the game folder", !has("node_modules"));
t("no absolute or machine-specific paths",
  !/\/home\/|\/Users\/|C:\\\\/.test(html + js + css));
t("API calls use relative URLs", !/fetch\("https?:\/\//.test(js));
t("no forbidden files in the game folder", (() => {
  const FORBIDDEN = [/\.xlsx?$/i, /\.sql$/i, /\.zip$/i, /preview.*\.html$/i, /bank.*\.json$/i,
                     /standalone.*\.html$/i];
  return fs.readdirSync(DIR).every((f) => !FORBIDDEN.some((re) => re.test(f)));
})());

/* ---- report ----------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
