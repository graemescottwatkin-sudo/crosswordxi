/* HiLo XI — scoring.js: the owner's rules for this game, in one place.
 *
 * ELEVEN CLOCKS, ONE PER CALL. A call's clock starts when the call is shown.
 * It holds for a grace so the call can be read, then the call's points fall
 * in a straight line to zero at the end of the clock. A right call is worth
 * ten inside the grace, less the longer it takes, nothing at the last
 * instant; the floor is zero and it still costs no substitution. A call
 * that runs out is a wrong call. Twelve seconds, two of grace, ten falling a
 * point a second — so the number on the clock is the points on offer.
 *
 * SCORE. Up to ten for each right call, 110 for eleven, plus two for each
 * completed run of five right in a row: runs of five to nine earn two, ten
 * or eleven earn four, so two runs of five or a perfect eleven reach 114 and
 * nothing exceeds it. No time bonus.
 *
 * SUBSTITUTIONS. Three; each wrong call spends one. No other help.
 * RESULT. Win: eleven calls made with at most three wrong. Draw: finished
 * with four or more wrong. Loss: unfinished.
 *
 * Loaded by the page as a script and by the tests as a module; the same
 * numbers either way, which is the point of a file.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HL_SCORING = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  var CLOCK_MS = 12000, GRACE_MS = 2000, CALL_MAX = 10, CALLS = 11;
  var SUBS = 3, CEILING = 114, RUN = 5, RUN_BONUS = 2, LONG_RUN = 10, LONG_RUN_BONUS = 4;

  /* What a right call made after `elapsedMs` on its clock is worth. Whole
     points, rounded up, so the number the player read off the clock as they
     pressed is the number they get. */
  function worthAt(elapsedMs) {
    var t = Math.max(0, Number(elapsedMs) || 0);
    if (t <= GRACE_MS) return CALL_MAX;
    if (t >= CLOCK_MS) return 0;
    return Math.ceil(CALL_MAX * (1 - (t - GRACE_MS) / (CLOCK_MS - GRACE_MS)) - 1e-9);
  }

  /* The run bonus from the sequence of outcomes (true right, false wrong,
     undefined not reached): two for every completed run of five, four for a
     run of ten or eleven, counted per run rather than per five. */
  function runBonus(results) {
    var bonus = 0, run = 0;
    for (var i = 0; i < CALLS; i++) {
      if (results[i] === true) { run++; }
      else { bonus += bonusForRun(run); run = 0; }
    }
    return bonus + bonusForRun(run);
  }
  function bonusForRun(n) {
    if (n >= LONG_RUN) return LONG_RUN_BONUS;
    if (n >= RUN) return RUN_BONUS;
    return 0;
  }

  /* The round's score: the worth banked on each right call, plus the run
     bonus, capped at the ceiling. */
  function score(results, worths) {
    var base = 0;
    for (var i = 0; i < CALLS; i++) if (results[i] === true) base += Number(worths[i]) || 0;
    return Math.min(CEILING, base + runBonus(results));
  }

  function wrongCount(results) {
    var n = 0;
    for (var i = 0; i < CALLS; i++) if (results[i] === false) n++;
    return n;
  }
  function madeCount(results) {
    var n = 0;
    for (var i = 0; i < CALLS; i++) if (results[i] === true || results[i] === false) n++;
    return n;
  }
  /* W, D or L. Unfinished is a loss, however it got there. */
  function result(results) {
    if (madeCount(results) < CALLS) return "L";
    return wrongCount(results) <= SUBS ? "W" : "D";
  }

  return {
    CLOCK_MS: CLOCK_MS, GRACE_MS: GRACE_MS, CALL_MAX: CALL_MAX, CALLS: CALLS,
    SUBS: SUBS, CEILING: CEILING, RUN: RUN,
    worthAt: worthAt, runBonus: runBonus, score: score,
    wrongCount: wrongCount, madeCount: madeCount, result: result,
  };
});
