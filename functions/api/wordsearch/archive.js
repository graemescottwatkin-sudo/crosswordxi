/* GET /api/wordsearch/archive
 *
 * Previous puzzles: every day the schedule has already played, newest first,
 * with the board that stood that day. Day, id, theme, category — identity
 * only, the same shape as the catalog. Strictly before today, so the list
 * carries nothing about the run-in: the one secret this game has is which
 * board is tomorrow's, and a list that stops at yesterday cannot say. */
import { archive, utcDayKey } from "../../_lib/wsdata.js";

export async function onRequestGet({ env }) {
  /* One clock reading for both the list and the day it is measured from, so
     a request straddling midnight cannot say "today" is a day the list has
     already moved past. */
  const now = Date.now();
  const days = await archive(env, now);
  return new Response(JSON.stringify({ today: utcDayKey(now), days }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
