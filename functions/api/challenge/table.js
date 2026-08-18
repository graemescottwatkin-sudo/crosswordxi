/* GET /api/challenge/table?id=
 *
 * The standings — after Full Time, which is the only place this is called from.
 * Score, time and help for every entry, because a 114 in thirty-eight seconds
 * with no help is self-evidently what it is, and among people who know each
 * other that deters more than any validation.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser } from "../../_lib/auth.js";
import { entrantKeyFor } from "../../_lib/names.js";

/* POST with an entrant key: "have I already played this, and if so, show me."
 *
 * The creator sends a challenge and then cannot see how anyone is getting on
 * without playing the board again, which is absurd. Somebody who has already
 * scored may see the standings, because they cannot act on them — their result
 * is set and one entry each means it will not be replaced. The rule that
 * matters is unchanged: nothing competitive before you have played.
 *
 * The key travels in a body rather than a query string. It is an identifier,
 * and identifiers in URLs end up in logs, referrers and shared links.
 */
export async function onRequestPost({ request, env }) {
  if (!hasDB(env)) return bad("Not configured.", 503);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const id = /^[a-z0-9]{6,16}$/.test(String(body.id || "")) ? String(body.id) : null;
  if (!id) return bad("Unknown challenge.", 404);
  /* The same rule as the write: a signed-in player is their account, a guest is
     their device key. Reading with the device key while the entry had been
     written with the account matched nothing, and a signed-in creator was told
     they had not played their own challenge. */
  const user = await currentUser(request, env);
  const key = entrantKeyFor(user, body.entrantKey);

  const mine = await env.DB.prepare(
    `SELECT id FROM challenge_entries WHERE challenge_id = ? AND entrant_key = ?`)
    .bind(id, key).first();
  if (!mine) return json({ played: false });

  const r = await tableFor(env, id);
  if (!r) return bad("Unknown challenge.", 404);
  return json(Object.assign({ played: true }, r));
}

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return bad("Not configured.", 503);
  const url = new URL(request.url);
  const id = /^[a-z0-9]{6,16}$/.test(String(url.searchParams.get("id") || ""))
    ? String(url.searchParams.get("id")) : null;
  if (!id) return bad("Unknown challenge.", 404);

  const r = await tableFor(env, id);
  if (!r) return bad("Unknown challenge.", 404);
  return json(r);
}

/* One query, two callers: the page after Full Time, and somebody who has
   already scored asking how it is going. */
async function tableFor(env, id) {
  const c = await env.DB.prepare(
    `SELECT id, theme_id, board_no, creator_name, group_name
       FROM challenges WHERE id = ? AND hidden = 0`)
    .bind(id).first();
  if (!c) return null;

  /* Score first, then the faster of two equal scores. */
  const rows = await env.DB.prepare(
    `SELECT name, score, elapsed_secs, checks, reveals, play_id, created_at,
            reveal_letters, reveal_answers, check_answers, check_grids
       FROM challenge_entries
      WHERE challenge_id = ? AND hidden = 0
      ORDER BY score DESC, elapsed_secs ASC
      LIMIT 200`).bind(id).all();

  const started = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM challenge_starts WHERE challenge_id = ?").bind(id).first();

  return {
    id: c.id,
    creatorName: c.creator_name,
    groupName: c.group_name || null,
    boardNo: c.board_no,
    themeId: c.theme_id,
    started: (started && started.n) || 0,
    entries: (rows.results || []).map((r, i) => ({
      position: i + 1,
      name: r.name,
      score: r.score,
      elapsedSeconds: r.elapsed_secs,
      checks: r.checks,
      reveals: r.reveals,
      /* Separately, so the table can say what was actually done. */
      revealLetters: r.reveal_letters || 0,
      revealAnswers: r.reveal_answers || 0,
      checkAnswers: r.check_answers || 0,
      checkGrids: r.check_grids || 0,
      playId: r.play_id,
    })),
  };
}
