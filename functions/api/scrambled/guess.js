/* POST /api/scrambled/guess  { token, guess, solved: [] }  ->  { solvedId }
 *
 * MARKING HAPPENS HERE EVEN THOUGH THE BROWSER COULD DO IT. The names are on
 * the server, and sending them to the page so it can compare strings would put
 * today's whole XI in the payload — which is the one thing publicBoard() is
 * for. The scramble gives away the letters; it does not have to give away the
 * spelling and every accepted alias too.
 *
 * ONE UNIVERSAL ANSWER BOX, NO SLOT SELECTION. The guess is checked against
 * every slot the player has not already solved, and the id of the one it
 * matched comes back. That is the original design — solve in any order — and
 * it leaks nothing: a name that matches a slot IS correct, so there is no
 * "right player, wrong slot" state to accidentally confirm.
 *
 * `solved` is the player's own claim about their progress and is not trusted
 * with anything. Lying about it can only re-solve a slot they already had.
 */
import { json, bad, boardForToken, boardForPreviewToken, loadBoards, revealName } from "../../_lib/sc-board.js";
import { matchesSlot } from "../../_lib/sc-names.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return bad("Expected a JSON body."); }
  const { token, guess } = body || {};
  const already = new Set((Array.isArray(body.solved) ? body.solved : []).map(String));

  if (typeof guess !== "string" || guess.length > 60) return bad("Not a name.");

  const { boards } = await loadBoards(env);
  /* An owner previewing a board plays it like any other, so the play endpoints
     accept the preview token — but only after re-reading the admin flag from
     the database on THIS request. A token is not authority. */
  let board = boardForToken(token, boards);
  if (!board && /^sc:preview:/.test(String(token || ""))) {
    const { isAdmin } = await import("../../_lib/auth.js");
    if (await isAdmin(request, env)) board = boardForPreviewToken(token, boards);
  }
  if (!board) return bad("That board is not playable.", 403);

  const hit = (board.slots || [])
    .filter((s) => !already.has(String(s.id)))
    .find((s) => matchesSlot(guess, s));

  /* The reveal, not the cypher. The client never holds the names, so the one
     name it is allowed to learn — the one it just guessed correctly — has to
     arrive from here in the form the board should display. */
  return json({
    solvedId: hit ? hit.id : null,
    name: hit ? revealName(hit) : null,
  });
}
