/* POST /api/hilo/call — { token, index, call }
 *
 * One call, judged here. The browser never holds a value it has not called
 * for: it sends the board's token, which row it is calling (1 to 11) and
 * "higher" or "lower", and gets back whether that was right, the row's value,
 * and the row's source — the publisher, the URL and the quote — because the
 * source is shown as the call settles and never before. Every board is built
 * so no quote gives a later call away, and the research side's gate refuses
 * one that does.
 *
 * Judged from the same rule as the token: a board the player may not have
 * (tomorrow's) cannot be called against, however the token is guessed.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { csrfOk } from "../../_lib/auth.js";
import { loadBank, boardForToken, judge } from "../../_lib/hl-board.js";
import { recordCall } from "../../_lib/hl-round.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Refused.", 403);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const bank = await loadBank(env);
  const board = boardForToken(bank, body.token);
  if (!board) return bad("No such board.", 404);
  const verdict = judge(board, body.index, body.call);
  if (!verdict) return bad("Not a call.");

  /* JUDGED HERE, SO RECORDED HERE. The verdict is this server's and so is the
     clock it was made against, which together are what a verified score is:
     see functions/_lib/hl-round.js. A right call also starts the next call's
     clock, because a right call moves the round on by itself.

     Deliberately after the verdict and deliberately unable to change it. If
     there is no round, no database or no play id — an older page, a round that
     never kicked off, a suite — this answers null and the call is served
     exactly as it always was. The game does not depend on being scored. */
  await recordCall(env, body.playId, body.index, body.call, verdict.right, Date.now());
  return json(verdict);
}
