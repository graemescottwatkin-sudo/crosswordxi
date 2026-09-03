/* live_check.mjs — is the deployed Wordsearch XI actually behaving?
 *
 *   node wordsearch/live_check.mjs [--expect v001g]
 *
 * The crossword has had one of these since the restructure; the word search
 * shipped without one, and every post-deploy check was done by hand with curl.
 * Two of tonight's faults would have been caught by the checks below the day
 * they happened rather than the day somebody looked:
 *
 *   - hasDB() falls back to SAMPLE boards when the D1 binding is missing, so
 *     an unbound database looks like a working game with a handful of boards.
 *     The `source` field is the tell, and nothing was reading it.
 *   - migration 002 sat unapplied for months behind a comment claiming it had
 *     been run, and every results query threw into a silent catch. The schema
 *     probe below asks the live endpoints the question directly.
 *
 * Assertions only ever READ. Nothing here plays, finishes, or writes.
 */

import { execSync } from "node:child_process";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const BASE = "https://www.thexigames.com";
const expectArg = process.argv.indexOf("--expect");
const EXPECT = expectArg > -1 ? process.argv[expectArg + 1] : null;

let pass = 0, fail = 0, warn = 0;
/* An outcome that is neither pass nor fail: a question this run could not ask.
   Mirrors the crossword's, and is printed — never silently skipped. */
const w = (n, d) => { warn++; console.log(`  ??  ${n}${d ? "  — " + d : ""}`); };

/* ---- the completion guard ----------------------------------------------- */
/* v001r: this file crashed at assertion 17 of 38 on a ReferenceError and
   printed a short list of green ticks with no summary at all. Nothing in the
   output said "incomplete" — a truncated run and a clean run differed only by
   an exit code nobody was reading. Two nets: the marker, set only by reaching
   the last line, catches a crash anywhere above it; the floor catches a block
   that goes quiet without crashing. Proven by EXECUTION, not by parse —
   node --check called the crashing file fine.
   The uncaughtException hook is load-bearing: a rejection out of top-level
   await terminates by a path that never runs 'exit' listeners, so a guard
   hung on 'exit' alone stays as silent as the bug it is meant to catch. */
/* REVIEWED at v001s: the run counts 50. The blocks that can legitimately go
   quiet are the bytes comparison (1), a sealed id (3), a published answer (2),
   today's board (4), a category page (5) and the archive body (4) — but they
   skip one at a time, not together, so the floor is set to catch any TWO of
   the larger blocks vanishing at once (50 - 5 - 4 - 4 = 37), not all of them:
   36. A floor at 30 could not have noticed the themes and the archive, sixteen
   assertions, going missing together. */
const MIN_ASSERTIONS = 36;
let reachedEnd = false, announced = false;
function incomplete() {
  if (announced) return;
  announced = true;
  console.log(`\nFAIL  the run did not complete — ${pass + fail + warn} assertion(s) ` +
    `ran, floor ${MIN_ASSERTIONS}. A crash mid-file is a failed run, not a ` +
    `short green list.`);
  process.exitCode = 1;
}
process.on("uncaughtException", (e) => {
  console.log("\n" + ((e && e.stack) || e));
  incomplete();
  process.exit(1);
});
process.on("unhandledRejection", (e) => { throw e; });
process.on("exit", () => { if (!reachedEnd) incomplete(); });
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}
const get = (path, opts) => fetch(BASE + path, { redirect: "manual", ...opts });

console.log(BASE + "/wordsearch");

/* ---- the page ----------------------------------------------------------- */
const page = await get("/wordsearch/");
const pageText = await page.text();
t("the page is served", page.status === 200, "HTTP " + page.status);
t("index.html is not stored, so nobody is pinned to an old build",
  /no-store/.test(page.headers.get("cache-control") || ""),
  page.headers.get("cache-control"));

