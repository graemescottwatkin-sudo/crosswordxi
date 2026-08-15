/* functions/_lib/auth.js — sessions and identity.
 *
 * Design decisions worth knowing, because they are the ones that are expensive
 * to change later:
 *
 * 1. No passwords, ever. Identity comes from Google (and later Apple), verified
 *    server-side. There is nothing here to leak or to reset.
 *
 * 2. Sessions are an opaque random id in an HttpOnly cookie, with the row in
 *    D1 — not a JWT in localStorage. A token readable by script is a token any
 *    injected script can take, and this game renders clue text from a database.
 *
 * 3. The primary key is an internal id, never the email. Emails change, and
 *    people sign in to the same account through different providers.
 *
 * 4. State-changing endpoints require a custom header. Cookies are sent
 *    automatically by the browser on cross-site form posts; a header is not, so
 *    requiring one is a simple, dependency-free CSRF defence. SameSite=Lax is
 *    belt and braces on top.
 */

const SESSION_COOKIE = "cxi_session";
const SESSION_DAYS = 180;

/* ---------- Google ID token verification ----------
   Standard OIDC: fetch Google's public keys, check the signature, then check
   the claims. This is not a custom security system — it is the documented way
   to accept a Google sign-in, and it avoids paying a third party to do it. */

let jwksCache = { keys: null, at: 0 };

async function googleKeys() {
  const hour = 3600000;
  if (jwksCache.keys && Date.now() - jwksCache.at < hour) return jwksCache.keys;
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error("Could not fetch Google signing keys");
  const body = await res.json();
  jwksCache = { keys: body.keys || [], at: Date.now() };
  return jwksCache.keys;
}

function b64urlToBytes(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function verifyGoogleIdToken(idToken, clientId, keysFn = googleKeys) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h, p, sig] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));

  const keys = await keysFn();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");

  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig),
    new TextEncoder().encode(h + "." + p));
  if (!ok) throw new Error("Bad signature");

  /* Claims are checked after the signature, never before. */
  const now = Math.floor(Date.now() / 1000);
  const issuers = ["accounts.google.com", "https://accounts.google.com"];
  if (!issuers.includes(claims.iss)) throw new Error("Wrong issuer");
  if (claims.aud !== clientId) throw new Error("Token was not issued for this site");
  if (typeof claims.exp !== "number" || claims.exp < now) throw new Error("Token expired");
  if (claims.iat && claims.iat > now + 300) throw new Error("Token issued in the future");
  if (!claims.sub) throw new Error("Token has no subject");
  return claims;
}

/* ---------- Users ---------- */

export function newId() {
  return crypto.randomUUID();
}

export async function findOrCreateUser(env, provider, subject, profile = {}) {
  const existing = await env.DB
    .prepare("SELECT * FROM users WHERE provider = ? AND provider_id = ? LIMIT 1")
    .bind(provider, subject).first();
  if (existing) return { user: existing, created: false };

  const id = newId();
  const name = (profile.name || (profile.email || "").split("@")[0] || "Player").slice(0, 40);
  await env.DB.prepare(
    "INSERT INTO users (id, provider, provider_id, email, display_name) VALUES (?, ?, ?, ?, ?)")
    .bind(id, provider, subject, profile.email || null, name).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return { user, created: true };
}

/* ---------- Sessions ---------- */

export async function createSession(env, userId) {
  const id = newId() + newId().replace(/-/g, "");   // opaque, not guessable
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires).run();
  return { id, expires };
}

export function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function currentUser(request, env) {
  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`)
    .bind(sid, new Date().toISOString()).first();
  return row || null;
}

export async function destroySession(request, env) {
  const sid = readCookie(request, SESSION_COOKIE);
  if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
}

export function sessionCookie(id, expires) {
  /* HttpOnly so script cannot read it. Secure so it never crosses plain HTTP.
     Lax so it survives a normal navigation but is not sent on cross-site
     posts. */
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; ` +
    `SameSite=Lax; Expires=${new Date(expires).toUTCString()}`;
}

export function clearedCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/* Cookies ride along on cross-site posts; a custom header does not. */
export function csrfOk(request) {
  return request.headers.get("X-Crossword-XI") === "1";
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    displayName: u.display_name,
    club: u.club || null,
    provider: u.provider,
    createdAt: u.created_at,
  };
}
