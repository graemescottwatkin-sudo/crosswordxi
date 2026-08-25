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
import { dailyNumber, playableDailyNo } from "../_lib/daily.js";

export async function onRequestGet({ request, env }) {
  /* ?no= asks for an earlier board. Without it you get today's.

     playableDailyNo() decides what is allowed, so this endpoint and the check,
     reveal and finish endpoints cannot disagree about which boards are open —
     one function, four callers. A number above today is refused there, which is
     the guard that matters: opening the past gives nothing away, opening the
     future gives away everything. */
  let asked = NaN;
  /* Guarded because the endpoint took no request at all until ?no= arrived, and
     callers that never needed one still exist — functions_test invokes it as
     daily({ env }). An endpoint that throws when asked for its default is worse
     than one that ignores a parameter it cannot read. */
  try { asked = Number(new URL(request.url).searchParams.get("no")); } catch (e) {}
  const wanted = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : dailyNumber();
  const no = playableDailyNo("daily:" + wanted);
  if (no === false || no === null) {
    return bad("That puzzle is not available yet.", 403);
  }
  const stored = await getDailyPuzzle(env, no);
  if (!stored) {
    return bad("No daily puzzle is stored for #" + no +
      ". Run tools/build_puzzles.js and import the result — see README step 5.", 404);
  }
  return json({
    mode: "daily",
    dailyNo: no,
    token: makeToken("daily", no),
    puzzle: publicPuzzle(stored.puzzle),
  });
}
