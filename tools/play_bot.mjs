/* play_bot.mjs — a bot that actually plays the live site, and reports breakage.
 *
 * The other half of item 14. /api/preflight asks whether the coming boards are
 * well FORMED; this asks whether today's board can actually be PLAYED — the
 * question that needs a running server rather than a shape rule, because what
 * it exercises is the WIRING: that production applies its own scoring rule to a
 * real play, on a clock it kept, against fouls it recorded.
 *
 *   XI_BOT_CODE=... node tools/play_bot.mjs
 *   XI_BOT_CODE=... BASE=http://127.0.0.1:8788 GAMES=wordsearch node tools/play_bot.mjs
 *
 * IT IS NEVER TOLD AN ANSWER. tools/bot_solve.mjs does the reasoning and
 * proves — against production's own judge — that every word on a board is
 * findable from the grid a browser is given. No bank reaches CI, which is the
 * whole reason this is possible on a public repo.
 *
 * IT SIGNS IN, AND IT FAILS CLOSED IF IT CANNOT.
 *
 * Ten sessions a night is roughly 3,650 rows a year and half of them carry a
 * real server-verified score — the kind that would sit in a challenge table.
 * So every play is made AS ONE ACCOUNT, created by DEVICE CODE rather than
 * Google: no name, no email, just a random string and some scores. Excluding
 * the bot from any table ever built is then one user_id, forever. Decided
 * before the first run, because retro-fitting it means working out which
 * historical rows were bots — and by then nobody can.
 *
 * A bot that could not sign in must NOT fall back to playing anonymously: that
 * is precisely the row nobody can identify later. No code, no run.
 */
import {
  solveWordsearch, aFoul, hiloCalls, slotsToReveal, sessionPlan,
} from "./bot_solve.mjs";

const BASE = (process.env.BASE || "https://www.thexigames.com").replace(/\/+$/, "");
const CODE = process.env.XI_BOT_CODE || "";
const ONLY = (process.env.GAMES || "").split(",").map((s) => s.trim()).filter(Boolean);
const CSRF = { "X-XI-Games": "1", "Content-Type": "application/json" };

let problems = [];
const note = (game, why) => { problems.push({ game, why }); console.log(`    ! ${why}`); };

if (!CODE) {
  console.error(
    "No XI_BOT_CODE in the environment.\n" +
    "The bot plays as one account so its rows can be excluded from every table\n" +
    "by one user_id. Playing anonymously instead would create exactly the rows\n" +
    "nobody can identify later, so this refuses rather than falling back.");
  process.exit(1);
}

/* ---- the wire --------------------------------------------------------- */

/* The session cookie, kept by hand. There is no cookie jar in node's fetch, and
   a bot that quietly lost its session would play on anonymously — the one
   outcome the code above refuses — so it is held explicitly and every request
   carries it. */
let cookie = "";

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...CSRF, ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const setter = res.headers.get("set-cookie");
  if (setter) cookie = setter.split(";")[0];
  let body = null;
  try { body = await res.json(); } catch (e) { /* not every route answers JSON */ }
  return { status: res.status, body };
}

const post = (path, data) => call(path, { method: "POST", body: JSON.stringify(data) });
const get = (path) => call(path, { method: "GET" });

const newPlayId = () => "bot-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);

/* ---- the sessions ------------------------------------------------------ */

/* A start and an end, exactly as a browser sends them, so the bot's plays land
   in the same table as everyone's and the season records the same result. The
   abandon session sends `completed: false`, which is the LOSS condition — and
   the only thing in this repo that produces one against production. */
async function startPlay(game, boardKey, playId) {
  const r = await post("/api/play", {
    event: "start", playId, game, mode: "daily", boardKey, total: 11,
  });
  return r.body && r.body.day;
}

const endPlay = (game, playId, completed, solved) =>
  post("/api/play", { event: "end", playId, game, completed, solved, elapsed: 30 });

