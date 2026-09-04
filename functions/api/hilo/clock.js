/* POST /api/hilo/clock — { playId, token }
 *
 * "The current call's clock starts now." Sent twice in a round's life: at kick
 * off, and after a wrong call when the player taps Next.
 *
 * WHY THE PAGE SAYS IT AT ALL, when the point of this work is that the server
 * owns the clock. After a RIGHT call the next call is shown immediately, so
 * its clock starts when the server answered the last one and nothing is asked.
 * After a WRONG call the round waits for a tap, and the wait is not thinking
 * time. Somebody has to say when the tap happened and only the page was there.
 *
 * It is safe because it can only ever move a clock LATER, which costs the
 * player points. There is no version of this a cheat would want to send.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { csrfOk } from "../../_lib/auth.js";
import { startClock, hasDB } from "../../_lib/hl-round.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Refused.", 403);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const { playId, token } = body || {};
  if (!playId || !token) return bad("A round is a play and a board.");

  /* Nothing to keep a clock in, and that is not an error: the game plays
     unverified, exactly as it did before any of this existed. */
  if (!hasDB(env)) return json({ verified: false });

  const at = await startClock(env, playId, token, Date.now());
  return json({ verified: at !== null });
}
