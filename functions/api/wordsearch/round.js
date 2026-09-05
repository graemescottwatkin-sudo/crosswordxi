/* POST /api/wordsearch/round — { playId }
 *
 * Kick off, by this server's clock, on the board this server says is today's.
 * The board is not taken from the request for the same reason /find does not
 * take one: a player who names their own board is timing a board nobody set
 * them.
 *
 * KICKING OFF TWICE KEEPS THE FIRST CLOCK. A reload, a double tap, a resumed
 * board — none of them hands out a fresh ten minutes.
 */
import { csrfOk } from "../../_lib/auth.js";
import { dailyBoard } from "../../_lib/wsdata.js";
import { startRound, foundWords, hasDB } from "../../_lib/ws-round.js";

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

  /* Nowhere to keep a clock, and that is not an error: the board plays and
     scores itself, as it did before any of this existed. */
  if (!hasDB(env)) return json({ verified: false });

  const { day, puzzle } = await dailyBoard(env);
  if (!puzzle) return json({ verified: false });

  const at = await startRound(env, playId, puzzle.id, day, Date.now());
  /* What this round has already found, so a resumed board draws its lines
     back without asking the page what it thinks it found. */
  const found = await foundWords(env, playId);
  return json({
    verified: at !== null,
    startedMs: at,
    found: found.map((f) => ({ word: f.word, bonus: Number(f.is_bonus) === 1 })),
  });
}
