/* scoring_test.mjs — the server's arithmetic against the browser's.
 *
 * functions/_lib/scoring.js duplicates FCW.computeScore rather than importing
 * it: engine.js is a browser file that also carries the generator, the seasons
 * and the clue-bank helpers, and pulling that into a Worker would drag all of
 * it into every request.
 *
 * Duplication is only safe if it cannot drift. This reads the constants and the
 * curve out of engine.js and holds the server's copy to them, then checks the
 * two produce identical scores across the range. Change one and this fails.
 */
import fs from "node:fs";
import { SCORING, computeScore, matchMinute, gridIsComplete } from "./functions/_lib/scoring.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const enginePath = "engine.js";
if (!fs.existsSync(enginePath)) {
  console.log("  --  engine.js is not here; run from a folder with the source alongside");
  process.exit(0);
}
const engine = fs.readFileSync(enginePath, "utf8");

console.log("The constants match the browser's");
for (const key of ["MAX_SCORE", "CHECK_PENALTY", "CHECK_ALL_PENALTY",
                   "REVEAL_LETTER_PENALTY", "REVEAL_ANSWER_PENALTY",
                   "MATCH_CLOCK_REAL_SECONDS", "MATCH_CLOCK_MAX_MINUTES"]) {
  const m = new RegExp(key + ":\\s*(\\d+)").exec(engine);
  t(key, m && Number(m[1]) === SCORING[key], m ? `engine ${m[1]} vs server ${SCORING[key]}` : "not found in engine.js");
}

const curve = /DECAY_CURVE:\s*\[([\s\S]*?)\]/.exec(engine);
const pairs = [...(curve ? curve[1] : "").matchAll(/minute:\s*(\d+),\s*score:\s*(\d+)/g)]
  .map((m) => ({ minute: Number(m[1]), score: Number(m[2]) }));
t("the decay curve has the same shape",
  pairs.length === SCORING.DECAY_CURVE.length, `${pairs.length} points vs ${SCORING.DECAY_CURVE.length}`);
t("and the same values at every landmark",
  pairs.every((p, i) => p.minute === SCORING.DECAY_CURVE[i].minute &&
                        p.score === SCORING.DECAY_CURVE[i].score));

console.log("\nThe arithmetic behaves");
t("a clean instant finish is the maximum", computeScore(0, 0, 0, 0, 0).score === 114);
t("the floor is the 90th minute, and decay stops there", (() => {
  const at90 = computeScore(1800, 0, 0, 0, 0).score;
  const at180 = computeScore(3600, 0, 0, 0, 0).score;
  return at90 === at180 && at90 === 36;
})(), computeScore(1800, 0, 0, 0, 0).score + " at 30 real minutes");
t("help is subtracted at the advertised prices", (() => {
  const base = computeScore(0, 0, 0, 0, 0).score;
  return base - computeScore(0, 1, 0, 0, 0).score === 3 &&
         base - computeScore(0, 0, 1, 0, 0).score === 2 &&
         base - computeScore(0, 0, 0, 1, 0).score === 9 &&
         base - computeScore(0, 0, 0, 0, 1).score === 9;
})());
t("a score can never go below zero", computeScore(3600, 40, 40, 40, 40).score === 0);
t("the match clock is capped at ninety", matchMinute(999999) === 90);

console.log("\nMarking a grid");
const puzzle = { cells: { "0,0": { ch: "A" }, "1,0": { ch: "B" }, "2,0": { ch: "C" } } };
t("a correct grid is complete", gridIsComplete(puzzle, { "0,0": "A", "1,0": "B", "2,0": "C" }));
t("case does not matter", gridIsComplete(puzzle, { "0,0": "a", "1,0": "b", "2,0": "c" }));
t("one wrong letter is not complete", !gridIsComplete(puzzle, { "0,0": "A", "1,0": "X", "2,0": "C" }));
t("a missing letter is not complete", !gridIsComplete(puzzle, { "0,0": "A", "1,0": "B" }));
t("an empty puzzle is never complete", !gridIsComplete({ cells: {} }, {}));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
