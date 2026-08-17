/* POST /api/play — how far people get.
 *
 * Two events per attempt: one when a puzzle starts, one when it ends. The end
 * event carries how many clues were solved, which is the number that matters —
 * a daily that 142 people start and 12 finish is a different problem from one
 * that 40 start and 38 finish, and no page-view tool can tell them apart.
 *
 * WHAT IT DOES NOT COLLECT
 *
 * No cookie, no account, no address, nothing derived from the person. The play
 * id is random, made when the puzzle starts and forgotten when it ends: it
 * pairs a start with its finish and identifies nobody. Two attempts by the same
 * player are indistinguishable from two players, which is the price of not
 * following anyone around, and worth paying.
 */
import { json, bad } from "../_lib/puzzle.js";
import { hasDB } from "../_lib/db.js";
import { newId } from "../_lib/auth.js";

const int = (v, max = 100000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : 0;
};

export async function onRequestPost({ request, env }) {
  /* Deliberately no CSRF header requirement: this is fired from a page-hide
     handler via sendBeacon, which cannot set headers. It writes nothing that
     belongs to anybody and reads nothing back, so there is nothing to protect
     against being triggered. */
  if (!hasDB(env)) return json({ ok: false });

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  const playId = String(body.playId || "").slice(0, 60);
  if (!playId || playId.length < 8) return bad("No play id.");
  const mode = body.mode === "practice" ? "practice" : "daily";

  if (body.event === "start") {
    /* One row per play id. A retry, a double-fire on a flaky connection, or a
       refresh mid-puzzle must not become three plays. */
    const seen = await env.DB.prepare("SELECT id FROM plays WHERE play_id = ?")
      .bind(playId).first();
    if (seen) return json({ ok: true, already: true });
    await env.DB.prepare(
      `INSERT INTO plays (id, play_id, mode, daily_no, phase, total)
       VALUES (?,?,?,?,?,?)`)
      .bind(newId(), playId, mode,
            body.dailyNo ? int(body.dailyNo, 100000) : null,
            body.phase === "season" ? "season" : "preseason",
            int(body.total, 50)).run();
    return json({ ok: true });
  }

  if (body.event === "end") {
    /* An update, not an insert: an attempt that ends twice — finished, then the
       tab closed — is still one attempt. */
    await env.DB.prepare(
      `UPDATE plays SET solved = ?, completed = ?, elapsed_secs = ?,
              checks = ?, reveals = ?, ended_at = datetime('now')
        WHERE play_id = ?`)
      .bind(int(body.solved, 50), body.completed ? 1 : 0,
            int(body.elapsed, 86400), int(body.checks, 500),
            int(body.reveals, 500), playId).run();
    return json({ ok: true });
  }

  return bad("Unknown event.");
}
