/* GET /api/hilo/daily            today's board
   GET /api/hilo/daily?day=YYYY-MM-DD   a past day's board, as free play

   The SERVER decides what day it is, in UTC. A day sent up is checked against
   today here rather than trusted: the past is open so a missed day can be
   caught up, the future is shut because opening it gives away everything.
   The board leaves through publicBoard(): names and context for the twelve,
   the first value only, no sources. */
import { json, bad } from "../../_lib/puzzle.js";
import { loadBank, boardById, todayKey, publicBoard, dayToken } from "../../_lib/hl-board.js";
import {
  mayOpenArchive, archiveRefusal, daysBack, FREE_ARCHIVE_DAYS,
} from "../../_lib/archive.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const today = todayKey();
  const asked = url.searchParams.get("day");
  const day = asked === null ? today : String(asked);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad("Not a day.");
  if (day > today) return bad("That day has not come.", 403);

  /* This game schedules by date, so the distance is a date subtraction rather
     than a board number — the same question, asked in this game's own terms.
     Refused before the bank is read: a board nobody may open is a board there
     is no reason to load. */
  const back = daysBack(day, today);
  if (!(await mayOpenArchive(request, env, back))) {
    return json(archiveRefusal(back), 401);
  }

  const bank = await loadBank(env);
  const id = (bank.schedule || {})[day];
  const board = id ? boardById(bank, id) : null;
  /* No row for the day: the calendar has run out or has not begun. Said
     plainly, with no board, so the page degrades to the club boards rather
     than to an error. */
  if (!board) return json({ day, today, board: null, source: bank.source, freeArchiveDays: FREE_ARCHIVE_DAYS });
  return json({ day, today, board: publicBoard(board, dayToken(day)), source: bank.source, freeArchiveDays: FREE_ARCHIVE_DAYS });
}

export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
