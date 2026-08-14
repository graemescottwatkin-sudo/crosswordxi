/* GET /api/daily
 *
 * Returns today's puzzle and nothing else. Tomorrow's is never sent, so a
 * player cannot read ahead by opening dev tools — the requirement in §6 of the
 * deployment standard.
 *
 * The day is decided by the server's own clock, not the browser's, so moving a
 * device clock forward cannot open a future puzzle.
 */
import { publicPuzzle, json, bad } from "../_lib/puzzle.js";
import { getDailyPuzzle, makeToken } from "../_lib/db.js";
import { dailyNumber } from "../_lib/daily.js";

export async function onRequestGet({ env }) {
  const no = dailyNumber();
  const stored = await getDailyPuzzle(env, no);
  if (!stored) {
    return bad("No daily puzzle is stored for #" + no +
      ". Run tools/build_puzzles.js and import the result — see README step 5.", 404);
  }
  return json({
    mode: "daily",
    dailyNo: no,
    token: makeToken("daily", no),
    puzzle: publicPuzzle(stored.puzzle),
  });
}
