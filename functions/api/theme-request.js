/* POST /api/theme-request  { key, note? }
 *
 * A player asking for a theme. Modelled on report-clue, which solves the same
 * problem: any signed-in player may add one, only the owner may read them.
 *
 * `key` comes from a picklist. Free text is accepted in `note` and nowhere
 * else, because a count is the entire value of this feature — "Man Utd",
 * "man united" and "MUFC" as three rows answers nothing, while 24 against one
 * key tells you what to write clues for next.
 */
import { json, bad } from "../_lib/puzzle.js";
import { hasDB } from "../_lib/db.js";
import { currentUser, csrfOk, newId } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in to ask for a theme.", 401);

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  /* Keys are lower-case, hyphenated and short — the shape the picklist sends.
     Anything else is rejected rather than cleaned up: a key that had to be
     repaired is a key that will not group with the others. */
  const key = String(body.key || "").toLowerCase().slice(0, 40);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) return bad("Pick a theme.");
  const note = String(body.note || "").slice(0, 200) || null;

  /* One per person per theme, a second replacing the first. Asking twice is a
     mis-tap; coming back with a better reason is worth keeping. */
  const seen = await env.DB
    .prepare("SELECT id, note FROM theme_requests WHERE theme_key = ? AND requested_by = ?")
    .bind(key, user.id).first();
  if (seen) {
    if (note && note !== seen.note) {
      await env.DB.prepare("UPDATE theme_requests SET note = ? WHERE id = ?")
        .bind(note, seen.id).run();
      return json({ ok: true, already: true, updated: true });
    }
    return json({ ok: true, already: true });
  }

  await env.DB.prepare(
    "INSERT INTO theme_requests (id, theme_key, requested_by, note) VALUES (?,?,?,?)")
    .bind(newId(), key, user.id, note).run();
  return json({ ok: true });
}
