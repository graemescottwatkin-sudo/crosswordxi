/* Challenge boards.
 *
 *   POST /api/challenge              create one from a verified finish
 *   GET  /api/challenge?id=          what the page shows BEFORE playing
 *   POST /api/challenge/start        a name, taken before the board opens
 *   POST /api/challenge/entry        a verified finish joins the table
 *   GET  /api/challenge/table?id=    the standings, after Full Time
 *
 * The rule that shapes all of it: nothing competitive is returned before the
 * board has been played. GET /api/challenge deliberately carries no score, no
 * standings and no fastest time — a target turns solving into arithmetic, and
 * standings reveal the target just as plainly.
 *
 * Every score is read from plays.srv_score, which the server computed from the
 * answers it holds, the help it served, and the clock it started when the board
 * was pulled. No endpoint here accepts a score.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, newId, csrfOk } from "../../_lib/auth.js";
import { cleanName, validEntrantKey, shortId, accountDisplayName , entrantKeyFor } from "../../_lib/names.js";

const okId = (v) => (/^[a-z0-9]{6,16}$/.test(String(v || "")) ? String(v) : null);

/* A verified finish, or nothing. Reading srv_score rather than being told one
   is the whole reason a challenge table can be shown to other people. */
async function verifiedPlay(env, playId) {
  const row = await env.DB.prepare(
    `SELECT play_id, theme_key, mode, srv_score, srv_verified_at, started_at, ended_at,
            srv_checks, srv_check_alls, srv_reveal_letters, srv_reveal_answers,
            challenge_id
       FROM plays WHERE play_id = ? LIMIT 1`).bind(String(playId || "")).first();
  if (!row || row.srv_score === null || row.srv_score === undefined) return null;
  return row;
}

function boardOf(themeKey) {
  const m = /^(.*)-(\d+)$/.exec(String(themeKey || ""));
  return m ? { theme_id: m[1], board_no: Number(m[2]) } : null;
}

/* To the moment the score was computed, not to ended_at — which is written when
   the tab closes and can be minutes later, leaving a table whose times cannot
   produce the scores beside them. */
function elapsedOf(row) {
  const a = Date.parse((row.started_at || "").replace(" ", "T") + "Z");
  const b = Date.parse((row.srv_verified_at || row.ended_at || "").replace(" ", "T") + "Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 1000)) : 0;
}

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return bad("Not configured.", 503);
  const url = new URL(request.url);
  const id = okId(url.searchParams.get("id"));
  if (!id) return bad("Unknown challenge.", 404);

  const c = await env.DB.prepare(
    `SELECT id, theme_id, board_no, creator_name, group_name, created_at
       FROM challenges WHERE id = ? AND hidden = 0`).bind(id).first();
  if (!c) return bad("Unknown challenge.", 404);

  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM challenge_starts  WHERE challenge_id = ?) AS started,
            (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = ? AND hidden = 0) AS finished`)
    .bind(id, id).first();

  /* Social proof, and nothing that could be worked backwards into a target. */
  return json({
    id: c.id,
    themeId: c.theme_id,
    boardNo: c.board_no,
    token: "theme:" + c.theme_id + "-" + c.board_no,
    creatorName: c.creator_name,
    groupName: c.group_name || null,
    started: (counts && counts.started) || 0,
    finished: (counts && counts.finished) || 0,
  });
}

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Not configured.", 503);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  const play = await verifiedPlay(env, body.playId);
  if (!play) return bad("That game has not been verified, so it cannot start a challenge.", 409);
  if (play.mode !== "theme" || !play.theme_key) {
    return bad("Challenges are for themed boards.", 400);
  }
  const board = boardOf(play.theme_key);
  if (!board) return bad("Unknown board.", 400);

  const user = await currentUser(request, env);
  /* Two names, not one. The creator is a person — from the account where there
     is one, typed otherwise. The group is who it is being sent to, and is
     optional: a challenge to one friend does not need a label, and demanding
     one would put a form between somebody and sending a link. */
  const name = accountDisplayName(user) || cleanName(body.name);
  if (!name) return bad("Choose a name of at least two characters.", 400);
  const groupName = body.groupName ? cleanName(body.groupName) : null;

  /* Pressing the button twice returns the link you already have, so a
     double-tap cannot produce two tables for one game. A second table is a
     different intention — the same board sent to a different group of people —
     and has to be asked for by name. Making somebody replay a board to send it
     to their family after sending it to their five-a-side lot would be friction
     for nothing: the result would be identical either way. */
  if (!body.another) {
    const already = await env.DB.prepare(
      "SELECT id FROM challenges WHERE play_id = ? ORDER BY created_at LIMIT 1")
      .bind(play.play_id).first();
    if (already) return json({ id: already.id, already: true });
  }

  const id = shortId();
  await env.DB.prepare(
    `INSERT INTO challenges (id, theme_id, board_no, created_by, creator_name, play_id, group_name)
     VALUES (?,?,?,?,?,?,?)`)
    .bind(id, board.theme_id, board.board_no, user ? user.id : null, name,
          play.play_id, groupName).run();

  /* The creator's own result seeds the table, or the page opens empty and reads
     as broken rather than as new. */
  const key = entrantKeyFor(user, body.entrantKey);
  if (key) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO challenge_entries
         (id, challenge_id, play_id, name, score, elapsed_secs, checks, reveals, entrant_key)
       VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(newId(), id, play.play_id, name, play.srv_score, elapsedOf(play),
            (play.srv_checks || 0) + (play.srv_check_alls || 0),
            (play.srv_reveal_letters || 0) + (play.srv_reveal_answers || 0), key).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO challenge_starts (id, challenge_id, entrant_key, name, play_id)
       VALUES (?,?,?,?,?)`).bind(newId(), id, key, name, play.play_id).run();
  }

  return json({ id });
}
