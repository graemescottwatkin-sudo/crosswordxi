/* deploy_check.mjs — Wordsearch XI's gate.
 *
 * Crossword's 34 checks, split honestly: the general ones carried over, the
 * crossword-specific ones left behind, and the two bank checks adopted
 * AS-WRITTEN — they only became true of this game when the bank moved to D1,
 * and narrowing them to pass earlier would have made the gate lie.
 *
 * Every check corresponds to something that has happened once, here or on
 * the crossword. Counts assertions, because a gate that does not count
 * cannot tell a silent skip from a pass — v4.3's tokens check note()d for
 * every build it existed and never failed once.
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

/* What was live when this gate last let a build through. Update after every
   deployment; the tag check below refuses a build that has not moved.

   THE VERSION SCHEME (new line, starts here): vNNN with an optional minor
   letter. Major bumps by one — v001, v002 — and minors walk the alphabet
   within a major — v001a, v001b, v001c. Ordering: v001 < v001a < v001b
   < v002.

   MAINTAINED, unlike its first draft. This sat at "v000" from the day the
   game shipped: the check compared every build against nothing and could not
   fail — a tag law half-implemented is the crossword's discipline worn as a
   costume. The constants are real now and the deploy ritual bumps them, same
   as the crossword's: LAST_SHIPPED after a deploy, beside the hash of the
   bytes it names. aligned_test asserts neither game's constant is a sentinel
   and that LAST_PRESENTED is gone rather than frozen. */
const LAST_SHIPPED = "v002g";     // <- what is LIVE; bump after each deploy

t("the game has its own index.html", has("index.html"));
t("functions are shared at the repository root", hasRoot("functions/api/wordsearch/daily.js"));
t("css and js are present", has("css/style.css") && has("js/game.js"));

const html = has("index.html") ? read("index.html") : "";
/* Routes (hrefs ending in /) are the hub's and other games' addresses, not
   files in this folder — the monorepo serves them. Files must resolve. */
const refs = [...html.matchAll(/(?:src|href)="(?!data:|#|https?:|mailto:)([^"]+)"/g)]
  .map((m) => m[1].split("?")[0]).filter((r) => !r.endsWith("/"));
t("every relative file reference resolves, exact case",
  refs.every((r) => fs.existsSync(path.join(DIR, r))), refs.join(", "));

/* ---- build tag: three places, moved past live ------------------------- */
const tagHtml = (html.match(/js\/game\.js\?v=(v\d+[a-z]?)/) || [])[1] || "";
const tagCss = (html.match(/css\/style\.css\?v=(v\d+[a-z]?)/) || [])[1] || "";
const js = has("js/game.js") ? read("js/game.js") : "";
const tagJs = (js.match(/BUILD\s*=\s*"(v\d+[a-z]?)"/) || [])[1] || "";
t("the asset tags and the code agree on the build", !!tagJs && tagJs === tagHtml && tagCss === tagHtml,
  `html js=${tagHtml} css=${tagCss} code=${tagJs}`);
/* v001 -> 1.00, v001a -> 1.01, v001b -> 1.02, v002 -> 2.00 — the minor
   letter is a fraction of the major, so ordering falls out of arithmetic. */
const num = (v) => {
  const m = String(v).match(/^v(\d+)([a-z])?$/);
  if (!m) return 0;
  return parseInt(m[1], 10) + (m[2] ? (m[2].charCodeAt(0) - 96) / 100 : 0);
};
/* NEVER BACKWARDS, rather than always ahead.

   This asked for the tree's tag to be strictly AHEAD of what is live, so
   the resting state between releases — the tree is exactly what is live —
   failed it. Every commit after a post-deploy bump was red until the next
   release, on every game, including games the commit never touched. Red
   that is expected is red nobody reads, which is worse than no gate.

   Nothing is lost by allowing equal. The pairing below is the check that
   carries the law: if the bytes changed, the tag must have moved; if they
   did not, it must not have. Equal with unchanged bytes is exactly right,
   and equal with changed bytes is what that check refuses. What is left
   for this one is the thing it is now named for: a tag that goes
   backwards, which would hand a browser an old ?v= for new bytes. */
t("the build tag never goes backwards",
  num(tagJs) >= num(LAST_SHIPPED),
  `now ${tagJs}, live ${LAST_SHIPPED}`);

/* THE ASSETS MOVED BUT THE TAG DID NOT.
   v001t: a client fix was committed with the build tag left on the live
   version, so the same ?v= URL would have named different bytes — and the
   browsers holding that URL cached are exactly the devices the fix was for.
   Every existing tag check passed: they ask whether the four tags AGREE and
   whether the tag is AHEAD of LAST_SHIPPED, and both were true of a tag that
   had not moved since the last deploy. The property nobody was checking is
   the one that matters — if the bytes changed, the tag must have changed too.

   LAST_SHIPPED_ASSETS is the other half of LAST_SHIPPED: what is live is a
   tag AND the bytes it names. Both move together, in the post-deploy commit.
   On failure this prints the value to paste, because a constant that is
   laborious to update is a constant that goes stale — which is how
   LAST_SHIPPED itself ended two releases behind. */
