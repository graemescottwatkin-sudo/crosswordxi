/* POST /api/wordsearch/find — { playId, from:[r,c], to:[r,c] }
 *
 * THE SELECTION GOES UP AND THE SERVER SAYS WHAT IT HIT. This is the whole
 * inversion: the board no longer travels with its answers, so the page cannot
 * judge a drag and does not try. It sends the two squares; this matches them
 * against placements the browser has never been given, and hands back the one
 * word that was found — with its placement, because the player has just earned
 * it and the page needs it to draw the line.
 *
 * A miss is a FOUL and is recorded as one. The penalty escalates with
 * consecutive wrong selections, so the row carries when it happened and the
 * escalation is derived from the sequence at full time — the same rule the
 * page applies to the same data.
 *
 * WHAT THIS WILL NOT DO. It will not say "warm", it will not say which word
 * you nearly had, and it will not confirm a square. A no is a no, and anything
 * more is the board leaking a letter at a time.
 */
import { csrfOk } from "../../_lib/auth.js";
import { dailyBoard } from "../../_lib/wsdata.js";
import { foundAnswer } from "../../_lib/ws-public.js";
import { judge, recordFind, recordFoul, foundWords, hasDB } from "../../_lib/ws-round.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return json({ error: "Refused." }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Expected a JSON body." }, 400); }
  const { playId, from, to } = body || {};
  if (!Array.isArray(from) || !Array.isArray(to)) return json({ error: "A selection is two squares." }, 400);

  /* TODAY'S BOARD, FROM THE SERVER'S OWN CLOCK. Not a board id from the
     request: an id would let a player judge a selection against a board they
     are not playing, which is how you read a future board one drag at a
     time. */
  const { puzzle } = await dailyBoard(env);
  if (!puzzle) return json({ error: "No daily today." }, 404);

  /* Without a database there is nothing to record against and no round to
     belong to, but the judging still works — so a board with no play id is
     played and marked exactly as it would be, and simply is not verified. */
  const already = hasDB(env) && playId
    ? (await foundWords(env, playId)).map((f) => f.word) : [];

  const hit = judge(puzzle, from, to, already);
  const now = Date.now();

  if (!hit) {
    const idx = await recordFoul(env, playId, now);
    return json({ hit: null, foul: true, fouls: idx || null });
  }

  await recordFind(env, playId, hit.item.grid, hit.bonus, now);
  return json({ hit: foundAnswer(hit.item, hit.bonus) });
}
