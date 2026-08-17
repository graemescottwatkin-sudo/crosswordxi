/* GET /api/auth/session — who, if anyone, is signed in.
   Safe to call on every page load; returns { user: null } for a guest. */
import { json } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, publicUser } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return json({ user: null, accounts: false });
  const user = await currentUser(request, env);
  return json({
    user: publicUser(user),
    accounts: !!env.GOOGLE_CLIENT_ID,
    googleClientId: env.GOOGLE_CLIENT_ID || null,   // public by design
  });
}
