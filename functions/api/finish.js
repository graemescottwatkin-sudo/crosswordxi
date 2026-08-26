/* POST /api/finish   { token, playId, letters }  ->  the score
 *
 * The score is the server's. The browser sends what it typed; the server marks
 * it, reads the help it served, times it from the row it wrote when the board
 * was pulled, and returns a number. Whatever the page shows is a display of
 * that number, not a calculation of it.
 *
 * Every input is something the browser cannot influence:
 *
 *   correct   the answers are here, so the grid is marked here
 *   help      every check and reveal came through this server
 *   time      started_at was written by this clock
 *
 * The clock is wall time from the moment the board was pulled, and the game's
 * pause is not honoured. That is a deliberate difference from the local score:
 * a pause the server cannot observe is exactly where a leaderboard would be
 * gamed, so a verified score is timed from the start of the sitting. The
 * device's own score is unaffected and still pauses.
 *
 * It also fixes something unrelated to cheating. Completion used to require
 * every entry to have been verified individually, so a player who filled the
 * last square with no connection got nothing at all — no Full Time, no score —
 * until eleven separate requests had landed. One call now marks the whole grid,
 * so finishing offline works the moment the connection returns.
 */
import { json, bad, normalise } from "../_lib/puzzle.js";
import { getPuzzleForToken, hasDB } from "../_lib/db.js";
import { playableDailyNo } from "../_lib/daily.js";
import { isAdmin } from "../_lib/auth.js";
import { computeScore, gridIsComplete, SCORING } from "../_lib/scoring.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const { token, playId, letters } = body || {};

  if (playableDailyNo(token) === false && !(await isAdmin(request, env))) {
    return bad("That puzzle is not today's daily.", 403);
  }
  const stored = await getPuzzleForToken(env, token);
  if (!stored) return bad("Unknown puzzle.", 404);

  /* Marked against the stored answers. The only thing the browser asserts is
     what it typed, which is the one thing it is entitled to assert. */
  const typed = {};
  for (const k of Object.keys(letters || {})) {
    const v = normalise(String(letters[k] || ""));
    if (v.length === 1) typed[k] = v;
  }
  const complete = gridIsComplete(stored.puzzle, typed);
  if (!complete) return json({ complete: false });

  if (!hasDB(env)) {
    /* No database, so no play row, so no trustworthy time or tally. Say so
       rather than returning a number that looks authoritative and is not. */
    return json({ complete: true, verified: false });
  }

  const row = await env.DB.prepare(
    `SELECT started_at, srv_checks, srv_check_alls,
            srv_reveal_letters, srv_reveal_answers, srv_score
       FROM plays WHERE play_id = ? LIMIT 1`).bind(String(playId || "")).first();
  if (!row) return json({ complete: true, verified: false });

  /* Already scored: hand back what was recorded rather than scoring again. A
     second call cannot improve on the first, which is what stops a finished
     board being re-submitted with a better time. */
  if (row.srv_score !== null && row.srv_score !== undefined) {
    return json({ complete: true, verified: true, score: row.srv_score, already: true });
  }

  const started = Date.parse((row.started_at || "").replace(" ", "T") + "Z");
  const elapsed = Number.isFinite(started)
    ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0;

  /* Help costs match minutes, and the server has to add them itself.

     `elapsed` above is wall-clock from started_at, which knows nothing about
     what was asked for. The browser adds help time to its own clock; without
     the same arithmetic here the verified score would come back HIGHER than the
     one on screen, and the number would jump upward a second after Full Time.

     The counts are the server's own — srv_checks and the rest are incremented
     by the check and reveal endpoints, not reported by the browser. */
  const perMin = SCORING.MATCH_CLOCK_REAL_SECONDS / SCORING.MATCH_CLOCK_MAX_MINUTES;
  const helpSeconds = Math.round(perMin * (
    (row.srv_checks || 0) * SCORING.HELP_MINUTES.check +
    (row.srv_check_alls || 0) * SCORING.HELP_MINUTES.checkAll +
    (row.srv_reveal_letters || 0) * SCORING.HELP_MINUTES.revealLetter +
    (row.srv_reveal_answers || 0) * SCORING.HELP_MINUTES.revealAnswer));

  const res = computeScore(elapsed + helpSeconds,
                           row.srv_checks || 0, row.srv_reveal_letters || 0,
                           row.srv_reveal_answers || 0, row.srv_check_alls || 0);

  await env.DB.prepare(
    `UPDATE plays
        SET srv_score = ?, srv_verified_at = datetime('now'),
            completed = 1, ended_at = COALESCE(ended_at, datetime('now'))
      WHERE play_id = ?`).bind(res.score, String(playId || "")).run();

  return json({
    complete: true, verified: true, score: res.score,
    elapsedSeconds: elapsed,
    checks: row.srv_checks || 0, checkAlls: row.srv_check_alls || 0,
    revealedLetters: row.srv_reveal_letters || 0,
    revealedAnswers: row.srv_reveal_answers || 0,
    breakdown: res,
  });
}
