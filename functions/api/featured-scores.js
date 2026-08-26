/* GET /api/featured-scores
 *
 * Today's scores on the board of the day, ranked and anonymous.
 *
 * Anonymous on purpose. A named table would be better reading, and it is what
 * made the challenge links work — but a challenge table is entered by somebody
 * who chose to type a name for a group they know, and this is a public page
 * everybody lands on. Publishing names here by default is a wider step than
 * that, and it is waiting on a privacy policy rather than on code.
 *
 * A rank out of a field still gives the thing worth having: a reason to come
 * back tomorrow, and a number to argue with.
 */
import { json } from "../_lib/puzzle.js";
import { hasDB, serverToday } from "../_lib/db.js";

const EMPTY = { configured: false, scores: [], count: 0 };

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return json(EMPTY);
  try {
    const url = new URL(request.url);
    const theme = String(url.searchParams.get("theme") || "").trim();
    const no = Number(url.searchParams.get("no") || 0);
    if (!theme || !no) return json(EMPTY);

    const key = theme + "-" + no;
    const today = serverToday();

    /* Scoped to attempts STARTED today, not to every attempt this board has
       ever had.
       
       A featured board has usually been playable for weeks before its turn
       comes round, so an all-time table would be topped by somebody who played
       it in September and nobody arriving today could catch them. Scoping to
       the day makes it the same offer for everyone, which is the rule the
       daily already follows — and it means somebody who played it weeks ago
       and comes back today starts level.
       
       by_owner = 0 keeps your own testing out. completed = 1 because an
       abandoned attempt is not a score. */
    const rows = await env.DB.prepare(
      /* srv_elapsed_secs, not elapsed_secs.

         elapsed_secs is the browser's own figure, posted by the pagehide
         beacon: forgeable, and NULL when the beacon never arrived — which
         SQLite sorts FIRST ascending, so a lost beacon won the tie-break
         outright. srv_elapsed_secs is the clock /api/finish scored on.

         COALESCE keeps rows written before migration 017 orderable rather than
         floating to the top; they fall back to the old figure. */
      `SELECT srv_score AS score,
              COALESCE(srv_elapsed_secs, elapsed_secs) AS secs
         FROM plays
        WHERE theme_key = ?
          AND completed = 1
          AND by_owner = 0
          AND srv_score IS NOT NULL
          AND date(started_at) = ?
        ORDER BY srv_score DESC, COALESCE(srv_elapsed_secs, elapsed_secs) ASC`).bind(key, today).all();

    const scores = (rows.results || []).map((r, i) => ({
      rank: i + 1, score: r.score, secs: r.secs,
    }));

    return json({
      configured: true, today, theme, no,
      count: scores.length,
      /* The top ten is the table; the count is the field. Sending every row
         would publish the shape of a small day — "you came 3rd of 3" is a
         worse thing to read than "3rd", and on a quiet day that is most of
         them. */
      scores: scores.slice(0, 10),
      best: scores.length ? scores[0].score : null,
    });
  } catch (e) {
    /* A missing column or table should cost the leaderboard, not the board. */
    return json(EMPTY);
  }
}
