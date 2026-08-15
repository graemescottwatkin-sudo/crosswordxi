/* auth_test.mjs — accounts, sessions and the guest migration.
 *
 * This is the one part of the project where a mistake is not a layout question but a
 * security one, so the tests use a real RSA key: a token is signed here, and
 * the code verifies it exactly as it would verify Google's. The forgery cases
 * are signed with a *different* key, which is what an attacker actually has.
 */
import crypto from "node:crypto";
import {
  verifyGoogleIdToken, findOrCreateUser, createSession, currentUser,
  destroySession, sessionCookie, clearedCookie, csrfOk, publicUser,
} from "./functions/_lib/auth.js";
import { onRequestPost as googleSignIn } from "./functions/api/auth/google.js";
import { onRequestGet as sessionInfo } from "./functions/api/auth/session.js";
import { onRequestPost as signOut } from "./functions/api/auth/signout.js";
import { onRequestGet as getProfile, onRequestPost as setProfile } from "./functions/api/account/profile.js";
import { onRequestPost as migrate } from "./functions/api/account/migrate.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* ---------- a stub D1 that behaves like the real tables ---------- */
function makeDB() {
  const users = [], sessions = [], results = [];
  const like = (sql, s) => sql.includes(s);
  return {
    _users: users, _sessions: sessions, _results: results,
    prepare(sql) {
      let b = [];
      const api = {
        bind(...args) { b = args; return api; },
        async first() {
          if (like(sql, "FROM users WHERE provider")) {
            return users.find((u) => u.provider === b[0] && u.provider_id === b[1]) || null;
          }
          if (like(sql, "FROM users WHERE id")) return users.find((u) => u.id === b[0]) || null;
          if (like(sql, "FROM sessions s JOIN users u")) {
            const s = sessions.find((x) => x.id === b[0] && x.expires_at > b[1]);
            return s ? users.find((u) => u.id === s.user_id) || null : null;
          }
          if (like(sql, "FROM results WHERE user_id")) {
            return results.find((r) => r.user_id === b[0] && r.daily_no === b[1]) || null;
          }
          return null;
        },
        async run() {
          if (like(sql, "INSERT INTO users")) {
            users.push({ id: b[0], provider: b[1], provider_id: b[2], email: b[3],
              display_name: b[4], club: null, created_at: "now" });
          } else if (like(sql, "INSERT INTO sessions")) {
            sessions.push({ id: b[0], user_id: b[1], expires_at: b[2] });
          } else if (like(sql, "DELETE FROM sessions")) {
            const i = sessions.findIndex((s) => s.id === b[0]);
            if (i > -1) sessions.splice(i, 1);
          } else if (like(sql, "UPDATE users SET display_name")) {
            const u = users.find((x) => x.id === b[2]);
            if (u) { u.display_name = b[0]; u.club = b[1]; }
          } else if (like(sql, "UPDATE users SET club")) {
            const u = users.find((x) => x.id === b[1]);
            if (u) u.club = b[0];
          } else if (like(sql, "INSERT INTO results")) {
            results.push({ id: b[0], user_id: b[1], mode: b[3], daily_no: b[4],
              score: b[7], source: "migrated" });
          }
          return { success: true };
        },
      };
      return api;
    },
  };
}

/* ---------- real keys, so signature checking is actually exercised ---------- */
const good = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const evil = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (buf) => Buffer.from(buf).toString("base64url");

function makeToken(claims, key = good.privateKey, kid = "test-key") {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const payload = b64u(JSON.stringify(claims));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(header + "." + payload), key);
  return header + "." + payload + "." + b64u(sig);
}
const jwks = () => Promise.resolve([{ kid: "test-key",
  ...good.publicKey.export({ format: "jwk" }), alg: "RS256", use: "sig" }]);

const CLIENT = "client-id.apps.googleusercontent.com";
const now = () => Math.floor(Date.now() / 1000);
const valid = () => ({ iss: "https://accounts.google.com", aud: CLIENT, sub: "google-user-1",
  email: "player@example.com", name: "Graeme", exp: now() + 600, iat: now() });

const req = (opts = {}) => new Request("https://crosswordxi.com/api/x", {
  method: opts.method || "GET",
  headers: Object.assign(opts.csrf === false ? {} : { "X-Crossword-XI": "1" },
    opts.cookie ? { Cookie: opts.cookie } : {}),
  body: opts.body ? JSON.stringify(opts.body) : undefined,
});

console.log("Token verification");
t("a properly signed token is accepted", await (async () => {
  const c = await verifyGoogleIdToken(makeToken(valid()), CLIENT, jwks);
  return c.sub === "google-user-1";
})());
for (const [name, claims, key] of [
  ["a token signed with another key is rejected", valid(), evil.privateKey],
  ["a token for another site is rejected", { ...valid(), aud: "someone-else" }, good.privateKey],
  ["a token from another issuer is rejected", { ...valid(), iss: "https://evil.example" }, good.privateKey],
  ["an expired token is rejected", { ...valid(), exp: now() - 10 }, good.privateKey],
  ["a token with no subject is rejected", { ...valid(), sub: undefined }, good.privateKey],
]) {
  let threw = false;
  try { await verifyGoogleIdToken(makeToken(claims, key), CLIENT, jwks); } catch (e) { threw = true; }
  t(name, threw);
}
let threw = false;
try { await verifyGoogleIdToken("not.a.token", CLIENT, jwks); } catch (e) { threw = true; }
t("a malformed token is rejected", threw);

