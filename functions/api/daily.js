/* GET /api/daily
 *
 * Returns today's puzzle and nothing else. Tomorrow's is never sent, so a
 * player cannot read ahead by opening dev tools — the requirement in §6 of the
 * deployment standard.
 *
 * The day is decided by the server's own clock, not the browser's, so moving a
 * device clock forward cannot open a future puzzle.
 */
import { publicPuzzle, json, bad } from "../_lib/puzzle.js";
import { getDailyPuzzle, makeToken } from "../_lib/db.js";
import { dailyNumber, ANSWERS_AFTER_DAYS } from "../_lib/daily.js";
import { mayOpenArchive, archiveRefusal, FREE_ARCHIVE_DAYS } from "../_lib/archive.js";

export async function onRequestGet({ request, env }) {
  /* ?no= asks for an earlier board. Without it you get today's.

     A number above today is ANSWERED WITH TODAY, not refused. The refusal
     dead-ended a real player, nightly: the server's day flips at midnight
     UTC, the browser's at local midnight, so every UK summer night between
     twelve and one the client computed tomorrow's number, asked for it, got
     403 "not available yet", and the daily was a toast on an empty pitch.
     The client-side recovery for a number disagreement — adoptServerBoard,
     "the server owns the calendar, so its answer wins" — was already written
     and already right, but it only runs when a BOARD comes back; a 403
     carries nothing to adopt. Clamping the ask is what lets the stated
     principle actually operate.

     Nothing leaks: the clamped answer is today's board, which is what the
     asker is entitled to. And this is the ASK only — check, reveal, verify
     and finish still validate tokens through playableDailyNo, where a claim
     about a future board stays refused. Asking is a question; a token is a
     claim. */
  let asked = NaN;
  /* Guarded because the endpoint took no request at all until ?no= arrived, and
     callers that never needed one still exist — functions_test invokes it as
     daily({ env }). An endpoint that throws when asked for its default is worse
     than one that ignores a parameter it cannot read. */
  try { asked = Number(new URL(request.url).searchParams.get("no")); } catch (e) {}
  const wanted = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : dailyNumber();
  const today = dailyNumber();
  const no = Math.min(Math.max(1, wanted), today);

  /* HOW FAR BACK IS THIS. Board numbers ARE days here — #1 is the epoch and
     each one after it is a day later — so the distance is subtraction, and no
     date arithmetic is needed to ask the shared question. */
  if (!(await mayOpenArchive(request, env, today - no))) {
    return json(archiveRefusal(today - no), 401);
  }

  const stored = await getDailyPuzzle(env, no);
  if (!stored) {
    return bad("No daily puzzle is stored for #" + no +
      ". Run tools/build_puzzles.js and import the result — see README step 5.", 404);
  }
  return json({
    mode: "daily",
    dailyNo: no,
    /* How many days until a board's answers page is published. The client
       needs the number for the calendar badges and the strap link, and this
       payload is how it learns it — copying the constant into game.js would
       be a second seven, drifting from the first the day one of them
       changes. The server remains the only place the rule LIVES;
       the client only displays it. */
    answersAfter: ANSWERS_AFTER_DAYS,
    /* How far back the archive is open without an account, sent for the same
       reason as answersAfter and on the same terms: the calendar needs the
       number to mark which days are locked, and a copy of it in game.js
       would be a second seven to keep in step. The rule LIVES on the server
       — the page only draws it. */
    freeArchiveDays: FREE_ARCHIVE_DAYS,
    token: makeToken("daily", no),
    puzzle: publicPuzzle(stored.puzzle),
  });
}
