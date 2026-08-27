/* POST /api/account/migrate  { game?, club?, results: [...] }
 *
 * A guest who signs in must not lose what they have already played. The
 * browser posts what it has in localStorage once, and it is written against
 * the new account.
 *
 * This is the foundation, not the finished article. Two rules make it safe to
 * build on:
 *
 *   - Migrated rows are marked `source = 'migrated'`, so a leaderboard can
 *     later choose to trust only rows it recorded itself. Everything here came
 *     from a browser and cannot be verified after the fact.
 *   - A daily is unique per player. Signing in twice, or migrating twice, tops
 *     up what is missing rather than duplicating a run — a streak built on
 *     duplicates would be meaningless.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, csrfOk, newId } from "../../_lib/auth.js";
import { validGame, entryKey, detailOf } from "../../_lib/games.js";

const MAX_RESULTS = 400;

function intOr(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1e6) : dflt;
}
function str(v, len) {
  return v === null || v === undefined ? null : String(v).slice(0, len);
}

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Accounts are not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Not signed in.", 401);

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  /* The club follows the player to the account, but never overwrites a choice
     already made there — the account is the more deliberate of the two. */
  if (!user.club && body.club) {
    await env.DB.prepare("UPDATE users SET club = ? WHERE id = ?")
      .bind(String(body.club).slice(0, 60), user.id).run();
  }

  /* Which game's history this is. Absent means crossword, because every
     migration posted before 020 existed was a crossword one and those bodies
     must keep meaning what they meant. An unknown id is refused rather than
     defaulted: a typo silently filed under 'crossword' is worse than an
     error. */
  const game = validGame(body.game === undefined ? undefined : body.game);
  if (!game) return bad("Unknown game.");

  const list = Array.isArray(body.results) ? body.results.slice(0, MAX_RESULTS) : [];
  let added = 0, skipped = 0;

  for (const r of list) {
    // The array came from a browser's localStorage: it can contain nulls,
    // numbers, strings, anything. Check the shape before reading fields.
    if (!r || typeof r !== "object") { skipped++; continue; }

    /* Dailies only. The browser records nothing else — practice is explicitly
       not counted towards streaks or stats — and a practice row has no key to
       deduplicate on, so anything without a daily number would be inserted
       again on every migration. Signing in on a third device would then treble
       it. Skipped rather than trusted. */
    /* ONE key, composed in _lib/games.js and nowhere else. A row with nothing
       to be unique by is skipped — that is why practice boards never migrated,
       and it is now the same sentence for every game rather than a per-game
       rule each caller reimplements. */
    const key = entryKey(game, r);
    if (!key) { skipped++; continue; }
    const dailyNo = game === "crossword" ? intOr(r.dailyNo, null) : null;
    const mode = "daily";

    const seen = await env.DB
      .prepare("SELECT id FROM results WHERE user_id = ? AND game = ? AND entry_key = ?")
      .bind(user.id, game, key).first();
    if (seen) { skipped++; continue; }           // already have this one

    /* OR IGNORE, against the unique index 020 adds. The SELECT above is the
       cheap path; this is the one that holds when two devices migrate the same
       history at the same moment and both SELECTs come back empty. A duplicate
       daily makes a streak meaningless, so the rule belongs in the schema and
       not only in the order these statements happen to run. */
    await env.DB.prepare(
      `INSERT OR IGNORE INTO results (id, user_id, game, entry_key, detail,
        puzzle_token, mode, daily_no, played_on,
        solved, score, elapsed_seconds, checks, check_alls, revealed_letters,
        revealed_answers, substitutions, pauses, paused_seconds,
        club, season, completed_at, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'migrated')`)
      .bind(
        newId(), user.id, game, key, detailOf(game, r),
        key, mode, dailyNo,
        str(r.date, 10), r.score === undefined ? 0 : 1, intOr(r.score, null),
        intOr(r.elapsedSeconds, null), intOr(r.checks), intOr(r.checkAlls),
        intOr(r.revealedLetters), intOr(r.revealedAnswers), intOr(r.substitutions),
        intOr(r.pauses), intOr(r.pausedSeconds),
        str(r.club, 60), str(r.season, 20), str(r.completedAt, 40),
      ).run();
    added++;
  }

  return json({ added, skipped });
}
