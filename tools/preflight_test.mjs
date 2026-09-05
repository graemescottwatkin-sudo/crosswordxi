/* preflight_test.mjs — the forward check, and the gate in front of it.
 *
 * /api/preflight walks the next N days of every game's schedule and reports
 * what is wrong with the boards it finds. Two properties matter more than the
 * rules themselves:
 *
 *   1. IT NEVER RETURNS A BOARD. Not a grid, not an answer, not a name, not a
 *      clue — not even for a board it is reporting as broken. The whole reason
 *      this exists rather than a bot with admin is that a leak costs one fact.
 *   2. IT FAILS CLOSED. No secret configured means no access, and no database
 *      means a refusal rather than fourteen perfect sample days.
 *
 * The boards below are built by hand and then BROKEN one way at a time, so
 * every rule is exercised by the fault it is there to catch. A rule that no
 * fixture can fail is a rule that will not fail in production either.
 *
 *   node tools/preflight_test.mjs        (from the repo root)
 */
import { preflight, PREFLIGHT_DAYS, MAX_DAYS, gamesPreflighted } from "../functions/_lib/preflight.js";
import { onRequestGet as preflightGet, PREFLIGHT_HEADER } from "../functions/api/preflight.js";
import { dailyNumber, utcDay } from "../functions/_lib/daily.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);      // 6 Sep 2026, midday UTC
const DAY_MS = 86400000;
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---- sound boards, one per game --------------------------------------- */

function goodCrossword() {
  const cells = {}, entries = [];
  for (let i = 0; i < 11; i++) {
    const keys = [];
    for (let j = 0; j < 4; j++) {
      const k = `${i},${j}`;
      cells[k] = { ch: "A", across: i + 1, down: null, num: j === 0 ? i + 1 : null };
      keys.push(k);
    }
    entries.push({ num: i + 1, dir: "across", x: 0, y: i, len: 4, cells: keys,
      row: { id: "r" + i, clue: "A clue", enum: "(4)", diff: 1 } });
  }
  return { cells, entries };
}

function goodWordsearch() {
  const answers = [];
  for (let i = 0; i < 11; i++) {
    answers.push({ display: "Name " + i, grid: "NAME", placement: { r: i, c: 0, dr: 0, dc: 1 } });
  }
  return { grid: "ABCDEFGH".repeat(20), answers,
    bonus: { clue: "A bonus clue", grid: "BONUS", placement: { r: 0, c: 0, dr: 1, dc: 0 }, category: "x" } };
}

function goodHilo() {
  const chain = [];
  for (let i = 0; i < 12; i++) chain.push({ name: "Player " + i, value: i * 3 + 1, context: "c" });
  return { id: "hl1", subtitle: "A subtitle.", chain };
}

function goodCypher() {
  const slots = [];
  for (let i = 0; i < 11; i++) {
    slots.push({ id: "s" + i, band: 1, x: 0.5, pos: "CM",
      scramble: "AEHLR", len: [5], cy: "HLR" });
  }
  return { id: "sc1", title: "A board", slots };
}

/* ---- a database that answers each loader's own query ------------------- */

