/* preflight_live.mjs — ask production whether the coming fortnight is sound.
 *
 * The endpoint does the walking; this asks it, and turns the answer into an
 * exit code so a schedule can fail a job. It runs NIGHTLY rather than on push,
 * because the failure it is looking for does not arrive with a push: every
 * game hands out a different board at midnight UTC with no deploy at all.
 *
 *   PREFLIGHT_SECRET=... node tools/preflight_live.mjs
 *   PREFLIGHT_SECRET=... BASE=https://... DAYS=21 node tools/preflight_live.mjs
 *
 * IT PRINTS WHAT IT WAS TOLD AND NOTHING MORE. The endpoint returns verdicts —
 * game, day, why — and never a board, so there is nothing here to redact. The
 * secret is read from the environment and sent as a header; it is never put on
 * the URL, because a URL is logged by everything it passes through and a
 * secret in one is a secret published.
 *
 * A MISSING SECRET IS A FAILURE, NOT A SKIP. A nightly job that quietly passes
 * when its credential is absent is a job that reports green for the whole
 * period nobody notices the credential expired — the silent-pass fault with a
 * cron behind it.
 */
const BASE = (process.env.BASE || "https://www.thexigames.com").replace(/\/+$/, "");
const SECRET = process.env.PREFLIGHT_SECRET || "";
const DAYS = Number(process.env.DAYS || 14);

function die(message) {
  console.error(message);
  process.exit(1);
}

if (!SECRET) {
  die("No PREFLIGHT_SECRET in the environment.\n" +
      "This job cannot check anything without it, and passing would be a lie.");
}

const url = `${BASE}/api/preflight?days=${encodeURIComponent(DAYS)}`;
console.log(`Preflight: ${BASE}, ${DAYS} days`);

let res, body;
try {
  res = await fetch(url, {
    headers: { "X-XI-Preflight": SECRET, accept: "application/json" },
  });
} catch (e) {
  die("Could not reach the site: " + (e && e.message));
}

/* 404 IS THE REFUSAL, checked BEFORE the body is parsed. A refused request may
   answer with the endpoint's own JSON or with the site's HTML 404 page — an
   undeployed route gives the second — and parsing first turned the useful
   message ("the secret is wrong, or this is not deployed") into the useless
   one ("that was not JSON"). The status is the fact; the body is decoration.

   It is the same 404 a wrong secret gets and a stranger gets, deliberately, so
   the gate tells nobody which they are. Which means this cannot tell either,
   and says so rather than guessing. */
if (res.status === 404) {
  die("Refused (404). Either the secret is wrong or /api/preflight is not deployed.\n" +
      "The gate answers both the same way on purpose.");
}

try {
  body = await res.json();
} catch (e) {
  die(`The endpoint answered ${res.status} with something that is not JSON.`);
}
if (res.status === 503) {
  die("The site has no database to check against:\n  " +
      (body.problems || []).map((p) => p.why).join("\n  "));
}
if (!res.ok) die(`The endpoint answered ${res.status}.`);

const problems = body.problems || [];
console.log(`Today is ${body.today}. Checked ${body.checked} board-days.`);

if (!problems.length) {
  console.log(`\nNothing wrong in the next ${body.days} days.`);
  process.exit(0);
}

/* Grouped by game so a schedule that has run out reads as one fact rather than
   fourteen lines of the same one. */
const byGame = new Map();
for (const p of problems) {
  if (!byGame.has(p.game)) byGame.set(p.game, []);
  byGame.get(p.game).push(p);
}

console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
for (const [game, list] of byGame) {
  console.log(`  ${game || "(site)"}`);
  /* The same complaint on consecutive days is one line with a count: a
     schedule that ends says so once. */
  const counts = new Map();
  for (const p of list) {
    const k = p.why;
    if (!counts.has(k)) counts.set(k, []);
    counts.get(k).push(p.day);
  }
  for (const [why, days] of counts) {
    const when = days.filter(Boolean);
    const span = when.length > 1 ? `${when[0]} … ${when[when.length - 1]} (${when.length} days)`
      : when.length === 1 ? when[0] : "the bank itself";
    console.log(`    ${why} — ${span}`);
  }
}

process.exit(1);
