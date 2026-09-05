/* preflight.js — are the boards we are ABOUT to serve well formed?
 *
 * The site's behaviour changes every night with no deploy: at midnight UTC
 * every game hands out a different board, and a malformed one — a schedule
 * with a hole in it, a board short of eleven, an answer with no placement —
 * reaches a player without a line of code having changed. Nothing catches
 * that today. A push-triggered CI run cannot: there is no push.
 *
 * So this walks the NEXT N days of every game's schedule and reports what it
 * finds. It is the higher-value half of item 14 because it looks FORWARD: a
 * bad board is found before anybody plays it, not after.
 *
 * IT RETURNS VERDICTS, NEVER BOARDS.
 *
 *   { checked: 70, days: 14, problems: [ { game, day, why } ] }
 *
 * No grid, no answer, no name, no clue, no title — not even for a board that
 * is broken. `why` comes from a fixed vocabulary written here, so a future
 * check cannot accidentally quote the thing it was inspecting. If the secret
 * that gates this ever leaked, what an attacker learns is whether the next
 * fortnight is well formed, and nothing else. That property is the whole
 * reason this exists instead of giving a bot admin: the admin route also
 * exports player data and accepts mutations, and lives one leak away from the
 * forward bank.
 *
 * EVERY BOARD IS FETCHED THROUGH THE GAME'S OWN LOADER — getDailyPuzzle,
 * dailyBoard, loadBank, boardForNumber. Not one query is written here. A
 * preflight with its own idea of which board Tuesday holds would pass a
 * schedule the site fails on, which is worse than no preflight: it would be a
 * green light with no bulb behind it.
 */
import { dailyNumber, utcDay } from "./daily.js";
import { getDailyPuzzle } from "./db.js";
import { dailyBoard } from "./wsdata.js";
import { loadBank, boardById as hlBoardById } from "./hl-board.js";
import { loadBoards, boardForNumber, dailyRing } from "./sc-board.js";

const DAY_MS = 86400000;

/* How far ahead by default, and the most that may be asked for. Fourteen days
   is long enough to notice a schedule running out with a week to fix it, and
   short enough that a nightly run stays cheap. */
export const PREFLIGHT_DAYS = 14;
export const MAX_DAYS = 60;

/* The eleven every game is built around. Named once: a game that starts
   shipping twelve is a decision, and it should break this on purpose. */
const XI = 11;

/* ---- the shape rules -------------------------------------------------
 * One function per game, each answering the same question: given the board
 * this game would serve on this day, what is WRONG with it? Null means
 * nothing is. The strings are the vocabulary — short, countable, and never
 * containing anything from the board itself.
 */

function checkCrossword(puzzle) {
  if (!puzzle) return "no board";
  const entries = puzzle.entries;
  const cells = puzzle.cells;
  if (!Array.isArray(entries)) return "no entries";
  if (entries.length !== XI) return `${entries.length} entries, not ${XI}`;
  if (!cells || typeof cells !== "object") return "no grid";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !e.row) return `entry ${i + 1} is malformed`;
    if (!e.row.clue || !String(e.row.clue).trim()) return `entry ${i + 1} has no clue`;
    if (!Array.isArray(e.cells) || e.cells.length === 0) return `entry ${i + 1} has no cells`;
    if (Number(e.len) !== e.cells.length) return `entry ${i + 1}: len does not match its cells`;
    /* THE ANSWER MUST BE IN THE GRID. A board whose entry points at a cell
       that does not exist renders as a hole the player can never fill, and it
       is the failure a shape check on entries alone would miss. The letter is
       READ but never reported. */
    for (const key of e.cells) {
      const c = cells[key];
      if (!c) return `entry ${i + 1} points at a cell that is not in the grid`;
      if (!c.ch || !String(c.ch).trim()) return `entry ${i + 1} has an empty square`;
    }
  }
  return null;
}

