/* deploy_check.mjs — the pre-upload checklist from the deployment standard,
   §12, run rather than eyeballed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
/* Two roots now, and the difference is the point.

   DIR is this game's folder — its own index.html, css and js. ROOT is the
   repository, which holds what every game shares: functions/, data/, _headers
   and the redirects. Before the move the two were the same directory and
   nothing distinguished a file the crossword owns from one the family shares.
   Reading them through different helpers means a check has to say which it
   means, and a shared file cannot be quietly duplicated into one game. */
const ROOT = path.join(DIR, "..");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const has = (f) => fs.existsSync(path.join(DIR, f));
const readRoot = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const hasRoot = (f) => fs.existsSync(path.join(ROOT, f));

t("the game has its own index.html", has("index.html"));
t("functions/ is at the repository root, shared", hasRoot("functions/api/daily.js"));
t("the hub is at the repository root", hasRoot("index.html"));
t("css and js are present", has("css/style.css") && has("js/game.js") && has("js/engine.js"));

const html = read("index.html");
const refs = [...html.matchAll(/(?:src|href)="(?!data:|#|https?:|mailto:)([^"]+)"/g)]
  .map((m) => m[1].split("?")[0]);   // drop the cache-busting ?v= tag
t("every relative reference resolves, exact case", refs.every(has), refs.join(", "));

/* The bug this guards against: index.html revalidated but css/ and js/ had no
   cache rule, so browsers served stale assets after a deploy and the site
   looked unchanged however many times it was uploaded. */
const headers = readRoot("_headers");
/* The rules must name THIS game's paths, not any paths.

   This asked whether the file mentioned /css/* and /js/* anywhere, and passed
   happily after the move while both rules matched nothing — the game's assets
   had gone to /crossword/css/ and the rules that stop a browser pairing new
   markup with a month-old stylesheet were dead. The only outward sign was a
   cache header quietly changing to the Pages default.

   GAME is this folder's name, so a game added without its own rules fails
   here rather than shipping with no cache policy. */
const GAME = path.basename(DIR);
t(`css and js have cache rules under /${GAME}/`,
  new RegExp(`^/${GAME}/css/\\*`, "m").test(headers) &&
  new RegExp(`^/${GAME}/js/\\*`, "m").test(headers),
  `/${GAME}/css/* and /${GAME}/js/*`);
t(`the game's own index.html is never stored`,
  new RegExp(`^/${GAME}/index\\.html`, "m").test(headers));
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

   LAST_SHIPPED is the version that is live now. Bump it when you deploy.

   THE SCHEME, from Crossword_v001 on: a major release bumps the number
   (v001 -> v002); a minor amendment appends or advances a letter
   (v001 -> v001b -> v001c). A tag is BURNED the moment its package is
   presented — v154 alone was rebuilt six times under one name, which made
   "--expect v154" prove a string while proving nothing about the tree, the
   duplication fault applied to release numbers. Packages are folders named
   for the game: Crossword_v001, zipped as Crossword_v001.zip.

   The old lineage (v124..v156) is retired; numbering restarted at v001. The
   comparison below knows about that one reset — an old-lineage LAST_SHIPPED
   (>= v100) with a new-scheme build passes with a note. Once LAST_SHIPPED is
   new-scheme, ordering is strict again: number first, then letter, where
   "v001" < "v001b" < "v002". */
const LAST_SHIPPED = "v001r";    // <- what is LIVE; bump after each deploy
/* What was last PRESENTED — a different question from what is live, and the
   burn rule is about this one: a tag dies the moment its package is handed
   over, deployed or not. One constant tried to answer both questions and the
   burn was unenforceable: while LAST_SHIPPED sat on the old lineage, the
   restart exemption waved through ANY new-scheme tag — v001 again tomorrow,
   v001a after v001b, anything below 100. Two facts, two constants. */
