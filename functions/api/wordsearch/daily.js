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
import { publicPuzzle } from "../../_lib/ws-public.js";
import { FREE_ARCHIVE_DAYS } from "../../_lib/archive.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestGet({ env }) {
  const { day, puzzle, sample } = await dailyBoard(env);
  /* How far back the archive is open without an account, so the archive
     list can mark the locked days. The rule LIVES on the server; the page
     only draws it, and a copy of the number in game.js would be a second
     window drifting from the first. */
  /* THROUGH publicPuzzle, WHICH IS THE POINT OF THIS ENDPOINT NOW. It sent
     `puzzle` whole: every answer's exact placement and the secret bonus word,
     to every player, before a single word was found. See _lib/ws-public.js. */
  return json({ day, puzzle: publicPuzzle(puzzle), source: sample ? "sample" : "d1",
    freeArchiveDays: FREE_ARCHIVE_DAYS });
}
