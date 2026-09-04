/* GET /api/scrambled/iconic          the catalogue of finals
   GET /api/scrambled/iconic?id=1424  one of them, ready to play

   ONE ENDPOINT FOR ONE SET. The finals are the boards that sit outside the
   daily rotation, and every question about them — what is there, and give me
   that one — is the same question about the same set. Split across two routes
   they would each have had to decide for themselves what "a final" is.

   NO AUTHORITY IS REQUIRED AND NONE IS PRETENDED. The daily route refuses a
   board number past today because the schedule is the thing worth protecting.
   These boards are not on the schedule: a board out of the rotation is never
   served as a daily on any date, so opening all 543 gives away nothing about
   tomorrow. boardForIconicToken enforces that — an id that names a board still
   IN the rotation resolves to nothing here, whoever asks.
*/
import {
  json, bad, loadBoards, iconicList, publicBoard, iconicKey, boardForIconicToken,
} from "../../_lib/sc-board.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const { boards, source } = await loadBoards(env);

  const asked = url.searchParams.get("id");
  if (asked !== null) {
    const board = boardForIconicToken(iconicKey(String(asked).trim()), boards);
    /* One answer for "no such board" and for "that board is a daily, ask the
       daily route": both are "not one of these", and telling them apart would
       let the id space be walked to find where the rotation ends. */
    if (!board) return bad("That board is not one of the finals.", 404);
    return json({
      ...publicBoard(board, null, iconicKey(board.id)),
      id: board.id, iconic: true, source,
    });
  }

  const boardsOut = iconicList(boards);
  return json({ boards: boardsOut, count: boardsOut.length, source });
}

export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
