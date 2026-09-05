/* GET /api/preflight — are the boards we are about to serve well formed?
 *
 * Owner, 5 Sep: "can agent or automation be made to test the game when these
 * updates go live where the aim is to see if the game breaks". This is the
 * half of that which needs no browser and looks FORWARD — the site hands out
 * new boards at midnight UTC with no deploy, so the thing most likely to break
 * a game tomorrow is not a code change at all.
 *
 * IT RETURNS VERDICTS, NEVER BOARDS. See _lib/preflight.js, which holds the
 * rules and the vocabulary. Nothing from a board reaches this response, not
 * even from a broken one.
 *
 *   { ok: true, checked: 70, days: 14, today: "2026-09-06", problems: [] }
 *
 * WHY A SHARED SECRET AND NOT ADMIN. Admin was asked for and refused: that
 * route also serves plays.csv and reports.csv — real player data, exportable —
 * and accepts featured-set, challenge-hide, reports/clear and replay-day. Put
 * that credential in the Actions secrets of a PUBLIC repo and one leak is the
 * forward bank, a player-data export and write access. This endpoint reads
 * nothing about any person, writes nothing, and gives up one fact if it
 * leaks: whether the next fortnight is well formed.
 *
 * IT FAILS CLOSED. No secret configured means no access — not open access.
 * An endpoint that answers when its gate is unset is an endpoint with no gate
 * on the first day somebody forgets to set one.
 */
import { json } from "../_lib/puzzle.js";
import { hasDB } from "../_lib/db.js";
import { utcDay } from "../_lib/daily.js";
import { preflight, PREFLIGHT_DAYS } from "../_lib/preflight.js";

export const PREFLIGHT_HEADER = "X-XI-Preflight";

/* Constant time for equal-length strings, and it does not leak the secret's
   length through timing either — both sides are compared to the same number
   of characters. A === would return on the first wrong character, which over
   enough attempts is a way to read a secret out one character at a time. */
function secretOk(given, want) {
  const a = String(given == null ? "" : given);
  const b = String(want == null ? "" : want);
  if (!b) return false;                  // fail closed: no secret, no access
  if (!a) return false;
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
  }
  return diff === 0;
}

/* One refusal for every reason. A gate that says "no secret configured" to one
   caller and "wrong secret" to another has told an attacker which of the two
   they are up against. */
const REFUSED = { error: "Not found." };

export async function onRequestGet({ request, env }) {
  const given = request.headers.get(PREFLIGHT_HEADER) ||
    /* Accepted on the Authorization header too, because that is what a CI
       runner reaches for first. Never on the QUERY STRING: a URL is logged,
       cached and shoulder-read, and a secret in one is a secret published. */
    (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

  if (!secretOk(given, env && env.PREFLIGHT_SECRET)) {
    return json(REFUSED, 404, { "Cache-Control": "no-store" });
  }

  /* HOW FAR AHEAD. Passed through as asked and clamped by preflight() itself,
     which is where MAX_DAYS lives. This used to clamp here as well — and a
     sabotage that removed this clamp changed nothing, because the other one
     caught it. Two copies of one bound: the second is not a safety net, it is
     a second number to keep in step, and the day they disagree the endpoint
     reports a range it did not walk. */
  let days = PREFLIGHT_DAYS;
  try {
    const asked = Number(new URL(request.url).searchParams.get("days"));
    if (Number.isFinite(asked) && asked > 0) days = Math.floor(asked);
  } catch (e) { /* no URL to read: the default stands */ }

  const today = utcDay();

  /* NO DATABASE IS NOT A CLEAN BILL OF HEALTH. Every loader falls back to its
     sample bank so the site still runs, which is right for a player and wrong
     for a preflight: it would walk fourteen perfect sample days and report
     nothing wrong with a production schedule it never read. Said plainly and
     refused. */
  if (!hasDB(env)) {
    return json({
      ok: false, today, days, checked: 0,
      reason: "no-store",
      problems: [{ game: null, day: null, why: "no database: the samples would pass and prove nothing" }],
    }, 503, { "Cache-Control": "no-store" });
  }

  const result = await preflight(env, days, Date.now());
  return json({
    ok: result.problems.length === 0,
    today,
    days: result.days,
    checked: result.checked,
    problems: result.problems,
  }, 200, { "Cache-Control": "no-store" });
}