const LAST_PRESENTED = "v001r";  // <- bump when a package is handed over
t("no package manifest or tool state in the repo root", (() => {
  /* The repo deliberately has no package.json: its absence is why Pages logs
     "No build command specified. Skipping build step." One appearing would
     silently change the deploy pipeline. And it nearly did — running the CI
     suite locally wrote package.json, a lockfile and a .wrangler/ state
     directory into the tree, and 181 files went into a package that should
     hold 136. Tools that write into the tree are a standing hazard; the gate
     now refuses their droppings. */
  for (const f of ["package.json", "package-lock.json", ".wrangler",
                   "yarn.lock", "pnpm-lock.yaml"]) {
    if (hasRoot(f)) return false;
  }
  return true;
})());

t("every og:image is an absolute https URL", (() => {
  /* Scrapers fetch og:image verbatim: Facebook, WhatsApp and Slack do not
     resolve a relative URL against the page, they just fail to render a
     card. "og-image.png" survived the migration in two heads, and every
     share of the game page has been rendering imageless. Enforced by scheme,
     not by fixing the two instances. */
  for (const f of ["index.html", "how-to-play.html", "privacy.html"]) {
    if (!has(f)) continue;
    for (const m of read(f).matchAll(/property="og:image" content="([^"]+)"/g)) {
      if (!/^https:\/\//.test(m[1])) return false;
    }
  }
  return true;
})());

t("the build tag has moved past the version now live, and past the last presented",
  (() => {
    const now = (html.match(/<span id="buildTag">([^<]+)</) || [])[1] || "";
    const parse = (v) => {
      const m = /^v(\d+)([a-z]?)$/.exec(String(v).trim());
      return m ? [parseInt(m[1], 10), m[2] || ""] : null;
    };
    const gt = (x, y) => x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);
    const a = parse(now), live = parse(LAST_SHIPPED), pres = parse(LAST_PRESENTED);
    if (!a || !live || !pres) return false;
    /* The one lineage restart: while what is LIVE is still the old numbering
       (>= v100), only number one — v001 and its letters — may follow it, in
       presentation order. v002 cannot leapfrog the bridge, and this clause
       retires itself the first time LAST_SHIPPED becomes a new-scheme tag. */
    const shippedOk = live[0] >= 100 ? a[0] === 1 : gt(a, live);
    return shippedOk && gt(a, pres);
  })(),
  `now ${(html.match(/<span id="buildTag">([^<]+)</) || [])[1]}, live ${LAST_SHIPPED}, presented ${LAST_PRESENTED}`);

/* The GAME's own script, not the first versioned asset on the page. This read
   `?v=` wherever it first appeared, which was the game's stylesheet until a
   SHARED one arrived above it — shared/xi-chrome.css carries its own v1
   lifecycle, and the check started comparing the game's BUILD against "v1".
   The tag being asserted is the game's, so ask the game's file for it. */
