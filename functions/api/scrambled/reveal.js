/* POST /api/scrambled/reveal  { token, slotId, kind }
 *
 *   kind "hint"    the board's own hint field — club or nationality
 *   kind "letter"  the next letter of the name, in position
 *   kind "name"    the name, which ends that slot
 *
 * `known` is how many letters of that slot the player already has, so the
 * server does not need a session to know which letter comes next. It is the
 * player's own claim and can only be used to ask for a letter they could have
 * bought anyway, one purchase at a time.
 *
 * WHAT THIS ENDPOINT DOES NOT DO, AND SHOULD BEFORE IT SHIPS: it does not
 * record the purchase. The score is therefore assembled in the browser and the
 * game says so on the Full Time card. A trusted score needs a play row with a
 * started_at the server wrote and a count of the reveals it served — the same
 * shape Crossword XI uses. Until that exists, "unverified" is the truth.
 */
import { json, bad, boardForToken, boardForPreviewToken, slotHint, hintLabel, loadBoards } from "../../_lib/sc-board.js";
import { normalise } from "../../_lib/sc-names.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return bad("Expected a JSON body."); }
  const { token, slotId, kind } = body || {};

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

  const slot = (board.slots || []).find((s) => String(s.id) === String(slotId));
  if (!slot) return bad("Unknown slot.", 404);

  if (kind === "hint") {
    return json({ kind, slotId: slot.id, label: hintLabel(board), value: slotHint(board, slot.id) });
  }

  if (kind === "letter") {
    const letters = normalise(slot.name);
    const known = Math.max(0, Math.min(letters.length, Number(body.known) || 0));
    /* Never the last one. A letter reveal that completes the name is a name
       reveal at the cheaper price. */
    if (known >= letters.length - 1) return json({ kind, slotId: slot.id, index: null, letter: null });
    return json({ kind, slotId: slot.id, index: known, letter: letters[known] });
  }

  if (kind === "name") {
    return json({ kind, slotId: slot.id, name: slot.name });
  }

  return bad("Unknown reveal.");
}
