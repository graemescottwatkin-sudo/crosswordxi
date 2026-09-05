/* sc-round.js — the clock and the help the server keeps for a Scrambled
 * round, and the score it computes from them.
 *
 * The same job hl-round.js does for HiLo, and a simpler one: this game has one
 * clock for the whole board rather than eleven, so nothing has to be told when
 * a clock restarts. Every input is already something the server serves:
 *
 *   started   written here, when the round begins
 *   solved    it marks every guess (/api/scrambled/guess)
 *   help      it serves every reveal (/api/scrambled/reveal)
 *
 * WITHOUT A DATABASE THIS DOES NOTHING, on purpose — the same rule the rest of
 * the family keeps. Every function answers null, the round plays exactly as it
 * did before a score could be verified, and the Full Time card keeps saying
 * the number is the device's own.
 */
import SCX_SCORING from "../../football/scrambled/js/scoring.js";
import SCX_CONFIG from "../../football/scrambled/js/config.js";
import { loadBoards, boardForToken, tokenCypher } from "./sc-board.js";

/* THE RULE AND THE PRICES ARE THE PAGE'S OWN FILES, imported rather than
   restated. Both were written to load as a script and as a module — the same
   reason HiLo's scoring can be shared and the crossword's cannot. So there is
   one statement of what a reveal costs and one of what a score is, and no
   drift to write a check against. */
export { SCX_SCORING, SCX_CONFIG };

export function hasDB(env) { return !!(env && env.DB); }

const okPlay = (v) => (/^[A-Za-z0-9_-]{6,64}$/.test(String(v || "")) ? String(v) : null);

/* What each kind of help costs, read from the game's own config so a price
   changes in one place. A kind nobody has priced costs nothing rather than
   NaN: an unknown reveal must not poison a score. */
export function costOf(kind) {
  const c = SCX_CONFIG;
  const prices = {
    hint: c.REVEAL_HINT_COST,
    letter: c.REVEAL_LETTER_COST,
    vowel: c.REVEAL_VOWEL_COST,
    name: c.REVEAL_NAME_COST,
  };
  const n = Number(prices[String(kind)]);
  return Number.isFinite(n) ? n : 0;
}

export async function startRound(env, playId, token, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id || !token) return null;
  const ms = Number(now) || Date.now();
  try {
    /* A round already started keeps its clock. Kicking off twice — a reload,
       a double tap — must not hand the player a fresh ninety minutes. */
    const row = await env.DB.prepare("SELECT started_ms FROM sc_round WHERE play_id = ?")
      .bind(id).first();
    if (row) return Number(row.started_ms);
    await env.DB.prepare(
      "INSERT INTO sc_round (play_id, token, started_ms, help) VALUES (?, ?, ?, 0)")
      .bind(id, String(token), ms).run();
    return ms;
  } catch (e) { return null; }
}

/* One slot done, however it was done. Keyed by the slot, so the same slot
   guessed twice counts once — a retry after a dropped connection is not a
   second solve, and eleven distinct slots is what finishes a round. */
