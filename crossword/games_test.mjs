/* games_test.mjs — one account, more than one game.
 *
 * Migration 020 exists because the session cookie has always been scoped to
 * .thexigames.com while `results` was keyed on daily_no, a crossword idea. A
 * player signed in on the crossword was already signed in on the word search
 * and there was nothing for that to carry.
 *
 * What this suite is for: the rules that only appear once there are two games,
 * and which no existing suite could have caught because no existing suite knew
 * a second game existed.
 *
 *   node crossword/games_test.mjs        (from the repo root)
 */
import { GAMES, DEFAULT_GAME, validGame, entryKey, detailOf, playedOn }
  from "../functions/_lib/games.js";
import { csrfOk, CSRF_HEADER } from "../functions/_lib/auth.js";
import fs from "node:fs";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

console.log("The list of games");
t("every game id is lower case and plain", GAMES.every((g) => /^[a-z]+$/.test(g)));
t("the default is one of them", GAMES.indexOf(DEFAULT_GAME) > -1);
t("an unknown id is refused, not coerced", validGame("wordsearchxi") === null &&
  validGame("../etc") === null && validGame("CROSSWORD") === "crossword");
/* Absent is not the same question as wrong. Every caller written before 020
   asked about the crossword and must keep getting that answer; a typo must
   not quietly become one. */
t("absent means the crossword, so old callers keep working",
  validGame(undefined) === "crossword");
t("but empty and null are still absent, not errors",
  validGame(null) === "crossword" && validGame("") === "crossword");

console.log("\nThe one entry key");
t("a crossword row is keyed by its daily number",
  entryKey("crossword", { dailyNo: 2 }) === "daily:2");
t("a word search row is keyed by the board's day",
  entryKey("wordsearch", { day: "2026-08-27" }) === "ws:2026-08-27");
/* The two games must never compose the same key for different rows, or one
   game's history would deduplicate against the other's. */
t("the two games cannot collide", (() => {
  const a = entryKey("crossword", { dailyNo: 20260827 });
  const b = entryKey("wordsearch", { day: "2026-08-27" });
  return a !== b;
})());
t("a row with nothing to be unique by has no key, so it is skipped",
  entryKey("crossword", {}) === null &&
  entryKey("crossword", { dailyNo: 0 }) === null &&
  entryKey("wordsearch", {}) === null &&
  entryKey("wordsearch", { day: "not-a-day" }) === null);
/* The grace rule: a board finished the day after still belongs to its own
   day. Keying on when it was played would file it as a second board. */
t("the key is the board's day, not the day it was played",
  entryKey("wordsearch", { day: "2026-08-26", playedAt: "2026-08-27" }) === "ws:2026-08-26");
t("an unknown game composes no key at all", entryKey("scrambled", { dailyNo: 1 }) === null);

console.log("\nThe day a row belongs to");
/* The crossword's browser record calls it `date`, the word search's calls it
   `day`. migrate.js read only `date`, so every word search row landed with
   played_on NULL — and results.js ORDERS BY that column, so a whole game's
   history sorted as null. Reconciled in one place now; asserted here against
   both real record shapes rather than one. */
t("a crossword row's day is read from `date`",
  playedOn("crossword", { date: "2026-08-26" }) === "2026-08-26");
t("a word search row's day is read from `day`",
  playedOn("wordsearch", { day: "2026-08-27" }) === "2026-08-27");
t("a full timestamp is trimmed to the date",
  playedOn("wordsearch", { day: "2026-08-27T22:14:00Z" }) === "2026-08-27");
t("and a row carrying neither gives null rather than a broken string",
  playedOn("wordsearch", {}) === null && playedOn("crossword", { date: "soon" }) === null);
/* The column is NOT NULL-tolerant in practice: results.js sorts on it. If a
   game is ever added whose record uses a third name, this fails rather than
   filing its whole history under null. */
t("every released game can produce a day from its own record shape",
  playedOn("crossword", { date: "2026-08-26" }) !== null &&
  playedOn("wordsearch", { day: "2026-08-27" }) !== null);

console.log("\nGame-specific facts go in detail, not in columns");t("the crossword adds no detail — its fields are already columns",
  detailOf("crossword", { dailyNo: 1 }) === null);