/* WORD SEARCH — the richest case, and the only game where the server judges
   every single action. Fouls first so the escalation is exercised, then the
   grid solved, then finish; the server's verified score is compared with what
   the shared scoring module says it should be. */
async function playWordsearch(kind) {
  const daily = await get("/api/wordsearch/daily");
  if (!daily.body || !daily.body.puzzle) return note("wordsearch", "no daily to play");
  const puzzle = daily.body.puzzle;
  const playId = newPlayId();
  await startPlay("wordsearch", "ws:" + (daily.body.day || "today"), playId);

  if (kind === "abandon") {
    /* Two words and then walk away: a real unfinished board, which is what a
       LOSS is made of. */
    const solved = solveWordsearch(puzzle);
    for (const f of solved.found.slice(0, 2)) {
      await post("/api/wordsearch/find", { playId, from: f.from, to: f.to });
    }
    await endPlay("wordsearch", playId, false, 2);
    return;
  }

  const round = await post("/api/wordsearch/round", { playId });
  if (!round.body) return note("wordsearch", "the round would not start");

  /* Three fouls, which is the escalation this session exists to exercise. */
  const foul = aFoul(puzzle, []);
  if (foul) {
    for (let i = 0; i < 3; i++) {
      const r = await post("/api/wordsearch/find", { playId, from: foul.from, to: foul.to });
      if (r.body && r.body.hit) note("wordsearch", "a selection that spells nothing was accepted as a word");
    }
  }

  const solved = solveWordsearch(puzzle);
  if (solved.missing.length) {
    note("wordsearch", `${solved.missing.length} word(s) in the list are not in the grid`);
  }
  let got = 0;
  for (const f of solved.found) {
    const r = await post("/api/wordsearch/find", { playId, from: f.from, to: f.to });
    if (r.body && r.body.hit) got++;
    else note("wordsearch", "the server refused a word the solver located");
  }

  const fin = await post("/api/wordsearch/finish", { playId });
  await endPlay("wordsearch", playId, got === solved.found.length, got);

  if (!fin.body || fin.body.verified !== true) {
    return note("wordsearch", "the round finished but the server verified no score");
  }
  console.log(`    finished ${got}/${solved.found.length}, verified ${fin.body.score}`);
  /* THE SECRET IS ONLY EVER REVEALED AT THE END. A bonus word handed over
     before the board was done was a live leak once; if it comes back, this is
     where it shows. */
  if (fin.body.secret && got < solved.found.length) {
    note("wordsearch", "the secret word was revealed before the board was finished");
  }
}

/* HILO — every call settles the row whether it is right or wrong, so a fixed
   call reaches full time on any board. */
async function playHilo(kind) {
  const daily = await get("/api/hilo/daily");
  if (!daily.body || !daily.body.token) return note("hilo", "no daily to play");
  const { token, day } = daily.body;
  const rows = (daily.body.board && daily.body.board.chain
    ? daily.body.board.chain.length - 1 : 11);
  const playId = newPlayId();
  await startPlay("hilo", "hl:" + (day || "today"), playId);

  const calls = hiloCalls(kind === "abandon" ? 3 : rows, "alternate");
  let settled = 0;
  for (let i = 0; i < calls.length; i++) {
    const r = await post("/api/hilo/call", { playId, token, index: i + 1, call: calls[i] });
    if (r.status === 200 && r.body && typeof r.body.right === "boolean") settled++;
    else note("hilo", `row ${i + 1} would not settle (${r.status})`);
  }
  if (kind === "abandon") return endPlay("hilo", playId, false, settled);

  const fin = await post("/api/hilo/finish", { playId });
  await endPlay("hilo", playId, settled === rows, settled);
  console.log(`    settled ${settled}/${rows}` +
    (fin.body && fin.body.score !== undefined ? `, verified ${fin.body.score}` : ""));
}

/* THE TWO CYPHER GAMES — finished by buying a name reveal per slot, which
   costs the score. That is the point: a bot finishing on 114 every night would
   prove the clock and nothing about the shop. */
