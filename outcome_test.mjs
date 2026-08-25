/* The win/draw/loss rule.
 *
 * One function decides what a finished board was worth, so the finish screen,
 * the season table, the form chips and the server cannot disagree. If this
 * drifts, every one of those drifts with it — which is why it is tested on its
 * own rather than through whatever happens to call it.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, "js/engine.js"), "utf8"), ctx);
const FCW = ctx.FCW || ctx.window.FCW;

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const rec = (x) => Object.assign({
  complete: true, elapsedSeconds: 300, revealedLetters: 0, revealedAnswers: 0,
}, x);

console.log("\nWhat counts as a win");
t("solved with nothing used", FCW.outcome(rec({})) === "W");
t("solved having spent all three substitutions",
  FCW.outcome(rec({ revealedLetters: 3 })) === "W",
  "spending the allocation is not exceeding it");
t("a revealed answer uses exactly three, so it is still a win",
  FCW.outcome(rec({ revealedAnswers: 1 })) === "W");

console.log("\nWhat makes it a draw");
t("a fourth letter", FCW.outcome(rec({ revealedLetters: 4 })) === "D");
t("an answer with one already spent",
  FCW.outcome(rec({ revealedLetters: 1, revealedAnswers: 1 })) === "D",
  "needs three, has two");
t("two revealed answers", FCW.outcome(rec({ revealedAnswers: 2 })) === "D");
t("solved after full time, with everything in hand",
  FCW.outcome(rec({ elapsedSeconds: 60 * 31 })) === "D",
  "90 match minutes is 30 real ones");
t("and exactly at full time is late enough",
  FCW.outcome(rec({ elapsedSeconds: FCW.SCORING.MATCH_CLOCK_REAL_SECONDS })) === "D");

console.log("\nWhat makes it a loss");
t("started and not finished", FCW.outcome(rec({ complete: false })) === "L");
t("no record at all", FCW.outcome(null) === "L");
t("an unfinished board is a loss however little help was used",
  FCW.outcome(rec({ complete: false, revealedLetters: 0 })) === "L");

console.log("\nSubstitutions");
t("three per board", FCW.SCORING.SUBS_PER_BOARD === 3);
t("a letter costs one", FCW.subsSpent(rec({ revealedLetters: 1 })) === 1);
t("an answer costs three", FCW.subsSpent(rec({ revealedAnswers: 1 })) === 3);
t("remaining never goes below zero",
  FCW.subsRemaining(rec({ revealedLetters: 9 })) === 0);
t("spending all three leaves none but does not exceed",
  FCW.subsRemaining(rec({ revealedAnswers: 1 })) === 0 &&
  !FCW.subsExceeded(rec({ revealedAnswers: 1 })));

console.log("\nPoints");
t("a win is three", FCW.outcomePoints("W") === 3);
t("a draw is one", FCW.outcomePoints("D") === 1);
t("a loss is none", FCW.outcomePoints("L") === 0);
t("a perfect season reaches the maximum score",
  38 * FCW.outcomePoints("W") === FCW.SCORING.MAX_SCORE,
  "38 x 3 = " + FCW.SCORING.MAX_SCORE);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