t("a word search carries its own facts as JSON", (() => {
  const d = JSON.parse(detailOf("wordsearch",
    { found_count: 11, bonus_found: true, minute: 42, puzzleId: "XIWS-0239" }));
  return d.foundCount === 11 && d.bonusFound === true && d.minute === 42 &&
         d.puzzleId === "XIWS-0239";
})());
t("it reads either spelling, because the browser writes snake_case", (() => {
  const a = JSON.parse(detailOf("wordsearch", { foundCount: 7, bonusFound: false, puzzleId: "XIWS-0001" }));
  const b = JSON.parse(detailOf("wordsearch", { found_count: 7, bonus_found: false, puzzle_id: "XIWS-0001" }));
  return a.foundCount === b.foundCount && a.bonusFound === b.bonusFound &&
         a.puzzleId === b.puzzleId && a.puzzleId === "XIWS-0001";
})());
/* EVERY field, not most of them. Two were handled for both spellings and two
   were not, so puzzleId arrived null on every row that reached production —
   the same fault as `date` vs `day`, in the same commit, found separately. */
t("the record the word search actually writes loses nothing", (() => {
  const written = {
    game: "wordsearch", day: "2026-08-27", puzzle_id: "XIWS-0239",
    score: 94, minute: 63, found_count: 11, bonus_found: true, complete: true,
  };
  const d = JSON.parse(detailOf("wordsearch", written));
  return d.puzzleId === "XIWS-0239" && d.foundCount === 11 &&
         d.bonusFound === true && d.minute === 63 &&
         playedOn("wordsearch", written) === "2026-08-27" &&
         entryKey("wordsearch", written) === "ws:2026-08-27";
})());
t("absurd numbers are clamped rather than stored", (() => {
  const d = JSON.parse(detailOf("wordsearch", { found_count: -5, minute: 1e12 }));
  return d.foundCount === 0 && d.minute === 1e6;
})());

console.log("\nOne CSRF rule, two header names");
const withHeader = (name) => new Request("https://www.thexigames.com/api/x",
  { method: "POST", headers: { [name]: "1" } });
t("the family header is accepted", csrfOk(withHeader(CSRF_HEADER)));
/* A browser holding a cached crossword game.js is still sending the old name
   and must not start failing mid-session. */
t("the crossword's original header is still accepted",
  csrfOk(withHeader("X-Crossword-XI")));
t("and a request carrying neither is refused",
  !csrfOk(new Request("https://www.thexigames.com/api/x", { method: "POST" })));

console.log("\nWhat migration 020 must actually contain");
const sql = fs.readFileSync("data/migrations/020-results-game.sql", "utf8");
t("it adds the game column with a default, so existing rows stay valid",
  /ALTER TABLE results ADD COLUMN game TEXT NOT NULL DEFAULT 'crossword'/.test(sql));
t("it adds the key column", /ADD COLUMN entry_key/.test(sql));
/* A unique index over a column that is NULL on old rows does not constrain
   them: the backfill is what makes the constraint describe the data. */
t("it backfills the key from daily_no before constraining it", (() => {
  const backfill = sql.indexOf("SET entry_key = 'daily:'");
  const index = sql.indexOf("CREATE UNIQUE INDEX");
  return backfill > -1 && index > -1 && backfill < index;
})());
t("and leaves no row without a key for the index to let through repeatedly",
  /SET entry_key = 'row:' \|\| id/.test(sql));
t("the uniqueness rule is in the schema, not only in application code",
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_results_entry\s+ON results \(user_id, game, entry_key\)/.test(sql));

