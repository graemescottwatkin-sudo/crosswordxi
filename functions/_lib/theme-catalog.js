/* The themes catalogue, in one place.
 *
 * /api/themes draws the in-game section from this; the club and theme pages
 * under /football/crossword/club/ and /football/crossword/theme/ are rendered from it. Two
 * destinations, one derivation — the alternative is a second SELECT that
 * agrees with the first until somebody changes what "on the shelf" means.
 *
 * TWO CONDITIONS, DELIBERATELY SEPARATE, and they are the whole of the
 * secrecy rule for this surface: release_on <= today asks whether a board has
 * come out, listed asks whether it is still on the shelf. A board that has not
 * been released is not in here at all, so no page rendered from this can name
 * one, link one, or count one.
 */

/* A theme id as it may appear in a URL. Anything else is not a slug we issued
   and is refused before it reaches a query. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function isSlug(s) {
  return SLUG.test(String(s || ""));
}

export async function listThemes(env, today) {
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
        /* Stored rather than derived from the id. The club page groups on
           club, and splitting "arsenal-in-the-cups" on a hyphen to find the
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
  return themes;
}
