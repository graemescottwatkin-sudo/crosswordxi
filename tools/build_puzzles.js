#!/usr/bin/env node
/* tools/build_puzzles.js
 *
 * Pre-generates puzzles on your machine and writes the SQL to load them into
 * D1. Run it whenever the clue bank changes.
 *
 *   node tools/build_puzzles.js --days 365 --practice 500
 *
 * Why this exists rather than generating on demand: laying out a crossword
 * takes roughly 900ms of CPU and thirty attempts. A Cloudflare Worker is billed
 * and limited on CPU time, and the free plan allows 10ms per request — three
 * orders of magnitude short. Generating here and storing the result turns every
 * request into one indexed SELECT.
 *
 * INPUT  ../pitchword-source/data.json      the private clue bank (never in this repo)
 * OUTPUT data/daily-production.sql          gitignored, imported with wrangler
 *        data/practice-production.sql
 *
 * Two files rather than one. A generated file may only delete what it
 * re-inserts: a single file opening with DELETE FROM puzzles meant rebuilding
 * the daily also wiped three hundred practice puzzles, which nothing in the
 * command line said it would.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const DAYS = parseInt(arg("days", "365"), 10);
const PRACTICE = parseInt(arg("practice", "500"), 10);
/* --from N: leave days 1..N-1 exactly as they are and rewrite only from N.
   Once the game is live this is the only safe way to regenerate: a day that
   somebody has already played must not change under them, and a result row
   points at a daily number whose puzzle should still be the one they saw. */
const FROM_RAW = String(arg("from", "1"));
const FORCE = process.argv.includes("--force");
/* Practice is appended by default. Replacing it renumbers the pool, and the
   token a player is mid-puzzle with names a row id — renumbering turns their
   next Check into "that puzzle is no longer stored". */
const REPLACE_PRACTICE = process.argv.includes("--replace-practice");
const RESET = process.argv.includes("--reset");
const SOURCE = arg("source", path.join(ROOT, "..", "crosswordxi-source"));
const OUT_DAILY = path.join(ROOT, "data", "daily-production.sql");

/* Generated SQL lands in <tools>\..\data, so running the tools where they were
   unpacked puts the output beside them. Created here rather than expected to
   exist: a missing folder is an ENOENT halfway through a run that otherwise
   worked, which reads as a real failure and is not one. */
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

const OUT_PRACTICE = path.join(ROOT, "data", "practice-production.sql");
/* The game is called Crossword XI. Eleven is the invariant, not a preference,
   so it is declared before either loop rather than beside the practice pool. */
const TARGET_ANSWERS = 11;
let shortRetries = 0, shortSkipped = 0;

function need(file) {
  const p = path.join(SOURCE, file);
  if (!fs.existsSync(p)) {
    console.error(`\nCannot find ${p}`);
    console.error("Point --source at the folder holding data.json, seasons.json,");
    console.error("daily_bans.json and engine.js (the project archive, kept out of");
    console.error("this repository so the clue bank is never committed).\n");
    process.exit(1);
  }
  return p;
}

const FCW = require(need("engine.js"));
const rows = JSON.parse(fs.readFileSync(need("data.json"), "utf8"));
const bans = JSON.parse(fs.readFileSync(need("daily_bans.json"), "utf8"));

/* --from takes a daily number or a date, because you think in dates and the
   table is keyed by number. The conversion uses the engine's own DAILY_EPOCH —
   the same constant the running game counts from — rather than a second copy
   of the arithmetic living in this file. */