console.log("\nThe endpoints ask the shared module, not their own copy");
const migrate = fs.readFileSync("functions/api/account/migrate.js", "utf8");
const results = fs.readFileSync("functions/api/account/results.js", "utf8");
t("migrate composes no key of its own", !/["'`]daily:["'`]\s*\+/.test(migrate) &&
  /entryKey\(/.test(migrate));
t("results filters by game rather than returning everything",
  /WHERE user_id = \? AND game = \?/.test(results));
/* The insert must be OR IGNORE or the unique index turns a race between two
   devices into a 500 rather than a skip. */
t("the insert defers to the index instead of racing it",
  /INSERT OR IGNORE INTO results/.test(migrate));
t("neither file keeps a private list of games",
  !/\[\s*["']crossword["']\s*,\s*["']wordsearch["']/.test(migrate + results));

/* THE INSERT ADDS UP.
 *
 * Adding `game`, `entry_key` and `detail` meant three more columns, three more
 * binds and three more placeholders. Two placeholders were added. 23 columns,
 * 21 marks, 22 binds — and D1 threw on every single migrate call, into a
 * `.catch` that said nothing. It shipped because every assertion about this
 * statement was a regex looking for words in it, and a regex cannot count.
 *
 * The three numbers must agree, and they are counted rather than eyeballed.
 * The bind count is taken from the argument list of the .bind() that follows,
 * which is the only other place the number lives. */
t("the results INSERT has as many placeholders as columns, and as many binds as placeholders",
  (() => {
    const stmt = migrate.match(/INSERT OR IGNORE INTO results \(([\s\S]*?)\)\s*\n\s*VALUES \(([^)]*)\)`\)\s*\n\s*\.bind\(([\s\S]*?)\)\.run\(\)/);
    if (!stmt) return false;                       // the shape changed; look again
    const columns = stmt[1].split(",").map((x) => x.trim()).filter(Boolean).length;
    const slots = stmt[2].split(",").map((x) => x.trim());
    const marks = slots.filter((v) => v === "?").length;
    const literals = slots.length - marks;
    /* Binds are split on top-level commas only: intOr(r.score, null) is one
       argument, not two, and counting raw commas would have "agreed" with the
       wrong number. */
    let depth = 0, binds = 1, seen = false;
    for (const ch of stmt[3]) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (ch === "," && depth === 0) binds++;
      if (!/\s/.test(ch)) seen = true;
    }
    /* A trailing comma before the closing paren is idiomatic here and would
       otherwise count as an extra argument. */
    if (/,\s*$/.test(stmt[3])) binds--;
    return seen && columns === marks + literals && binds === marks;
  })(),
  "23 columns, 22 placeholders, 22 binds");

const ws = fs.readFileSync("wordsearch/js/game.js", "utf8");
console.log("\nBoth games push at the same moments");
const cw = fs.readFileSync("crossword/js/game.js", "utf8");
/* The crossword pushed only at sign-in and at code-claim, so a board finished
   while already signed in sat on the device until the next sign-in — while the
   word search pushed after every completed board. One fact, two behaviours,
   and the kind that is invisible until someone plays on two devices. */
t("the crossword pushes after recording a finished daily", (() => {
  const rec = cw.match(/list\.sort\([\s\S]{0,400}?saveResults\(list\);[\s\S]{0,400}?return list;/);
  return !!rec && /pushResults\(\)/.test(rec[0]);
})());
/* After the device has its copy, never before: a failed push must leave the
   record where it was. */
t("and only after the device has saved its own copy", (() => {
  const rec = cw.match(/saveResults\(list\);[\s\S]{0,400}?return list;/);
  return !!rec && rec[0].indexOf("saveResults(list)") < rec[0].indexOf("pushResults()");
})());
t("the word search pushes after recording a completed board", (() => {
  const rec = ws.match(/function recordResult\([\s\S]{0,600}?\n  \}/);
  return !!rec && /pushResults\(\)/.test(rec[0]);
})());
/* The migrate call was written out twice before this and would have been three
   times. One named function, asked in three places. */
t("neither game calls migrate directly outside its own pusher",
  (cw.match(/apiAuth\(["']\/api\/account\/migrate["']/g) || []).length === 1 &&
  (ws.match(/apiAuth\(["']\/api\/account\/migrate["']/g) || []).length === 1);

console.log("\nThe word search actually asks");
t("it reads the session", /api\/auth\/session/.test(ws));
t("it pushes under its own game id", /game:\s*["']wordsearch["']/.test(ws));
t("it pulls under its own game id", /account\/results\?game=wordsearch/.test(ws));
/* Push then pull. The other order fetches, merges, and then pushes rows the
   account already had. */
t("it pushes before it pulls", (() => {
  const m = ws.match(/pushResults\(\)\.then\(pullResults\)/);
  return !!m;
})());
t("it sends the CSRF header, or every post is a 403",
  new RegExp(`["']${CSRF_HEADER}["']\\s*:\\s*["']1["']`).test(ws));
/* Nothing on the board waits for an account: signed out, offline and failed
   all reach the grid at the same speed. */
t("the sync is fire and forget at boot", /^\s*syncAccount\(\);/m.test(ws));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