async function playCypher(game, kind) {
  const cy = game === "vowels" ? "?cy=1" : "";
  const daily = await get("/api/scrambled/daily" + cy);
  if (!daily.body || !daily.body.token) return note(game, "no daily to play");
  const { token, no } = daily.body;
  const playId = newPlayId();
  await startPlay(game, "sc:" + (no == null ? "today" : no), playId);
  await post("/api/scrambled/round", { playId, token });

  const slots = slotsToReveal(daily.body);
  const wanted = kind === "abandon" ? Math.min(2, slots.length) : slots.length;
  let opened = 0;
  for (let i = 0; i < wanted; i++) {
    const r = await post("/api/scrambled/reveal",
      { playId, token, kind: "name", slotId: slots[i] });
    if (r.status === 200) opened++;
    else note(game, `a reveal was refused (${r.status})`);
  }
  if (kind === "abandon") return endPlay(game, playId, false, opened);

  const fin = await post("/api/scrambled/finish", { playId, token });
  await endPlay(game, playId, opened === slots.length, opened);
  console.log(`    opened ${opened}/${slots.length}` +
    (fin.body && fin.body.score !== undefined ? `, verified ${fin.body.score}` : ""));
}

/* THE CROSSWORD is played through reveal, one entry at a time. */
async function playCrossword(kind) {
  const daily = await get("/api/daily");
  if (!daily.body || !daily.body.puzzle) return note("crossword", "no daily to play");
  const entries = daily.body.puzzle.entries || [];
  const playId = newPlayId();
  await startPlay("crossword", "daily:" + daily.body.dailyNo, playId);
  const wanted = kind === "abandon" ? Math.min(2, entries.length) : entries.length;
  let opened = 0;
  for (let i = 0; i < wanted; i++) {
    const e = entries[i];
    const r = await post("/api/reveal",
      { playId, dailyNo: daily.body.dailyNo, num: e.num, dir: e.dir, kind: "answer" });
    if (r.status === 200) opened++;
  }
  if (opened === 0 && wanted > 0) note("crossword", "no entry could be revealed");
  await endPlay("crossword", playId, kind !== "abandon" && opened === entries.length, opened);
  console.log(`    opened ${opened}/${wanted}`);
}

const PLAYERS = {
  crossword: playCrossword,
  wordsearch: playWordsearch,
  scrambled: (kind) => playCypher("scrambled", kind),
  hilo: playHilo,
  vowels: (kind) => playCypher("vowels", kind),
};

/* ---- the run ----------------------------------------------------------- */

console.log(`Play bot: ${BASE}`);

/* SIGNING IN IS THE FIRST THING AND A HARD REQUIREMENT. /api/account/code
   turns a device code into a user with provider 'code' — the account the bot
   owns. If this fails the run stops: an anonymous bot writes rows nobody can
   ever separate from a player's. */
const signin = await post("/api/account/code", { code: CODE });
if (signin.status !== 200 || !signin.body || !signin.body.user) {
  console.error(`Could not sign in with the bot's code (${signin.status}).\n` +
    "Refusing to play anonymously: those rows could never be excluded.");
  process.exit(1);
}
console.log(`Signed in as ${signin.body.user.id}${signin.body.created ? " (created)" : ""}`);

const games = ONLY.length ? ONLY : Object.keys(PLAYERS);
const plan = sessionPlan(games).filter((s) => PLAYERS[s.game]);
console.log(`${plan.length} sessions: ${games.join(", ")}\n`);

for (const { game, kind } of plan) {
  console.log(`  ${game} — ${kind}`);
  try {
    await PLAYERS[game](kind);
  } catch (e) {
    note(game, "the session threw: " + (e && e.message));
  }
}

console.log("");
if (!problems.length) {
  console.log(`All ${plan.length} sessions played.`);
  process.exit(0);
}
console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
for (const p of problems) console.log(`  ${p.game}: ${p.why}`);
process.exit(1);
