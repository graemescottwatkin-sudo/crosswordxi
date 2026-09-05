/* ws-round.js — the clock, the finds and the fouls the server keeps for a
 * Wordsearch XI round, and the score it computes from them.
 *
 * The last of the five games, and the one that needed the most to get here.
 * HiLo already judged every call and Scrambled marked every guess, so both
 * only wanted a clock. This game judged NOTHING: the board travelled whole,
 * every answer with its exact placement, and the page decided for itself what
 * had been found. There was no server-side fact about a round to build on.
 *
 * So the judging moved first — see ws-public.js — and this is what the judging
 * writes down:
 *
 *   started   here, at kick off
 *   found     one row per word, written when THIS server matched the selection
 *   fouls     one row per wrong selection, because the penalty escalates with
 *             consecutive ones and a running total cannot say which were
 *
 * WITHOUT A DATABASE THIS DOES NOTHING, on purpose — the rule the rest of the
 * family keeps. Every function answers null, the round plays exactly as it did
 * before a score could be verified, and the card keeps saying the number is
 * the device's own.
 */
import XIWS_SCORING from "../../football/wordsearch/js/scoring.js";
import { boardById, dailyBoard, utcDayKey } from "./wsdata.js";

/* THE RULE IS THE PAGE'S OWN FILE, imported rather than restated — the same
   reason HiLo's and Scrambled's can be shared. One statement of what a score
   is, and no drift to write a check against. */
export { XIWS_SCORING };

export function hasDB(env) { return !!(env && env.DB); }

const okPlay = (v) => (/^[A-Za-z0-9_-]{6,64}$/.test(String(v || "")) ? String(v) : null);

/* ---- the geometry, which is the judging ----
 *
 * A selection is two squares; the word it claims is every square on the line
 * between them. The page drew that line and checked it against placements it
 * had been given. The server does it now, against placements it has never
 * sent.
 */
const DIRS = {
  E: [0, 1], W: [0, -1], S: [1, 0], N: [-1, 0],
  SE: [1, 1], SW: [1, -1], NE: [-1, 1], NW: [-1, -1],
};

/* The squares a placement covers, as "r,c" strings. */
export function placementCells(pl, len) {
  const d = DIRS[pl && pl.direction];
  if (!d) return [];
  const out = [];
  for (let k = 0; k < len; k++) out.push((pl.start_row + d[0] * k) + "," + (pl.start_col + d[1] * k));
  return out;
}

/* The squares a selection covers. Refuses anything that is not a straight
   line — the page refuses it too, and a server that accepted a bent path
   would be judging a shape the game does not have. */
export function selectionCells(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to)) return [];
  const [r1, c1] = from.map(Number), [r2, c2] = to.map(Number);
  if (![r1, c1, r2, c2].every(Number.isInteger)) return [];
  const dr = r2 - r1, dc = c2 - c1;
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return [];
  const n = Math.max(Math.abs(dr), Math.abs(dc));
  const sr = Math.sign(dr), sc = Math.sign(dc);
  const out = [];
  for (let k = 0; k <= n; k++) out.push((r1 + sr * k) + "," + (c1 + sc * k));
  return out;
}

const sameCells = (a, b) =>
  a.length === b.length && a.every((x) => b.includes(x));

/* WHAT THIS SELECTION HIT, if anything. A word already found is not hit
   again: the page removes it from play, and a server that kept matching it
   would let one word be "found" eleven times. */
export function judge(puzzle, from, to, already) {
  const cells = selectionCells(from, to);
  if (!cells.length) return null;
  const done = new Set(already || []);
  const pool = (puzzle.answers || []).map((a) => ({ item: a, bonus: false }));
  if (puzzle.bonus) pool.push({ item: puzzle.bonus, bonus: true });
  for (const { item, bonus } of pool) {
    if (done.has(item.grid)) continue;
    if (sameCells(cells, placementCells(item.placement, item.grid.length))) {
      return { item, bonus };
    }
  }
  return null;
}

/* ---- the rows ---- */

export async function startRound(env, playId, puzzleId, day, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id || !puzzleId) return null;
  const ms = Number(now) || Date.now();
  try {
    /* A round already started keeps its clock. A reload, a double tap, a
       resumed board — none of them hands the player a fresh ten minutes. */
    const row = await env.DB.prepare("SELECT started_ms FROM ws_round WHERE play_id = ?")
      .bind(id).first();
    if (row) return Number(row.started_ms);
    await env.DB.prepare(
      "INSERT INTO ws_round (play_id, puzzle_id, day, started_ms) VALUES (?, ?, ?, ?)")
      .bind(id, String(puzzleId), String(day || ""), ms).run();
    return ms;
  } catch (e) { return null; }
}

/* One word found, keyed by the word: the same word sent twice after a dropped
   connection is one find, and eleven distinct words is what finishes a board. */
