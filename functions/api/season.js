/* GET /api/season — the account's season, or nothing.
 *
 * ONE SEASON, AT THE TOP LEVEL. Not a game's: a game shows a live table for
 * the board being played, and the season belongs to the family. It counts
 * FINISHES rather than points, which is why it survives a theme that scores
 * out of something other than 114 — see _lib/season.js, which holds the rule
 * and knows nothing about a database.
 *
 * TWO BRANCHES, DECIDED BY WHETHER THERE IS AN ACCOUNT.
 *
 *   an account   this endpoint answers, from season_play, and the season
 *                follows the player to any device they sign in on
 *   no account   this endpoint says so, and the HUB computes the same rule
 *                over what the browser already holds
 *
 * A device code IS an account — /api/account/code turns one into a user with
 * provider = 'code' — so a player who linked two devices with the code is in
 * the first branch, and there is no third case to build.
 *
 * The server decides what day it is, in UTC, and says so in the answer: the
 * hub must not decide from a device clock which day is still in flight.
 */
import { utcDay } from "../_lib/daily.js";
import { season, NO_SEASON_YET } from "../_lib/season.js";
import { daysFor, seasonUser, hasDB } from "../_lib/season-store.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      /* Never stored: a season changes the moment a puzzle is finished, and a
         cached one would show a player yesterday's standing after they had
         just moved it. */
      "Cache-Control": "no-store",
    },
  });

export async function onRequestGet({ request, env }) {
  const today = utcDay();

  /* No database is not an error and not an empty season — it is a site that
     cannot answer, and the hub falls back to the device exactly as it does for
     a player with no account. Saying "no season" here would tell a signed-in
     player their record was gone. */
  if (!hasDB(env)) return json({ account: false, today, reason: "no-store" });

  const user = await seasonUser(request, env);
  if (!user) return json({ account: false, today, message: NO_SEASON_YET });

  const days = await daysFor(env, user);
  const s = season(days, today);
  return json({
    account: true,
    today,
    /* The invitation travels with the answer rather than being rebuilt in the
       page, so the sentence and the condition that shows it cannot drift. */
    message: s.started ? null : NO_SEASON_YET,
    season: {
      played: s.played, won: s.won, drawn: s.drawn, lost: s.lost,
      points: s.points, marks: s.marks, started: s.started,
    },
    /* Today, as it stands. Shown as provisional and not counted: a loss can
       still become a draw before midnight. */
    inFlight: s.inFlight,
  });
}