function memDB(over = {}) {
  const cw = over.crossword === undefined ? goodCrossword() : over.crossword;
  const ws = over.wordsearch === undefined ? goodWordsearch() : over.wordsearch;
  const hl = over.hilo === undefined ? goodHilo() : over.hilo;
  const sc = over.scrambled === undefined ? goodCypher() : over.scrambled;
  /* Which days the schedules cover. A short schedule is how a hole shows up,
     and it is measured from NOW so the day it runs out is predictable.
     A schedule left at its default starts well BEFORE NOW instead, because the
     ENDPOINT walks from the real clock rather than from this fixture's — it is
     the server that decides what day it is, which is the rule, and a fixture
     that only covered its own idea of today made the endpoint's own check go
     red for a board that was never missing. */
  const wsDays = over.wsDays === undefined ? 800 : over.wsDays;
  const hlDays = over.hlDays === undefined ? 800 : over.hlDays;
  const wsFrom = over.wsDays === undefined ? NOW - 400 * DAY_MS : NOW;
  const hlFrom = over.hlDays === undefined ? NOW - 400 * DAY_MS : NOW;

  const schedule = {};
  for (let k = 0; k < hlDays; k++) schedule[utcDay(hlFrom + k * DAY_MS)] = "hl1";

  /* prepare(...).all() is called WITHOUT bind() by loadBank and loadBoards, and
     prepare(...).bind(x).first() WITH it by the other two. The first draft of
     this fake only offered all/first behind bind(), so those two queries threw,
     both loaders fell back to their built-in banks, and four checks passed
     against sample data while claiming to test production's. bind() returns the
     same object here, so either shape works — which is what the real D1 client
     does. */
  return {
    prepare(sql) {
      const stmt = (a) => ({
        bind: (...args) => stmt(args),
        first: async () => {
          if (/FROM puzzles/.test(sql)) return cw ? { payload: JSON.stringify(cw) } : null;
          if (/ws_schedule/.test(sql)) {
            const want = a[0];
            const ok = ws && [...Array(wsDays)].some((_, k) => utcDay(wsFrom + k * DAY_MS) === want);
            return ok ? { id: "ws1", theme: "t", category: "c", status: "live",
              hash: "h", version: 1, share_key: "k",
              payload: JSON.stringify({ grid: ws.grid, answers: ws.answers, bonus: ws.bonus }) } : null;
          }
          return null;
        },
        all: async () => {
          if (/FROM hl_board/.test(sql)) return { results: hl ? [{ payload: JSON.stringify(hl) }] : [] };
          if (/FROM hl_schedule/.test(sql)) {
            return { results: Object.keys(schedule).map((d) => ({ day: d, board_id: schedule[d] })) };
          }
          if (/FROM sc_board/.test(sql)) return { results: sc ? [{ payload: JSON.stringify(sc) }] : [] };
          return { results: [] };
        },
        run: async () => ({}),
      });
      return stmt([]);
    },
  };
}

const envWith = (over) => ({ DB: memDB(over), PREFLIGHT_SECRET: "s3cret" });

/* Run the walk and return the problems for one game, ignoring the once-only
   bank lines (day null) unless asked for them. */
async function problemsFor(over, game, days = 3) {
  const r = await preflight(envWith(over), days, NOW);
  return r.problems.filter((p) => p.game === game && p.day !== null);
}

console.log("A sound fortnight is silent");
{
  const r = await preflight(envWith({}), 14, NOW);
  t("every game, every day, nothing to report",
    r.problems.length === 0 && r.days === 14, JSON.stringify(r.problems.slice(0, 3)));
  t("and it checked five games across fourteen days",
    r.checked === 5 * 14, r.checked + " checked");
  t("the five games are the five that are live",
    gamesPreflighted().join(",") === "crossword,wordsearch,hilo,scrambled,vowels",
    gamesPreflighted().join(","));
}

console.log("\nA hole in a schedule");
{
  /* THE FAULT THIS WAS ASKED FOR. Nothing about it involves a code change:
     the schedule simply runs out and the game has nothing to serve. */
  const ws = await problemsFor({ wsDays: 2 }, "wordsearch", 5);
  t("the word search runs out and every day after it is reported",
    ws.length === 3 && ws.every((p) => p.why === "no board"),
    ws.map((p) => p.day).join(", "));
  const hl = await problemsFor({ hlDays: 1 }, "hilo", 4);
  t("so does HiLo, whose schedule is keyed by date too",
    hl.length === 3 && hl.every((p) => p.why === "no board"), hl.length + " days");
  t("and the day it starts is named, so it can be fixed before it arrives",
    hl[0] && hl[0].day === utcDay(NOW + DAY_MS), hl[0] && hl[0].day);
}

