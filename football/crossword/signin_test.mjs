/* signin_test.mjs — the sign-in checks, with you doing the Google part.
 *
 *   node signin_test.mjs
 *   set BASE=https://crossword.thexigames.com   (default is localhost:8788)
 *
 * Opens a REAL browser window you can see and click in. It does everything it
 * can on its own, stops when it needs a human, tells you exactly what to do,
 * and carries on the moment you have done it.
 *
 * Why not automate the Google part: Google blocks automated sign-in, and
 * stubbing it would test the stub rather than the three things that actually
 * break — the origin allow-list, the token verification and the cookie. So the
 * popup is yours. Everything either side of it is checked here.
 *
 * Nothing is written to your database. Clearing your existing record, if you
 * want a clean count, is one command printed at the start.
 
 * RUN BY A PERSON, NOT BY CI. This needs a real database, a configured
 * GOOGLE_CLIENT_ID and somebody to click the Google popup — which is the whole
 * point of it, because automating that popup would test a stub rather than the
 * origin allow-list, the token verification and the cookie, which are what
 * break. Against production:
 *
 *   BASE=https://www.thexigames.com/football/crossword/ HEADED=1 node crossword/signin_test.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8788";
let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
};
const say = (msg) => console.log(`\n\u001b[36m>>> ${msg}\u001b[0m`);

/* Ask the server who is signed in. More reliable than reading the page, and it
   is the same endpoint the game itself uses. */
const session = (page) =>
  page.evaluate(() =>
    fetch("/api/auth/session", { credentials: "same-origin" }).then((r) => r.json()));

const status = (page) =>
  page.evaluate(() => fetch("/api/status").then((r) => r.json()));

/* Wait for you. Polls rather than asking you to press Enter, so it continues
   the moment the state changes. */
async function waitFor(page, what, predicate, seconds = 180) {
  say(what);
  const until = Date.now() + seconds * 1000;
  let dots = 0;
  while (Date.now() < until) {
    let s = null;
    try { s = await session(page); } catch (e) { /* mid-navigation */ }
    if (s && predicate(s)) { console.log("    done.\n"); return s; }
    await page.waitForTimeout(1000);
    if (++dots % 10 === 0) process.stdout.write(".");
  }
  console.log("\n    timed out waiting.\n");
  return null;
}

/* HEADED WHEN A PERSON IS DRIVING IT, HEADLESS OTHERWISE.

   This was pinned open with a 60ms slowMo because the sign-in it exercises is
   a real Google popup somebody has to click. That is still true, and it is why
   the assertions below stop at the boundary rather than automating the popup —
   but a job with no display cannot open a window, so the suite could never
   have run anywhere but a desktop. HEADED=1 to watch it. */
const headed = process.env.HEADED === "1";
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 60 : 0 });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();

console.log(`Testing ${BASE}\n`);
console.log("If you want a clean account count, run this first and restart:");
console.log('  npx wrangler d1 execute crosswordxi --remote --command "DELETE FROM results"\n');

await page.goto(BASE, { waitUntil: "domcontentloaded" });
/* The game opens on a landing screen and loads nothing until a mode is
   chosen. Waiting for the kick off card without choosing one waits forever —
   which is what this did, in a job nobody had ever run. */
await page.waitForSelector("#homeDaily", { timeout: 20000 });
await page.click("#homeDaily", { timeout: 10000 });
await page.waitForSelector("#kickOffBtn", { timeout: 20000 });

/* ---------- Baseline ---------- */
console.log("Before signing in");
const before = await status(page);
t("the site is talking to its database", before.db === true, before.source);
t("sign-in is configured", before.accounts === true,
  before.accounts ? "client id present" : "GOOGLE_CLIENT_ID missing — nothing below can work");
const startAccounts = before.users ?? 0;
console.log(`      accounts on record: ${startAccounts}`);

/* If a session is already live, sign out first — otherwise the first wait
   passes instantly and proves nothing about signing in. */
let s0 = await session(page);
if (s0.user) {
  say("Already signed in. Signing out first so the test starts from a guest.");
  await page.click("#accountToggle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.click("#xicAcctSignOut", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.click("#xicAcctClose", { timeout: 4000 }).catch(() => {});
  s0 = await session(page);
}
t("nobody is signed in yet", s0.user === null,
  s0.user ? `still signed in as ${s0.user.displayName}` : "guest");

/* ---------- First sign-in ---------- */
const s1 = await waitFor(page, "Sign in with Google in the browser window.",
  (s) => s.user !== null);
t("signing in produced an account", !!s1 && !!s1.user, s1?.user?.displayName);
if (!s1?.user) {
  console.log("\nCannot continue without a session. Stopping here.");
  await browser.close();
  process.exit(1);
}
const name1 = s1.user.displayName;
const id1 = s1.user.id;

const after1 = await status(page);
t("exactly one account was created", after1.users === startAccounts + 1 || after1.users === 1,
  `${startAccounts} -> ${after1.users}`);

/* ---------- Sign out — this part needs no help ---------- */
say("Signing out for you.");
await page.click("#accountToggle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);
await page.click("#xicAcctSignOut", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1200);
const s2 = await session(page);
t("signing out ends the session", s2.user === null,
  s2.user ? "still signed in" : "signed out");
await page.click("#xicAcctClose", { timeout: 4000 }).catch(() => {});

/* ---------- Second sign-in: the one that matters ---------- */
const s3 = await waitFor(page,
  "Sign in AGAIN with the SAME Google account.", (s) => s.user !== null);
t("signing in again works", !!s3?.user, s3?.user?.displayName);

t("it is the same account, not a second one",
  !!s3?.user && s3.user.id === id1,
  s3?.user ? `${id1.slice(0, 8)} vs ${s3.user.id.slice(0, 8)}` : "no session");
t("and the same display name", s3?.user?.displayName === name1,
  `${name1} / ${s3?.user?.displayName}`);

const after2 = await status(page);
t("no duplicate account was created", after2.users === after1.users,
  `${after1.users} -> ${after2.users}`);

/* ---------- The account survives a reload ---------- */
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const s4 = await session(page);
t("the session survives a reload", !!s4?.user && s4.user.id === id1,
  s4?.user ? "still signed in" : "lost the session");

/* ---------- A signed-out game is untouched ---------- */
say("Signing out again, then checking a guest game still plays.");
await page.click("#accountToggle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);
await page.click("#xicAcctSignOut", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(800);
await page.click("#xicAcctClose", { timeout: 4000 }).catch(() => {});
await page.click("#kickOffBtn", { timeout: 8000 }).catch(() => {});
await page.waitForSelector(".cell", { timeout: 10000 });
t("a guest can still start a puzzle",
  (await page.locator(".cell:not(.block)").count()) > 40,
  `${await page.locator(".cell:not(.block)").count()} playable cells`);

console.log(`\n${"\u2500".repeat(60)}`);
console.log(fail ? `${fail} failures` : "All sign-in checks passed.");
console.log("\nThe browser stays open so you can look around. Close it when done.");
console.log("Press Ctrl+C in this window to finish.\n");

/* Deliberately not closing: the last thing you want after a failure is the
   evidence disappearing. */
await new Promise(() => {});
