/* POST /api/auth/signout — drop the session row and clear the cookie.
   Guest progress in the browser is untouched: signing out is not a reset. */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { destroySession, clearedCookie, csrfOk } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (hasDB(env)) await destroySession(request, env);
  return json({ ok: true }, 200, { "Set-Cookie": clearedCookie() });
}
