/* hl-round.js — the clock the server keeps for a HiLo round, and the record
 * of the calls it judged.
 *
 * WHAT A VERIFIED SCORE IS MADE OF HERE. Every input is something the browser
 * cannot influence:
 *
 *   right    this server judged every call, from values it holds
 *   time     it timed each call from a clock it started itself
 *   order    the calls are keyed by index, so none can be replayed
 *
 * THE ONE THING THE PAGE GETS TO SAY ABOUT TIME, and why it is safe. After a
 * right call the next is shown at once, so its clock starts when this server
 * answered — nothing is asked. After a WRONG call the round waits for a tap of
 * Next, and the wait is not thinking time, so the page says when the clock
 * restarted. That can only move a clock LATER, which costs the player points.
 * There is nothing to gain by lying and no need to trust it.
 *
 * WITHOUT A DATABASE THIS DOES NOTHING, on purpose. Every function answers
 * null and the game plays exactly as it did before a score was verified — the
 * device's own number, which the Full Time card has always said is unverified.
 * A game that stopped working because a table was missing would be a worse
 * failure than an unverified score.
 */
import HL_SCORING from "../../football/hilo/js/scoring.js";

/* THE RULE IS THE PAGE'S OWN FILE, imported rather than restated. Crossword XI
   keeps two copies of its scoring and a suite to stop them drifting, because
   its rule lives inside engine.js beside the generator and the clue bank and
   dragging that into a Worker would cost every request. HiLo's scoring.js is a
   file of nothing but the rule, written to load as a script and as a module —
   so there is one copy, and no drift to check for. */
export { HL_SCORING };

export function hasDB(env) { return !!(env && env.DB); }

const okPlay = (v) => (/^[A-Za-z0-9_-]{6,64}$/.test(String(v || "")) ? String(v) : null);

/* Kick off, or the clock restarting after a wrong call. One entry point for
   both: they are the same fact — "the current call's clock starts now" — and
   two spellings of it would be two answers about when a call began. */
export async function startClock(env, playId, token, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id || !token) return null;
  const ms = Number(now) || Date.now();
  try {
    const row = await env.DB.prepare("SELECT play_id FROM hl_round WHERE play_id = ?")
      .bind(id).first();
    if (row) {
      await env.DB.prepare("UPDATE hl_round SET clock_ms = ? WHERE play_id = ?")
        .bind(ms, id).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO hl_round (play_id, token, started_ms, clock_ms) VALUES (?, ?, ?, ?)")
        .bind(id, String(token), ms, ms).run();
    }
    return ms;
  } catch (e) { return null; }
}

/* Record a judged call and, when it was right, start the next call's clock —
   because a right call moves the round on by itself. Returns what the server
   measured, or null where there is no database to measure into. */
export async function recordCall(env, playId, idx, called, wasRight, now) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return null;
  const ms = Number(now) || Date.now();
  try {
    const round = await env.DB.prepare(
      "SELECT clock_ms FROM hl_round WHERE play_id = ?").bind(id).first();
    /* No round means no kick off was seen. Refused rather than invented: a
       call with no clock start would have to be given an elapsed from
       somewhere, and anywhere is a guess. */
    if (!round) return null;
    const elapsed = Math.max(0, ms - Number(round.clock_ms));
    await env.DB.prepare(
      `INSERT INTO hl_call (play_id, idx, called, was_right, elapsed_ms, at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(play_id, idx) DO NOTHING`)
      .bind(id, Number(idx), String(called), wasRight ? 1 : 0, elapsed, ms).run();
    /* ON CONFLICT DO NOTHING, so a call sent twice keeps the first judgement
       and the first time. A retry after a dropped connection must not be a
       second, faster attempt at the same call. */
    if (wasRight) {
      await env.DB.prepare("UPDATE hl_round SET clock_ms = ? WHERE play_id = ?")
        .bind(ms, id).run();
    }
    return elapsed;
  } catch (e) { return null; }
}

/* The score, from the rows this server wrote. Nothing here reads anything the
   browser sent: the verdicts are its own and the times are its own. */
export async function verifiedScore(env, playId) {
  const id = okPlay(playId);
  if (!hasDB(env) || !id) return null;
  try {
    const { results } = await env.DB.prepare(
      "SELECT idx, was_right, elapsed_ms FROM hl_call WHERE play_id = ? ORDER BY idx")
      .bind(id).all();
    const rows = results || [];
    if (rows.length !== HL_SCORING.CALLS) return null;
    const verdicts = [], worths = [];
    for (const r of rows) {
      const right = Number(r.was_right) === 1;
      verdicts.push(right);
      worths.push(right ? HL_SCORING.worthAt(Number(r.elapsed_ms)) : 0);
    }
    const round = await env.DB.prepare(
      "SELECT started_ms FROM hl_round WHERE play_id = ?").bind(id).first();
    return {
      score: HL_SCORING.score(verdicts, worths),
      right: verdicts.filter(Boolean).length,
      elapsedSecs: round
        ? Math.max(0, Math.round((Number(rows[rows.length - 1].at_ms) - Number(round.started_ms)) / 1000))
        : null,
    };
  } catch (e) { return null; }
}