function checkWordsearch(puzzle) {
  if (!puzzle) return "no board";
  if (!puzzle.grid) return "no grid";
  const answers = puzzle.answers;
  if (!Array.isArray(answers)) return "no answers";
  if (answers.length !== XI) return `${answers.length} answers, not ${XI}`;
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!a || !a.display || !String(a.display).trim()) return `answer ${i + 1} has no name`;
    if (!a.grid || !String(a.grid).trim()) return `answer ${i + 1} has no letters`;
    /* WITHOUT A PLACEMENT THE WORD CANNOT BE FOUND. The server judges every
       selection against this, so a missing one is a word the player can see
       in the list and never select — the exact "board whose bonus is missing"
       class this endpoint was asked for. */
    if (!a.placement) return `answer ${i + 1} has no placement`;
  }
  /* The bonus is optional. Half a bonus is not: a clue with nothing to find,
     or letters with nothing to ask, is worse than no bonus at all. */
  const b = puzzle.bonus;
  if (b) {
    if (!b.clue || !String(b.clue).trim()) return "the bonus has no clue";
    if (!b.grid || !String(b.grid).trim()) return "the bonus has no letters";
    if (!b.placement) return "the bonus has no placement";
  }
  return null;
}

function checkHilo(board) {
  if (!board) return "no board";
  const chain = board.chain;
  if (!Array.isArray(chain)) return "no chain";
  /* Eleven ROWS is eleven calls plus the one you are shown to start from. */
  if (chain.length !== XI + 1) return `${chain.length} rows, not ${XI + 1}`;
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (!r) return `row ${i + 1} is malformed`;
    if (!Number.isFinite(Number(r.value))) return `row ${i + 1} has no value`;
    if (!r.name && !r.label) return `row ${i + 1} has nothing to name it`;
    /* A TIE CANNOT BE CALLED. Higher or lower is the whole game, and two
       equal values in a row is a call with no right answer — which no shape
       check on counts alone would find. */
    if (i > 0 && Number(r.value) === Number(chain[i - 1].value)) {
      return `rows ${i} and ${i + 1} are equal, so the call cannot be made`;
    }
  }
  if (!board.subtitle || !String(board.subtitle).trim()) return "no subtitle";
  return null;
}

/* Scrambled and Vowels are the same bank read two ways, so they are the same
   check with the cypher passed in. Which is the point of the arrangement: a
   board that is sound as an anagram and unsound de-vowelled is a board this
   would catch on one side and not the other. */
function checkCypher(board, consonants) {
  if (!board) return "no board";
  const slots = board.slots;
  if (!Array.isArray(slots)) return "no slots";
  if (slots.length !== XI) return `${slots.length} slots, not ${XI}`;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s || !s.id) return `slot ${i + 1} is malformed`;
    if (!s.pos) return `slot ${i + 1} has no position`;
    if (consonants) {
      if (!s.cy && !s.presolved) return `slot ${i + 1} has no de-vowelled form`;
    } else {
      if (!s.scramble) return `slot ${i + 1} has no scramble`;
      if (!Array.isArray(s.len) || !s.len.length) return `slot ${i + 1} has no word lengths`;
    }
  }
  /* EVERY SLOT PRESOLVED IS NOT A PUZZLE. A name with no vowels rides down
     solved and says so; a board of eleven such names would open finished. */
  if (consonants && slots.every((s) => s.presolved)) return "every slot is presolved";
  if (!board.title || !String(board.title).trim()) return "no title";
  return null;
}

/* ---- the walk --------------------------------------------------------- */

/* One game, one day. Kept as data so the walk below has no per-game branch in
   it: adding a sixth game is a row here and nothing else. */
