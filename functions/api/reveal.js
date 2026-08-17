/* POST /api/reveal
 *
 * Body: { token, entry, index }   one letter  — Reveal Letter, Substitution
 *    or { token, entry }          one answer  — Reveal Answer
 *
 * §6 of the deployment standard allows the server to return an answer "only
 * after the user explicitly requests a reveal". That is exactly what this is:
 * every route to it costs the player points or spends a substitution, and it
 * hands back one letter or one entry — never the puzzle, never the bank.
 *
 * Scoring stays in the browser. A player who calls this endpoint directly can
 * read one answer they were already able to reveal in the UI, so there is
 * nothing to gain; keeping score server-side would need accounts and is out of
 * scope for a puzzle with no login.
 */
import { normalise, json, bad } from "../_lib/puzzle.js";
import { getPuzzleForToken } from "../_lib/db.js";
import { playableDailyNo } from "../_lib/daily.js";
import { isAdmin } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return bad("Expected a JSON body.");
  }

  const { token, entry, index } = body || {};
  /* A daily token is only playable on its own day; see _lib/daily.js. The one
     exception is the owner previewing another day — otherwise the preview is a
     board that cannot be checked, revealed or finished, which is not much of a
     preview. The guard is unchanged for everyone else: the flag is read from
     the database, not taken from the request. */
  if (playableDailyNo(token) === false && !(await isAdmin(request, env))) {
    return bad("That puzzle is not today's daily.", 403);
  }
  const stored = await getPuzzleForToken(env, token);
  if (!stored) return bad("Unknown puzzle.", 404);
  const puzzle = stored.puzzle;

  const idx = Number(entry);
  if (!Number.isInteger(idx) || idx < 0 || idx >= puzzle.entries.length) {
    return bad("Unknown entry.");
  }
  const answer = normalise(puzzle.entries[idx].row.grid);

  if (index === undefined || index === null) {
    return json({ entry: idx, answer });
  }

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= answer.length) {
    return bad("That square is not part of this answer.");
  }
  return json({ entry: idx, index: i, letter: answer[i] });
}
