/* verified_test.mjs — the score Scrambled's server computes, and what it
 * refuses.
 *
 * The same job hl-round.js does for HiLo. This game's server already marked
 * every guess and sold every reveal, so all it was missing was the clock —
 * one for the whole board here, not eleven. A score is 114 with time and help
 * taken off it, and the server now knows both without being told either.
 *
 * The checks that matter are the ones that try to cheat it: a score sent up, a
 * slot solved twice, a hint bought twice, a name bought for a slot already
 * done, and a round that never kicked off.
 *
 *   node scrambled/verified_test.mjs        (from the repo root)
 */
import {
  SCX_SCORING, SCX_CONFIG, costOf, startRound, recordSolve, recordHelp,
  alreadyDone, verifiedScore,
} from "../functions/_lib/sc-round.js";
import { onRequestPost as roundPost } from "../functions/api/scrambled/round.js";
import { onRequestPost as finishPost } from "../functions/api/scrambled/finish.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* A DATABASE OF TWO TABLES, IN MEMORY, THAT FOLLOWS THE STATEMENT IT IS GIVEN.
   HiLo's first draft of this modelled "first solve wins" in its own code, so
   changing the real SQL to DO UPDATE left the suite green — a fake that is
   right while the code is wrong is worse than no fake. This reads the conflict
   rule out of the statement. */