const LAST_SHIPPED_ASSETS = "9b617b24b726f1da";
function ownAssetHash() {
  /* Discovered from the page, never a hardcoded list: an asset added to
     index.html is covered the day it is added, so this check cannot quietly
     go narrower than the page it guards. */
  const paths = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+)\?v=[^"]*"/g)]
    .map((m) => m[1]).sort();
  if (!paths.length) return null;
  const h = crypto.createHash("sha256");
  for (const p of paths) {
    if (!has(p)) return null;          // fail closed: the page names a file that is not there
    h.update(p); h.update("\0");
    /* NORMALISED TO LF FIRST. The hash is meant to describe the bytes that
       SHIP, and what ships is what is in git — LF. On a Windows checkout the
       same file is CRLF in the working tree, so the hash depended on which
       tool last wrote the file: a plain `git checkout` of an untouched file
       turned every one of these gates red for a change nobody had made.
       All five places that compute this hash normalise, or they cannot
       agree. */
    h.update(fs.readFileSync(path.join(DIR, p), "utf8").replace(/\r\n/g, "\n"));
  }
  return h.digest("hex").slice(0, 16);
}
const assetsNow = ownAssetHash();
const tagNow = tagJs;
t("the game's own assets cannot change without its build tag moving",
  !!assetsNow && (assetsNow === LAST_SHIPPED_ASSETS || tagNow !== LAST_SHIPPED),
  assetsNow === LAST_SHIPPED_ASSETS
    ? "unchanged since " + LAST_SHIPPED
    : tagNow !== LAST_SHIPPED
      ? "changed, and the tag moved " + LAST_SHIPPED + " -> " + tagNow
      : "CHANGED with the tag still on " + tagNow +
        " — bump the tag, then set LAST_SHIPPED_ASSETS to " + assetsNow);

/* ---- markup sanity ---------------------------------------------------- */
t("HTML comments are balanced, so none can render as text",
  (html.match(/<!--/g) || []).length === (html.match(/-->/g) || []).length,
  `${(html.match(/<!--/g) || []).length} open, ${(html.match(/-->/g) || []).length} close`);
t("every <div> is closed, so no panel ends up inside another",
  (html.match(/<div\b/g) || []).length === (html.match(/<\/div>/g) || []).length,
  `${(html.match(/<div\b/g) || []).length} open, ${(html.match(/<\/div>/g) || []).length} close`);
