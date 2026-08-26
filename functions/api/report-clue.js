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
import { limited } from "../_lib/limit.js";

export async function onRequestPost({ request, env }) {
  if (await limited(env, request, "report-clue", 20, 3600))
    return json({ error: "Too many requests. Give it a minute." }, 429);
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in to report a clue.", 401);

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const clueId = String(body.clueId || "").slice(0, 40);
  if (!clueId) return bad("No clue id.");

  const reason = String(body.reason || "").slice(0, 200) || null;

  /* One report per clue per person — pressing the button twice is far more
     likely to be a mis-tap than two separate objections. But a second report
     with a better reason replaces the first rather than being thrown away:
     coming back to a clue with a clearer idea of what is wrong with it is
     exactly what a second look is for. */
  const seen = await env.DB
    .prepare("SELECT id, reason FROM clue_reports WHERE clue_id = ? AND reported_by = ?")
    .bind(clueId, user.id).first();
  if (seen) {
    if (reason && reason !== seen.reason) {
      await env.DB.prepare("UPDATE clue_reports SET reason = ? WHERE id = ?")
        .bind(reason, seen.id).run();
      return json({ ok: true, already: true, updated: true });
    }
    return json({ ok: true, already: true });
  }

  await env.DB.prepare(
    "INSERT INTO clue_reports (id, clue_id, reported_by, reason, puzzle) VALUES (?,?,?,?,?)")
    .bind(newId(), clueId, user.id, reason,
          String(body.puzzle || "").slice(0, 40) || null).run();
  return json({ ok: true });
}
