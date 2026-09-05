/* wordsearch/js/scoring.js — what a Wordsearch XI score is, in one file.
 *
 * Extracted from game.js when the server started computing this score too. The
 * other games did this already for the same reason: HiLo's scoring.js and
 * Scrambled's are imported by their Workers, so there is one statement of the
 * rule and no drift to write a check against. The crossword duplicates its
 * engine and pays for it with a drift check; this does not.
 *
 * Written to load BOTH ways — as a plain <script> in the page and as an ES
 * module in a Worker — which is the whole reason it can be shared.
 *
 * WHAT THE SCORE IS. The clock counts in match minutes: 600 real seconds is
 * 90 minutes, so a word search is a ten-minute game where the crossword is a
 * thirty-minute one. The score is what the clock has left, on the family's
 * curve, plus ten for the secret. Fouls push the clock forward, which is why
 * fifteen minutes of them can turn a win into a draw.
 */
(function (root) {
  "use strict";

  var REAL_SECONDS = 600;
  var MAX_SCORE = 114;
  var BONUS = 10;

  /* The family's curve, in match minutes. It drops fastest early and levels
     off, so finishing late still gets a result. */
  var CURVE = [[0,104],[10,99],[20,91],[30,83],[45,71],[60,57],[70,44],[80,26],[85,13],[90,0]];

  function scoreForMinute(m) {
    if (m <= 0) return 104;
    if (m >= 90) return 0;
    for (var i = 1; i < CURVE.length; i++) {
      if (m <= CURVE[i][0]) {
        var a = CURVE[i - 1], b = CURVE[i], t = (m - a[0]) / (b[0] - a[0]);
        return Math.round(a[1] + (b[1] - a[1]) * t);
      }
    }
    return 0;
  }

  /* ---- the foul rule ----
   *
   * A wrong selection costs a minute, and consecutively wrong ones cost more:
   * +1', +2', +3', then +4' for every one after that, capped at fifteen
   * minutes for the whole board. The run resets after seven quiet seconds.
   *
   * THE RUN IS THE PART THAT NEEDS THE TIMES. A running total cannot say
   * whether two fouls were consecutive or eight seconds apart, and those cost
   * differently — so the server keeps a row per foul and derives the penalty
   * from the sequence, applying the same rule to the same data the page did.
   */
  var FOUL_STEP_MAX = 4;
  var FOUL_CAP = 15;
  var FOUL_RESET_MS = 7000;

  /* Minutes of penalty for a sequence of foul timestamps, in order. */
  function penaltyFor(atMsList) {
    var list = (atMsList || []).slice().sort(function (a, b) { return a - b; });
    var penalty = 0, run = 0, prev = null;
    for (var i = 0; i < list.length; i++) {
      var at = Number(list[i]);
      if (!isFinite(at)) continue;
      /* Seven quiet seconds and the run is over — the next wrong one starts
         again at a single minute. */
      if (prev !== null && at - prev > FOUL_RESET_MS) run = 0;
      run++;
      penalty = Math.min(FOUL_CAP, penalty + Math.min(FOUL_STEP_MAX, run));
      prev = at;
    }
    return penalty;
  }

  /* The match minute the clock shows: elapsed play, plus the fouls. */
  function matchMinute(elapsedSeconds, penaltyMinutes) {
    var e = Math.max(0, Number(elapsedSeconds) || 0);
    var p = Math.max(0, Number(penaltyMinutes) || 0);
    return Math.min(90, Math.floor((e / REAL_SECONDS) * 90) + p);
  }

  /* The whole thing. `found` is how many of the eleven were found; a board
     that is not finished has no final score, which is the caller's business —
     this says what the score WOULD be at that clock. */
  function computeScore(elapsedSeconds, penaltyMinutes, bonusFound) {
    var minute = matchMinute(elapsedSeconds, penaltyMinutes);
    var base = scoreForMinute(minute);
    return {
      minute: minute,
      base: base,
      bonus: bonusFound ? BONUS : 0,
      score: Math.min(MAX_SCORE, base + (bonusFound ? BONUS : 0)),
    };
  }

  var api = {
    REAL_SECONDS: REAL_SECONDS,
    MAX_SCORE: MAX_SCORE,
    BONUS: BONUS,
    WORDS: 11,
    CURVE: CURVE,
    FOUL_STEP_MAX: FOUL_STEP_MAX,
    FOUL_CAP: FOUL_CAP,
    FOUL_RESET_MS: FOUL_RESET_MS,
    scoreForMinute: scoreForMinute,
    penaltyFor: penaltyFor,
    matchMinute: matchMinute,
    computeScore: computeScore,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.XIWS_SCORING = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
