/* GET /api/hilo/daily            today's board
   GET /api/hilo/daily?day=YYYY-MM-DD   a past day's board, as free play

   The SERVER decides what day it is, in UTC. A day sent up is checked against
   today here rather than trusted: the past is open so a missed day can be
   caught up, the future is shut because opening it gives away everything.
   The board leaves through publicBoard(): names and context for the twelve,
   the first value only, no sources. */
import { json, bad } from "../../_lib/puzzle.js";
import { loadBank, boardById, todayKey, publicBoard, dayToken } from "../../_lib/hl-board.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const today = todayKey();
  const asked = url.searchParams.get("day");
  const day = asked === null ? today : String(asked);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad("Not a day.");
  if (day > today) return bad("That day has not come.", 403);

  const bank = await loadBank(env);
  const id = (bank.schedule || {})[day];
  const board = id ? boardById(bank, id) : null;
  /* No row for the day: the calendar has run out or has not begun. Said
     plainly, with no board, so the page degrades to the club boards rather
     than to an error. */
  if (!board) return json({ day, today, board: null, source: bank.source });
  return json({ day, today, board: publicBoard(board, dayToken(day)), source: bank.source });
}

export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
