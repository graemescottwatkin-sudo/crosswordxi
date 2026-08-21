/* GET /api/themes
 *
 * What the Clubs and themes section is built from. Three lists in one reply,
 * because the section shows all three at once and three requests to draw one
 * panel is three chances for one of them to be the slow one.
 *
 *   themes    every theme with at least one released, listed board
 *   upcoming  the published schedule: names and dates only, no boards
 *   options   what a player may ask for, for the suggestion picklist
 *
 * Nothing here carries answers, and nothing here carries a board that has not
 * been released. `upcoming` publishes a theme name and a date and no more:
 * knowing Manchester United #3 lands on 2 October gives away nothing, while
 * the board itself would give away eleven answers.
 */
import { json } from "../_lib/puzzle.js";
import { hasDB, serverToday } from "../_lib/db.js";
import { currentUser } from "../_lib/auth.js";

/* How far ahead the schedule is published. Four weeks is a promise the build
   buffer can keep; further out and a slipped board is visible for longer than
   it takes to fix. */
const WEEKS_AHEAD = 4;

const EMPTY = { themes: [], upcoming: [], options: [], mine: [], configured: false };

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return json(EMPTY);
  try {
    return await serve(request, env);
  } catch (e) {
    /* The tables or columns may not exist yet: the code deploys from GitHub and
       the migration is run by hand, so there is a window where one is live and
       the other is not — and it was hit on the first deploy. A section nobody
       has set up should look unconfigured, not broken. Every other endpoint is
       untouched by this, so the rest of the game carries on. */
    return json(EMPTY);
  }
}

async function serve(request, env) {

  const today = serverToday();
  const horizon = new Date(Date.now() + WEEKS_AHEAD * 7 * 86400000)
    .toISOString().slice(0, 10);

  /* Two conditions, deliberately separate.
     
     release_on <= today asks whether a board has come out. listed asks whether
     it is still on the shelf. Collapsing them — retiring a board by pushing its
     release date forward — would look identical here and break everything else:
     getThemeBoard() treats a future release_on as "does not exist", and every
     token path runs through it, so a retired board would stop serving
     check-answer, reveal and finish to the live challenges pointing at it. */
  const out = await env.DB.prepare(
    `SELECT t.id, t.name, t.kind, t.club_id, t.family,
            b.board_no, b.id AS board_id, b.release_on
       FROM themes t JOIN theme_boards b ON b.theme_id = t.id
      WHERE b.release_on <= ? AND b.listed = 1
      ORDER BY t.kind, t.name, b.board_no`).bind(today).all();

  const themes = [];
  const byId = {};
  for (const r of out.results || []) {
    if (!byId[r.id]) {
      byId[r.id] = {
        id: r.id, name: r.name, kind: r.kind,
        /* Sent as stored rather than derived from the id. The club page groups
           on club, and splitting "arsenal-in-the-cups" on a hyphen to find the
           club is the same fact computed in a second place — it holds until a
           club id contains one. */
        club: r.club_id || null,
        family: r.family || null,
        boards: [],
      };
      themes.push(byId[r.id]);
    }
    byId[r.id].boards.push({ no: r.board_no, boardId: r.board_id, releasedOn: r.release_on });
  }

  const next = await env.DB.prepare(
    `SELECT t.name, b.board_no, b.release_on
       FROM theme_boards b JOIN themes t ON t.id = b.theme_id
      WHERE b.release_on > ? AND b.release_on <= ? AND b.listed = 1
      ORDER BY b.release_on`).bind(today, horizon).all();

  /* Everything a player may ask for. One entry per CLUB rather than per theme:
     Arsenal alone now has nine themes, and a picklist offering "Arsenal —
     Goalkeepers", "Arsenal — Captains" and seven more is a wall to scroll
     rather than a list to choose from. The picklist is the point — free text
     turns one club into six spellings and makes the count meaningless. */
  const seen = {};
  const options = [];
  for (const t of themes) {
    const key = t.club || t.id;
    if (seen[key]) continue;
    seen[key] = true;
    options.push({
      key,
      label: t.club ? clubLabel(t) : t.name,
      exists: true,
    });
  }

  /* What this player asked for, so the section can say "you asked for this"
     the week their board lands. This is the whole of the notification feature
     for now: it reaches everybody who comes back, needs no address, no
     sending, no unsubscribe and no scheduler — and email only ever reaches the
     people who do not come back, which is a smaller group than it feels like.
     Signed out, the list is simply empty. */
  let mine = [];
  try {
    const user = await currentUser(request, env);
    if (user) {
      const rows = await env.DB
        .prepare("SELECT theme_key FROM theme_requests WHERE requested_by = ?")
        .bind(user.id).all();
      mine = (rows.results || []).map((r) => r.theme_key);
    }
  } catch (e) { /* the section is worth more than the marker on it */ }

  return json({
    configured: true,
    today,
    mine,
    themes,
    upcoming: (next.results || []).map((r) => ({
      name: r.name, no: r.board_no, releaseOn: r.release_on,
    })),
    options,
  });
}

/* "Arsenal — Goalkeepers" -> "Arsenal". Display only, for the picklist label:
   nothing downstream keys on the result, so a club whose name does not split
   cleanly degrades to its full theme name rather than to nothing. */
function clubLabel(t) {
  const cut = String(t.name).split(/\s+[\u2014-]\s+/)[0];
  return cut || t.name;
}