function memDB(bank) {
  /* A BANK CAN BE HANDED IN, because one thing the score depends on cannot be
     built out of the module sample: a slot that arrives already solved. */
  const rows = (bank || []).map((b) => ({ payload: JSON.stringify(b) }));
  const rounds = new Map();
  const solves = new Map();
  const plays = new Map();
  return {
    _rounds: rounds, _solves: solves, _plays: plays,
    prepare(sql) {
      return {
        /* loadBoards asks straight off the prepare, with nothing bound. An
           empty table is the un-imported state, so it falls back to the module
           bank — which is the same eleven-slot boards the game serves. */
        all: async () => ({ results: rows }),
        bind(...a) {
          return {
            first: async () => {
              if (/FROM sc_round/.test(sql)) {
                const r = rounds.get(a[0]);
                if (!r) return null;
                /* THE TOKEN COMES BACK TOO. The score reads the board's own
                   slot count now instead of being told one, and the token on
                   the round row is how it finds the board. */
                return { started_ms: r.started_ms, help: r.help, hinted: r.hinted,
                  token: r.token };
              }
              if (/FROM sc_solve/.test(sql)) {
                return solves.get(a[0] + "|" + a[1]) || null;
              }
              return null;
            },
            all: async () => {
              if (/FROM sc_solve/.test(sql)) {
                return { results: [...solves.values()].filter((x) => x.play_id === a[0]) };
              }
              return { results: [] };
            },
            run: async () => {
              if (/INSERT INTO sc_round/.test(sql)) {
                rounds.set(a[0], { token: a[1], started_ms: a[2], help: 0, hinted: 0 });
              } else if (/UPDATE sc_round SET help = help \+ \?, hinted = 1/.test(sql)) {
                const r = rounds.get(a[1]); if (r) { r.help += a[0]; r.hinted = 1; }
              } else if (/UPDATE sc_round SET help = help \+ \?/.test(sql)) {
                const r = rounds.get(a[1]); if (r) r.help += a[0];
              } else if (/INSERT INTO sc_solve/.test(sql)) {
                const key = a[0] + "|" + a[1];
                const row = { play_id: a[0], slot_id: a[1], how: a[2], at_ms: a[3] };
                if (!solves.has(key)) solves.set(key, row);
                else if (/DO UPDATE/i.test(sql)) solves.set(key, row);
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
}

const post = (fn, env, body) => fn({
  request: new Request("https://x/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
    body: JSON.stringify(body),
  }), env,
});
const read = async (res) => ({ status: res.status, body: await res.json() });
const TOKEN = "sc:1";

console.log("The rule and the prices are the page's own files");
t("the Worker imports scrambled/js/scoring.js itself",
  SCX_SCORING.MAX_SCORE === 114 && typeof SCX_SCORING.computeScore === "function",
  "one file, so there is no drift to check for");
t("and the bench prices come from the game's own config",
  costOf("hint") === SCX_CONFIG.REVEAL_HINT_COST &&
  costOf("letter") === SCX_CONFIG.REVEAL_LETTER_COST &&
  costOf("vowel") === SCX_CONFIG.REVEAL_VOWEL_COST &&
  costOf("name") === SCX_CONFIG.REVEAL_NAME_COST,
  [costOf("hint"), costOf("letter"), costOf("vowel"), costOf("name")].join("/"));
t("a kind nobody priced costs nothing rather than poisoning the score",
  costOf("nonsense") === 0 && costOf(undefined) === 0);

console.log("\nA board solved clean");
{
  const env = { DB: memDB() };
  const play = "sc-clean-01";
  const t0 = 1000000;
  await startRound(env, play, TOKEN, t0);
  for (let i = 1; i <= 11; i++) await recordSolve(env, play, "s" + i, "solved", t0 + 60000);
  const got = await verifiedScore(env, play);
  const expect = SCX_SCORING.computeScore(60, 0);
  t("eleven solved in a minute, no help, scores what the rule says",
    got.score === expect.score && got.solved === 11 && got.help === 0,
    got.score + " / 114");
  t("and the clock stops at the last slot, not at whenever finish is called",
    got.elapsedSecs === 60, got.elapsedSecs + "s");
}

console.log("\nHelp is priced by the thing that serves it");
{
  const env = { DB: memDB() };
  const play = "sc-help-01";
  const t0 = 2000000;
  await startRound(env, play, TOKEN, t0);
  await recordHelp(env, play, "letter");
  await recordHelp(env, play, "vowel");
  for (let i = 1; i <= 11; i++) await recordSolve(env, play, "s" + i, "solved", t0 + 60000);
  const got = await verifiedScore(env, play);
  t("a letter and a vowel are charged",
    got.help === SCX_CONFIG.REVEAL_LETTER_COST + SCX_CONFIG.REVEAL_VOWEL_COST, got.help);
  t("and the score is lower by exactly that",
    got.score === SCX_SCORING.computeScore(60, got.help).score, got.score);
}
{
  /* THE HINT IS ONE PURCHASE FOR THE BOARD. The page charges it on the
     transition and a second press bills nothing; a server charging per request
     would score three lower than the card. */
  const env = { DB: memDB() };
  const play = "sc-hint-01";
  await startRound(env, play, TOKEN, 3000000);
  const first = await recordHelp(env, play, "hint");
  const second = await recordHelp(env, play, "hint");
  const third = await recordHelp(env, play, "hint");
  t("the careers hint is charged once however many times it is asked for",
    first === SCX_CONFIG.REVEAL_HINT_COST && second === 0 && third === 0 &&
    env.DB._rounds.get(play).help === SCX_CONFIG.REVEAL_HINT_COST,
    "help = " + env.DB._rounds.get(play).help);
}
{
  /* A NAME BOUGHT FOR A SLOT ALREADY DONE COSTS NOTHING, which is the page's
     rule: it refuses the click on a solved tile rather than billing for it. */
  const env = { DB: memDB() };
  const play = "sc-name-01";
  await startRound(env, play, TOKEN, 4000000);
  await recordSolve(env, play, "s1", "solved", 4000000 + 1000);
  t("a slot already done reports as done", await alreadyDone(env, play, "s1") === true);
  t("and one that is not, does not", await alreadyDone(env, play, "s2") === false);
}

console.log("\nA tile that arrives done is not one the player owes");
{
  /* THE GAP THIS FOUND. In the consonant cypher a name with no vowels IS its
     own cypher, so it rides down solved and the page marks it free — no guess
     is ever sent and no row is ever written. A server counting eleven owed
     would have refused to verify every round on such a board, forever and
     without saying why, and no board in the module sample has one, so nothing
     already written would have noticed. Hence a bank made here.

     One board in it, so the ring's half-turn offset for consonants has nothing
     to turn through and #1 is this board either way. */
  const slots = [];
  for (let i = 1; i <= 11; i++) {
    slots.push({ id: "s" + i, band: 1, x: 0.5, pos: "CM", cy: "X", scramble: "x",
      len: [1], name: "Name " + i, ...(i === 11 ? { presolved: true } : {}) });
  }
  const bank = [{ id: 1, title: "A side", slots }];

  const env = { DB: memDB(bank) };
  const play = "sc-pre-01";
  const t0 = 7000000;
  await startRound(env, play, "sc:c:1", t0);
  for (let i = 1; i <= 10; i++) await recordSolve(env, play, "s" + i, "solved", t0 + 30000);
  const got = await verifiedScore(env, play);
  t("ten sent up on a board that gave one away is a full house",
    !!got && got.solved === 10 && got.free === 1,
    got ? got.solved + " solved, " + got.free + " free" : "refused to score it");

  /* AND THE ANAGRAM HIDES THOSE NAMES LIKE ANY OTHER, so the same board owes
     all eleven there — presolved is a fact about one cypher, not about a name. */
  const env2 = { DB: memDB(bank) };
  await startRound(env2, "sc-pre-02", "sc:1", t0);
  for (let i = 1; i <= 10; i++) await recordSolve(env2, "sc-pre-02", "s" + i, "solved", t0 + 30000);
  t("but the anagram of the same board still owes eleven",
    await verifiedScore(env2, "sc-pre-02") === null);
}

console.log("\nWhat it refuses");
{
  const env = { DB: memDB() };
  const play = "sc-part-01";
  await startRound(env, play, TOKEN, 5000000);
  for (let i = 1; i <= 7; i++) await recordSolve(env, play, "s" + i, "solved", 5000000 + 1000);
  t("a board with seven of eleven done is not scored",
    await verifiedScore(env, play) === null, "eleven or nothing");
}
{
  /* THE SAME SLOT TWICE. A retry after a dropped connection is not a second
     solve, and eleven distinct slots is what finishes a board. */
  const env = { DB: memDB() };
  const play = "sc-dupe-01";
  await startRound(env, play, TOKEN, 6000000);
  for (let i = 0; i < 11; i++) await recordSolve(env, play, "s1", "solved", 6000000 + i);
  t("one slot solved eleven times is still one slot",
    await verifiedScore(env, play) === null,
    [...env.DB._solves.values()].length + " row recorded");

  /* AND THAT IS THE SCHEMA'S DOING, so the schema is what this reads. The fake
     above models the key, and a fake that is right while the table is wrong
     proves nothing: if sc_solve stopped declaring (play_id, slot_id), the
     ON CONFLICT clause naming those columns would be an error and a slot sent
     twice would count twice. One statement of the key, checked where it is. */
  const MIG = readFileSync(
    new URL("../data/migrations/029-scrambled-round.sql", import.meta.url), "utf8");
  t("the solve table keys on the slot, which is what makes a repeat free",
    /CREATE TABLE IF NOT EXISTS sc_solve[\s\S]*?PRIMARY KEY\s*\(\s*play_id\s*,\s*slot_id\s*\)/i.test(MIG));
}
{
  const env = { DB: memDB() };
  t("a round the server never saw start is not scored",
    await verifiedScore(env, "sc-nostart-1") === null);
  t("with no database, nothing is recorded and nothing throws",
    await startRound({}, "p", TOKEN, 1) === null &&
    await recordSolve({}, "p", "s1", "solved", 1) === null &&
    await recordHelp({}, "p", "letter") === null &&
    await verifiedScore({}, "p") === null);
}

console.log("\nThe endpoints, called for real");
{
  const env = { DB: memDB() };
  const play = "sc-http-01";
  const r = await read(await post(roundPost, env, { playId: play, token: TOKEN }));
  t("the round endpoint starts a clock", r.status === 200 && r.body.verified === true);

  /* Kicking off twice keeps the first clock: a reload is not a fresh ninety
     minutes. */
  const started = env.DB._rounds.get(play).started_ms;
  await post(roundPost, env, { playId: play, token: TOKEN });
  /* AND AGAIN AN HOUR LATER, which is the half that can tell. Both posts above
     land inside the same millisecond, so a server that restarted the clock on
     every kick off wrote the same number and looked identical; the check went
     green either way until this line was added. */
  await startRound(env, play, TOKEN, started + 3600000);
  t("and kicking off twice keeps the first one",
    env.DB._rounds.get(play).started_ms === started,
    "clock at " + (env.DB._rounds.get(play).started_ms - started) + "ms past kick off");

  const t0 = env.DB._rounds.get(play).started_ms;
  for (let i = 1; i <= 11; i++) await recordSolve(env, play, "s" + i, "solved", t0 + 120000);
  await recordHelp(env, play, "name");

  const fin = await read(await post(finishPost, env, { playId: play, slots: 11 }));
  t("finish returns a score the server computed",
    fin.status === 200 && fin.body.verified === true && fin.body.solved === 11,
    JSON.stringify(fin.body));
  const banked = env.DB._plays.get(play);
  t("and writes it against the attempt",
    !!banked && banked.srv_score === fin.body.score,
    "plays.srv_score = " + (banked ? banked.srv_score : "nothing written"));

  /* THE POINT OF ALL OF IT. Claimed against a round whose real score is not
     the one being sent, so the check fails if the claim is ever read. */
  const cheat = await read(await post(finishPost, env,
    { playId: play, slots: 11, score: 114, help: 0, elapsedSecs: 1 }));
  t("a score sent with it is ignored",
    cheat.body.score === fin.body.score && cheat.body.score !== 114,
    "claimed 114, answered " + cheat.body.score);

  /* AND A SMALLER BOARD CANNOT BE CLAIMED to finish a round early.

     This check is the one that found the hole, and it found it by being
     rewritten: it first asserted that three-of-eleven WAS scored, because the
     board's size came up from the page. Solve three, say the board has three,
     and a fast unhelped score tops a challenge table. The request still sends
     the claim below, so the check fails if anything ever reads it again. */
  const env2 = { DB: memDB() };
  const p2 = "sc-http-02";
  await post(roundPost, env2, { playId: p2, token: TOKEN });
  const t2 = env2.DB._rounds.get(p2).started_ms;
  for (let i = 1; i <= 3; i++) await recordSolve(env2, p2, "s" + i, "solved", t2 + 1000);
  const early = await read(await post(finishPost, env2, { playId: p2, slots: 3 }));
  t("three slots done cannot be finished by claiming a three-slot board",
    early.body.verified === false && early.body.score === undefined,
    "claimed slots: 3, answered " + JSON.stringify(early.body));
}
{
  const env = { DB: memDB() };
  const r = await read(await post(finishPost, env, { playId: "sc-unknown-1", slots: 11 }));
  t("an unknown round is told it is unverified, not given a score",
    r.status === 200 && r.body.verified === false && r.body.score === undefined);
  const bare = await read(await post(finishPost, {}, { playId: "p", slots: 11 }));
  t("and so is a site with no database", bare.body.verified === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
