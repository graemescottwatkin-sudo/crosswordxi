/* GET /api/wordsearch/daily
 *
 * Today's board, whole — grid, answers, placements, bonus. The SERVER decides
 * what day it is, so a device clock cannot open tomorrow's board, and the
 * schedule never ships to the browser at all. That is the entire point of
 * this endpoint: v4.3 shipped a two-year DAILY_SCHEDULE in the page, which
 * made "one fixed puzzle for everyone today" a promise the client could not
 * keep.
 *
 * No daily scheduled (the schedule has an end date) is { day, puzzle: null },
 * status 200 — the client offers Free Play instead of an error. */
import { dailyBoard } from "../../_lib/wsdata.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestGet({ env }) {
  const { day, puzzle, sample } = await dailyBoard(env);
  return json({ day, puzzle, source: sample ? "sample" : "d1" });
}
