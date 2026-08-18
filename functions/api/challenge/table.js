/* GET /api/challenge/table?id=
 *
 * The standings — after Full Time, which is the only place this is called from.
 * Score, time and help for every entry, because a 114 in thirty-eight seconds
 * with no help is self-evidently what it is, and among people who know each
 * other that deters more than any validation.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return bad("Not configured.", 503);
  const url = new URL(request.url);
  const id = /^[a-z0-9]{6,16}$/.test(String(url.searchParams.get("id") || ""))
    ? String(url.searchParams.get("id")) : null;
  if (!id) return bad("Unknown challenge.", 404);

  const c = await env.DB.prepare(
    `SELECT id, theme_id, board_no, creator_name FROM challenges WHERE id = ? AND hidden = 0`)
    .bind(id).first();
  if (!c) return bad("Unknown challenge.", 404);

  /* Score first, then the faster of two equal scores. */
  const rows = await env.DB.prepare(
    `SELECT name, score, elapsed_secs, checks, reveals, play_id, created_at
       FROM challenge_entries
      WHERE challenge_id = ? AND hidden = 0
      ORDER BY score DESC, elapsed_secs ASC
      LIMIT 200`).bind(id).all();

  const started = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM challenge_starts WHERE challenge_id = ?").bind(id).first();

  return json({
    id: c.id,
    creatorName: c.creator_name,
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
      playId: r.play_id,
    })),
  });
}
