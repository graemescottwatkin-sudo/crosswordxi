/* GET /api/hilo/archive — the days already played, newest first.

   Strictly before today, each with its board's category and subtitle: the
   list a player picks a missed day from. It stops at yesterday by
   construction, so it carries nothing about the run-in. */
import { json } from "../../_lib/puzzle.js";
import { loadBank, archive, todayKey } from "../../_lib/hl-board.js";

export async function onRequestGet({ env }) {
  const now = Date.now();
  const bank = await loadBank(env);
  return json({ today: todayKey(now), days: archive(bank, now), source: bank.source });
}
