/* GET  /api/account/profile — the signed-in player's profile
 * POST /api/account/profile { displayName?, club? }
 *
 * Small on purpose: an account holds who you are and which club you play as.
 * Everything else is derived from results.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, publicUser, csrfOk } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return bad("Accounts are not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Not signed in.", 401);
  return json({ user: publicUser(user) });
}

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Accounts are not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Not signed in.", 401);

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  // Everything from the browser is bounded and trimmed before it is stored.
  const name = body.displayName === undefined ? user.display_name
    : String(body.displayName).replace(/\s+/g, " ").trim().slice(0, 40);
  const club = body.club === undefined ? user.club
    : (body.club === null ? null : String(body.club).trim().slice(0, 60));
  if (!name) return bad("A display name cannot be empty.");

  await env.DB.prepare("UPDATE users SET display_name = ?, club = ? WHERE id = ?")
    .bind(name, club, user.id).run();
  const updated = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  return json({ user: publicUser(updated) });
}
