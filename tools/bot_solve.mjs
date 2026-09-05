/* bot_solve.mjs — how a bot reaches full time in each game, unaided.
 *
 * NO BOT IS EVER TOLD AN ANSWER. That was the design question behind item 14
 * and it settles the whole shape of the thing: if a bot needed the bank, the
 * bank would have to reach CI, and a public repo with the forward bank in its
 * secrets is a worse problem than the one the bot was solving.
 *
 * It does not need it. Every game can be finished from what the server already
 * hands a browser:
 *
 *   wordsearch  the grid IS the puzzle and the list of words is printed beside
 *               it, because that is what a word search is. Withholding the
 *               PLACEMENTS never made it unsolvable by a machine — it made the
 *               SERVER the judge, which is what makes the score mean anything.
 *               Searching eight directions finds all eleven in milliseconds.
 *   hilo        higher or lower, and a wrong call still settles the row, so a
 *               fixed call reaches the end of the chain every time.
 *   scrambled   a name reveal per slot; the shop is part of the game
 *   vowels      the same
 *   crossword   a reveal per entry
 *
 * NOTHING HERE TOUCHES THE NETWORK. It is the reasoning half, so it can be
 * proved offline against real boards; tools/play_bot.mjs is the half that
 * talks to a site.
 */

/* ---- word search ------------------------------------------------------ */

/* The eight ways a word can lie in a grid. Named rather than derived so a
   direction that stops working is a line to read, not an arithmetic puzzle. */
const DIRECTIONS = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/* A grid arrives as an array of row strings. Read through one accessor so a
   ragged row — which is a real malformed board, not a hypothetical — returns
   undefined rather than throwing halfway through a search. */
const at = (grid, r, c) => {
  const row = grid[r];
  return typeof row === "string" && c >= 0 && c < row.length ? row[c] : undefined;
};

/* Where a word lies, as the two squares a player would drag between.
 *
 * Returns { from: [r, c], to: [r, c] } or null. The letters are compared
 * case-folded and stripped of anything that is not a letter, because `grid` on
 * an answer is the run of letters as laid and `display` is the readable name —
 * "O'Neill" is ONEILL in the grid, and a bot comparing the two would report a
 * board as unsolvable when it is the comparison that is wrong. */
export function findWord(grid, word) {
  const want = String(word || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!want || !Array.isArray(grid) || !grid.length) return null;
  const rows = grid.length;
  for (let r = 0; r < rows; r++) {
    const cols = typeof grid[r] === "string" ? grid[r].length : 0;
    for (let c = 0; c < cols; c++) {
      if (at(grid, r, c) !== want[0]) continue;
      for (const [dr, dc] of DIRECTIONS) {
        let k = 1;
        for (; k < want.length; k++) {
          if (at(grid, r + dr * k, c + dc * k) !== want[k]) break;
        }
        if (k === want.length) {
          return { from: [r, c], to: [r + dr * (want.length - 1), c + dc * (want.length - 1)] };
        }
      }
    }
  }
  return null;
}

/* Every word on the board, located. `found` names the ones that could not be,
   which is a VERDICT about the board rather than a failure of the bot: a word
   in the list that is not in the grid is exactly the malformed board the
   preflight endpoint looks for, seen from the other side.
   The bonus is included when the payload admits to one — it is not named
   (that is the point of it), so it can only be found once the server has said
   what it was, which is why it is returned separately as `bonusPending`. */
export function solveWordsearch(payload) {
  const grid = (payload && payload.grid) || [];
  const answers = (payload && payload.answers) || [];
  const found = [], missing = [];
  for (const a of answers) {
    const where = findWord(grid, a.grid || a.display);
    if (where) found.push({ display: a.display, ...where });
    else missing.push(a.display || "(unnamed)");
  }
  return {
    found, missing,
    bonusPending: !!(payload && payload.bonus && payload.bonus.has),
  };
}

/* A WRONG SELECTION, ON PURPOSE. The bot has to draw fouls to exercise the
   escalation — +1', +2', +3', +4' capped at 15', reset after a quiet spell —
   and the honest way to draw one is to select squares that spell nothing. Two
   adjacent cells that are not the start of any answer will do, and if the
   board is so dense that every pair hits something, that is worth knowing
   rather than working around. */
export function aFoul(payload, solved) {
  const grid = (payload && payload.grid) || [];
  const taken = new Set();
  for (const f of solved || []) {
    const [r1, c1] = f.from, [r2, c2] = f.to;
    const n = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1));
    const sr = Math.sign(r2 - r1), sc = Math.sign(c2 - c1);
    for (let k = 0; k <= n; k++) taken.add((r1 + sr * k) + "," + (c1 + sc * k));
  }
  for (let r = 0; r < grid.length; r++) {
    const cols = typeof grid[r] === "string" ? grid[r].length : 0;
    for (let c = 0; c + 1 < cols; c++) {
      if (taken.has(r + "," + c) || taken.has(r + "," + (c + 1))) continue;
      return { from: [r, c], to: [r, c + 1] };
    }
  }
  return null;
}

/* ---- hilo -------------------------------------------------------------- */

/* Eleven calls, and the bot does not need to be right. A wrong call settles
   the row and the chain moves on, so "higher every time" reaches full time on
   every board — which is what a play bot is for. Alternating is offered so a
   run can be varied without varying the code that drives it. */
export function hiloCalls(rows, style = "higher") {
  const n = Math.max(0, Number(rows) || 0);
  const out = [];
  for (let i = 1; i <= n; i++) {
    if (style === "alternate") out.push(i % 2 ? "higher" : "lower");
    else if (style === "lower") out.push("lower");
    else out.push("higher");
  }
  return out;
}

/* ---- the two cypher games and the crossword ---------------------------- */

/* Both cypher games and the crossword finish by BUYING what they do not know:
   a name reveal per slot, an answer reveal per entry. It costs the score, which
   is the point — a bot that finishes on 114 every night proves the clock and
   nothing about the shop. Returned as a plain list of ids so the driver has no
   per-game branch in it. */
export function slotsToReveal(payload) {
  const slots = (payload && payload.slots) || [];
  /* A presolved slot is already open — buying it would be a purchase with
     nothing behind it, and the server is right to refuse. */
  return slots.filter((s) => s && !s.presolved).map((s) => s.id);
}

export function entriesToReveal(payload) {
  const entries = (payload && payload.puzzle && payload.puzzle.entries) || [];
  return entries.map((e) => ({ num: e.num, dir: e.dir }));
}

/* ---- what a session is ------------------------------------------------- */

/* TEN SESSIONS A NIGHT: per game, one that fouls a few times and then
   completes, and one that starts and walks away.
 *
 * The first covers the escalation, the reset AND a clean finish in one play;
 * splitting them doubles the cost for no coverage. The second is the only way
 * to exercise an unfinished board — and it is the LOSS condition of the season,
 * which nothing else in the suite produces. */
export const SESSIONS = ["complete", "abandon"];

export function sessionPlan(games) {
  const out = [];
  for (const game of games) for (const kind of SESSIONS) out.push({ game, kind });
  return out;
}
