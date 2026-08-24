/* GET /api/account/results
 *
 * Everything this account has played, in the shape the browser keeps in
 * localStorage. The other half of migrate.js.
 *
 * Until this existed, signing in was a one-way trip: the browser posted what it
 * had and nothing ever came back. A player who signed in on a laptop, played
 * the daily, then signed in on an iPad saw an empty history — the rows were on
 * the account all along with nowhere to go. The sign-in offer said "across
 * every device you play on", which was not true.
 *
 * Read-only. It never writes, so calling it twice costs nothing and a failure
 * leaves the player exactly as they were.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser } from "../../_lib/auth.js";

/* The same ceiling migrate.js uses. A player with more than this has years of
   history and the tail of it is not what any screen shows. */
const MAX_RESULTS = 400;

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return bad("Accounts are not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Not signed in.", 401);

  /* Newest first, so the cap keeps recent history rather than the oldest.
     A streak is read from the recent end. */
  const rows = await env.DB.prepare(
    `SELECT mode, daily_no, played_on, score, elapsed_seconds,
            checks, check_alls, revealed_letters, revealed_answers,
            substitutions, pauses, paused_seconds, club, season,
            completed_at, source
       FROM results
      WHERE user_id = ?
      ORDER BY daily_no DESC, completed_at DESC
      LIMIT ?`).bind(user.id, MAX_RESULTS).all();

  /* Renamed back to the browser's own field names rather than sending the
     column names. The browser has read this shape since before accounts
     existed, and every screen that reads a result — the streak, the season
     table, My Season — expects it. Translating here keeps that in one place. */
  const results = (rows.results || []).map((r) => ({
    mode: r.mode,
    dailyNo: r.daily_no,
    date: r.played_on,
    score: r.score,
    elapsedSeconds: r.elapsed_seconds,
    checks: r.checks,
    checkAlls: r.check_alls,
    revealedLetters: r.revealed_letters,
    revealedAnswers: r.revealed_answers,
    substitutions: r.substitutions,
    pauses: r.pauses,
    pausedSeconds: r.paused_seconds,
    club: r.club,
    season: r.season,
    completedAt: r.completed_at,
    /* Carried through so the browser can tell a row the server recorded itself
       from one a browser reported. Nothing uses it yet; a leaderboard that
       needs to trust its own rows will. */
    source: r.source,
  }));

  return json({ results, count: results.length, capped: results.length >= MAX_RESULTS },
    200, { "Cache-Control": "no-store" });
}