function resolveFrom(raw) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parts = raw.split("-").map(Number);
    const at = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(at.getTime())) { console.error(`--from: ${raw} is not a real date`); process.exit(1); }
    return { no: FCW.dailyNumber(at), date: raw, gave: "date" };
  }
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--from wants a daily number or YYYY-MM-DD, not "${raw}"`);
    process.exit(1);
  }
  return { no: n, date: dateOfDaily(n), gave: "number" };
}
function dateOfDaily(n) {
  const e = FCW.DAILY_EPOCH;
  const d = new Date(e.y, e.m, e.d + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
         "-" + String(d.getDate()).padStart(2, "0");
}
const TODAY_NO = FCW.dailyNumber();
const from = resolveFrom(FROM_RAW);
const FROM = Math.max(1, from.no);

/* Refuse to rewrite a day somebody has already played. The tool knows what day
   it is, so an off-by-one here is catchable rather than something you discover
   when a result no longer matches the puzzle it points at. --reset is exempt:
   it says destroy everything, and says it in a word nobody types by accident. */
if (!RESET && FROM <= TODAY_NO && !FORCE) {
  console.error(`\n--from ${FROM_RAW} resolves to daily #${FROM} (${from.date}).`);
  console.error(`Today is daily #${TODAY_NO}. That would replace ` +
    `${TODAY_NO - FROM + 1} day(s) already played or in play.`);
  console.error(`Pass --force if that is genuinely what you want.\n`);
  process.exit(1);
}

/* FROM past DAYS writes a file that deletes and inserts nothing — a silent
   truncation of the run, reported as a nonsense range like "#29-#25". Caught
   here because the SQL is valid and the import would succeed. */
if (!RESET && FROM > DAYS) {
  console.error(`\n--from ${FROM_RAW} resolves to daily #${FROM}, but --days is ${DAYS}.`);
  console.error(`That would delete dailies from #${FROM} and write none back.`);
  console.error(`Raise --days to at least ${FROM}, or lower --from.\n`);
  process.exit(1);
}

/* Clues written for a club board with the club left implicit. They read
   correctly under a board titled "Arsenal - Strikers" and are unanswerable on a
   mixed daily, where nothing says which club is meant. Themed boards see the
   whole bank; daily and practice see this. */
const generalRows = rows.filter((r) => r.clubOnly !== true);
const clubOnlyIds = new Set(rows.filter((r) => r.clubOnly === true).map((r) => String(r.id)));
if (clubOnlyIds.size) {
  console.log(`${clubOnlyIds.size} club-only row(s) held back from daily and practice`);
}

const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const salt = () => crypto.randomBytes(12).toString("hex");

const writtenIds = new Set();
const daily = [];
const practice = [];
const banner = (what) => [
  "-- Generated by tools/build_puzzles.js. Do not edit by hand.",
  "-- Contains answers: never commit this file.",
  `-- ${what}`,
];
daily.push(...banner(RESET
  ? "--reset: every daily replaced. Only safe before launch."
  : `Dailies from #${FROM} (${from.date}). Days 1..${FROM - 1} are left untouched.`));
daily.push(RESET
  ? "DELETE FROM puzzles WHERE mode = 'daily';"
  : `DELETE FROM puzzles WHERE mode = 'daily' AND daily_no >= ${FROM};`);
practice.push(...banner(RESET || REPLACE_PRACTICE
  ? "Practice pool replaced."
  : "Practice appended; nothing removed, so tokens in play stay valid."));
if (RESET || REPLACE_PRACTICE) practice.push("DELETE FROM puzzles WHERE mode = 'practice';");

/* Days before FROM are still generated, because each day's bans depend on the
   week before it — the chain cannot be joined halfway. They are computed and
   thrown away; only days from FROM are written. */
/* Two constraints on the daily, both measured over 120 days.

   maxPerFamily — transfers are 63% of the bank, so an unconstrained puzzle drew
   6.3 of its 11 from them, and one drew 9: eleven different answers, but the
   same question asked nine times. Capped at 3.

   DAILY_CLUE_WINDOW — a clue used recently sits out, so the game keeps reaching
   for material it has not used. Coverage over 120 days: 769 clues as it was,
   847 with a 40-day window. Unbounded exclusion reaches 880 but starves the
   pool — 40 of 120 puzzles could not reach eleven answers, so it is a window
   rather than a memory.

   The cost is crossings, 16.8 -> 15.3. Fewer intersections means slightly less
   help from letters already in the grid, which is the price of variety. */
