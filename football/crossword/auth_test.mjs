/* auth_test.mjs — accounts, sessions and the guest migration.
 *
 * This is the one part of the project where a mistake is not a layout question but a
 * security one, so the tests use a real RSA key: a token is signed here, and
 * the code verifies it exactly as it would verify Google's. The forgery cases
 * are signed with a *different* key, which is what an attacker actually has.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import {
  verifyGoogleIdToken, findOrCreateUser, createSession, currentUser,
  destroySession, sessionCookie, clearedCookie, csrfOk, publicUser,
} from "../../functions/_lib/auth.js";
import { onRequestPost as googleSignIn } from "../../functions/api/auth/google.js";
import { onRequestGet as sessionInfo } from "../../functions/api/auth/session.js";
import { onRequestPost as signOut } from "../../functions/api/auth/signout.js";
import { onRequestGet as getProfile, onRequestPost as setProfile } from "../../functions/api/account/profile.js";
import { onRequestPost as migrate } from "../../functions/api/account/migrate.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));

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
            /* Matches on the entry key, as migration 020 does. Keying the stub
               on daily_no kept it agreeing with an endpoint that had stopped
               asking that question — a double that models the old schema turns
               a passing suite into a statement about nothing. */
            return results.find((r) => r.user_id === b[0] && r.game === b[1] &&
                                       r.entry_key === b[2]) || null;
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
          } else if (like(sql, "INSERT OR IGNORE INTO results") ||
                     like(sql, "INSERT INTO results")) {
            /* OR IGNORE against UNIQUE(user_id, game, entry_key). The stub has
               to enforce it too: without this the endpoint's second guard is
               untested and a race that reaches production passes here. */
            const clash = results.some((r) => r.user_id === b[1] &&
              r.game === b[2] && r.entry_key === b[3]);
            if (!clash) {
              results.push({ id: b[0], user_id: b[1], game: b[2], entry_key: b[3],
                detail: b[4], mode: b[6], daily_no: b[7],
                score: b[10], source: "migrated" });
            }
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

const req = (opts = {}) => new Request("https://crossword.thexigames.com/api/x", {
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

console.log("\nSessions across devices and time");
t("an expired session is refused", await (async () => {
  const s = await createSession(env, a.user.id);
  // Reach into the stub and age it, which is the only way to test expiry
  // without waiting six months.
  env.DB._sessions.find((x) => x.id === s.id).expires_at = "2020-01-01T00:00:00.000Z";
  return (await currentUser(req({ cookie: `cxi_session=${s.id}` }), env)) === null;
})());
t("signing in on a second device leaves the first signed in", await (async () => {
  const phone = await createSession(env, a.user.id);
  const tablet = await createSession(env, a.user.id);
  const both = await currentUser(req({ cookie: `cxi_session=${phone.id}` }), env)
    && await currentUser(req({ cookie: `cxi_session=${tablet.id}` }), env);
  return !!both && phone.id !== tablet.id;
})());
t("signing out on one device does not sign the other out", await (async () => {
  const phone = await createSession(env, a.user.id);
  const tablet = await createSession(env, a.user.id);
  await destroySession(req({ cookie: `cxi_session=${phone.id}` }), env);
  return (await currentUser(req({ cookie: `cxi_session=${phone.id}` }), env)) === null
    && (await currentUser(req({ cookie: `cxi_session=${tablet.id}` }), env)) !== null;
})());
t("a signed-out cookie cannot be replayed", await (async () => {
  const s = await createSession(env, a.user.id);
  await destroySession(req({ cookie: `cxi_session=${s.id}` }), env);
  return (await currentUser(req({ cookie: `cxi_session=${s.id}` }), env)) === null;
})());

console.log("\nWhen accounts are not configured");
t("sign-in says so rather than failing oddly, with no client id", await (async () => {
  const noId = { DB: makeDB() };
  return (await googleSignIn({ request: req({ method: "POST", body: { credential: "x" } }), env: noId })).status === 503;
})());
t("sign-in says so with no database", await (async () => {
  const noDb = { GOOGLE_CLIENT_ID: CLIENT };
  return (await googleSignIn({ request: req({ method: "POST", body: { credential: "x" } }), env: noDb })).status === 503;
})());
t("session info still answers, so the page can boot", await (async () => {
  const j = await (await sessionInfo({ request: req(), env: {} })).json();
  return j.user === null && j.accounts === false;
})());

console.log("\nMigration takes nothing on trust");
t("a junk payload is ignored, not thrown on", await (async () => {
  for (const body of [{ results: "not an array" }, { results: [null, 7, "x"] }, {}]) {
    const r = await migrate({ request: req({ method: "POST", cookie, body }), env });
    if (r.status !== 200) return false;
  }
  return true;
})());
t("practice results are not migrated, so repeat sign-ins cannot multiply them", await (async () => {
  const before = env.DB._results.length;
  const j = await (await migrate({ request: req({ method: "POST", cookie, body: {
    results: [{ score: 50 }, { dailyNo: null, score: 60 }],
  } }), env })).json();
  return j.added === 0 && j.skipped === 2 && env.DB._results.length === before;
})());
t("negative and absurd numbers are clamped", await (async () => {
  const j = await (await migrate({ request: req({ method: "POST", cookie, body: {
    results: [{ dailyNo: 900, score: -5, checks: 1e12, elapsedSeconds: "abc" }],
  } }), env })).json();
  const row = env.DB._results.find((r) => r.daily_no === 900);
  /* A negative score is stored as null — unknown — rather than clamped to 0.
     Inventing a real score of nought would be a worse lie than admitting the
     value was not usable. */
  return j.added === 1 && row && row.score === null;
})());
t("markup in a display name is stored as text, not executed", await (async () => {
  const j = await (await setProfile({ request: req({ method: "POST", cookie,
    body: { displayName: "<img src=x onerror=alert(1)>" } }), env })).json();
  return j.user.displayName.indexOf("<img") === 0;
})(), "escaping is the renderer's job — nothing renders it yet");

/* The domain move exists so one sign-in works across every XI game. If the
   cookie is ever scoped to a single subdomain, login succeeds here and fails
   silently in the next game — so sign-out must always match sign-in. */
t("signing out clears the same cookie scope it was set with", (() => {
  const set = sessionCookie("x", new Date(Date.now() + 1000).toISOString());
  const clear = clearedCookie();
  const domainOf = (c) => (c.match(/Domain=([^;]+)/) || [])[1] || "(host only)";
  return domainOf(set) === domainOf(clear);
})(), (sessionCookie("x", new Date().toISOString()).match(/Domain=([^;]+)/) || [])[1] || "host-only for now");

/* Signing out has to look like something happened. The button Google renders is
   drawn once into an element and is not restored when the session it was drawn
   for ends, so the sheet showed a signed-out account with no way back in until
   the page was reloaded. The sheet is the chrome's now, so the rule is asserted
   on shared/xi-chrome.js; the game's part is to re-render what depends on the
   session when the chrome says the player signed out. */
{
  const chrome = fs.readFileSync(path.join(DIR, "..", "..", "shared", "xi-chrome.js"), "utf8");
  const out = chrome.slice(chrome.indexOf("function signOut()"), chrome.indexOf("function saveName()"));
  t("signing out rebuilds the sign-in button", /renderGoogle\(\)/.test(out));
  const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  const on = js.slice(js.indexOf('document.addEventListener("xi:account"'), js.indexOf("function sayAccount"));
  t("and the game re-renders what depends on the session",
    /d\.type === "signout"/.test(on) && /renderAccount\(\)/.test(on) && /refreshAdmin\(\)/.test(on) && /renderHome\(\)/.test(on));
}

/* Signing in was one of three links in a row of small text, which is where a
   thing goes when nobody is meant to find it — and it is what carries a streak
   between devices and puts a name on a challenge without typing one. */
{
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  t("sign-in has a control of its own on the landing screen", (() => {
    /* It was a .home-signin button in the column, then a button in this
       page's header bar. It is the chrome's now: shared/xi-chrome.js draws
       Sign in into every bar of the family, so this page writes none and
       the control is there all the same. */
    const chrome = fs.readFileSync(path.join(DIR, "..", "..", "shared", "xi-chrome.js"), "utf8");
    return !/id="homeSignIn"/.test(html) && /btn\("xic-ghost xic-signin", "Sign in"\)/.test(chrome);
  })());
  t("which disappears once there is an account", (() => {
    /* An account button is only interesting until you have one. */
    const chrome = fs.readFileSync(path.join(DIR, "..", "..", "shared", "xi-chrome.js"), "utf8");
    const fn = chrome.slice(chrome.indexOf("function paintAccount"), chrome.indexOf("function say("));
    return /b\.hidden = !acct\.known \|\| !!acct\.user \|\| !acct\.accounts/.test(fn);
  })());
  t("and is not offered when sign-in is not configured", (() => {
    /* Offering something that cannot work is worse than not offering it. */
    const fn = js.slice(js.indexOf("function syncSignInPrompt"), js.indexOf("function renderAccount"));
    return /!accountsAvailable/.test(fn);
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
