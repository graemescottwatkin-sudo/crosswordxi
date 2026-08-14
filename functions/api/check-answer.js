/* POST /api/check-answer
 *
 * Body: { token, entry, guess }           is this entry right?
 *       { token, entry, guess, detail:1 } ...and which letters are wrong
 *       { token, grid }                   is the whole grid right?
 *
 * The answer is compared here and only a verdict goes back.
 *
 * Two levels on purpose. The game tells you an entry is right the moment you
 * finish typing it, and always has — that feedback is free. Naming *which*
 * letters are wrong is the Check feature, and Check costs three points. If this
 * endpoint always returned positions, the paid feature would be free to anyone
 * calling the API directly, and each guess would leak far more per attempt.
 */
import { normalise, json, bad, solutionString } from "../_lib/puzzle.js";
import { getPuzzleForToken } from "../_lib/db.js";
import { playableDailyNo } from "../_lib/daily.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return bad("Expected a JSON body.");
  }

  const { token, entry, guess, grid, detail } = body || {};

  // A daily token is only playable on its own day; see _lib/daily.js.
  if (playableDailyNo(token) === false) {
    return bad("That puzzle is not today's daily.", 403);
  }
  const stored = await getPuzzleForToken(env, token);
  if (!stored) return bad("Unknown puzzle.", 404);
  const puzzle = stored.puzzle;

  /* Whole-grid check: used once, when every square has been filled. */
  if (typeof grid === "string") {
    const want = normalise(solutionString(puzzle));
    const got = normalise(grid);
    if (!detail) return json({ correct: got === want });
    /* The nudge ("six letters are wrong") is free information the game has
       always shown once the grid is full. It says how much, never where. */
    let wrongCells = 0;
    for (let i = 0; i < want.length; i++) if (got[i] && got[i] !== want[i]) wrongCells++;
    return json({ correct: got === want, wrongCells, total: want.length });
  }

  const idx = Number(entry);
  if (!Number.isInteger(idx) || idx < 0 || idx >= puzzle.entries.length) {
    return bad("Unknown entry.");
  }
  const answer = normalise(puzzle.entries[idx].row.grid);
  const typed = normalise(guess);
  const correct = typed.length === answer.length &&
    [...answer].every((ch, i) => typed[i] === ch);

  if (!detail) return json({ correct });

  // Positions that are filled and wrong. A blank square is not "wrong" — it has
  // not been answered yet, and marking it would mislead.
  const wrong = [];
  for (let i = 0; i < answer.length; i++) {
    if (typed[i] && typed[i] !== answer[i]) wrong.push(i);
  }
  return json({ correct, wrong, length: answer.length });
}