/* Transfers are capped at 3; everything else at 2.

   The wildcard was missing, and only the Transfer line existed — so the daily
   capped the one family nobody would have chosen to over-serve and left every
   other family uncapped. Measured over 40 generated days: one board in eight
   came out with four or more of a category, and day 33 with five Managers
   clues in eleven. Eleven different answers, the same question asked five
   times, which is exactly what this cap exists to prevent everywhere else.

   Club boards already used { "*": 2, Transfer: 3 }. This is the same rule
   rather than a second one. Measured at 2: no board fell short on the full
   bank or on a 335-row four-club bank, and distinct answers over a fortnight
   were unchanged — so the cap costs nothing the generator was using. */
const DAILY_FAMILY_CAP = { "*": 2, Transfer: 3 };
const DAILY_CLUE_WINDOW = 440;
let recentDaily = [];

console.log(`Generating days 1..${DAYS}` +
  (FROM > 1 ? `, writing from ${FROM} (earlier days are recomputed for the ban chain, not written)` : ""));
let t0 = Date.now();
let written = 0;
for (let d = 1; d <= DAYS; d++) {
  const opts = FCW.dailyOptions(d, bans);
  opts.maxPerFamily = DAILY_FAMILY_CAP;
  if (recentDaily.length) {
    const ex = {};
    recentDaily.forEach((id) => { ex[id] = true; });
    const f = Object.assign({}, opts.filter || {}, { excludeIds: ex });
    // Never exclude so much that eleven answers cannot be placed.
    if (FCW.filterViability(generalRows, f).enough) opts.filter = f;
  }
  const p = FCW.generate(generalRows, opts);
  p.entries.forEach((e) => recentDaily.push(e.row.id));
  if (recentDaily.length > DAILY_CLUE_WINDOW) {
    recentDaily = recentDaily.slice(-DAILY_CLUE_WINDOW);
  }
  if (p.entries.length !== TARGET_ANSWERS) {
    console.error(`\nDaily #${d} came out with ${p.entries.length} answers, not ${TARGET_ANSWERS}.`);
    console.error("Refusing to write a run with an inconsistent daily.\n");
    process.exit(1);
  }
  if (d >= FROM) {
    p.entries.forEach((e) => writtenIds.add(String(e.row.id)));
    const payload = JSON.stringify({ salt: salt(), puzzle: p });
    daily.push(`INSERT INTO puzzles (mode, daily_no, category, payload) VALUES ` +
      `('daily', ${d}, NULL, ${sqlStr(payload)});`);
    written++;
  }
  if (d % 25 === 0) console.log(`  ${d}/${DAYS}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

/* Practice pools, one per topic group plus an unfiltered pool. /api/practice
   accepts ?category=, and /api/categories publishes the list, so the rows have
   to carry a category or the filter matches nothing and every filtered request
   returns 400. The category column is what those queries read. */
const GROUPS = Object.keys(FCW.groupOptions(generalRows).groups);
const POOLS = [{ category: null, filter: {} },
  ...GROUPS.map((g) => ({ category: g, filter: { groups: [g] } }))];
const perPool = Math.max(1, Math.round(PRACTICE / POOLS.length));

console.log(`Generating ${perPool} practice puzzles for each of ` +
  `${POOLS.length} pools (all${GROUPS.length ? ", " + GROUPS.join(", ") : ""})...`);
t0 = Date.now();
let made = 0;
/* How far back the exclusion reaches. 600 slots covers roughly the last fifty
   puzzles; measured coverage is 851 clues at 200, 977 at 600, and slightly
   worse unbounded — starving the pool makes the generator fall back. */
const RECENT_WINDOW = 600;
let recent = [];
for (const pool of POOLS) {
  // A pool with too few rows cannot make a viable grid; skip it rather than
  // fill the table with failures.
  if (pool.category && !FCW.filterViability(generalRows, pool.filter).enough) {
    console.log(`  skipping ${pool.category}: not enough rows for a viable grid`);
    continue;
  }
  for (let i = 1; i <= perPool; i++) {
    made++;
    /* Rolling exclusion. Generated independently, every practice puzzle picks
       the same short, easy-fitting rows — 120 puzzles between them used just
       109 distinct clues out of 2,948. Excluding what the last few hundred
       slots used forces the generator down into the rest of the bank, which
       takes the same 120 puzzles to 977 distinct clues. */
    let filter = pool.filter;
    if (recent.length) {
      const ex = {};
      recent.forEach((id) => { ex[id] = true; });
      const candidate = Object.assign({}, pool.filter, { excludeIds: ex });
      // Never exclude so much that the grid cannot be built.
      if (FCW.filterViability(generalRows, candidate).enough) filter = candidate;
    }
    /* Eleven answers or it does not get stored. generate() returns the best
       layout it found rather than failing, so when the rolling exclusion
       starves the pool it can come back with nine — and two such puzzles went
       into the pool before this check existed. Retry without the exclusion,
       which is always buildable; variety is worth less than the invariant the
       game is named after. */
    let p = FCW.generate(generalRows, { seed: 1000000 + made * 7919, filter: filter,
                                 maxPerFamily: DAILY_FAMILY_CAP });
    if (p.entries.length !== TARGET_ANSWERS && filter !== pool.filter) {
      p = FCW.generate(generalRows, { seed: 1000000 + made * 7919, filter: pool.filter,
                               maxPerFamily: DAILY_FAMILY_CAP });
      shortRetries++;
    }
    if (p.entries.length !== TARGET_ANSWERS) {
      shortSkipped++;
      continue;                       // never store a puzzle of the wrong size
    }
    const clueIds = p.entries.map((e) => e.row.id);
    clueIds.forEach((id) => writtenIds.add(String(id)));
    recent.push(...clueIds);
    if (recent.length > RECENT_WINDOW) recent = recent.slice(-RECENT_WINDOW);
    const payload = JSON.stringify({ salt: salt(), category: pool.category, puzzle: p });
    practice.push(`INSERT INTO puzzles (mode, daily_no, category, payload, clue_ids) VALUES ` +
      `('practice', NULL, ${pool.category ? sqlStr(pool.category) : "NULL"}, ` +
      `${sqlStr(payload)}, ${sqlStr(JSON.stringify(clueIds))});`);
    if (made % 25 === 0) console.log(`  ${made}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}

/* A flag that silently does nothing the first time somebody forgets it is
   worse than no flag. Assert the held-back rows really were held back, rather
   than trusting that seven call sites were all changed together. */
const leaked = [...writtenIds].filter((id) => clubOnlyIds.has(id));
if (leaked.length) {
  console.error(`\n${leaked.length} club-only clue(s) reached a daily or practice puzzle:`);
  console.error("  " + leaked.slice(0, 10).join(", ") + (leaked.length > 10 ? " ..." : ""));
  console.error("Refusing to write. A club-only clue has no club in it and cannot be");
  console.error("answered on a mixed board.\n");
  process.exit(1);
}

fs.writeFileSync(OUT_DAILY, daily.join("\n") + "\n");
fs.writeFileSync(OUT_PRACTICE, practice.join("\n") + "\n");
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1);
if (shortRetries) console.log(`  ${shortRetries} puzzle(s) rebuilt without the exclusion to reach ${TARGET_ANSWERS}`);
if (shortSkipped) console.log(`  ${shortSkipped} puzzle(s) skipped: could not reach ${TARGET_ANSWERS}`);
console.log(`\nWrote ${OUT_DAILY}     (${mb(OUT_DAILY)}MB, ${written} daily)`);
console.log(`Wrote ${OUT_PRACTICE}  (${mb(OUT_PRACTICE)}MB, ${made} practice)`);
if (RESET) {
  console.log(`\n--reset: every daily and every practice puzzle replaced.`);
} else {
  console.log(`\nReplacing dailies #${FROM}-#${DAYS} (${from.date} onward).`);
  console.log(`#1-#${FROM - 1} untouched. Today is #${TODAY_NO}.`);
  console.log(`Practice is ` +
    (REPLACE_PRACTICE ? "replaced." : "appended, so tokens in play stay valid."));
}
console.log("Import it with:");
console.log("  npx wrangler d1 execute crosswordxi --remote --file=data/daily-production.sql");
console.log("  npx wrangler d1 execute crosswordxi --remote --file=data/practice-production.sql\n");