const SCHEDULE = [
  {
    game: "crossword",
    /* Board numbers ARE days for the crossword and the two cypher games: #1 is
       the epoch and each one after it is a day later, so a future day is
       addition rather than date arithmetic. */
    async board(env, at) { return getDailyPuzzle(env, dailyNumber(at)); },
    check: checkCrossword,
  },
  {
    game: "wordsearch",
    /* dailyBoard takes the moment, so a future day costs no new query and no
       second copy of the schedule join. */
    async board(env, at) { const d = await dailyBoard(env, at); return d && d.puzzle; },
    check: checkWordsearch,
  },
  {
    game: "hilo",
    async board(env, at, ctx) {
      const bank = ctx.hlBank;
      const id = (bank.schedule || {})[utcDay(at)];
      return id ? hlBoardById(bank, id) : null;
    },
    check: checkHilo,
  },
  {
    game: "scrambled",
    async board(env, at, ctx) {
      return boardForNumber(dailyNumber(at), ctx.scBoards, "anagram");
    },
    check: (b) => checkCypher(b, false),
  },
  {
    game: "vowels",
    async board(env, at, ctx) {
      return boardForNumber(dailyNumber(at), ctx.scBoards, "consonants");
    },
    check: (b) => checkCypher(b, true),
  },
];

export function gamesPreflighted() { return SCHEDULE.map((s) => s.game); }

/* Walk every game across the next `days` days, starting today.
 *
 * TODAY IS INCLUDED deliberately. The board a player is on right now is the
 * one whose breakage costs something immediately, and a check that only ever
 * looked at tomorrow would have nothing to say about it. */
export async function preflight(env, days, now) {
  const at0 = Number(now) || Date.now();
  const n = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(days) || PREFLIGHT_DAYS)));
  const problems = [];
  let checked = 0;
  /* Banks loaded once and shared across the whole walk: HiLo's is every board
     in the game and Scrambled's is nine hundred, and re-reading them per day
     would turn fourteen days into seventy table scans. */
  const ctx = {};

  /* THE RING IS A PRECONDITION, NOT A DAY. Scrambled and Vowels always
     resolve to SOME board because the bank is a ring — so an empty bank shows
     up as fourteen identical "no board" lines, or worse, as nothing at all.
     Said once, plainly, before the walk. */
  try {
    /* UNWRAPPED. loadBoards answers { boards, source } and boardForNumber
       takes the ARRAY — handing it the wrapper makes `boards.length`
       undefined, and dailyRing then falls back to the module bank without a
       word. Fourteen days of the built-in sample would have walked green
       while production's schedule went unread: a green light with no bulb
       behind it, which is the one outcome this endpoint must never produce. */
    const loaded = await loadBoards(env);
    ctx.scBoards = loaded.boards;
    /* AND THE SOURCE IS PART OF THE VERDICT. "module" means the sc_board
       table was empty or unreadable and the game is running on its built-in
       bank — the site stays up, which is right, but a preflight that checked
       that bank has checked the wrong one. */
    if (loaded.source !== "d1") {
      problems.push({ game: "scrambled", day: null,
        why: "the bank is not the database's: " + loaded.source });
    }
    if (!dailyRing(ctx.scBoards).length) {
      problems.push({ game: "scrambled", day: null, why: "the bank is empty" });
    }
  } catch (e) {
    ctx.scBoards = [];
    problems.push({ game: "scrambled", day: null, why: "the bank could not be read" });
  }

  /* The same question of HiLo, whose loader falls back the same way. */
  try {
    ctx.hlBank = await loadBank(env);
    if (ctx.hlBank.source !== "d1") {
      problems.push({ game: "hilo", day: null,
        why: "the bank is not the database's: " + ctx.hlBank.source });
    }
  } catch (e) {
    ctx.hlBank = { boards: [], schedule: {} };
    problems.push({ game: "hilo", day: null, why: "the bank could not be read" });
  }

  for (let k = 0; k < n; k++) {
    const at = at0 + k * DAY_MS;
    const day = utcDay(at);
    for (const s of SCHEDULE) {
      checked++;
      let why = null;
      try {
        why = s.check(await s.board(env, at, ctx));
      } catch (e) {
        /* A loader that threw is a problem about the board, not an error for
           the caller: one game's bad day must not stop the other four being
           walked. */
        why = "could not be read";
      }
      if (why) problems.push({ game: s.game, day, why });
    }
  }

  return { checked, days: n, problems };
}
