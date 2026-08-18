/* POST /api/verify   { token, entry, guess }  ->  { correct }
 *
 * The free one. As you type, the game asks whether a completed entry is right
 * so it can mark it solved and know when the puzzle is finished. It costs
 * nothing, it happens constantly, and it tells you nothing you did not already
 * type — the answer is not returned, only a verdict on what you supplied.
 *
 * It exists as its own door so that /api/check-answer can be paid by
 * definition. They were one endpoint, identical requests, and the server had to
 * be told which kind it was looking at — which meant a browser that omitted the
 * flag got its checks for nothing. Now the server needs nobody's word: a
 * request that arrives here is free, a request that arrives there is charged,
 * and the tally is the server's own count either way.
 *
 * Deliberately no `detail`. Which letters are wrong is what the paid check
 * buys; this only ever says yes or no, so it cannot be used as a free one.
 */
import { normalise, json, bad, solutionString } from "../_lib/puzzle.js";
import { getPuzzleForToken } from "../_lib/db.js";
import { playableDailyNo } from "../_lib/daily.js";
import { isAdmin } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  const { token, entry, guess, grid } = body || {};

  if (playableDailyNo(token) === false && !(await isAdmin(request, env))) {
    return bad("That puzzle is not today's daily.", 403);
  }
  const stored = await getPuzzleForToken(env, token);
  if (!stored) return bad("Unknown puzzle.", 404);

  /* The free nudge: how much of a full grid is wrong, never where. It fires by
     itself whenever the last square is filled, so it cannot live behind the
     paid door — it was being charged as a grid check the player never pressed.
     Counts only. Positions are what nine points buys. */
  if (grid !== undefined && grid !== null) {
    const want = normalise(solutionString(stored.puzzle));
    const chars = Array.from({ length: want.length },
      (_, i) => normalise(String(grid || "")).charAt(i) || null);
    let wrongCells = 0;
    for (let i = 0; i < want.length; i++) if (chars[i] && chars[i] !== want[i]) wrongCells++;
    const order = Object.keys(stored.puzzle.cells).sort();
    const at = {};
    order.forEach((k, i) => { at[k] = i; });
    let wrongEntries = 0;
    for (const e of stored.puzzle.entries) {
      let complete = true, bad = false;
      for (const c of e.cells) {
        const i = at[c.x + "," + c.y];
        if (i === undefined || !chars[i]) { complete = false; break; }
        if (chars[i] !== want[i]) bad = true;
      }
      if (complete && bad) wrongEntries++;
    }
    return json({ wrongCells, wrongEntries, total: want.length });
  }

  const idx = Number(entry);
  if (!Number.isInteger(idx) || idx < 0 || idx >= stored.puzzle.entries.length) {
    return bad("Unknown entry.");
  }
  const answer = normalise(stored.puzzle.entries[idx].row.grid);
  const typed = normalise(String(guess || ""));
  if (typed.length !== answer.length) return json({ correct: false });

  return json({ correct: typed === answer });
}
