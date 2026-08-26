/* POST /api/auth/google  { credential }
 *
 * The browser gets an ID token from Google Identity Services and posts it here.
 * The token is verified against Google's public keys before anything is
 * trusted — the browser is never asked who it is, it is told.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import {
  verifyGoogleIdToken, findOrCreateUser, createSession,
  sessionCookie, publicUser, csrfOk,
} from "../../_lib/auth.js";
import { limited } from "../../_lib/limit.js";

export async function onRequestPost({ request, env }) {
  if (await limited(env, request, "signin", 20, 3600))
    return json({ error: "Too many requests. Give it a minute." }, 429);
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Accounts need the D1 binding — see README step F.", 503);
  if (!env.GOOGLE_CLIENT_ID) {
    return bad("Google sign-in is not configured on this site yet.", 503);
  }

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  if (!body || !body.credential) return bad("No credential supplied.");

  let claims;
  try {
    claims = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    // Never echo the reason back: it tells an attacker which check they failed.
    return bad("Could not verify that sign-in.", 401);
  }

  const { user, created } = await findOrCreateUser(env, "google", claims.sub, {
    email: claims.email, name: claims.name,
  });
  const session = await createSession(env, user.id);

  return json({ user: publicUser(user), created }, 200,
    { "Set-Cookie": sessionCookie(session.id, session.expires, request) });
}
