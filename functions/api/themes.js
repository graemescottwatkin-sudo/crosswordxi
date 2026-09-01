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
import { listThemes } from "../_lib/theme-catalog.js";
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

  /* The catalogue comes from theme-catalog.js, which the club and theme
     pages render from too. It used to be spelled out here, and a second copy
     of "released and still listed" is a second place for that rule to change
     alone. One derivation, two destinations. */
  const themes = await listThemes(env, today);
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
    featured: await featured(env, themes, today),
    themes,
    upcoming: (next.results || []).map((r) => ({
      name: r.name, no: r.board_no, releaseOn: r.release_on,
    })),
    options,
  });
}

/* The board of the day, override first.
 *
 * A hand-set row wins over the cycle, but only for its own date. Wrapped
 * because the table arrives in a later migration than the code that reads it:
 * a missing table should mean "nobody has overridden anything", not a landing
 * screen without a card on it. */
async function featured(env, themes, today) {
  try {
    const row = await env.DB.prepare(
      "SELECT board_id FROM featured_override WHERE on_date = ?").bind(today).first();
    if (row) {
      /* Matched against the released, listed list rather than read straight
         from theme_boards. An override naming a board that has since been
         retired, or is not out yet, must not be the one thing that puts an
         unreleased board on the landing screen. */
      for (const t of themes) {
        for (const b of t.boards) {
          if (b.boardId === row.board_id) {
            return {
              themeId: t.id, themeName: t.name, club: t.club || null,
              family: t.family || null, no: b.no, boardId: b.boardId, pinned: true,
            };
          }
        }
      }
    }
  } catch (e) { /* no table yet, or no override: fall through to the cycle */ }
  return featuredBoard(themes, today);
}

/* Board of the day.
 *
 * Chosen here rather than in the browser, and from the date rather than at
 * random, so every player gets the same board on the same day. That is the
 * same rule the daily follows, and it is what makes it worth talking about:
 * "have you done today's board" only means something if there is one.
 *
 * It cycles. Position is days-since-epoch modulo the number of boards, over a
 * list ordered by a hash of the board id — so it works through every board
 * before repeating one, and the order is not alphabetical, which would put
 * Arsenal first for a fortnight.
 *
 * Adding boards reshuffles the cycle. That is accepted: this is a shop window,
 * not a schedule anybody is holding us to, and nothing references yesterday's
 * pick.
 */
function featuredBoard(themes, today) {
  const all = [];
  for (const t of themes) {
    for (const b of t.boards) {
      all.push({
        themeId: t.id, themeName: t.name, club: t.club || null,
        family: t.family || null, no: b.no, boardId: b.boardId,
      });
    }
  }
  if (!all.length) return null;

  all.sort((a, b) => {
    const ha = hash(String(a.boardId)), hb = hash(String(b.boardId));
    /* Falls back to the id so the order is total: two boards hashing equal
       would otherwise sort differently between requests and the board of the
       day would change on refresh. */
    return ha - hb || (a.boardId - b.boardId);
  });

  const days = Math.floor(Date.UTC(
    +today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) / 86400000);
  return all[((days % all.length) + all.length) % all.length];
}

/* FNV-1a. Only needs to scatter ids evenly and give the same answer every
   time; nothing here is security. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* "Arsenal — Goalkeepers" -> "Arsenal". Display only, for the picklist label:
   nothing downstream keys on the result, so a club whose name does not split
   cleanly degrades to its full theme name rather than to nothing. */
function clubLabel(t) {
  const cut = String(t.name).split(/\s+[\u2014-]\s+/)[0];
  return cut || t.name;
}
