/* POST /api/scrambled/round — { playId, token }
 *
 * Kick off, by this server's clock. One clock for the whole board, so unlike
 * HiLo there is nothing to restart and nothing further to be told: from here
 * the server serves every guess and every reveal, which is the rest of what a
 * score is made of.
 *
 * KICKING OFF TWICE KEEPS THE FIRST CLOCK. A reload, a double tap, a resumed
 * board — none of them hands the player a fresh ninety minutes.
 */
import { json, bad } from "../../_lib/sc-board.js";
import { csrfOk } from "../../_lib/auth.js";
import { startRound, hasDB } from "../../_lib/sc-round.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Refused.", 403);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const { playId, token } = body || {};
  if (!playId || !token) return bad("A round is a play and a board.");

  /* Nowhere to keep a clock, and that is not an error: the board plays and
     scores itself, as it did before any of this existed. */
  if (!hasDB(env)) return json({ verified: false });

  const at = await startRound(env, playId, token, Date.now());
  return json({ verified: at !== null });
}