const tag = (pageText.match(/js\/game\.js\?v=([^"]+)"/) || [])[1];
t("the game script carries a build tag", !!tag, tag);
if (EXPECT) t("the build is " + EXPECT, tag === EXPECT, "serving " + tag);
else console.log(`      serving ${tag} — pass --expect vNNN to assert it`);

t("the canonical names this page",
  pageText.indexOf('href="https://www.thexigames.com/wordsearch/"') > -1);
t("the shared chrome is referenced, not copied",
  /shared\/xi-chrome\.css/.test(pageText) && /shared\/xi-chrome\.js/.test(pageText));

/* ---- the bytes behind the tag, which the gate cannot see ---------------- */
/* The gate proves the tag moved when the assets changed. It cannot prove the
   DEPLOY landed: a push that never built, or a CDN still serving the previous
   file under the same ?v=, is indistinguishable from success by tag alone —
   and the tag is all anything was checking. So compare the bytes.
   Only comparable when the live tag and this checkout agree; when they do not
   the run says so rather than skipping quietly, because a check that goes
   silent is the fault this suite exists to catch. */
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const localJs = fs.readFileSync(path.join(here, "js/game.js"), "utf8");
  const localTag = (localJs.match(/BUILD\s*=\s*"(v\d+[a-z]?)"/) || [])[1] || "";
  const sum = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
  if (!tag || !localTag || tag !== localTag) {
    w("the deployed game.js is the file in this checkout",
      `not comparable — live ${tag || "?"}, this checkout ${localTag || "?"}`);
  } else {
    const r = await fetch(BASE + "/wordsearch/js/game.js?v=" + tag);
    const body = r.ok ? await r.text() : "";
    t("the deployed game.js is the file in this checkout",
      r.ok && sum(body) === sum(localJs),
      r.ok ? `live ${sum(body)} vs local ${sum(localJs)}` : `HTTP ${r.status}`);
  }
}

/* The standing rule, now checked where players actually land. The crossword's
   landing footer named two unreleased games and privacy.html named five, on
   live indexed pages, because this rule was only ever enforced on the hub. */
/* QuickFire XI is BUILT but not launched: its page exists in the repo, it is
   not on the squad list, not in the sitemap, and not in the server game list,
   so it must still never be NAMED in served markup. Career Path is now
   Transfer XI. */
const UNRELEASED = ["QuickFire", "Missing XI", "Transfer XI",
                    "Player Chain", "Link XI", "Odd One Out"];
/* HOW A NAME IS LOOKED FOR, and why it is not indexOf any more.

   Case-insensitively: these matched "QuickFire" exactly, so "quickfire xi"
   in a sentence would have walked straight past a check called "names no
   unreleased game". A check whose name is broader than its behaviour is the
   fault this project keeps a rule about.

   And with href and src VALUES removed first, because a game in testing is
   now reachable — the hub's number-four card and the drawer's slot both link
   to /quickfire/, deliberately, and a path is not the page naming the game.
   Everything a reader can actually see is still searched, including titles,
   meta descriptions and link text. */
function namesAny(markup, names) {
  const clean = markup
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\b(?:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return names.filter((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(clean));
}
function namesNone(label, markup) {
  const found = namesAny(markup, UNRELEASED);
  t(label + " names no unreleased game", found.length === 0, found.join(", "));
}
namesNone("the game page", pageText);
for (const p of ["/crossword/privacy.html", "/crossword/how-to-play.html"]) {
  const r = await get(p);
  namesNone(p, r.status === 200 ? await r.text() : "");
}

/* ---- the daily ---------------------------------------------------------- */
const daily = await get("/api/wordsearch/daily");
const d = daily.status === 200 ? await daily.json() : null;
t("the daily endpoint answers", daily.status === 200, "HTTP " + daily.status);
t("it is not cacheable", /no-store/.test(daily.headers.get("cache-control") || ""));
t("it returns a board", !!(d && d.puzzle), d && d.puzzle && d.puzzle.id);
/* THE BINDING PROBE. source:"sample" with a 200 is exactly what a missing D1
   binding looks like — a working game with a handful of boards. */
t("the board comes from D1, not the sample fallback",
  !!d && d.source === "d1", d && "source: " + d.source);
t("eleven answers, which is the whole premise",
  !!(d && d.puzzle && d.puzzle.answers && d.puzzle.answers.length === 11));
t("and a bonus", !!(d && d.puzzle && d.puzzle.bonus && d.puzzle.bonus.display));
t("placements are 0-based on the wire",
  !!(d && d.puzzle && d.puzzle.answers.every((a) =>
    a.placement.start_row >= 0 && a.placement.start_row <= 13 &&
    a.placement.start_col >= 0 && a.placement.start_col <= 11)),
  "rows 0-13, cols 0-11");

/* ---- the schedule guard ------------------------------------------------- */
const cat = await get("/api/wordsearch/catalog");
const c = cat.status === 200 ? await cat.json() : null;
/* v001r: the endpoint returns { boards: [...] }; this file read c.puzzles.
   One wrong key made three checks lie — the count read 0 in green on a live
   site with 239 boards, the no-leak guard never inspected a board and failed
   on its own empty-input branch, and releasedIds below came back empty, which
   left the sealed-board check picking the top of the scan every time instead
   of deriving it from the schedule. Shipped without ever being run;
   node --check proves parsing, not execution. A live catalog with zero
   released boards is a failure, not a pass, so the count is asserted. */
const releasedCount = c && c.boards ? c.boards.length : 0;
t("the catalog answers", cat.status === 200 && releasedCount > 0,
  releasedCount + " released boards");
/* v001r: this sampled boards[0] and generalised to all 239 — a name broader
   than its behaviour, the same fault as the wrong key one line above it, only
   quieter. Every entry is scanned now, and a failure names the id and the key
   it carried, never the theme. */
const LEAK_KEYS = ["grid", "answers", "bonus", "words", "solution", "placements"];
const leaks = [];
for (const b of (c && c.boards) || []) {
  const bad = LEAK_KEYS.filter((k) => k in b);
  if (bad.length) leaks.push(b.id + ": " + bad.join("+"));
}
t("the catalog carries no grids and no answers",
  releasedCount > 0 && leaks.length === 0,
  leaks.length ? leaks.slice(0, 5).join(", ") : releasedCount + " entries scanned");

/* ---- the unscheduled tripwire (D1; HTTP cannot see the schedule) --------- */
/* released() treats a board with no schedule row as released — "an unscheduled
   board has no date to protect", functions/_lib/wsdata.js. Deliberate, and
   harmless only while every board is scheduled. HTTP cannot check it: an
   unscheduled board and a released one are byte-identical over the wire, which
   is why this one question goes to D1. Never silently skipped — if wrangler is
   not there, the run says so rather than passing. */
let unscheduled = null;
try {
  const out = execSync(
    "npx wrangler d1 execute crosswordxi --remote --json --command " +
    "\"SELECT COUNT(*) AS n FROM ws_puzzles p WHERE NOT EXISTS " +
    "(SELECT 1 FROM ws_schedule s WHERE s.puzzle_id = p.id)\"",
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 180000 });
  const m = out.match(/"n":\s*(\d+)/);
  if (m) unscheduled = Number(m[1]);
} catch { /* wrangler absent, unauthenticated, or offline */ }
if (unscheduled === null) {
  w("every board is scheduled, so nothing rides the unscheduled path",
    "D1 unreachable — wrangler absent or not logged in");
} else {
  t("every board is scheduled, so nothing rides the unscheduled path",
    unscheduled === 0, unscheduled + " board(s) with no schedule row");
}

/* An id the schedule has not released yet. The catalog lists what IS released,
   so any XIWS id not in it and within the bank's range is a sealed board —
   asking for it must 404 with nothing said. */
const releasedIds = new Set(c && c.boards ? c.boards.map((p) => p.id) : []);
let sealedId = null;
for (let n = 374; n >= 1; n--) {
  const id = "XIWS-" + String(n).padStart(4, "0");
  if (!releasedIds.has(id)) { sealedId = id; break; }
}
if (sealedId) {
  const sealed = await get("/api/wordsearch/puzzle?id=" + sealedId);
  t("an unreleased board is refused", sealed.status === 404, sealedId + " -> " + sealed.status);
  t("and the refusal is not cacheable",
    /no-store/.test(sealed.headers.get("cache-control") || ""),
    "a cached refusal would outlive its release date");
  const sealedBody = await sealed.text();
  t("and it names nothing", sealedBody.indexOf("theme") === -1 && sealedBody.indexOf("grid") === -1);
} else {
  console.log("      every board is released — the sealed-board checks have nothing to refuse");
}

/* ---- the answers pages -------------------------------------------------- */
const ansIndex = await get("/wordsearch/answers/");
const ansText = ansIndex.status === 200 ? await ansIndex.text() : "";
t("the answers index is served", ansIndex.status === 200, "HTTP " + ansIndex.status);
const firstAnswered = (ansText.match(/\/wordsearch\/answers\/(XIWS-\d{4})/) || [])[1];
t("it lists published boards", !!firstAnswered, firstAnswered);
if (firstAnswered) {
  const one = await get("/wordsearch/answers/" + firstAnswered);
  t("a published board's answers are served", one.status === 200);
  t("and cacheable — a published answer never changes",
    /max-age/.test(one.headers.get("cache-control") || ""));
}
/* Today's board must be sealed: it was first scheduled at most today. */
if (d && d.puzzle) {
  const todays = await get("/wordsearch/answers/" + d.puzzle.id);
  t("today's board's answers are refused", todays.status === 404,
    d.puzzle.id + " -> " + todays.status);
  t("and the refusal is not cacheable",
    /no-store/.test(todays.headers.get("cache-control") || ""));
  const refText = await todays.text();
  t("and it carries no theme and no names",
    refText.indexOf(d.puzzle.theme) === -1 &&
    d.puzzle.answers.every((a) => refText.indexOf(a.display) === -1));
}

/* ---- the themes pages --------------------------------------------------- */
/* The same shape as the crossword's clubs: an index, a page per category, and
   a board address that is a door into the game. Rendered from the catalog, so
   they can name nothing the catalog does not. */
const themesIndex = await get("/wordsearch/themes/");
const themesText = themesIndex.status === 200 ? await themesIndex.text() : "";
t("the themes index is served", themesIndex.status === 200, "HTTP " + themesIndex.status);
t("and it is indexable",
  themesIndex.status === 200 && !/noindex/.test(themesText) && !themesIndex.headers.get("x-robots-tag"));
const firstGroup = (themesText.match(/href="\/wordsearch\/theme\/([a-z0-9-]+)\/"/) || [])[1];
t("it links a category page", !!firstGroup, firstGroup);
if (firstGroup) {
  const groupPage = await get("/wordsearch/theme/" + firstGroup + "/");
  const groupText = groupPage.status === 200 ? await groupPage.text() : "";
  t("a category page is served", groupPage.status === 200, "HTTP " + groupPage.status);
  const chips = (groupText.match(/class="no" href="\/wordsearch\/theme\/[a-z0-9-]+\/\d+"/g) || []).length;
  t("every board on it is a numbered target", chips > 0, chips + " boards");
  const door = await get("/wordsearch/theme/" + firstGroup + "/1");
  const loc = door.headers.get("location") || "";
  t("a board address is a door into the game, with the board named",
    door.status === 302 && /^https:\/\/www\.thexigames\.com\/wordsearch\/\?b=XIWS-\d{4}$/.test(loc),
    door.status + " -> " + loc);
  const doorId = (loc.match(/b=(XIWS-\d{4})/) || [])[1];
  t("and the board behind the door is a released one", !!doorId && releasedIds.has(doorId), doorId);
  const beyond = await get("/wordsearch/theme/" + firstGroup + "/99999");
  t("a board that is not there is refused, not cacheable, not indexed",
    beyond.status === 404 && /no-store/.test(beyond.headers.get("cache-control") || "") &&
    beyond.headers.get("x-robots-tag") === "noindex", "HTTP " + beyond.status);
}
if (d && d.puzzle) {
  t("the themes index names no answer from today's board",
    d.puzzle.answers.every((a) => themesText.indexOf(a.display) === -1) &&
    themesText.indexOf(d.puzzle.bonus.display) === -1);
}

/* ---- the archive: previous days, and nothing after them ----------------- */
const arch = await get("/api/wordsearch/archive");
const a = arch.status === 200 ? await arch.json() : null;
t("the archive endpoint answers", arch.status === 200 && !!a && Array.isArray(a.days), "HTTP " + arch.status);
t("it is not cacheable, because midnight moves it", /no-store/.test(arch.headers.get("cache-control") || ""));
if (a) {
  t("it stops at yesterday: every day is before the server's today",
    a.days.length > 0 && a.days.every((e) => e.day < a.today), a.days.length + " days, today " + a.today);
  t("newest first", a.days.every((e, i) => i === 0 || a.days[i - 1].day >= e.day));
  t("it carries identity only — no grid, no names, no bonus",
    a.days.every((e) => e.id && e.theme && !e.grid && !e.answers && !e.bonus));
  t("and every day's board is a released one", a.days.every((e) => releasedIds.has(e.id)));
}

/* ---- HEAD --------------------------------------------------------------- */
for (const p of ["/api/wordsearch/daily", "/wordsearch/answers/", "/wordsearch/themes/"]) {
  const r = await get(p, { method: "HEAD" });
  t(`HEAD ${p} answers like its GET`, r.status === 200, "HTTP " + r.status);
}

/* ---- the schema, asked through the endpoints ---------------------------- */
/* Migration 002 hid because nothing compared the migrations folder against
   the live database. live_check speaks HTTP, not wrangler, so the probe is
   indirect but sharp: an endpoint whose SELECT names a missing column throws,
   and its error status is distinguishable from its refusal status. A signed-
   out results call must be a 401 — a 500 means the query itself is broken,
   which is precisely what "no such column: pauses" looked like. */
for (const [path, wants] of [["/api/account/results?game=wordsearch", 401],
                             ["/api/account/results", 401]]) {
  const r = await get(path);
  t(`${path} refuses cleanly rather than erroring`, r.status === wants,
    `HTTP ${r.status}${r.status === 500 ? " — the query is broken, check the schema" : ""}`);
}

/* The floor, for a block that goes quiet without crashing. */
const ran = pass + fail + warn;
if (ran < MIN_ASSERTIONS) {
  fail++;
  console.log(`FAIL  the run is short — ${ran} assertion(s) ran, floor is ${MIN_ASSERTIONS}`);
}
reachedEnd = true;
/* ---- the permalink: one URL, one puzzle, forever ---------------------- */
/* The whole contract a linking bot depends on, checked against production:
   /wordsearch/daily lands on a dated address, that address serves the game, and a
   board that does not exist yet is not a page. Here rather than only in the
   offline suite because the route is a Function, and the offline suite runs
   in node, which has no Workers runtime to run one in. */
{
  const hop = await fetch(BASE + "/wordsearch/daily", { redirect: "manual" });
  const loc = hop.headers.get("location") || "";
  const key = loc.split("/").filter(Boolean).pop() || "";
  t("/wordsearch/daily sends you to a dated address",
    hop.status === 302 && new RegExp("/wordsearch/daily/.+").test(loc), `${hop.status} -> ${loc}`);
  t("and never lets that answer be cached",
    (hop.headers.get("cache-control") || "").includes("no-store"));

  const page = await fetch(BASE + "/wordsearch/daily/" + key, { redirect: "manual" });
  const html = page.status === 200 ? await page.text() : "";
  t("the permalink serves the game itself",
    page.status === 200 && html.includes("js/game.js"), String(page.status));
  /* Every asset on the page is relative and the page is served one level
     deeper than it lives. Without this the board is a blank screen. */
  t("with a base, so its relative assets still resolve",
    html.includes('<base href="/wordsearch/">'));
  t("naming the board in its title and its canonical",
    /<title>[^<]+ \u00b7 /.test(html) && html.includes("/wordsearch/daily/" + key + '"'));
  t("and asking not to be indexed, being one shell per day",
    /content="noindex,follow"/.test(html));

  const future = await fetch(BASE + "/wordsearch/daily/2099-01-01", { redirect: "manual" });
  t("a board that does not exist yet is not a page", future.status === 404, String(future.status));
}

console.log(`\n${pass} passed, ${fail} failed${warn ? `, ${warn} unknown` : ""}`);
process.exit(fail ? 1 : 0);
