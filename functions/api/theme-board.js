/* GET /api/theme-board?id=12   or  ?theme=man-united&no=3
 *
 * One themed board, stripped of its answers like any other puzzle. Two ways in
 * because the section links by row id while a shared URL says what it is:
 * /?t=man-united-3 reads as an invitation, /?p=4471 reads as a database key.
 *
 * A board scheduled for a future Friday is not servable. getThemeBoard applies
 * that, and it applies it in the same place check-answer and reveal read from,
 * so there is one guard rather than three.
 */
import { publicPuzzle, json, bad } from "../_lib/puzzle.js";
import { hasDB, getThemeBoard, makeToken, serverToday } from "../_lib/db.js";

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return bad("Not configured.", 503);
  const url = new URL(request.url);

  let id = parseInt(url.searchParams.get("id") || "", 10);
  if (!Number.isInteger(id) || id <= 0) {
    const theme = String(url.searchParams.get("theme") || "").slice(0, 40);
    const no = parseInt(url.searchParams.get("no") || "", 10);
    if (!theme || !Number.isInteger(no) || no <= 0) return bad("Name a board.");
    const row = await env.DB.prepare(
      `SELECT id FROM theme_boards WHERE theme_id = ? AND board_no = ? AND release_on <= ? LIMIT 1`)
      .bind(theme, no, serverToday()).first();
    if (!row) return bad("No such board.", 404);
    id = row.id;
  }

  const board = await getThemeBoard(env, id);
  if (!board) return bad("No such board.", 404);

  return json({
    mode: "theme",
    themeId: board.themeId,
    themeName: board.themeName,
    boardNo: board.boardNo,
    releasedOn: board.releaseOn,
    /* What a share message says. Built here rather than in the browser so the
       name on the board and the name in the message cannot drift apart. */
    label: `${board.themeName} #${board.boardNo}`,
    token: makeToken("theme", board.boardId),
    puzzle: publicPuzzle(board.puzzle),
  });
}