console.log("\nUsers and sessions");
const env = { DB: makeDB(), GOOGLE_CLIENT_ID: CLIENT };
const a = await findOrCreateUser(env, "google", "sub-1", { email: "a@b.c", name: "Graeme" });
const b = await findOrCreateUser(env, "google", "sub-1", { email: "a@b.c", name: "Graeme" });
t("signing in twice reuses the same account", a.user.id === b.user.id && a.created && !b.created);
t("the account id is not the email address",
  a.user.id !== a.user.email && /^[0-9a-f-]{36}$/.test(a.user.id), a.user.id);
const sess = await createSession(env, a.user.id);
t("a session resolves back to its user",
  (await currentUser(req({ cookie: `cxi_session=${sess.id}` }), env)).id === a.user.id);
t("an unknown session resolves to nobody",
  (await currentUser(req({ cookie: "cxi_session=made-up" }), env)) === null);
t("no cookie means guest", (await currentUser(req(), env)) === null);
t("the cookie is HttpOnly, Secure and SameSite", (() => {
  const c = sessionCookie(sess.id, new Date(Date.now() + 1000).toISOString());
  return /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c);
})());
t("the session id is long and random, not a number",
  sess.id.length >= 60 && !/^\d+$/.test(sess.id));
t("the public profile leaks nothing internal", (() => {
  const p = publicUser(a.user);
  return !("provider_id" in p) && !("email" in p) && p.id === a.user.id;
})(), Object.keys(publicUser(a.user)).join(","));

console.log("\nEndpoints");
t("sign-in refuses a request without the anti-CSRF header",
  (await googleSignIn({ request: req({ method: "POST", csrf: false, body: { credential: "x" } }), env })).status === 403);
t("sign-out refuses one too",
  (await signOut({ request: req({ method: "POST", csrf: false }), env })).status === 403);
t("the profile is refused when not signed in",
  (await getProfile({ request: req(), env })).status === 401);
t("migration is refused when not signed in",
  (await migrate({ request: req({ method: "POST", body: { results: [] } }), env })).status === 401);
t("a bad credential does not say which check failed", await (async () => {
  const r = await googleSignIn({ request: req({ method: "POST", body: { credential: makeToken(valid(), evil.privateKey) } }), env });
  const j = await r.json();
  return r.status === 401 && !/signature|issuer|expired|audience/i.test(j.error);
})());
t("session info is safe to call as a guest", await (async () => {
  const j = await (await sessionInfo({ request: req(), env })).json();
  return j.user === null && j.googleClientId === CLIENT;
})());
t("signing out clears the cookie and drops the row", await (async () => {
  const s2 = await createSession(env, a.user.id);
  const r = await signOut({ request: req({ method: "POST", cookie: `cxi_session=${s2.id}` }), env });
  return /Max-Age=0/.test(r.headers.get("Set-Cookie")) &&
    !env.DB._sessions.some((x) => x.id === s2.id);
})());

console.log("\nProfile and guest migration");
const cookie = `cxi_session=${sess.id}`;
t("a display name is trimmed and bounded", await (async () => {
  const r = await setProfile({ request: req({ method: "POST", cookie,
    body: { displayName: "   " + "x".repeat(90) + "   ", club: "Bolton Wanderers" } }), env });
  const j = await r.json();
  return j.user.displayName.length === 40 && j.user.club === "Bolton Wanderers";
})());
t("an empty display name is refused", await (async () => {
  return (await setProfile({ request: req({ method: "POST", cookie, body: { displayName: "   " } }), env })).status === 400;
})());
t("guest results are carried across on sign-in", await (async () => {
  const j = await (await migrate({ request: req({ method: "POST", cookie, body: {
    club: "Ignored, the account already chose",
    results: [{ dailyNo: 1, score: 90 }, { dailyNo: 2, score: 80 }],
  } }), env })).json();
  return j.added === 2;
})());
t("migrating twice does not duplicate a day", await (async () => {
  const j = await (await migrate({ request: req({ method: "POST", cookie, body: {
    results: [{ dailyNo: 1, score: 114 }, { dailyNo: 3, score: 70 }],
  } }), env })).json();
  return j.added === 1 && j.skipped === 1;
})());
t("the account's own club is not overwritten by the guest's",
  env.DB._users.find((u) => u.id === a.user.id).club === "Bolton Wanderers");
t("migrated rows are marked as such, so a leaderboard can distrust them",
  env.DB._results.every((r) => r.source === "migrated"));
t("a huge payload is capped rather than accepted whole", await (async () => {
  const many = Array.from({ length: 900 }, (_, i) => ({ dailyNo: 500 + i, score: 10 }));
  const j = await (await migrate({ request: req({ method: "POST", cookie, body: { results: many } }), env })).json();
  return j.added <= 400;
})(), "cap is 400");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
