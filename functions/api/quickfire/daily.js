/* GET /api/quickfire/daily
 *
 * Today's board and the live weekly round, if there is one. No bank, no future
 * boards, no schedule — only what a player is entitled to right now.
 *
 * `source` is asserted by live_check. There is no sample fallback: an unbound
 * D1 binding answers 503 rather than quietly looking like a working game.
 */
import { hasDB, getDaily, getWeek, noStore, today } from "../../_lib/qfdata.js";

export async function onRequestGet({ env }) {
  if (!hasDB(env)) {
    return noStore({ error: "no database binding", source: "none" }, 503);
  }

  let daily = null, week = null;
  try {
    daily = await getDaily(env);
    week = await getWeek(env);
  } catch (err) {
    return noStore({ error: "query failed", detail: String(err), source: "d1" }, 500);
  }

  if (!daily) {
    return noStore({ error: "no board published for today", date: today(), source: "d1" }, 404);
  }

  return noStore({ source: "d1", generatedAt: new Date().toISOString(), daily, week });
}

export const onRequestHead = onRequestGet;
