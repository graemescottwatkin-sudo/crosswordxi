/* scoring.js — a score is 114 with time and help taken off it.
 *
 * WHAT TRAVELS BETWEEN GAMES, AND WHAT DOES NOT
 *
 * XI_SCORING_CORE below is the part that makes 114 mean the same thing across
 * the family: the maximum, the length of a match in match minutes, and the
 * decay curve. scoring_test.mjs reads the same three values out of
 * functions/_lib/scoring.js — Crossword XI's server-side copy, which is the
 * oldest and therefore the source — and fails if they differ.
 *
 * The draft hashed this block and asserted the hash, because it lived in its
 * own repo and had nothing to compare against. In the monorepo it does: the
 * other game is right there, so the check compares the real values rather than
 * a fingerprint somebody has to remember to bump. A hash of a constant nobody
 * can diff is a sentinel by another name.
 *
 * Everything outside the core is per-game by design and lives in config.js.
 */
(function (root) {
  'use strict';

  /* ---- XI_SCORING_CORE — the family's, not this game's ---- */
  var XI_SCORING_CORE = {
    MAX_SCORE: 114,
    MATCH_CLOCK_MAX_MINUTES: 90,
    DECAY_CURVE: [
      { minute: 0, score: 114 }, { minute: 10, score: 97 },
      { minute: 20, score: 86 }, { minute: 30, score: 78 },
      { minute: 45, score: 68 }, { minute: 60, score: 58 },
      { minute: 75, score: 47 }, { minute: 90, score: 36 }
    ]
  };
  /* ---- end XI_SCORING_CORE ---- */

  /* The real clock is stated ONCE, in config.js. A fallback default here would
     be a second copy of it — and the copy that wins silently when config.js
     fails to load, which is the drift this whole file is written to avoid. So
     a missing config is loud. */
  function cfg() {
    var c = root.SCX_CONFIG;
    if (!c || !c.MATCH_CLOCK_REAL_SECONDS) {
      throw new Error("SCX_CONFIG must load before scoring.js: the real clock lives there.");
    }
    return c;
  }

  function matchMinute(elapsedSeconds) {
    var m = Math.floor((elapsedSeconds / cfg().MATCH_CLOCK_REAL_SECONDS) *
      XI_SCORING_CORE.MATCH_CLOCK_MAX_MINUTES);
    return Math.max(0, Math.min(XI_SCORING_CORE.MATCH_CLOCK_MAX_MINUTES, m));
  }

  function scoreAtMinute(minute) {
    var c = XI_SCORING_CORE.DECAY_CURVE;
    if (minute <= c[0].minute) return c[0].score;
    if (minute >= c[c.length - 1].minute) return c[c.length - 1].score;
    for (var i = 1; i < c.length; i++) {
      if (minute <= c[i].minute) {
        var a = c[i - 1], b = c[i];
        var t = (minute - a.minute) / (b.minute - a.minute);
        return a.score + (b.score - a.score) * t;
      }
    }
    return c[c.length - 1].score;
  }

  function timePenalty(elapsedSeconds) {
    return Math.round(XI_SCORING_CORE.MAX_SCORE - scoreAtMinute(matchMinute(elapsedSeconds)));
  }

  /* help is the running cost of everything bought off the bench. */
  function computeScore(elapsedSeconds, help) {
    var tp = timePenalty(elapsedSeconds);
    var hp = Math.max(0, help || 0);
    return {
      score: Math.max(0, XI_SCORING_CORE.MAX_SCORE - tp - hp),
      timePenalty: tp,
      helpPenalty: hp
    };
  }

  var api = {
    XI_SCORING_CORE: XI_SCORING_CORE,
    MAX_SCORE: XI_SCORING_CORE.MAX_SCORE,
    matchMinute: matchMinute,
    timePenalty: timePenalty,
    computeScore: computeScore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SCX_SCORING = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