console.log("\nA board that is short, or malformed");
{
  const short = clone(goodCrossword()); short.entries.pop();
  t("ten entries is not eleven",
    (await problemsFor({ crossword: short }, "crossword"))[0].why === "10 entries, not 11");

  const noClue = clone(goodCrossword()); noClue.entries[3].row.clue = "   ";
  t("an entry with no clue is caught, and named by number",
    (await problemsFor({ crossword: noClue }, "crossword"))[0].why === "entry 4 has no clue");

  const gap = clone(goodCrossword()); gap.entries[2].cells.push("99,99");
  t("an entry pointing outside the grid is caught",
    (await problemsFor({ crossword: gap }, "crossword"))[0].why
      === "entry 3: len does not match its cells");

  const blank = clone(goodCrossword()); blank.cells["5,2"].ch = "";
  t("and a square with no letter in it",
    (await problemsFor({ crossword: blank }, "crossword"))[0].why === "entry 6 has an empty square");
}

console.log("\nA board that is simply not there");
{
  /* Three sabotages ran green against the first draft of this file, because
     nothing here ever removed a crossword board, shortened a word search, or
     made a loader throw. Each is a real production failure; each now has a
     fixture that produces it. */
  t("a day with no crossword board is reported, not skipped",
    (await problemsFor({ crossword: null }, "crossword"))[0].why === "no board");
  const shortWs = clone(goodWordsearch()); shortWs.answers.pop();
  t("a word search with ten answers is reported",
    (await problemsFor({ wordsearch: shortWs }, "wordsearch"))[0].why === "10 answers, not 11");

  /* A LOADER THAT THROWS IS A PROBLEM ABOUT THE BOARD, not an error for the
     caller: one game's bad day must not stop the other four being walked. */
  const angry = {
    DB: { prepare(sql) {
      if (/FROM puzzles/.test(sql)) throw new Error("table gone");
      return memDB().prepare(sql);
    } },
    PREFLIGHT_SECRET: "s3cret",
  };
  const r = await preflight(angry, 2, NOW);
  const cw = r.problems.filter((p) => p.game === "crossword");
  t("a loader that throws is reported rather than swallowed",
    cw.length === 2 && cw.every((p) => p.why === "could not be read"),
    JSON.stringify(cw));
  t("and the other four games are still walked",
    r.checked === 10 &&
    r.problems.filter((p) => p.game !== "crossword" && p.day !== null).length === 0,
    r.checked + " checked despite one game failing");
}

console.log("\nA word that cannot be found");
{
  const noPlace = clone(goodWordsearch()); delete noPlace.answers[6].placement;
  t("an answer with no placement is caught — it would sit in the list unselectable",
    (await problemsFor({ wordsearch: noPlace }, "wordsearch"))[0].why === "answer 7 has no placement");

  const halfBonus = clone(goodWordsearch()); delete halfBonus.bonus.placement;
  t("and half a bonus is caught",
    (await problemsFor({ wordsearch: halfBonus }, "wordsearch"))[0].why === "the bonus has no placement");

  const noBonus = clone(goodWordsearch()); delete noBonus.bonus;
  t("but NO bonus is fine — it is optional and always was",
    (await problemsFor({ wordsearch: noBonus }, "wordsearch")).length === 0);
}

console.log("\nA call that cannot be made");
{
  const tie = clone(goodHilo()); tie.chain[5].value = tie.chain[4].value;
  t("two equal values in a row is a call with no right answer",
    (await problemsFor({ hilo: tie }, "hilo"))[0].why
      === "rows 5 and 6 are equal, so the call cannot be made",
    (await problemsFor({ hilo: tie }, "hilo"))[0].why);

  const noSub = clone(goodHilo()); noSub.subtitle = "";
  t("and a board with no subtitle is reported",
    (await problemsFor({ hilo: noSub }, "hilo"))[0].why === "no subtitle");

  const shortChain = clone(goodHilo()); shortChain.chain.pop();
  t("eleven rows is one short: eleven calls need twelve",
    (await problemsFor({ hilo: shortChain }, "hilo"))[0].why === "11 rows, not 12");
}

