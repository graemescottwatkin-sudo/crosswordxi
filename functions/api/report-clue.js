/* POST /api/report-clue  { clueId, reason?, puzzle? }
 *
 * Flag a clue while playing. Deliberately open to any signed-in player rather
 * than admins only: the person who notices a bad clue is whoever happens to be
 * looking at it, and a note you have to remember until later is a note that
 * gets lost.
 *
 * Reading the reports is admin-only. Adding one is not.
 */
import { json, bad } from "../_lib/puzzle.js";
import { hasDB } from "../_lib/db.js";
import { currentUser, csrfOk, newId } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in to report a clue.", 401);

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const clueId = String(body.clueId || "").slice(0, 40);
  if (!clueId) return bad("No clue id.");

  /* One report per clue per person. Pressing the button twice on the same clue
     is far more likely to be a mis-tap than two separate objections. */
  const seen = await env.DB
    .prepare("SELECT id FROM clue_reports WHERE clue_id = ? AND reported_by = ?")
    .bind(clueId, user.id).first();
  if (seen) return json({ ok: true, already: true });

  await env.DB.prepare(
    "INSERT INTO clue_reports (id, clue_id, reported_by, reason, puzzle) VALUES (?,?,?,?,?)")
    .bind(newId(), clueId, user.id,
          String(body.reason || "").slice(0, 200) || null,
          String(body.puzzle || "").slice(0, 40) || null).run();
  return json({ ok: true });
}