export async function recordSolve(env, playId, slotId, how, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id || !slotId) return null;
  const ms = Number(now) || Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO sc_solve (play_id, slot_id, how, at_ms) VALUES (?, ?, ?, ?)
       ON CONFLICT(play_id, slot_id) DO NOTHING`)
      .bind(id, String(slotId), String(how), ms).run();
    return true;
  } catch (e) { return null; }
}

/* Is this slot already done? Asked before a name is charged for: buying a
   name the round already has must cost nothing, which is the rule the page
   keeps by refusing the click. */
export async function alreadyDone(env, playId, slotId) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id || !slotId) return false;
  try {
    const row = await env.DB.prepare(
      "SELECT slot_id FROM sc_solve WHERE play_id = ? AND slot_id = ?")
      .bind(id, String(slotId)).first();
    return !!row;
  } catch (e) { return false; }
}

/* Help served, added up by the thing serving it.
 *
 * THE HINT IS ONE PURCHASE FOR THE WHOLE BOARD, not one per press. The page
 * charges it on the transition and a second click bills nothing — "the board
 * is revealed once and the button goes dead" — so a server that charged per
 * request would score three points lower than the card for a player who
 * clicked twice. Both keep the same rule, which is the only way the two
 * numbers can agree. */
export async function recordHelp(env, playId, kind) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return null;
  const cost = costOf(kind);
  if (!cost) return 0;
  try {
    if (String(kind) === "hint") {
      const row = await env.DB.prepare(
        "SELECT hinted FROM sc_round WHERE play_id = ?").bind(id).first();
      if (!row || Number(row.hinted) === 1) return 0;
      await env.DB.prepare(
        "UPDATE sc_round SET help = help + ?, hinted = 1 WHERE play_id = ?")
        .bind(cost, id).run();
      return cost;
    }
    await env.DB.prepare("UPDATE sc_round SET help = help + ? WHERE play_id = ?")
      .bind(cost, id).run();
    return cost;
  } catch (e) { return null; }
}

/* The score, from rows this server wrote.
 *
 * HOW MANY SLOTS THE BOARD HAS IS READ FROM THE BOARD, not from the page. It
 * took a `slots` argument first, and that was a hole big enough to drive a
 * leaderboard through: solve three quickly, claim the board has three, and a
 * fast unhelped score goes to the top of a table. The round row already holds
 * the token it was started with, so the server can look the board up and count
 * its own slots — and a round is finished only when every one of them is done.
 * The page is not asked and cannot answer. */
export async function verifiedScore(env, playId) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return null;
  try {
    const round = await env.DB.prepare(
      "SELECT started_ms, help, token FROM sc_round WHERE play_id = ?").bind(id).first();
    if (!round) return null;
    const { boards } = await loadBoards(env);
    const board = boardForToken(round.token, boards);
    /* No board for the token this round was started with: nothing to measure
       a finish against, so nothing is scored. */
    if (!board || !Array.isArray(board.slots) || !board.slots.length) return null;
    /* A TILE THAT ARRIVES DONE IS NOT ONE THE PLAYER HAS TO SEND UP. In the
       consonant cypher a name with no vowels IS its own cypher, so the board
       hands it over at kick off — the page marks it "free" and never guesses
       it, and no row is ever written for it. Counting it as owed would mean a
       board with one of them could never reach a full house, and every player
       who drew that board would be told, forever and without a reason, that
       their round could not be verified.
       Which cypher is the token's business, and the anagram hides those names
       like any other: presolved is a consonant fact only. */
    const presolved = tokenCypher(round.token) === "consonants"
      ? board.slots.filter((s) => s.presolved).length : 0;
    const need = board.slots.length - presolved;
    if (need < 1) return null;
    const { results } = await env.DB.prepare(
      "SELECT slot_id, how, at_ms FROM sc_solve WHERE play_id = ? ORDER BY at_ms")
      .bind(id).all();
    const rows = results || [];
    if (rows.length !== need) return null;
    /* Timed to the LAST slot done, not to now. A player who finishes and
       leaves the card open must not be charged for reading it. */
    const lastMs = Math.max(...rows.map((r) => Number(r.at_ms)));
    const elapsed = Math.max(0, Math.round((lastMs - Number(round.started_ms)) / 1000));
    const help = Math.max(0, Number(round.help) || 0);
    const res = SCX_SCORING.computeScore(elapsed, help);
    return {
      score: res.score,
      solved: rows.filter((r) => r.how === "solved").length,
      given: rows.filter((r) => r.how === "revealed").length,
      /* The same three numbers the Full Time card shows, counted the same way:
         it calls a presolved tile free because the player was not charged for
         it and did not unravel it either. Counted off the board, because a
         free tile is never sent up and so has no row to count. */
      free: presolved,
      help,
      elapsedSecs: elapsed,
    };
  } catch (e) { return null; }
}