const css = has("css/style.css") ? read("css/style.css") : "";
t("the stylesheet's braces and comments balance",
  (css.match(/{/g) || []).length === (css.match(/}/g) || []).length &&
  (css.match(/\/\*/g) || []).length === (css.match(/\*\//g) || []).length,
  `${(css.match(/{/g) || []).length} braces`);

/* ---- one H1, and it is the first heading in the body ------------------ */
/* Comments stripped before anything counts tags. The family template documents
   the identity rule in a comment containing the text <h1>, and a gate counting
   raw markup reads that as a second heading — it fails a correct page. The
   crossword gate already strips for its <div> count; this one did not. */
t("exactly one H1, before any other heading", (() => {
  const m = html.replace(/<!--[\s\S]*?-->/g, "");
  return (m.match(/<h1\b/g) || []).length === 1 && m.indexOf("<h1") < m.indexOf("<h2");
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
t("the unofficial-game disclaimer is present", /[Uu]nofficial/.test(html));

/* ---- noindex matches the address the page claims ---------------------- */
/* Adopted from the crossword verbatim in spirit: derive the expectation from
   og:url rather than asking robots and headers merely to agree with each
   other — both can be wrong together, and were. */
t("noindex matches the address the page claims", (() => {
  if (!hasRoot("_headers")) return true;
  const url = (html.match(/property="og:url"\s+content="([^"]+)"/) || [])[1] || "";
  /* www is the canonical host, not a staging subdomain — the crossword's
     version of this check reads www as a subdomain and is satisfied by the
     /api/* noindex, two faults cancelling. Corrected here: only non-www
     hosts count, and only a global noindex (one outside any /api/ block)
     counts as blocking. */
  const onSubdomain = /:\/\/(?!www\.)[a-z0-9-]+\.thexigames\.com/.test(url);
  /* Comments stripped first: the family _headers documents this very rule in
     a comment, and a gate that reads a comment as a live header fails a
     correct file. Only rule lines count. */
  const rules = readRoot("_headers").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const global = rules.split(/^\/api\//m)[0];
  const noindexed = /X-Robots-Tag:\s*noindex/i.test(global);
  return onSubdomain === noindexed;
})());

/* ---- cache rules under THIS game's path ------------------------------- */
const GAME = path.basename(DIR);
t(`css and js have immutable cache rules under /${GAME}/`, (() => {
  if (!hasRoot("_headers")) return false;
  const h = readRoot("_headers");
  return new RegExp(`^/${GAME}/css/\\*`, "m").test(h) && new RegExp(`^/${GAME}/js/\\*`, "m").test(h);
})(), `/${GAME}/css/* and /${GAME}/js/*`);
t(`the game's index.html is never stored`, (() => {
  if (!hasRoot("_headers")) return false;
  const h = readRoot("_headers");
  const i = h.indexOf(`/${GAME}/index.html`);
  return i > -1 && /Cache-Control:\s*no-store/.test(h.slice(i, i + 120));
})());

/* ---- the shared token layer, finally enforced ------------------------- */
const EXPECTED_TOKENS = "v1";
t(`xi-tokens.css exists in shared/ and is ${EXPECTED_TOKENS}`, (() => {
  if (!hasRoot("shared/xi-tokens.css")) return false;
  const m = readRoot("shared/xi-tokens.css").match(/xi-tokens\.css\s*—\s*(v\d+)/);
  return !!m && m[1] === EXPECTED_TOKENS;
})());
t("the page references the shared tokens rather than carrying a copy",
  /shared\/xi-tokens\.css/.test(html) && !/--paper\s*:/.test(css),
  "palette variables must not be restated in the game's stylesheet");

/* ---- the bank stays out of the page ----------------------------------- */
/* The two crossword checks this game could not honestly run until now. */
t("no puzzle bank in any public file", (() => {
  for (const f of ["index.html", "js/game.js", "css/style.css"]) {
    if (has(f) && /DAILY_SCHEDULE|const PUZZLES\s*=\s*\[/.test(read(f))) return false;
  }
  return true;
}), "the schedule shipping to the browser is the fault this rebuild retires");
t("no answers or placements in any public file", (() => {
  for (const f of ["index.html", "js/game.js"]) {
    if (has(f) && /"start_row"|start_row:/.test(read(f).replace(/placementCells|pl\.start_row/g, ""))) return false;
  }
  return true;
}));
t("generated production SQL is gitignored and absent from the game folder", (() => {
  const gi = hasRoot(".gitignore") ? readRoot(".gitignore") : "";
  return /ws-production\.sql|\*-production\.sql/.test(gi) && !has("ws-production.sql");
})());

/* ---- functions parse as the Pages bundler parses them ----------------- */
/* RUN-ME v154: the fault 547 green assertions never saw, because no local
   suite imported the file that would not bundle. Parse every one. */
const fnDir = path.join(ROOT, "functions");
const fnFiles = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p) : /\.js$/.test(f) && fnFiles.push(p);
  }
})(fnDir);
let parseFails = [];
/* node --check per file: what the workflow runs, and closer to the Pages
   bundler than any regex. */
for (const f of fnFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { parseFails.push(path.relative(ROOT, f)); }
}
t("every Functions file parses", parseFails.length === 0,
  parseFails.join(", ") || `${fnFiles.length} files`);
t("every wordsearch import resolves to something the target exports", (() => {
  for (const f of fnFiles.filter((x) => x.includes("wordsearch") || x.includes("ws-"))) {
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

/* ---- the coordinate convention, held forever -------------------------- */
/* The source bank's placements are 1-based; the family speaks 0-based, and
   the conversion happens once, at import. This check spells every sample
   word off its grid at base 0 — the exact fault that cost this build its
   only red run cannot come back quietly. */
t("sample placements spell their words at base 0", (() => {
  try {
    const src = fs.readFileSync(path.join(ROOT, "functions/_lib/ws-sample.js"), "utf8");
    const m = src.match(/SAMPLE_PUZZLES = (\[[\s\S]*?\]);\n/);
    const boards = JSON.parse(m[1]);
    const D = { E:[0,1],W:[0,-1],S:[1,0],N:[-1,0],SE:[1,1],SW:[1,-1],NE:[-1,1],NW:[-1,-1] };
    for (const b of boards) for (const a of b.answers.concat([b.bonus])) {
      const pl = a.placement, dd = D[pl.direction];
      let word = "";
      for (let k = 0; k < a.grid.length; k++) {
        const r = pl.start_row + dd[0] * k, c = pl.start_col + dd[1] * k;
        if (r < 0 || r >= 14 || c < 0 || c >= 12) return false;
        word += b.grid[r][c];
      }
      if (word !== a.grid) return false;
    }
    return boards.length === 3;
  } catch (e) { return false; }
})());

/* ---- hygiene ---------------------------------------------------------- */
t("no node_modules in the game folder", !has("node_modules"));
/* THE ROOT TOO. This gate passed with a .wrangler directory sitting in the
   repository root — a local dev server's state — while the other two gates
   refused. Pages must not build and must not upload tool state, and the rule
   is the family's, so the check is. Watched failing with a .wrangler present. */
for (const junk of ["node_modules", "package.json", "package-lock.json", ".wrangler"]) {
  t(`no ${junk} in the repository root`, !hasRoot(junk));
}
t("no absolute or machine-specific paths",
  !/\/home\/|\/Users\/|C:\\\\/.test(html + js + css));
t("API calls use relative URLs", !/fetch\("https?:\/\//.test(js));
t("no forbidden files in the game folder", (() => {
  const FORBIDDEN = [/\.xlsx?$/i, /\.sql$/i, /\.zip$/i, /preview.*\.html$/i, /bank.*\.json$/i];
  return fs.readdirSync(DIR).every((f) => !FORBIDDEN.some((re) => re.test(f)));
})());

/* ---- report ----------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
