/* verified_test.mjs — the score HiLo's server computes, and what it refuses.
 *
 * A challenge table is only worth looking at if the scores in it were computed
 * by the server. Until this, only Crossword XI wrote plays.srv_score. HiLo has
 * always judged WHICH calls were right — it holds the values — so the thing
 * that had to change was the clock: this game's score is per-call speed, ten
 * points inside the grace falling a point a second, and the server did not
 * know when a call was shown.
 *
 * It does now, and the suite that matters is the one that tries to cheat it:
 * a score sent up, a call replayed faster, a round with no kick off.
 *
 *   node hilo/verified_test.mjs        (from the repo root)
 */
import { onRequestPost as callPost } from "../functions/api/hilo/call.js";
import { onRequestPost as clockPost } from "../functions/api/hilo/clock.js";
import { onRequestPost as finishPost } from "../functions/api/hilo/finish.js";
import { HL_SCORING, startClock, recordCall, verifiedScore } from "../functions/_lib/hl-round.js";
import { HL_SAMPLE_BOARDS, HL_SAMPLE_SCHEDULE } from "../functions/_lib/hl-sample.js";
import { dayToken } from "../functions/_lib/hl-board.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* A DATABASE OF TWO TABLES, IN MEMORY. Small enough to be obviously right and
   real enough that the handlers cannot tell: the same SQL runs against it. */
function memDB() {
  const rounds = new Map();          // play_id -> { token, started_ms, clock_ms }
  const calls = new Map();           // play_id|idx -> row
  const plays = new Map();           // play_id -> { srv_score, srv_elapsed_secs }
  const db = {
    _rounds: rounds, _calls: calls, _plays: plays,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            first: async () => {
              if (/FROM hl_round/.test(sql)) {
                const r = rounds.get(a[0]);
                return r ? { play_id: a[0], clock_ms: r.clock_ms, started_ms: r.started_ms } : null;
              }
              return null;
            },
            all: async () => {
              if (/FROM hl_call/.test(sql)) {
                const out = [...calls.values()].filter((c) => c.play_id === a[0])
                  .sort((x, y) => x.idx - y.idx);
                return { results: out };
              }
              return { results: [] };
            },
            run: async () => {
              if (/INSERT INTO hl_round/.test(sql)) {
                rounds.set(a[0], { token: a[1], started_ms: a[2], clock_ms: a[3] });
              } else if (/UPDATE hl_round/.test(sql)) {
                const r = rounds.get(a[1]);
                if (r) r.clock_ms = a[0];
              } else if (/INSERT INTO hl_call/.test(sql)) {
                const key = a[0] + "|" + a[1];
                const row = { play_id: a[0], idx: a[1], called: a[2],
                  was_right: a[3], elapsed_ms: a[4], at_ms: a[5] };
                /* THE CONFLICT RULE IS READ OUT OF THE STATEMENT, not decided
                   here. Modelling "first one wins" in the fake made the fake
                   correct and the check useless: changing the real SQL to DO
                   UPDATE left the suite green, because this had already
                   decided what a conflict means. A fake that is right when the
                   code is wrong is worse than no fake. */
                if (!calls.has(key)) calls.set(key, row);
                else if (/DO UPDATE/i.test(sql)) calls.set(key, row);
              } else if (/UPDATE plays/.test(sql)) {
                plays.set(a[2], { srv_score: a[0], srv_elapsed_secs: a[1] });
              }
              return {};
            },
          };
        },
      };
    },
  };
  return db;
}

const day = Object.keys(HL_SAMPLE_SCHEDULE).sort()[0];
const board = HL_SAMPLE_BOARDS.find((b) => String(b.id) === HL_SAMPLE_SCHEDULE[day]);
const TOKEN = dayToken(day);
const truth = (i) => (board.chain[i].value > board.chain[i - 1].value ? "higher" : "lower");

const post = (fn, env, body) => fn({
  request: new Request("https://x/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
    body: JSON.stringify(body),
  }), env,
});
const read = async (res) => ({ status: res.status, body: await res.json() });

console.log("The rule is the page's own file, not a second copy of it");
t("the Worker imports hilo/js/scoring.js itself",
  HL_SCORING.CALLS === 11 && HL_SCORING.CEILING === 114 && HL_SCORING.worthAt(0) === 10,
  "one file, so there is no drift to check for");
t("and the numbers are the ones the page scores with",
  HL_SCORING.worthAt(HL_SCORING.CLOCK_MS) === 0 &&
  HL_SCORING.score(Array(11).fill(true), Array(11).fill(10)) === 114);

console.log("\nA round played right through");
{
  const env = { DB: memDB() };
  const play = "play-perfect-1";
  let now = 1000000;
  await startClock(env, play, TOKEN, now);
  for (let i = 1; i <= 11; i++) {
    /* Answered inside the grace every time, so every call is worth ten. */
    now += HL_SCORING.GRACE_MS;
    await recordCall(env, play, i, truth(i), true, now);
  }
  const got = await verifiedScore(env, play);
  t("eleven right inside the grace is the ceiling",
    got && got.score === 114 && got.right === 11, got && got.score);
  t("and the round's length is measured by this server",
    got.elapsedSecs === Math.round(11 * HL_SCORING.GRACE_MS / 1000), got.elapsedSecs + "s");
}

