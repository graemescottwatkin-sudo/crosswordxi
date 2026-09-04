/* POST /api/hilo/finish — { playId }  ->  the score, the server's
 *
 * Every number here is read from rows this server wrote while the round was
 * played: which calls were right, because it judged them, and how long each
 * one took, because it timed them from a clock it started. Nothing the browser
 * sent is read, and no score is accepted — which is the rule that lets a
 * challenge table be shown to other people.
 *
 * It writes plays.srv_score, the same column Crossword XI's /api/finish
 * writes and the same one every challenge endpoint reads. That is the whole
 * point of doing it this way rather than inventing a second kind of score:
 * the challenge machinery already exists and asks one question.
 *
 * A ROUND THAT CANNOT BE VERIFIED IS SAID SO, NOT GUESSED AT. Fewer than
 * eleven judged calls, no clock, no database — each answers { verified: false }
 * and the page keeps showing the number it worked out itself, which the Full
 * Time card has always labelled unverified.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { csrfOk } from "../../_lib/auth.js";
import { verifiedScore, hasDB } from "../../_lib/hl-round.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Refused.", 403);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const { playId } = body || {};
  if (!playId) return bad("Which round?");
  if (!hasDB(env)) return json({ verified: false });

  const got = await verifiedScore(env, playId);
  if (!got) return json({ verified: false });

  /* Recorded against the attempt, so the challenge routes can read it. Failing
     to write is not failing to score: the number is already true, and the page
     is told it either way. */
  try {
    await env.DB.prepare(
      `UPDATE plays SET srv_score = ?, srv_verified_at = datetime('now'),
                        srv_elapsed_secs = ?
        WHERE play_id = ? AND game = 'hilo'`)
      .bind(got.score, got.elapsedSecs, String(playId)).run();
  } catch (e) { /* the score stands; the row can be caught up later */ }

  return json({ verified: true, score: got.score, right: got.right,
    elapsedSecs: got.elapsedSecs });
}
