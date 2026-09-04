/* GET /api/scrambled/daily            today's board
   GET /api/scrambled/daily?no=12      board twelve, if it is not in the future

   The SERVER decides what day it is, in UTC. A number sent up from a browser
   is a number off a clock the player controls, so `no` is checked against
   today here rather than trusted — the past is open so a missed day can be
   caught up, the future is shut because opening it gives away everything.
*/
import {
  publicBoard, boardForNumber, scKey, json, bad, loadBoards, playableTokenNo,
} from "../../_lib/sc-board.js";
import { dailyNumber } from "../../_lib/daily.js";
import { mayOpenArchive, archiveRefusal, FREE_ARCHIVE_DAYS } from "../../_lib/archive.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const today = dailyNumber();
  const asked = url.searchParams.get("no");
  const no = asked === null ? today : Number(asked);

  if (!Number.isInteger(no) || no < 1) return bad("Not a board number.");
  /* ONE RULE, ONE PLACE. This read `no > today` and returned 403 — the same
     rule playableTokenNo already implements for the guess and reveal routes,
     written a second time. They agreed until the archive was opened for
     testing, and then this endpoint refused board twelve while the guess route
     happily marked a name against it. Two statements of one fact, exactly the
     fault this codebase keeps paying for.
     Asked through the shared predicate now, so the mode governs every route or
     none of them. */
  if (playableTokenNo(scKey(no)) === false) return bad("That board is not out yet.", 403);

  /* And how far back it is. A board number is a day here, the same as the
     crossword's, so the distance is subtraction. The finals are not asked
     this at all — they are a catalogue rather than a back issue, and they
     come through /api/scrambled/iconic. */
  if (!(await mayOpenArchive(request, env, today - no))) {
    return json(archiveRefusal(today - no), 401);
  }

  /* D1 when bound, the generated module when not. `source` rides in the
     payload so a live_check can refuse a run that quietly fell back. */
  const { boards, source } = await loadBoards(env);
  const board = boardForNumber(no, boards);
  if (!board) return bad("No board.", 404);

  return json({
    ...publicBoard(board, no), today, token: scKey(no), source,
    /* For the calendar's locked days; the rule stays here, the page draws it. */
    freeArchiveDays: FREE_ARCHIVE_DAYS,
  });
}

export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
