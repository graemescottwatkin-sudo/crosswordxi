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
import { tally } from "../_lib/tally.js";
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

  const { token, entry, guess, grid, detail, playId } = body || {};
  /* Paid by definition. This used to serve the free background verification
     too — identical requests through one door — so the server had to be told
     which kind it was looking at, and a browser that omitted the flag got its
     checks for nothing. The free path is /api/verify now. Anything arriving
     here is a check the player chose to spend points on, and the tally below is
     the server's own count rather than the browser's word. */

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

  /* Letters arrive as an array, one entry per square, null for an empty one.
     They used to arrive as a string with a space for a blank — and normalise()
     strips spaces, so every letter after a gap shifted a place and was compared
     against the wrong one. A part-filled grid reported correct letters as
     wrong, blanks included. */
  const asChars = (v, len) => {
    if (Array.isArray(v)) {
      return Array.from({ length: len }, (_, i) => normalise(v[i] || "").charAt(0) || null);
    }
    // A plain string is still accepted, but only means anything when complete.
    const n = normalise(v);
    return Array.from({ length: len }, (_, i) => n.charAt(i) || null);
  };

  /* Whole-grid check. */
  if (grid !== undefined && grid !== null) {
    const want = normalise(solutionString(puzzle));
    const chars = asChars(grid, want.length);
    const got = chars.map((c) => c || " ").join("");
    const complete = chars.every((c) => c !== null);
    const allRight = complete && chars.every((c, i) => c === want[i]);
    await tally(env, playId, "srv_check_alls");
    if (!detail) return json({ correct: allRight });
    /* The nudge ("six letters are wrong") is free information the game has
       always shown once the grid is full. It says how much, never where.
       An empty square is not wrong — it has not been answered. */
    let wrongCells = 0;
    for (let i = 0; i < want.length; i++) if (chars[i] && chars[i] !== want[i]) wrongCells++;

    /* How many answers those wrong squares spoil. The browser asked for this
       and nothing ever sent it, so the nudge read "2 squares are wrong, across
       0 answers" — a contradiction, and worse than saying nothing, because the
       reader has to decide which half to believe.
       Counted here because it needs the answers and the browser has none. The
       keys are sorted to match solutionString, which is how a cell's position
       in the string is found. */
    const order = Object.keys(puzzle.cells).sort();
    const at = {};
    order.forEach((k, i) => { at[k] = i; });
    let wrongEntries = 0;
    for (const e of puzzle.entries) {
      let complete = true, bad = false;
      for (const c of e.cells) {
        const i = at[c.x + "," + c.y];
        if (i === undefined || !chars[i]) { complete = false; break; }
        if (chars[i] !== want[i]) bad = true;
      }
      if (complete && bad) wrongEntries++;
    }
    return json({ correct: allRight, wrongCells, wrongEntries, total: want.length });
  }

  const idx = Number(entry);
  if (!Number.isInteger(idx) || idx < 0 || idx >= puzzle.entries.length) {
    return bad("Unknown entry.");
  }
  const answer = normalise(puzzle.entries[idx].row.grid);
  const typed = asChars(guess, answer.length);
  const correct = typed.every((c, i) => c === answer[i]);

  await tally(env, playId, "srv_checks");
  if (!detail) return json({ correct });

  // Positions that are filled and wrong. A blank square is not "wrong" — it has
  // not been answered yet, and marking it would mislead.
  const wrong = [];
  for (let i = 0; i < answer.length; i++) {
    if (typed[i] && typed[i] !== answer[i]) wrong.push(i);
  }
  return json({ correct, wrong, length: answer.length });
}
