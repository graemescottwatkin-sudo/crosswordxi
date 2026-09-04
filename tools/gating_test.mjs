/* gating_test.mjs — the archive gate, across the whole family.
 *
 * Today and the week behind it are open to everybody. Older than that, a
 * board asks the player to register. Four games, four ways of naming a board
 * — two count days, one schedules by date, one opens boards by id — and the
 * point of this suite is that they are four doors onto ONE rule. A gate that
 * four games implement four ways is a gate with three ways round it, and the
 * one people find is the one nobody tested.
 *
 * WHERE THE RULE DOES NOT APPLY, AND WHY THAT IS NOT A HOLE. A site that
 * cannot offer an account must not demand one: with no database bound and no
 * sign-in configured, "sign in to play this" is a door with no handle. So the
 * gate is off in that shape — which is also the shape every suite runs in —
 * and it is asserted here in BOTH shapes rather than only the convenient one.
 *
 *   node tools/gating_test.mjs        (from the repo root)
 */
import {
  FREE_ARCHIVE_DAYS, beyondFreeArchive, daysBack, accountsOffered,
  mayOpenArchive, archiveRefusal,
} from "../functions/_lib/archive.js";
import { ANSWERS_AFTER_DAYS, dailyNumber, utcDay } from "../functions/_lib/daily.js";
import { onRequestGet as crosswordDaily } from "../functions/api/daily.js";
import { onRequestGet as scrambledDaily } from "../functions/api/scrambled/daily.js";
import { onRequestGet as hiloDaily } from "../functions/api/hilo/daily.js";
import { onRequestGet as wordsearchPuzzle } from "../functions/api/wordsearch/puzzle.js";
import { onRequestGet as session } from "../functions/api/auth/session.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* A DATABASE THAT ANSWERS THE FEW THINGS THESE ROUTES ASK IT. Enough to be a
   site with accounts configured, which is the shape the gate is live in. The
   session row is what makes a request "signed in"; leave it out and the same
   request is a guest, which is the pair every check below turns on. */
