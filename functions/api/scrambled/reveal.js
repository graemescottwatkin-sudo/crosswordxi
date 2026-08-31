/* POST /api/scrambled/reveal  { token, slotId, kind }
 *
 *   kind "hint"    the board's own hint field — club, nationality or career.
 *                  Answers for EVERY slot: it is one purchase, not eleven.
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
import { json, bad, boardForToken, boardForPreviewToken, slotHint, hintLabel, loadBoards, revealName, topClubs } from "../../_lib/sc-board.js";
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

  if (kind === "hint") {
    /* ONE PURCHASE, THE WHOLE BOARD. A career is not a clue to one tile in the
       way a letter is: knowing that somebody went United, PSG, Milan, Galaxy
       tells you as much about who ISN'T on the rest of the board as about who
       this one is. Selling it eleven times over would be charging eleven times
       for a thing the player can only really use all at once.

       So the board answers with every career it has, and the client decides
       which one to put in front of the player. slotId is not required and is
       not a permission — it only says which tile was being looked at, and the
       team talk asks with no tile selected at all. */
    const hints = {};
    for (const s of board.slots || []) {
      const v = slotHint(board, s.id);
      if (v) hints[s.id] = v;
    }
    return json({ kind, slotId: slot ? slot.id : null, label: hintLabel(board), hints });
  }

  /* Below here a slot is the subject of the purchase, not a label on it. */
  if (!slot) return bad("Unknown slot.", 404);

  if (kind === "letter") {
    const letters = normalise(slot.name);
    const known = Math.max(0, Math.min(letters.length, Number(body.known) || 0));
    /* Never the last one. A letter reveal that completes the name is a name
       reveal at the cheaper price. */
    if (known >= letters.length - 1) return json({ kind, slotId: slot.id, index: null, letter: null });
    return json({ kind, slotId: slot.id, index: known, letter: letters[known] });
  }

  if (kind === "name") {
    /* A bought name solves the slot exactly as a correct guess does, so it
       hands over the same two facts. */
    return json({ kind, slotId: slot.id, name: revealName(slot), clubs: topClubs(slot) });
  }

  return bad("Unknown reveal.");
}
