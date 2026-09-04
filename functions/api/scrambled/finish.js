/* POST /api/scrambled/finish — { playId }  ->  the score, the server's
 *
 * Every number is read from rows this server wrote while the board was played:
 * which slots were done and how, because it marked every guess and served
 * every reveal; how long it took, from a clock it started; how much help was
 * bought, because it sold all of it. No score is accepted, which is the rule
 * that lets a challenge table be shown to other people.
 *
 * It writes plays.srv_score — the column Crossword XI's /api/finish writes and
 * every challenge endpoint reads — so nothing new has to be invented for this
 * game to join a table.
 *
 * The Full Time card has always said the number it shows is the device's own
 * and unverified. A round this cannot verify keeps that number and says so:
 * fewer than eleven slots done, no kick off, no database.
 */
import { json, bad } from "../../_lib/sc-board.js";
import { csrfOk } from "../../_lib/auth.js";
import { verifiedScore, hasDB } from "../../_lib/sc-round.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Refused.", 403);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const { playId } = body || {};
  if (!playId) return bad("Which round?");
  if (!hasDB(env)) return json({ verified: false });

  /* NOTHING ABOUT THE BOARD IS TAKEN FROM THE REQUEST. This asked the page how
     many slots the board had, which was a hole big enough to drive a
     leaderboard through: solve three, say the board has three, and a fast
     unhelped score tops the table. The round knows which board it started on
     and the server counts the slots itself. */
  const got = await verifiedScore(env, playId);
  if (!got) return json({ verified: false });

  try {
    await env.DB.prepare(
      `UPDATE plays SET srv_score = ?, srv_verified_at = datetime('now'),
                        srv_elapsed_secs = ?
        WHERE play_id = ? AND game = 'scrambled'`)
      .bind(got.score, got.elapsedSecs, String(playId)).run();
  } catch (e) { /* the score stands; the row can be caught up later */ }

  return json({ verified: true, score: got.score, solved: got.solved,
    given: got.given, free: got.free, help: got.help, elapsedSecs: got.elapsedSecs });
}