console.log("\nThe two cypher games are checked as two games");
{
  /* THE POINT OF CHECKING BOTH. One bank, read two ways: a board sound as an
     anagram can be unsound de-vowelled, and only asking one question would
     pass it. */
  const noCy = clone(goodCypher());
  noCy.slots.forEach((s) => { delete s.cy; });
  const anagram = await problemsFor({ scrambled: noCy }, "scrambled");
  const vowels = await problemsFor({ scrambled: noCy }, "vowels");
  t("a bank with no de-vowelled forms passes as Scrambled", anagram.length === 0);
  t("and fails as Vowels", vowels.length > 0 && /de-vowelled/.test(vowels[0].why), vowels[0] && vowels[0].why);

  const noScramble = clone(goodCypher());
  noScramble.slots.forEach((s) => { delete s.scramble; });
  t("and the other way round: no scramble fails as Scrambled",
    (await problemsFor({ scrambled: noScramble }, "scrambled"))[0].why === "slot 1 has no scramble");

  const allSolved = clone(goodCypher());
  allSolved.slots.forEach((s) => { s.presolved = true; delete s.cy; });
  t("a board that opens finished is not a puzzle",
    (await problemsFor({ scrambled: allSolved }, "vowels"))[0].why === "every slot is presolved");
}

console.log("\nThe bank the site would actually use");
{
  /* THE BUG THIS CHECK EXISTS FOR. loadBoards answers { boards, source } and
     boardForNumber takes the array; handing it the wrapper makes the ring fall
     back to the built-in module bank silently, and fourteen days of samples
     walk green while production goes unread. */
  const r = await preflight(envWith({ scrambled: null }), 3, NOW);
  const bank = r.problems.filter((p) => p.day === null);
  t("an empty sc_board table is reported as the WRONG bank, not as sound days",
    bank.some((p) => p.game === "scrambled" && /not the database's/.test(p.why)),
    JSON.stringify(bank));
  const hl = await preflight(envWith({ hilo: null }), 3, NOW);
  t("and an empty hl_board table the same way",
    hl.problems.some((p) => p.game === "hilo" && p.day === null && /not the database's/.test(p.why)));
}

console.log("\nWhat it will not say");
{
  /* THE PROPERTY THAT MATTERS MOST. Break every game at once and read the
     whole response as text: nothing from any board may appear in it. */
  const broken = {
    crossword: (() => { const c = clone(goodCrossword()); c.entries[0].row.clue = ""; return c; })(),
    wordsearch: (() => { const w = clone(goodWordsearch()); delete w.answers[0].placement; return w; })(),
    hilo: (() => { const h = clone(goodHilo()); h.subtitle = ""; return h; })(),
    scrambled: (() => { const s = clone(goodCypher()); delete s.slots[0].scramble; return s; })(),
  };
  const r = await preflight(envWith(broken), 4, NOW);
  const text = JSON.stringify(r);
  t("it found something wrong with all of them", r.problems.length >= 4, r.problems.length + " problems");
  const leaks = ["Name 0", "NAME", "A clue", "Player 1", "AEHLR", "HLR", "A board",
    "A bonus clue", "BONUS", "ABCDEFGH", "A subtitle"];
  const found = leaks.filter((s) => text.indexOf(s) > -1);
  t("and said nothing about any of them — no grid, no answer, no name, no clue",
    found.length === 0, found.length ? "LEAKED: " + found.join(", ") : "verdicts only");
  t("every problem is exactly { game, day, why }",
    r.problems.every((p) => Object.keys(p).sort().join(",") === "day,game,why"),
    "a field added here is a field that could carry a board");
}

console.log("\nThe gate");
{
  const ask = (env, headers = {}) => preflightGet({
    request: new Request("https://x/api/preflight", { headers }), env,
  });
  const env = envWith({});

  const right = await ask(env, { [PREFLIGHT_HEADER]: "s3cret" });
  t("the right secret is let through", right.status === 200);
  const body = await right.json();
  t("and answers ok with nothing to report", body.ok === true && body.problems.length === 0,
    JSON.stringify({ ok: body.ok, checked: body.checked, days: body.days }));
  t("defaulting to a fortnight", body.days === PREFLIGHT_DAYS);

  t("a wrong secret is refused", (await ask(env, { [PREFLIGHT_HEADER]: "wrong" })).status === 404);
  t("no secret at all is refused", (await ask(env)).status === 404);
  t("and an empty one is refused", (await ask(env, { [PREFLIGHT_HEADER]: "" })).status === 404);
  /* FAIL CLOSED. An endpoint that answers when nobody configured its gate has
     no gate on the first day somebody forgets to set one. */
  t("with no secret CONFIGURED, nobody gets in — not even with none supplied",
    (await ask({ DB: memDB() })).status === 404 &&
    (await ask({ DB: memDB() }, { [PREFLIGHT_HEADER]: "" })).status === 404,
    "an unconfigured gate is a closed gate, not an open one");

  /* ONE REFUSAL FOR EVERY REASON: a gate that distinguishes "no secret set"
     from "wrong secret" has told an attacker which they are up against. */
  const a = await (await ask(env, { [PREFLIGHT_HEADER]: "wrong" })).json();
  const b = await (await ask({ DB: memDB() }, { [PREFLIGHT_HEADER]: "wrong" })).json();
  t("and the two refusals are identical", JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a));

  t("the Authorization header works too, for a CI runner",
    (await ask(env, { Authorization: "Bearer s3cret" })).status === 200);

  /* NEVER ON THE QUERY STRING. A URL is logged, cached and shoulder-read. */
  const viaUrl = await preflightGet({
    request: new Request("https://x/api/preflight?secret=s3cret"), env,
  });
  t("a secret on the URL is not a secret, and is not accepted", viaUrl.status === 404);

  t("nothing here is ever cached",
    right.headers.get("Cache-Control") === "no-store" &&
    (await ask(env, { [PREFLIGHT_HEADER]: "wrong" })).headers.get("Cache-Control") === "no-store");
}

console.log("\nHow much may be asked for");
{
  const ask = (url, env) => preflightGet({
    request: new Request(url, { headers: { [PREFLIGHT_HEADER]: "s3cret" } }), env,
  });
  const env = envWith({});
  const few = await (await ask("https://x/api/preflight?days=3", env)).json();
  t("a shorter walk is allowed", few.days === 3 && few.checked === 15, few.checked + " checked");
  const lots = await (await ask("https://x/api/preflight?days=9999", env)).json();
  t("and an absurd one is capped rather than run",
    lots.days === MAX_DAYS, lots.days + " days");
  const junk = await (await ask("https://x/api/preflight?days=abc", env)).json();
  t("junk falls back to the default", junk.days === PREFLIGHT_DAYS);
}

console.log("\nNo database is not a clean bill of health");
{
  const res = await preflightGet({
    request: new Request("https://x/api/preflight", { headers: { [PREFLIGHT_HEADER]: "s3cret" } }),
    env: { PREFLIGHT_SECRET: "s3cret" },
  });
  const body = await res.json();
  t("it refuses rather than walking fourteen perfect sample days",
    res.status === 503 && body.ok === false && body.checked === 0,
    "the samples would pass and prove nothing about production");
}

console.log("\nToday is included, because today is what somebody is playing");
{
  const r = await preflight(envWith({ wsDays: 0 }), 1, NOW);
  t("a one-day walk checks today, not tomorrow",
    r.checked === 5 &&
    r.problems.some((p) => p.game === "wordsearch" && p.day === utcDay(NOW)),
    JSON.stringify(r.problems.filter((p) => p.day !== null)));
  t("and the crossword's day is a NUMBER, resolved the server's way",
    dailyNumber(NOW) > 0, "daily #" + dailyNumber(NOW));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