export async function recordFind(env, playId, word, isBonus, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id || !word) return null;
  try {
    await env.DB.prepare(
      `INSERT INTO ws_find (play_id, word, is_bonus, at_ms) VALUES (?, ?, ?, ?)
       ON CONFLICT(play_id, word) DO NOTHING`)
      .bind(id, String(word), isBonus ? 1 : 0, Number(now) || Date.now()).run();
    return true;
  } catch (e) { return null; }
}

/* One wrong selection. Numbered rather than counted, so the sequence survives
   and the escalation can be derived from it. */
export async function recordFoul(env, playId, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT COALESCE(MAX(idx), 0) AS n FROM ws_foul WHERE play_id = ?").bind(id).first();
    const idx = Number(row && row.n) + 1;
    await env.DB.prepare(
      `INSERT INTO ws_foul (play_id, idx, at_ms) VALUES (?, ?, ?)
       ON CONFLICT(play_id, idx) DO NOTHING`)
      .bind(id, idx, Number(now) || Date.now()).run();
    return idx;
  } catch (e) { return null; }
}

/* The words a round has already found, so the judge does not match one twice
   and the page can be told where it stands after a reload. */
export async function foundWords(env, playId) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT word, is_bonus FROM ws_find WHERE play_id = ? ORDER BY at_ms").bind(id).all();
    return results || [];
  } catch (e) { return []; }
}

/* IS THIS ROUND OVER? Asked before the secret is revealed at full time.
 *
 * The page names the missed secret on the results card, which is right when
 * the game has ended and is a free answer at any other moment — so the server
 * decides, from its own rows, rather than the page saying "I have finished".
 * Over means: every word found, or the clock past ninety match minutes, which
 * for this game is ten real minutes of play plus whatever the fouls added.
 */
export async function roundIsOver(env, playId, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return false;
  try {
    const round = await env.DB.prepare(
      "SELECT puzzle_id, started_ms FROM ws_round WHERE play_id = ?").bind(id).first();
    if (!round) return false;
    const puzzle = await boardById(env, round.puzzle_id);
    if (!puzzle) return false;
    const finds = await foundWords(env, id);
    if (finds.filter((f) => !Number(f.is_bonus)).length >= (puzzle.answers || []).length) return true;
    const { results } = await env.DB.prepare(
      "SELECT at_ms FROM ws_foul WHERE play_id = ?").bind(id).all();
    const penalty = XIWS_SCORING.penaltyFor((results || []).map((r) => Number(r.at_ms)));
    const elapsed = Math.max(0, ((Number(now) || Date.now()) - Number(round.started_ms)) / 1000);
    return XIWS_SCORING.matchMinute(elapsed, penalty) >= 90;
  } catch (e) { return false; }
}

/* The secret, once the round is over and not a moment before. */
export async function revealSecret(env, playId, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return null;
  if (!(await roundIsOver(env, id, now))) return null;
  try {
    const round = await env.DB.prepare(
      "SELECT puzzle_id FROM ws_round WHERE play_id = ?").bind(id).first();
    if (!round) return null;
    const puzzle = await boardById(env, round.puzzle_id);
    return puzzle && puzzle.bonus ? puzzle.bonus.display : null;
  } catch (e) { return null; }
}

/* The score, from rows this server wrote.
 *
 * HOW MANY WORDS A BOARD HAS IS READ FROM THE BOARD, never from the page —
 * the fault Scrambled shipped and had to fix: a page that can claim the board
 * is smaller can claim a finished board it never finished. The round row holds
 * the puzzle it started on, so the server looks it up and counts.
 */
export async function verifiedScore(env, playId) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return null;
  try {
    const round = await env.DB.prepare(
      "SELECT puzzle_id, day, started_ms FROM ws_round WHERE play_id = ?").bind(id).first();
    if (!round) return null;
    const puzzle = await boardById(env, round.puzzle_id);
    if (!puzzle || !Array.isArray(puzzle.answers) || !puzzle.answers.length) return null;

    const finds = await foundWords(env, id);
    const words = finds.filter((f) => !Number(f.is_bonus));
    const need = puzzle.answers.length;
    if (words.length !== need) return null;

    const { results } = await env.DB.prepare(
      "SELECT at_ms FROM ws_foul WHERE play_id = ? ORDER BY idx").bind(id).all();
    const penalty = XIWS_SCORING.penaltyFor((results || []).map((r) => Number(r.at_ms)));

    /* Timed to the LAST word found, not to now: a player who finishes and
       leaves the card open must not be charged for reading it. */
    const lastMs = Math.max(...finds.map((f) => Number(f.at_ms)));
    const elapsed = Math.max(0, Math.round((lastMs - Number(round.started_ms)) / 1000));
    const bonusFound = finds.some((f) => Number(f.is_bonus) === 1);
    const res = XIWS_SCORING.computeScore(elapsed, penalty, bonusFound);
    return {
      score: res.score, base: res.base, bonus: res.bonus, minute: res.minute,
      found: words.length, bonusFound, penaltyMinutes: penalty,
      fouls: (results || []).length, elapsedSecs: elapsed,
    };
  } catch (e) { return null; }
}