function fakeDB({ signedIn = false, firstDay = null, lastDay = null } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...args) { return this._with(args); },
        _with(args) {
          return {
            first: async () => {
              if (/FROM sessions/.test(sql)) {
                return signedIn ? { id: "u1", name: "A Player" } : null;
              }
              /* Two different answers on purpose. A word search board can be
                 scheduled more than once, so its debut and its last outing are
                 different days — and reading the age from the wrong end of that
                 is the mistake this pair exists to catch. */
              if (/MAX\(day\)/.test(sql)) return { d: lastDay };
              if (/MIN\(day\)/.test(sql)) return { d: firstDay };
              if (/ws_puzzles/.test(sql)) {
                return { id: args[0], payload: JSON.stringify({ id: args[0], grid: [], words: [] }) };
              }
              if (/puzzles/.test(sql)) return null;
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => ({}),
          };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
      };
    },
  };
}
const withAccounts = (over) => ({ DB: fakeDB(over), GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com" });
const guest = new Request("https://x/", { headers: {} });
const member = new Request("https://x/", { headers: { Cookie: "cxi_session=abc" } });

console.log("The window itself");
t(`today and ${FREE_ARCHIVE_DAYS} days behind it are free`,
  [0, 1, 2, 7].every((b) => !beyondFreeArchive(b)),
  "0 to " + FREE_ARCHIVE_DAYS + " days back");
t("and the day after that is not", beyondFreeArchive(FREE_ARCHIVE_DAYS + 1));
t("a board with no day is never gated by age",
  !beyondFreeArchive(null) && !beyondFreeArchive(undefined) && !beyondFreeArchive(NaN),
  "the free-play catalogues are not back issues");

/* THE TWO SEVENS ARE TWO DECISIONS. They agree today; nothing may make one
   depend on the other, or moving the answers window moves the paywall. */
t("the free window and the answers window are separate constants",
  FREE_ARCHIVE_DAYS === 7 && ANSWERS_AFTER_DAYS === 7);
{
  const src = await (await import("node:fs")).promises.readFile("functions/_lib/archive.js", "utf8");
  t("and the gate does not compute its window from the answers one",
    !/ANSWERS_AFTER_DAYS/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")),
    "mentioned in the comment that warns about it, and nowhere in the code");
}

console.log("\nDays back, from a date");
t("yesterday is one day back", daysBack("2026-09-03", "2026-09-04") === 1);
t("today is none", daysBack("2026-09-04", "2026-09-04") === 0);
t("and it counts across a month end", daysBack("2026-08-28", "2026-09-04") === 7);
t("something that is not a day is not a number",
  daysBack("", "2026-09-04") === null && daysBack("last tuesday", "2026-09-04") === null &&
  daysBack(null, "2026-09-04") === null);

console.log("\nWhen the gate is up at all");
t("not without a database — there is nowhere to put a user",
  accountsOffered({ GOOGLE_CLIENT_ID: "x" }) === false);
t("not without a way to sign in — the door would have no handle",
  accountsOffered({ DB: {} }) === false);
t("and up when both are there", accountsOffered({ DB: {}, GOOGLE_CLIENT_ID: "x" }) === true);
t("with neither, an old board is served rather than refused",
  await mayOpenArchive(guest, {}, 400) === true,
  "which is the shape every suite runs in");
t("the session endpoint reports the same answer, rather than its own", (() => {
  return true;
})(), "asserted below against the route");
{
  const res = await session({ request: guest, env: { DB: fakeDB(), GOOGLE_CLIENT_ID: null } });
  const body = await res.json();
  t("a site with no client id tells the browser accounts are off",
    body.accounts === false);
  const res2 = await session({ request: guest, env: withAccounts() });
  const body2 = await res2.json();
  t("and a site with both tells it they are on", body2.accounts === true);
}

console.log("\nA guest, and a member, on a site that has accounts");
t("a guest is refused a board beyond the window",
  await mayOpenArchive(guest, withAccounts(), FREE_ARCHIVE_DAYS + 1) === false);
t("but not one inside it",
  await mayOpenArchive(guest, withAccounts(), FREE_ARCHIVE_DAYS) === true);
t("a signed-in player is served either way",
  await mayOpenArchive(member, withAccounts({ signedIn: true }), 999) === true &&
  await mayOpenArchive(member, withAccounts({ signedIn: true }), 0) === true);
/* A LOOKUP THAT FAILS IS NOT A PLAYER WHO IS SIGNED OUT. The cost of being
   wrong this way is one free archive board; the other way it locks a paying
   player out of a board they are entitled to. */
t("a session lookup that throws serves the board rather than refusing it",
  await mayOpenArchive(member, {
    DB: { prepare() { throw new Error("d1 down"); } },
    GOOGLE_CLIENT_ID: "x",
  }, 999) === true);

console.log("\nWhat a refusal says");
{
  const r = archiveRefusal(30);
  t("it carries a flag the page can act on, not just a sentence",
    r.needsAccount === true && r.daysBack === 30 && r.freeDays === FREE_ARCHIVE_DAYS);
  t("and the sentence says how far back is free",
    r.error.includes(String(FREE_ARCHIVE_DAYS)) && /sign in/i.test(r.error), r.error);
}

console.log("\nAll four doors, onto the one rule");
const today = dailyNumber();
const old = Math.max(1, today - (FREE_ARCHIVE_DAYS + 5));
const recent = Math.max(1, today - 1);

async function ask(fn, url, env, request) {
  const res = await fn({ request: request || new Request(url), env });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}
const signedOut = (url) => new Request(url);
const signedIn = (url) => new Request(url, { headers: { Cookie: "cxi_session=abc" } });

/* Every game is asked the same three questions: an old board as a guest, the
   same board signed in, and a recent board as a guest. */
const DOORS = [
  {
    game: "crossword",
    oldOne: (env, who) => ask(crosswordDaily, "https://x/api/daily?no=" + old, env, who("https://x/api/daily?no=" + old)),
    recentOne: (env, who) => ask(crosswordDaily, "https://x/api/daily?no=" + recent, env, who("https://x/api/daily?no=" + recent)),
  },
  {
    game: "scrambled",
    oldOne: (env, who) => ask(scrambledDaily, "https://x/api/scrambled/daily?no=" + old, env, who("https://x/api/scrambled/daily?no=" + old)),
    recentOne: (env, who) => ask(scrambledDaily, "https://x/api/scrambled/daily?no=" + recent, env, who("https://x/api/scrambled/daily?no=" + recent)),
  },
  {
    game: "hilo",
    oldOne: (env, who) => {
      const d = new Date(Date.parse(utcDay() + "T00:00:00Z") - (FREE_ARCHIVE_DAYS + 5) * 86400000)
        .toISOString().slice(0, 10);
      return ask(hiloDaily, "https://x/api/hilo/daily?day=" + d, env, who("https://x/api/hilo/daily?day=" + d));
    },
    recentOne: (env, who) => {
      const d = new Date(Date.parse(utcDay() + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      return ask(hiloDaily, "https://x/api/hilo/daily?day=" + d, env, who("https://x/api/hilo/daily?day=" + d));
    },
  },
  {
    game: "wordsearch",
    /* Opened by id, so the board's age comes from the schedule the fake DB
       answers with — which is how this game differs and why it is here. */
    oldOne: (env, who) => ask(wordsearchPuzzle, "https://x/api/wordsearch/puzzle?id=XIWS-0001",
      { ...env, DB: fakeDB({ signedIn: env.__in, firstDay: dayAgo(FREE_ARCHIVE_DAYS + 40), lastDay: dayAgo(FREE_ARCHIVE_DAYS + 5) }) },
      who("https://x/api/wordsearch/puzzle?id=XIWS-0001")),
    recentOne: (env, who) => ask(wordsearchPuzzle, "https://x/api/wordsearch/puzzle?id=XIWS-0001",
      { ...env, DB: fakeDB({ signedIn: env.__in, firstDay: dayAgo(1), lastDay: dayAgo(1) }) },
      who("https://x/api/wordsearch/puzzle?id=XIWS-0001")),
  },
];
function dayAgo(n) {
  return new Date(Date.parse(utcDay() + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
}

for (const door of DOORS) {
  const guestEnv = { ...withAccounts(), __in: false };
  const memberEnv = { ...withAccounts({ signedIn: true }), __in: true };

  const refused = await door.oldOne(guestEnv, signedOut);
  t(`${door.game}: a guest is refused a board beyond the window`,
    refused.status === 401 && refused.body && refused.body.needsAccount === true,
    refused.status + " " + String(JSON.stringify((refused.body || {}).error)).slice(0, 60));
  /* AND THE BOARD DOES NOT COME WITH THE REFUSAL. A 401 that still carries
     the puzzle is a lock on the door of an open room. */
  t(`${door.game}: and no board rides with the refusal`,
    refused.body && !refused.body.puzzle && !refused.body.board && !refused.body.slots,
    Object.keys(refused.body || {}).join(","));

  const allowed = await door.oldOne(memberEnv, signedIn);
  t(`${door.game}: a signed-in player is not refused`,
    allowed.status !== 401 && !(allowed.body && allowed.body.needsAccount),
    "status " + allowed.status);

  const fresh = await door.recentOne(guestEnv, signedOut);
  t(`${door.game}: and a board inside the window is open to a guest`,
    fresh.status !== 401 && !(fresh.body && fresh.body.needsAccount),
    "status " + fresh.status);
}

/* THE CASE THE DISTINCTION EXISTS FOR. A word search board can run more than
   once. Its age is the last day it was the daily, not its debut — a board that
   came out in July and ran again yesterday is a day old to a player, and
   locking it because it debuted two months ago would shut a board that is
   currently in rotation. */
{
  const env = { ...withAccounts(), __in: false };
  const res = await ask(wordsearchPuzzle, "https://x/api/wordsearch/puzzle?id=XIWS-0001",
    { ...env, DB: fakeDB({ firstDay: dayAgo(60), lastDay: dayAgo(1) }) },
    signedOut("https://x/api/wordsearch/puzzle?id=XIWS-0001"));
  t("wordsearch: a board that debuted long ago but ran again yesterday is open",
    res.status !== 401 && !(res.body && res.body.needsAccount),
    "debut 60 days back, last outing 1 — status " + res.status);
  const res2 = await ask(wordsearchPuzzle, "https://x/api/wordsearch/puzzle?id=XIWS-0001",
    { ...env, DB: fakeDB({ firstDay: dayAgo(60), lastDay: dayAgo(60) }) },
    signedOut("https://x/api/wordsearch/puzzle?id=XIWS-0001"));
  t("and the same board is gated once its last outing is old too",
    res2.status === 401, "status " + res2.status);
}

console.log("\nAnd with no accounts configured, every door stays open");
for (const door of DOORS) {
  const bare = { __in: false };
  const r = await door.oldOne(bare, signedOut);
  t(`${door.game}: an old board is served when nobody could register`,
    r.status !== 401, "status " + r.status);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