const ownTag = (html.match(/js\/game\.js\?v=([^"]+)"/) || [])[1];
t("the build tag matches the one the script reports",
  !!ownTag && read("js/game.js").includes('var BUILD = "' + ownTag + '"'),
  ownTag);
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
/* Every named import must exist in the module it names.

   Cloudflare bundles Functions with esbuild at deploy time, so an import of
   something that is not exported is a BUILD failure, not a runtime one — the
   deployment never completes and Pages goes on serving the previous build. The
   site does not break; it silently stops changing, which is a much harder thing
   to notice than an error.

   That is exactly what happened: api/account/code.js imported upsertUser from
   _lib/auth.js, which exports findOrCreateUser. deploy_check passed, the push
   succeeded, and the live site sat on the previous version through two more
   attempts before anybody looked at the build log.

   node --check does not catch this: each file is valid on its own. Only
   resolving the imports across files does. */
/* Every test suite in the folder is named in the workflow.

   Suites drift out of CI silently: outcome_test, fairness_test and howto_test
   were all written, all passing locally, and none of them ran on a push. A test
   nobody runs is a comment.

   The reverse case matters too — a suite named in the workflow but deleted from
   the folder fails the whole run on a missing file, which is how a dead
   scoring_test lingered for weeks exiting 0 on "engine.js is not here". */
/* The deleted penalty constants stay deleted.

   They were set to 0 when help moved to the clock and kept "so the breakdown
   can read them". Two reviews then produced findings about readers that still
   treated them as meaningful — a zero prints a plausible number, so nothing
   failed and nothing was found. Deleted, a missed reader prints undefined.

   This check exists so they cannot come back as a convenience. */
/* `dailyNo` is a record field, never a variable.

   It was one of six values each holding part of the answer to "which board is
   this" — mode, dailyNo, dailyWanted, themeWanted, sharedToken, adminDay —
   written from a dozen routes and reassembled differently by every reader. Six
   separate faults came out of that, each found only after fixing the previous
   one moved the symptom.

   There is one `board` value now and one writer, openBoard(). A bare `dailyNo`
   is how a seventh copy would start. */
/* The four shadow variables stay deleted.

   `mode`, `themeWanted`, `sharedToken` and `adminDay` each held part of "which
   board is this" alongside `board` itself. Seven routes set them and never
   touched `board`, so `requestPuzzle` read a stale board and **every non-daily
   board loaded today's daily** — "New puzzle" from the landing screen issued
   one request, /api/daily. 479 tests passed, because none asserted the URL a
   theme or practice board asks for.

   One value, one writer, or this comes back. */
let shadowVars = "";
t("the board shadow variables have not returned", (() => {
  if (!has("js/game.js")) return true;
  const src = read("js/game.js");
  const bad = [];
  /* Comments and string literals go first, for every name: "adminDay" is also
     a DOM id and "cxi:mode" an event name. Stripping them afterwards left the
     id looking like a variable. */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  ["themeWanted", "sharedToken", "adminDay"].forEach((n) => {
    /* board.adminDay is the field; a bare adminDay is the old variable. */
    /* Strips the legitimate forms: board.x reading the field, `x:` writing an
       object key, and "x" as a DOM id or an event name in a string. What is
       left is a bare variable. */
    /* Any x.name is a field read — board.adminDay, and t.adminDay reading the
       target passed to openBoard. A bare name is the old variable. */
    const stripped = code.replace(new RegExp("[\\w\\)\\]]\\." + n, "g"), "")
      .replace(new RegExp(n + "\\s*:", "g"), "")
      .replace(new RegExp('"' + n + '"', "g"), "")
      .replace(new RegExp("'" + n + "'", "g"), "");
    if (new RegExp("\\b" + n + "\\b").test(stripped)) bad.push(n);
  });
  /* `mode` survives as a string field on records and as fcw.mode; a bare
     variable read is what must not. */
  /* Comments and strings stripped first: "cxi:mode" is an event name and the
     word appears in prose throughout. */
  const modeSrc = code
    .replace(/\.mode\b/g, "").replace(/mode\s*:/g, "")
    .replace(/\bfitMode\b/g, "");
  if (/(?<![.\w])\bmode\b(?!\s*:)/.test(modeSrc)) bad.push("mode");
  shadowVars = bad.join(", ");
  return !bad.length;
})(), shadowVars);

/* Every JSON-LD block parses, and the share card exists.

   Structured data fails silently: a trailing comma or a stray quote means a
   search engine ignores the block entirely and nothing on the page looks
   wrong. Same for og:image — a reference to a file that is not there is worse
   than no reference, because every share becomes a broken image rather than a
   plain link. */
/* A staging address must not be indexed; the real one must be.

   The game is on crossword.thexigames.com and moves to thexigames.com/crossword/.
   Indexing the subdomain now would put the wrong URL in every search result and
   every inbound link, and migrating away from somebody else's index of your old
   address is far harder than never being in it.

   Both directions, because the failure is symmetrical: shipping to the path
   with noindex still set is a live game nobody can find, which is worse.

   The signal is og:url, the one place the page states where it thinks it
   lives. */
let robotsGap = "";
t("noindex matches the address the page claims", (() => {
  /* Ported back from the wordsearch gate, which found this passing by TWO
     faults cancelling and a third waiting: the subdomain regex matched
     "www." (the canonical host read as staging), the /api/* noindex
     satisfied the header side, and the _headers comment DOCUMENTING this
     rule read as a live header. Corrected: www is not a subdomain, comment
     lines are stripped, and only a global noindex — one before any /api/
     block — counts as blocking. */
  if (!has("index.html") || !hasRoot("_headers")) return false;
  const url = (read("index.html").match(/og:url" content="([^"]+)"/) || [])[1] || "";
  const onSubdomain = /:\/\/(?!www\.)[a-z0-9-]+\.thexigames\.com/.test(url);
  const rules = readRoot("_headers").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const global = rules.split(/^\/api\//m)[0];
  const noindexed = /X-Robots-Tag:\s*noindex/i.test(global);
  if (onSubdomain && !noindexed) {
    robotsGap = "on a subdomain (" + url + ") and indexable";
  } else if (!onSubdomain && noindexed) {
    robotsGap = "on its path (" + url + ") but still noindex";
  }
  return !robotsGap;
})(), robotsGap || null);

/* NOT CHECKED HERE: that every name game.js calls is one it declares.

   `bulkReveal` lost its declaration and kept three references, so every reveal
   threw ReferenceError on a shipped build. Fixing it nearly shipped the same
   fault again — `unfinishedTheme` was called before it was written.

   A regex attempt at this produced four false positives on the first run
   (function parameters, string methods, keywords) and four more after two
   rounds of tightening. A checker that cries wolf gets switched off, which is
   worse than not having one.

   The right tool is a parser — `node --check` only proves the file parses, not
   that its names resolve. Until then the honest answer is that this class of
   fault is caught by loading the page, which is what the jsdom suites do and
   what this gate cannot. Run frontend_test before shipping. */

let seoGap = "";
t("structured data parses and the share card is present", (() => {
  const problems = [];
  ["index.html", "how-to-play.html"].forEach((f) => {
    if (!has(f)) return;
    const src = read(f);
    const blocks = src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    if (!blocks.length) { problems.push("no JSON-LD in " + f); return; }
    blocks.forEach((b) => {
      const body = b.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
      try {
        const parsed = JSON.parse(body);
        if (!parsed["@type"]) problems.push("no @type in " + f);
      } catch (e) { problems.push("unparseable JSON-LD in " + f); }
    });
    const img = src.match(/og:image" content="([^"]+)"/);
    if (!img) problems.push("no og:image in " + f);
    else if (!/^https?:/.test(img[1]) && !has(img[1])) {
      problems.push("og:image missing: " + img[1]);
    }
  });
  seoGap = problems.join(", ");
  return !problems.length;
})(), seoGap);

let bareDaily = "";
t("dailyNo appears only as a record field, never as a variable", (() => {
  if (!has("js/game.js")) return true;
  const lines = read("js/game.js").split("\n");
  const bad = [];
  lines.forEach((l, i) => {
    const trimmed = l.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
    /* Strip the legitimate forms: `x.dailyNo` reading a record, and
       `dailyNo:` writing one in an object literal. Anything left is a bare
       variable. */
    const stripped = l.replace(/[\w\])]\.dailyNo/g, "").replace(/dailyNo\s*:/g, "");
    if (/\bdailyNo\b/.test(stripped)) bad.push("line " + (i + 1));
  });
  bareDaily = bad.slice(0, 3).join(", ");
  return !bad.length;
})(), bareDaily);

let deadConsts = "";
t("the deleted penalty constants have not returned", (() => {
  const names = ["CHECK_PENALTY", "CHECK_ALL_PENALTY",
                 "REVEAL_LETTER_PENALTY", "REVEAL_ANSWER_PENALTY"];
  const files = ["js/engine.js", "js/game.js"].map((f) => path.join(DIR, f))
    .concat(["functions/_lib/scoring.js", "functions/api/finish.js"]
      .map((f) => path.join(ROOT, f)));
  const found = [];
  files.forEach((f) => {
    if (!has(f)) return;
    const src = read(f);
    names.forEach((n) => { if (src.includes(n)) found.push(n + " in " + f); });
  });
  deadConsts = found.join(", ");
  return !found.length;
})(), deadConsts);

let suiteGap = "";
t("every test suite is named in the workflow", (() => {
  /* hasRoot, not has: the workflow lives at the repo root, and has() looks in
     crossword/ — where .github does not exist, so this check returned true
     unconditionally from the v152 restructure until now. A gate that reports
     a pass it never evaluated is the silent-pass fault wearing the gate's own
     uniform, and it was reported outward as "34/34" for four builds. */
  const wf = "\u002egithub/workflows/checks.yml";
  if (!hasRoot(wf)) return false;   // a missing workflow is a failure, not a pass
  const yml = readRoot(wf);
  /* EVERY suite folder, not this game's. This read only crossword/, so the
     word search could grow suites that ran nowhere and nothing said so —
     which is precisely the gap that let its sentinel tag law and its unrun
     suites in. External review, finding 4. */
  const suites = [];
  for (const dir of ["crossword", "wordsearch", "tools"]) {
    if (!hasRoot(dir)) continue;
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (/_test\.mjs$/.test(f)) suites.push(dir + "/" + f);
    }
  }
  /* Suites that need a live URL or a real browser cannot run in the offline
     job. Named here so the exemption is a decision on the record rather than
     something that quietly grew:
       render_test   Playwright, sixteen viewports, needs BASE
       journey_test  Playwright
       signin_test   Playwright, needs BASE
       preview_test  needs a built preview, and exits 0 without one — which is
                     the "test that cannot fail" fault; it should be fixed or
                     deleted rather than added here permanently. */
  const needsLive = ["crossword/render_test.mjs", "crossword/journey_test.mjs",
                     "crossword/signin_test.mjs", "crossword/preview_test.mjs"];
  const missing = suites.filter((f) => needsLive.indexOf(f) === -1 && !yml.includes(f));
  /* The reverse direction: every suite the workflow names must exist. The old
     regex was /node (\w+_test\.mjs)/ — no slash in the class — and every
     workflow entry is "node dir/suite.mjs", so it matched NOTHING and this
     half of the check had been vacuous since it was written. Found while
     widening the forward half. */
  const named = (yml.match(/node ([\w/]+_test\.mjs)/g) || [])
    .map((m) => m.replace("node ", ""));
  const absent = named.filter((f) => !hasRoot(f));
  suiteGap = [
    missing.length ? "not in CI: " + missing.join(", ") : "",
    absent.length ? "in CI but missing: " + absent.join(", ") : "",
  ].filter(Boolean).join("  |  ");
  return !missing.length && !absent.length;
})(), suiteGap);

let brokenImports = [];
/* Every Functions file must PARSE as an ES module, checked with a real
   parser. The import-resolution check below matches import lines by pattern
   and read straight past a multi-line import that had another import spliced
   into the middle of it — locally every suite stayed green because nothing
   imports account/code.js, and the fault surfaced as a failed Pages build in
   Cloudflare's log, the first deploy-time failure since v124. The bundler
   parses; so does the gate now. */
{
  /* Node's own parser via stdin — no dependency, because this gate must run
     with no node_modules present (its own check demands it).

     execFILEsync, not execSync. execSync passes the command to cmd.exe as a
     string, and on Windows process.execPath is "C:\Program Files\nodejs\
     node.exe" — unquoted, cmd reads that as the program "C:\Program" and
     fails with an empty stderr. All 43 files failed, on every Windows run,
     for as long as this check has existed; CI passed throughout because
     /usr/bin/node has no space in it. A check that cannot run on the machine
     the developer uses is the same fault as one that returns true on a folder
     that is not there, only louder. execFileSync takes the arguments as an
     array and spawns the binary directly, so no shell parses the path. */
  const { execFileSync } = await import("node:child_process");
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      fs.statSync(p).isDirectory() ? walk(p) : e.endsWith(".js") && files.push(p);
    }
  })(path.join(ROOT, "functions"));
  let broken = null;
  for (const f of files) {
    try {
      execFileSync(process.execPath, ["--input-type=module", "--check"],
        { input: fs.readFileSync(f), stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      /* Report the parse error when there is one, and the raw exit and stderr
         when there is not. The old line printed only the first stderr line
         matching /Error/ and, finding none, printed "undefined" — which said a
         check had failed while hiding that the cause was the environment
         rather than the file. */
      const err = String(e.stderr || "");
      const named = err.split("\n").find((l) => /Error/.test(l));
      broken = path.relative(ROOT, f) + " — " +
        (named || `no parse error reported; exit=${e.status} stderr=${JSON.stringify(err.trim())}`);
      break;
    }
  }
  t("every Functions file parses as the Pages bundler will parse it",
    !broken, broken || files.length + " files");
}
t("every import resolves to something the target actually exports", (() => {
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name)));
      else if (e.name.endsWith(".js")) out.push(path.join(dir, e.name));
    }
    return out;
  };
  if (!hasRoot("functions")) return false;   // vacuous-true here hid nothing for
                                             // months only by luck
  const broken = [];
  for (const f of walk("functions")) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
      const target = path.resolve(path.dirname(path.join(ROOT, f)), m[2]);
      if (!fs.existsSync(target)) { broken.push(`${f} -> ${m[2]} (no such file)`); continue; }
      const t2 = fs.readFileSync(target, "utf8");
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        const declared = new RegExp(`export\\s+(async\\s+)?(function|const|let|var|class)\\s+${name}\\b`).test(t2);
        const listed = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(t2);
        if (!declared && !listed) broken.push(`${name} in ${f}`);
      }
    }
  }
  brokenImports = broken;
  return broken.length === 0;
})(), brokenImports.slice(0, 4).join(", "));

