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

const BASE = "https://www.thexigames.com";
const expectArg = process.argv.indexOf("--expect");
const EXPECT = expectArg > -1 ? process.argv[expectArg + 1] : null;

let pass = 0, fail = 0;
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

/* The standing rule, now checked where players actually land. The crossword's
   landing footer named two unreleased games and privacy.html named five, on
   live indexed pages, because this rule was only ever enforced on the hub. */
const UNRELEASED = ["QuickFire", "Scrambled", "Missing XI", "Career Path",
                    "Player Chain", "Link XI", "Odd One Out"];
function namesNone(label, markup) {
  const clean = markup.replace(/<!--[\s\S]*?-->/g, "");
  const found = UNRELEASED.filter((n) => clean.indexOf(n) > -1);
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
t("the catalog carries no grids and no answers", (() => {
  if (!c || !c.boards || !c.boards.length) return false;
  const p = c.boards[0];
  return !("grid" in p) && !("answers" in p) && !("bonus" in p);
})());

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

/* ---- HEAD --------------------------------------------------------------- */
for (const p of ["/api/wordsearch/daily", "/wordsearch/answers/"]) {
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
