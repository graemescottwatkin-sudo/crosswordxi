/* retire_test.mjs — a saved practice board survives its pool being retired.
 *
 * Retiring the practice pool is one UPDATE renaming `mode` to
 * 'practice_retired'. Every query that SELECTS a practice board filters
 * `mode = 'practice'`, so the rename takes all 300 out of circulation at once
 * with no delete. But the query that RESUMES a saved board filtered the same
 * way — so the rename that correctly hides retired boards from new games also
 * hid them from the player halfway through one, whose game became "that
 * practice puzzle is no longer stored" mid-solve.
 *
 * This suite exists because that fix cannot be tested by the data: nothing has
 * `mode = 'practice_retired'` until the day someone runs the retirement, and a
 * fix nothing exercises is one edit away from being silently undone. So the
 * stub below IS a retired row, and the real getPuzzleForToken is executed
 * against it.
 *
 * Both halves are asserted, because only one of them is the fix:
 *   - a token RESOLVES a retired board  (you can finish the one you hold)
 *   - selection still REFUSES one       (you cannot be given a new one)
 * A suite asserting only the first would pass a change that reopened retired
 * boards to fresh games, which is the whole point of retiring them.
 */
import fs from "node:fs";
import { getPuzzleForToken } from "../functions/_lib/db.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A stub that models the WHERE clause rather than the row: it reads which
   modes the SQL admits, so the question asked is "does the query this code
   sends reach a retired row", not "does the file contain a string". */
function envFor(row) {
  return { DB: { prepare(sql) {
    return { bind(...b) { return { async first() {
      const inList = (sql.match(/mode IN \(([^)]*)\)/) || [, ""])[1];
      const eq = (sql.match(/mode = '([a-z_]+)'/) || [, ""])[1];
      const modes = inList ? inList.split(",").map((s) => s.trim().replace(/'/g, "")) : (eq ? [eq] : []);
      if (modes.indexOf(row.mode) === -1) return null;
      if (Number(b[0]) !== row.id) return null;
      return { payload: row.payload, id: row.id };
    } }; } };
  } } };
}
const RETIRED = { id: 42, mode: "practice_retired", payload: JSON.stringify({ marker: "retired-board" }) };
const LIVE = { id: 43, mode: "practice", payload: JSON.stringify({ marker: "live-board" }) };

console.log("A board you already hold");
const got = await getPuzzleForToken(envFor(RETIRED), "practice:42");
t("a retired board still resolves by its token",
  !!got && got.marker === "retired-board",
  got ? "resolved" : "returned null — a game in progress would have died here");

const still = await getPuzzleForToken(envFor(LIVE), "practice:43");
t("and a live practice board is unaffected", !!still && still.marker === "live-board");

console.log("\nBut you cannot be dealt a new one");
/* Read as text, deliberately: these are the SELECTION queries, and the rule is
   about which modes they admit. Executing each would need the whole pool. */
const db = fs.readFileSync("functions/_lib/db.js", "utf8");
const selects = [...db.matchAll(/"SELECT[^"]*FROM puzzles[^"]*"/g)].map((m) => m[0])
  .filter((s) => !/LIMIT 1/.test(s) || !/id = \?/.test(s));
t("every selection query still admits only 'practice'",
  selects.length > 0 && selects.every((s) => !/practice_retired/.test(s)),
  `${selects.length} selection queries checked`);
t("and exactly one query admits the retired mode — the resume lookup",
  (db.match(/practice_retired/g) || []).filter((_, i, a) => a.length).length >= 1 &&
  (db.match(/mode IN \('practice', 'practice_retired'\)/g) || []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