t("no Functions file collides with a directory of the same name", (() => {
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name)));
      else if (e.name.endsWith(".js")) out.push(path.join(dir, e.name));
    }
    return out;
  };
  if (!hasRoot("functions")) return false;
  return !walk("functions").some((f) =>
    hasRoot(f.replace(/\.js$/, "")) &&
    fs.statSync(path.join(ROOT, f.replace(/\.js$/, ""))).isDirectory());
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
  hasRoot("functions/_lib/sample-puzzles.js") && !hasRoot("data/sample-puzzles.js"));
t("API calls use relative URLs", /fetch\(/.test(read("js/game.js")) &&
  !/https?:\/\/[^"']*\/api\//.test(read("js/game.js")));

const ignore = readRoot(".gitignore");
t("generated answer files are gitignored",
  /clues-production\.sql/.test(ignore) && /puzzles-production\.sql/.test(ignore));
t("no production SQL is present in the package",
  !hasRoot("data/clues-production.sql") && !hasRoot("data/puzzles-production.sql"));
t("no secrets are committed", !has(".env") && !has(".dev.vars") &&
  !/(api[_-]?key|password|secret)\s*[:=]\s*["'][^"']{8,}/i.test(all));
t("no node_modules in the package", !has("node_modules"));
t("no preview build is in the package", (() => {
  // A preview inlines the answers so it can run from disk. It must never reach
  // the repository, which is what the whole D1 move was for.
  return !fs.readdirSync(DIR).some((f) => /^crosswordxi-preview-.*\.html$/.test(f)) &&
    /crosswordxi-preview-\*\.html/.test(readRoot(".gitignore"));
})());

/* v001e: three \u2014 escapes shipped to the live front page and read as six
   literal characters in the card copy AND in the meta description search
   engines show. Copy was written as JS string literals and pasted into markup,
   where nothing interprets an escape. Proven to fail before it was trusted: it
   found four sites, including one in how-to-play.html nobody had noticed.
   Script blocks are stripped first — there the escape is valid and correct. */
let escapeHits = "";
t("no literal unicode escapes in markup", (() => {
  const pages = ["index.html", "404.html", "crossword/index.html",
                 "crossword/how-to-play.html", "crossword/privacy.html",
                 "wordsearch/index.html"];
  const found = [];
  for (const p of pages) {
    if (!hasRoot(p)) continue;
    const markup = readRoot(p).replace(/<script[\s\S]*?<\/script>/gi, "");
    for (const m of markup.matchAll(/\\u[0-9a-fA-F]{4}/g)) found.push(`${p} ${m[0]}`);
  }
  escapeHits = found.join(", ");
  return found.length === 0;
})(), escapeHits);

/* v001e: the game's name lived in six player-facing places in its own page
   with nothing holding them together — the rename from "XI Word Search" to
   "Wordsearch XI" is exactly when four of them agree and two do not. One fact,
   asserted across the places that state it. */
let nameSpread = "";
t("each game's name is identical in title, og:title, JSON-LD and h1", (() => {
  const pages = ["crossword/index.html", "wordsearch/index.html"];
  for (const p of pages) {
    if (!hasRoot(p)) continue;
    const html = readRoot(p);
    /* The tagline is separated by a dash or a pipe, and the dash is a literal
       character in one page and an &mdash; entity in another. Split on any of
       them: the name is what comes first. */
    const grab = (re) =>
      ((html.match(re) || [])[1] || "").split(/&mdash;|&ndash;|—|–|\|/)[0].trim();
    const names = [
      grab(/<title>([^<]+)<\/title>/),
      grab(/property="og:title" content="([^"]+)"/),
      grab(/"name":\s*"([^"]+)"/),
      grab(/<h1[^>]*>([^<]+)<\/h1>/),
    ].filter(Boolean);
    const uniq = [...new Set(names)];
    if (names.length < 4 || uniq.length !== 1) {
      nameSpread = `${p}: ${uniq.join(" / ")}`;
      return false;
    }
  }
  return true;
})(), nameSpread);

/* v001n: the chrome is shared, or it is not chrome. Both games must reference
   shared/xi-chrome.{css,js} rather than keeping a private copy — the whole
   fault it replaces was two games with two chromes. This is the first of the
   forbidden-copy checks the cross-game contract suite will generalise. */
let chromeGap = "";
t("both games use the shared chrome rather than a copy of it", (() => {
  const missing = [];
  for (const p of ["crossword/index.html", "wordsearch/index.html"]) {
    if (!hasRoot(p)) continue;
    const html = readRoot(p);
    if (!/shared\/xi-chrome\.css/.test(html)) missing.push(p + " css");
    if (!/shared\/xi-chrome\.js/.test(html)) missing.push(p + " js");
    if (!/class="xic-bar"/.test(html)) missing.push(p + " bar");
  }
  /* A game defining .xic- rules in its own sheet has started a second chrome. */
  for (const p of ["crossword/css/style.css", "wordsearch/css/style.css"]) {
    if (hasRoot(p) && /^\s*\.xic-[a-z-]+\s*\{/m.test(readRoot(p))) {
      missing.push(p + " defines .xic- rules of its own");
    }
  }
  chromeGap = missing.join(", ");
  return missing.length === 0;
})(), chromeGap);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