console.log("\nThe clock is the server's, and slow calls cost");
{
  const env = { DB: memDB() };
  const play = "play-slow-1";
  let now = 2000000;
  await startClock(env, play, TOKEN, now);
  for (let i = 1; i <= 11; i++) {
    /* Right at the end of every clock: right calls, worth nothing. */
    now += HL_SCORING.CLOCK_MS;
    await recordCall(env, play, i, truth(i), true, now);
  }
  const got = await verifiedScore(env, play);
  t("eleven right at the last instant score only the run bonus",
    got.score === HL_SCORING.runBonus(Array(11).fill(true)), got.score);
  t("which is not zero, because the runs still stand", got.score > 0, got.score);
}

console.log("\nWhat it refuses");
{
  const env = { DB: memDB() };
  const play = "play-short-1";
  await startClock(env, play, TOKEN, 3000000);
  for (let i = 1; i <= 5; i++) await recordCall(env, play, i, truth(i), true, 3000000 + i * 1000);
  t("a round of five calls is not scored", await verifiedScore(env, play) === null,
    "eleven or nothing");
}
{
  /* A CALL WITH NO KICK OFF. Nothing to time it from, so nothing is invented. */
  const env = { DB: memDB() };
  t("a call on a round the server never saw start is not recorded",
    await recordCall(env, "play-nostart", 1, "higher", true, 4000000) === null);
  t("and that round has no score", await verifiedScore(env, "play-nostart") === null);
}
{
  /* THE REPLAY. A call sent twice — a retry after a dropped connection, or an
     attempt at a faster time — keeps the first judgement and the first clock. */
  const env = { DB: memDB() };
  const play = "play-replay-1";
  await startClock(env, play, TOKEN, 5000000);
  await recordCall(env, play, 1, truth(1), true, 5000000 + HL_SCORING.CLOCK_MS);
  const second = await recordCall(env, play, 1, truth(1), true, 5000000 + 1);
  const rows = [...env.DB._calls.values()].filter((c) => c.play_id === play);
  t("a call sent twice keeps its first time, not the faster one",
    rows.length === 1 && rows[0].elapsed_ms === HL_SCORING.CLOCK_MS,
    "second attempt measured " + second + "ms and was discarded");
}
{
  /* NO DATABASE IS NOT AN ERROR. The game plays and scores itself, exactly as
     it did before any of this existed. */
  t("with no database, nothing is recorded and nothing throws",
    await startClock({}, "p", TOKEN, 1) === null &&
    await recordCall({}, "p", 1, "higher", true, 1) === null &&
    await verifiedScore({}, "p") === null);
}

console.log("\nThe endpoints, called for real");
{
  const env = { DB: memDB() };
  const play = "play-http-1";
  let r = await read(await post(clockPost, env, { playId: play, token: TOKEN }));
  t("the clock endpoint starts a round", r.status === 200 && r.body.verified === true);

  for (let i = 1; i <= 11; i++) {
    const v = await read(await post(callPost, env, {
      token: TOKEN, index: i, call: truth(i), playId: play }));
    if (i === 1) {
      t("a call is judged and answered as it always was",
        v.status === 200 && v.body.right === true && v.body.index === 1);
    }
  }
  const fin = await read(await post(finishPost, env, { playId: play }));
  t("finish returns a score the server computed",
    fin.status === 200 && fin.body.verified === true && typeof fin.body.score === "number",
    JSON.stringify(fin.body));
  t("eleven right, and it wrote the score against the attempt",
    fin.body.right === 11 && env.DB._plays.get(play).srv_score === fin.body.score,
    "plays.srv_score = " + env.DB._plays.get(play).srv_score);

  /* THE POINT OF ALL OF IT: no endpoint takes a score. Sent against a round
     whose real score is NOT the one being claimed — the first draft of this
     check sent 114 to a round that scored 114, which passes whether the
     server reads the claim or ignores it. */
  const slow = "play-http-slow";
  let at = 9000000;
  await startClock(env, slow, TOKEN, at);
  for (let i = 1; i <= 11; i++) {
    at += HL_SCORING.CLOCK_MS;              // every call at the last instant
    await recordCall(env, slow, i, truth(i), true, at);
  }
  const honest = await read(await post(finishPost, env, { playId: slow }));
  t("a slow round scores only its run bonus",
    honest.body.verified === true && honest.body.score === HL_SCORING.runBonus(Array(11).fill(true)),
    honest.body.score + ", not 114");
  const cheat = await read(await post(finishPost, env,
    { playId: slow, score: 114, right: 11, elapsedSecs: 1 }));
  t("and a score sent with it is ignored",
    cheat.body.score === honest.body.score && cheat.body.score !== 114,
    "claimed 114, answered " + cheat.body.score);
}
{
  /* A round the server has no record of answers honestly rather than scoring
     it, and the page keeps its own number. */
  const env = { DB: memDB() };
  const r = await read(await post(finishPost, env, { playId: "play-unknown-1" }));
  t("an unknown round is told it is unverified, not given a score",
    r.status === 200 && r.body.verified === false && r.body.score === undefined);
  const bare = await read(await post(finishPost, {}, { playId: "p" }));
  t("and so is a site with no database", bare.body.verified === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
