/* POST /api/account/code  { code }
 *
 * Turns a device code into an account, or signs in to the one it already
 * names. The code IS the identity — there is no password, and anyone holding
 * it is that player.
 *
 * Why this exists alongside Google sign-in: almost nobody signs in, and a
 * Google account means a name, an email and a service likely accessed by
 * children. A code holds a random string and some scores. Two doors, one
 * account: `users` already has a provider column, so a code is
 * provider = 'code' with the code as provider_id, and sessions, results and
 * the results pull all work unchanged.
 *
 * The code is generated in the browser and lives only there until this is
 * called. That keeps the server holding nothing for the great majority who
 * never ask to save anything.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import {
  upsertUser, createSession, sessionCookie, publicUser, csrfOk, currentUser,
} from "../../_lib/auth.js";

/* Thirty characters: Crockford base32 with 0 and 1 dropped as well.

   I, L, O and U go for Crockford's reasons — U so a random code cannot spell
   anything unfortunate, the rest because they are confusable. 0 and 1 go too,
   because 0/O and 1/I are exactly what people get wrong copying a code from an
   iPad onto a laptop, and removing one side of each pair is not enough.

   Twelve characters of thirty is 2^59 — with ten thousand players a blind
   guess finds an account once in about 58 trillion attempts. The length is
   comfortably past the point of mattering; rate limiting the endpoint is what
   actually stops somebody hammering it. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LEN = 12;

function normalise(raw) {
  /* Hyphens are formatting, not part of the code, and people type the case
     they see. Both are stripped before anything is compared. */
  const up = String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (up.length !== CODE_LEN) return null;
  for (const ch of up) if (ALPHABET.indexOf(ch) === -1) return null;
  return up;
}

export async function onRequestPost({ request, env }) {
  if (!hasDB(env)) return bad("Accounts are not configured.", 503);
  if (!csrfOk(request)) return bad("Bad request.", 400);

  let body = null;
  try { body = await request.json(); } catch (e) { return bad("Bad request.", 400); }

  const code = normalise(body && body.code);
  /* Deliberately vague. A response that distinguished "not a valid code" from
     "no such account" would let somebody map the space without ever guessing
     one right. */
  if (!code) return bad("That code is not right.", 400);

  /* Already signed in as somebody else: refuse rather than silently switch.
     Claiming a code while holding another identity is how two sets of results
     end up merged by accident, and there is no way back from that. */
  const already = await currentUser(request, env);
  if (already && already.provider !== "code") {
    return bad("Sign out first, then enter the code.", 409);
  }

  /* upsertUser creates on first sight and returns the existing row after that,
     which is exactly the behaviour wanted: the first device to claim a code
     makes the account, every device after signs in to it. */
  const { user, created } = await upsertUser(env, "code", code, { name: "Player" });
  const session = await createSession(env, user.id);

  return json({ user: publicUser(user), created },
    200, { "Set-Cookie": sessionCookie(session.id, session.expires) });
}
