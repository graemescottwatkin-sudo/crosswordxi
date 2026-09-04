/* GET /api/auth/session — who, if anyone, is signed in.
   Safe to call on every page load; returns { user: null } for a guest. */
import { json } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, publicUser } from "../../_lib/auth.js";
import { accountsOffered } from "../../_lib/archive.js";

export async function onRequestGet({ request, env }) {
  if (!hasDB(env)) return json({ user: null, accounts: false });
  const user = await currentUser(request, env);
  return json({
    user: publicUser(user),
    /* Asked rather than restated. The archive gate turns on the same
       question — a site that cannot offer an account must not demand one —
       and two spellings of "can anyone sign in here" would be two answers the
       first time one of them gained a condition. */
    accounts: accountsOffered(env),
    googleClientId: env.GOOGLE_CLIENT_ID || null,   // public by design
  });
}
