/* POST /api/challenge/start   { id, name, entrantKey }
 *
 * The name, taken before the board opens.
 *
 * That is the owner's decision, made against my advice — I argued a form before
 * anyone has seen the puzzle is where people leave. The counter-argument is
 * better: a name typed before playing is a commitment, people finish what they
 * have put something into, and it makes "six have taken this" a real number
 * rather than an estimate.
 *
 * A start is counted, never listed. Somebody who begins and gives up appears in
 * the total and not in the standings, which is honest without publishing
 * anyone's abandonment.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, newId, csrfOk } from "../../_lib/auth.js";
import { cleanName, validEntrantKey, accountDisplayName } from "../../_lib/names.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Not configured.", 503);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  const id = /^[a-z0-9]{6,16}$/.test(String(body.id || "")) ? String(body.id) : null;
  if (!id) return bad("Unknown challenge.", 404);
  const c = await env.DB.prepare(
    "SELECT id FROM challenges WHERE id = ? AND hidden = 0").bind(id).first();
  if (!c) return bad("Unknown challenge.", 404);

  const user = await currentUser(request, env);
  const name = accountDisplayName(user) || cleanName(body.name);
  if (!name) return bad("Choose a name of at least two characters.", 400);

  const key = user ? "u:" + user.id : validEntrantKey(body.entrantKey);
  if (!key) return bad("Missing entrant key.", 400);

  /* IGNORE, not REPLACE: coming back to an interrupted attempt is the same
     start, not a second one. */
  await env.DB.prepare(
    `INSERT OR IGNORE INTO challenge_starts (id, challenge_id, entrant_key, name)
     VALUES (?,?,?,?)`).bind(newId(), id, key, name).run();

  /* Whether this person has already posted a score. One SCORED RESULT per
     entrant, not one start — an attempt interrupted by a phone call has to be
     resumable, or a legitimate player loses their go to bad luck. */
  const done = await env.DB.prepare(
    `SELECT id FROM challenge_entries WHERE challenge_id = ? AND entrant_key = ?`)
    .bind(id, key).first();

  return json({ ok: true, name, alreadyScored: !!done });
}
