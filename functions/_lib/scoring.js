/* Scoring, server side.
 *
 * The same arithmetic as FCW.computeScore in js/engine.js, deliberately
 * duplicated rather than shared: engine.js is a browser file that also carries
 * the generator, the seasons and the clue-bank helpers, and importing it into a
 * Worker would drag all of that into every request.
 *
 * Duplication is only safe if it cannot drift, so scoring_test.mjs reads the
 * constants out of engine.js and asserts they match these. Change one and the
 * suite fails.
 *
 * What the server can know, and therefore what a trusted score is made of:
 *
 *   time     from the play row's started_at, written by this clock
 *   checks   it served every /api/check-answer
 *   reveals  it served every /api/reveal
 *   correct  it holds the answers and can mark the grid itself
 *
 * Wall clock, not the paused clock. The game lets a player stop the timer, and
 * the server cannot see a pause — nor should it trust one, since an unverifiable
 * pause is exactly where a leaderboard would be gamed. A challenge is timed from
 * the moment the board was pulled.
 */
export const SCORING = {
  MAX_SCORE: 114,
  /* These MUST match js/engine.js. The server is authoritative, so a
     divergence does not show as an error — it shows as a Full Time screen
     whose number changes a second after it appears, with no explanation. */
  CHECK_PENALTY: 2,
  CHECK_ALL_PENALTY: 9,
  REVEAL_LETTER_PENALTY: 3,
  REVEAL_ANSWER_PENALTY: 12,
  MATCH_CLOCK_REAL_SECONDS: 1800,
  MATCH_CLOCK_MAX_MINUTES: 90,
  DECAY_CURVE: [
    { minute: 0, score: 114 }, { minute: 10, score: 97 },
    { minute: 20, score: 86 }, { minute: 30, score: 78 },
    { minute: 45, score: 68 }, { minute: 60, score: 58 },
    { minute: 75, score: 47 }, { minute: 90, score: 36 },
  ],
};

export function matchMinute(elapsedSeconds) {
  const m = Math.floor(
    (elapsedSeconds / SCORING.MATCH_CLOCK_REAL_SECONDS) * SCORING.MATCH_CLOCK_MAX_MINUTES);
  return Math.max(0, Math.min(SCORING.MATCH_CLOCK_MAX_MINUTES, m));
}

function scoreAtMinute(minute) {
  const c = SCORING.DECAY_CURVE;
  if (minute <= c[0].minute) return c[0].score;
  if (minute >= c[c.length - 1].minute) return c[c.length - 1].score;
  for (let i = 1; i < c.length; i++) {
    if (minute <= c[i].minute) {
      const a = c[i - 1], b = c[i];
      const t = (minute - a.minute) / (b.minute - a.minute);
      return a.score + (b.score - a.score) * t;
    }
  }
  return c[c.length - 1].score;
}

export function computeScore(elapsedSeconds, checks, revealLetters, revealAnswers, checkAlls) {
  const timePenalty = Math.round(SCORING.MAX_SCORE - scoreAtMinute(matchMinute(elapsedSeconds)));
  const checkPenalty = (checks || 0) * SCORING.CHECK_PENALTY;
  const checkAllPenalty = (checkAlls || 0) * SCORING.CHECK_ALL_PENALTY;
  const letterPenalty = (revealLetters || 0) * SCORING.REVEAL_LETTER_PENALTY;
  const answerPenalty = (revealAnswers || 0) * SCORING.REVEAL_ANSWER_PENALTY;
  return {
    score: Math.max(0, SCORING.MAX_SCORE - timePenalty - checkPenalty -
                       checkAllPenalty - letterPenalty - answerPenalty),
    timePenalty, checkPenalty, checkAllPenalty, letterPenalty, answerPenalty,
  };
}

/* Is this grid actually finished and correct? The only part of a score the
   browser has to assert, so it is the part the server marks itself. */
export function gridIsComplete(puzzle, letters) {
  const cells = Object.keys(puzzle.cells || {});
  if (!cells.length) return false;
  for (const k of cells) {
    const want = puzzle.cells[k].ch;
    if (!want) continue;
    if (String((letters || {})[k] || "").toUpperCase() !== String(want).toUpperCase()) {
      return false;
    }
  }
  return true;
}
