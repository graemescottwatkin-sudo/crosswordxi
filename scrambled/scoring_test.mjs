/* scoring_test.mjs — 114 has to mean the same thing in every game.
 *
 *   node scrambled/scoring_test.mjs        (from the repo root)
 *
 * THE DRAFT HASHED THE SHARED BLOCK AND ASSERTED THE HASH, because it lived in
 * its own repo and had nothing to compare against. In the monorepo it does:
 * Crossword XI's functions/_lib/scoring.js is the oldest copy and is therefore
 * the source, and it is right there. So this suite compares the real values.
 *
 * That matters. A hash is a fingerprint of a constant nobody can diff — when
 * it fails it says "something changed" and not what, and the cheapest way past
 * it is to paste in the new hash. Comparing the values names the drift.
 */
import { createRequire } from "node:module";
import { SCORING as CROSSWORD } from "../functions/_lib/scoring.js";

const require = createRequire(import.meta.url);
require("./js/config.js");                       // sets globalThis.SCX_CONFIG
const SC = require("./js/scoring.js");
const CFG = globalThis.SCX_CONFIG;

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const CORE = SC.XI_SCORING_CORE;

console.log("\n=== The family core, compared against Crossword XI ===");
t("the maximum is the family's 114",
  CORE.MAX_SCORE === CROSSWORD.MAX_SCORE, `${CORE.MAX_SCORE} vs ${CROSSWORD.MAX_SCORE}`);
t("a match is ninety match minutes in both",
  CORE.MATCH_CLOCK_MAX_MINUTES === CROSSWORD.MATCH_CLOCK_MAX_MINUTES);
t("the decay curve is the same length",
  CORE.DECAY_CURVE.length === CROSSWORD.DECAY_CURVE.length);
t("and every point on it agrees", CORE.DECAY_CURVE.every((p, i) =>
  p.minute === CROSSWORD.DECAY_CURVE[i].minute &&
  p.score === CROSSWORD.DECAY_CURVE[i].score),
  "a drift here shows as a Full Time number that differs between two XI games");

console.log("\n=== What is per-game, and is meant to be ===");
/* REAL_SECONDS is the clearest case of a value that must NOT be shared:
   Crossword XI maps ninety match minutes onto 1800 real seconds because a
   crossword takes that long. Forcing the two to agree would make one wrong. */
t("this game's real clock is its own",
  CFG.MATCH_CLOCK_REAL_SECONDS === 900 &&
  CFG.MATCH_CLOCK_REAL_SECONDS !== CROSSWORD.MATCH_CLOCK_REAL_SECONDS,
  `${CFG.MATCH_CLOCK_REAL_SECONDS}s here, ${CROSSWORD.MATCH_CLOCK_REAL_SECONDS}s on the crossword`);
t("and it is stated once, in config.js, not restated in scoring.js",
  !/900/.test(require("node:fs").readFileSync("scrambled/js/scoring.js", "utf8")
    .split("XI_SCORING_CORE ----")[1] || ""));

console.log("\n=== The clock ===");
t("nothing elapsed is 0'", SC.matchMinute(0) === 0);
t("half the real clock is half time",
  SC.matchMinute(CFG.MATCH_CLOCK_REAL_SECONDS / 2) === 45);
t("the whole real clock is 90'",
  SC.matchMinute(CFG.MATCH_CLOCK_REAL_SECONDS) === 90);
t("and it never runs past 90'",
  SC.matchMinute(CFG.MATCH_CLOCK_REAL_SECONDS * 10) === 90);
t("a negative elapsed cannot mint minutes", SC.matchMinute(-500) === 0);

console.log("\n=== The score ===");
t("instant and unaided is the full 114", SC.computeScore(0, 0).score === 114);
t("the clock only ever takes points off", (() => {
  let last = -1, ok = true;
  for (let s = 0; s <= CFG.MATCH_CLOCK_REAL_SECONDS; s += 10) {
    const tp = SC.timePenalty(s);
    if (tp < last) ok = false;
    last = tp;
  }
  return ok;
})(), "monotone, so waiting can never be worth more than not waiting");
t("ninety minutes and no help still scores something",
  SC.computeScore(CFG.MATCH_CLOCK_REAL_SECONDS, 0).score === 36,
  "the floor of the curve");
t("help comes off the top", (() => {
  const a = SC.computeScore(0, 0).score, b = SC.computeScore(0, 9).score;
  return a - b === 9;
})());
t("a score cannot go negative", SC.computeScore(CFG.MATCH_CLOCK_REAL_SECONDS, 500).score === 0);
t("the penalties add up to what was taken off", (() => {
  const r = SC.computeScore(300, 12);
  return r.score + r.timePenalty + r.helpPenalty === CORE.MAX_SCORE;
})());

console.log("\n=== The bench is priced against the family ===");
/* Revealing a name ends that slot the way revealing an answer ends a crossword
   entry, so it carries the same cost. A point must buy the same thing in every
   game or a shared score compares nothing. */
/* AND THE FAMILY COMPARISON IS NOT AVAILABLE HERE, WHICH IS WORTH SAYING OUT
   LOUD RATHER THAN FAKING. Crossword XI charges help in MATCH MINUTES and lets
   the curve turn them into points; this game charges points directly. The two
   numbers are not the same unit, so any assertion that 9 here "matches" 14
   there would be a check whose name is broader than its behaviour. What can be
   checked is that this game's own prices are ordered and that the ladder
   cannot be gamed. Reconciling the two economies is an open item. */
t("a letter costs less than a name", CFG.REVEAL_LETTER_COST < CFG.REVEAL_NAME_COST);
t("and the hint sits between them", CFG.REVEAL_HINT_COST > CFG.REVEAL_LETTER_COST &&
  CFG.REVEAL_HINT_COST < CFG.REVEAL_NAME_COST);
t("buying everything for all eleven cannot be cheaper than playing", (() => {
  const worst = 11 * (CFG.REVEAL_NAME_COST);
  return worst > CORE.MAX_SCORE - CORE.DECAY_CURVE[CORE.DECAY_CURVE.length - 1].score;
})(), "revealing the whole XI must cost more than sitting on the clock");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
