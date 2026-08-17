/* GET /api/themes
 *
 * What the Themed section is built from. Three lists in one reply, because the
 * section shows all three at once and three requests to draw one panel is
 * three chances for one of them to be the slow one.
 *
 *   themes    every theme with at least one released board, and its boards
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
    /* The tables may not exist yet: the code deploys from GitHub and the
       migration is run by hand, so there is a window where one is live and the
       other is not — and it was hit on the first deploy. A section nobody has
       set up should look unconfigured, not broken. Every other endpoint is
       untouched by this, so the rest of the game carries on. */
    return json(EMPTY);
  }
}

async function serve(request, env) {

  const today = serverToday();
  const horizon = new Date(Date.now() + WEEKS_AHEAD * 7 * 86400000)
    .toISOString().slice(0, 10);

  const out = await env.DB.prepare(
    `SELECT t.id, t.name, t.kind, b.board_no, b.id AS board_id, b.release_on
       FROM themes t JOIN theme_boards b ON b.theme_id = t.id
      WHERE b.release_on <= ?
      ORDER BY t.kind, t.name, b.board_no`).bind(today).all();

  const themes = [];
  const byId = {};
  for (const r of out.results || []) {
    if (!byId[r.id]) {
      byId[r.id] = { id: r.id, name: r.name, kind: r.kind, boards: [] };
      themes.push(byId[r.id]);
    }
    byId[r.id].boards.push({ no: r.board_no, boardId: r.board_id, releasedOn: r.release_on });
  }

  const next = await env.DB.prepare(
    `SELECT t.name, b.board_no, b.release_on
       FROM theme_boards b JOIN themes t ON t.id = b.theme_id
      WHERE b.release_on > ? AND b.release_on <= ?
      ORDER BY b.release_on`).bind(today, horizon).all();

  /* Everything a player may ask for: the themes that exist, plus every club in
     the game's own club list so a Villa supporter can ask for Villa before a
     Villa board exists. The picklist is the point — free text turns one club
     into six spellings and makes the count meaningless. */
  const options = themes.map((t) => ({ key: t.id, label: t.name, exists: true }));

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
