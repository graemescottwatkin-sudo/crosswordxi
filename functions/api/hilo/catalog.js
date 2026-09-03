/* GET /api/hilo/catalog — the club boards, grouped by club.

   Identity only: id, subtitle, the date the values are true as of. No values,
   no sources, no calendar — club boards are never dailies, so nothing here
   can be read as a preview of the run-in. */
import { json } from "../../_lib/puzzle.js";
import { loadBank, clubCatalog } from "../../_lib/hl-board.js";

export async function onRequestGet({ env }) {
  const bank = await loadBank(env);
  return json({ clubs: clubCatalog(bank), source: bank.source });
}
