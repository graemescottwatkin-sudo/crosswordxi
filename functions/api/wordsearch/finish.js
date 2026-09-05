/* POST /api/wordsearch/finish — { playId }  ->  the score, the server's
 *
 * Every number is read from rows this server wrote while the board was played:
 * which words were found, because it matched every selection; how long it
 * took, from a clock it started; how many fouls and in what order, because it
 * judged every miss too and the penalty depends on which were consecutive.
 *
 * No score is accepted. That is the rule that lets a challenge table be shown
 * to other people, and it is newly possible here — until this release the page
 * held every answer, so a word search score was a number the browser chose.
 *
 * It writes plays.srv_score, the column Crossword XI's /api/finish writes and
 * every challenge endpoint reads, so nothing new is invented for this game to
 * join a table.
 *
 * A round this cannot verify keeps the device's number and says so: fewer than
 * eleven words, no kick off, no database.
 */
import { csrfOk } from "../../_lib/auth.js";
import { verifiedScore, revealSecret, hasDB } from "../../_lib/ws-round.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return json({ error: "Refused." }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Expected a JSON body." }, 400); }
  const { playId } = body || {};
  if (!playId) return json({ error: "Which round?" }, 400);
  if (!hasDB(env)) return json({ verified: false });

  /* NOTHING ABOUT THE BOARD OR THE ROUND IS TAKEN FROM THE REQUEST — not the
     board's size, not the clock, not the fouls. Scrambled shipped with the
     page telling the server how many slots the board had, which let a player
     finish a three-word board and top a table with it. */
  /* THE SECRET, IF THE ROUND IS OVER. The results card names a missed bonus,
     which is right at full time and a free answer at any other moment — so the
     server decides from its own rows whether the game has ended, rather than
     the page saying it has. An unverified round still gets this: running out
     of time is an ending too, and the reveal is not the score. */
  const secret = await revealSecret(env, playId);

  const got = await verifiedScore(env, playId);
  if (!got) return json({ verified: false, ...(secret ? { secret } : {}) });

  try {
    await env.DB.prepare(
      `UPDATE plays SET srv_score = ?, srv_verified_at = datetime('now'),
                        srv_elapsed_secs = ?
        WHERE play_id = ? AND game = 'wordsearch'`)
      .bind(got.score, got.elapsedSecs, String(playId)).run();
  } catch (e) { /* the score stands; the row can be caught up later */ }

  return json({ verified: true, ...got, ...(secret ? { secret } : {}) });
}
