/* POST /api/challenge/entry   { id, playId, name, entrantKey }
 *
 * A verified finish joins the table. The score is read from the play row, never
 * taken from the request — there is no field here that a browser can put a
 * number into.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, newId, csrfOk } from "../../_lib/auth.js";
import { cleanName, validEntrantKey, accountDisplayName , entrantKeyFor } from "../../_lib/names.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Not configured.", 503);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  const id = /^[a-z0-9]{6,16}$/.test(String(body.id || "")) ? String(body.id) : null;
  if (!id) return bad("Unknown challenge.", 404);
  const c = await env.DB.prepare(
    `SELECT id, theme_id, board_no FROM challenges WHERE id = ? AND hidden = 0`)
    .bind(id).first();
  if (!c) return bad("Unknown challenge.", 404);

  const play = await env.DB.prepare(
    `SELECT play_id, theme_key, srv_score, started_at, ended_at, srv_verified_at,
            srv_checks, srv_check_alls, srv_reveal_letters, srv_reveal_answers
       FROM plays WHERE play_id = ? LIMIT 1`).bind(String(body.playId || "")).first();
  if (!play || play.srv_score === null || play.srv_score === undefined) {
    return bad("That game has not been verified.", 409);
  }
  /* The right board. Otherwise a good score on an easy board could be posted to
     a challenge on a hard one. */
  if (String(play.theme_key) !== c.theme_id + "-" + c.board_no) {
    return bad("That result is from a different board.", 409);
  }

  const user = await currentUser(request, env);
  const name = accountDisplayName(user) || cleanName(body.name);
  if (!name) return bad("Choose a name of at least two characters.", 400);
  const key = entrantKeyFor(user, body.entrantKey);
  if (!key) return bad("Missing entrant key.", 400);

  const a = Date.parse((play.started_at || "").replace(" ", "T") + "Z");
  const b = Date.parse((play.ended_at || play.srv_verified_at || "").replace(" ", "T") + "Z");
  const elapsed = Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 1000)) : 0;

  /* One scored result each. IGNORE rather than REPLACE, so a second finish
     cannot improve on the first — which is what makes reveal-then-replay cost
     the cheat their real attempt. */
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO challenge_entries
       (id, challenge_id, play_id, name, score, elapsed_secs, checks, reveals, entrant_key)
     VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(newId(), id, play.play_id, name, play.srv_score, elapsed,
          (play.srv_checks || 0) + (play.srv_check_alls || 0),
          (play.srv_reveal_letters || 0) + (play.srv_reveal_answers || 0), key).run();

  const added = !!(res.meta && res.meta.changes);
  return json({ ok: true, added, score: play.srv_score });
}
