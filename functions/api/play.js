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
import { newId, isAdmin} from "../_lib/auth.js";
import { limited } from "../_lib/limit.js";

const int = (v, max = 100000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : 0;
};

export async function onRequestPost({ request, env }) {
  if (await limited(env, request, "play", 120, 3600))
    return json({ error: "Too many requests. Give it a minute." }, 429);
  /* Deliberately no CSRF header requirement: this is fired from a page-hide
     handler via sendBeacon, which cannot set headers. It writes nothing that
     belongs to anybody and reads nothing back, so there is nothing to protect
     against being triggered. */
  if (!hasDB(env)) return json({ ok: false });

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }

  const playId = String(body.playId || "").slice(0, 60);
  if (!playId || playId.length < 8) return bad("No play id.");
  /* Three modes, not two. Coercing everything that was not "practice" into
     "daily" filed every themed board under practice, which is the one place
     the number is least useful — a themed board is the thing designed to be
     passed between friends. */
  const mode = body.mode === "practice" ? "practice"
             : body.mode === "theme" ? "theme"
             : "daily";
  /* "man-united-3": the same slug the share link carries, so a row here joins
     to the link somebody actually sent. */
  const themeKey = mode === "theme"
    ? (/^[a-z0-9][a-z0-9-]{0,48}$/.test(String(body.themeKey || "")) ? body.themeKey : null)
    : null;

  /* Was this the owner testing? Read from the session, never from the browser
     — a flag the client could set is a flag anyone could set about anyone.
     It records that one bit and nothing else: no email, no user id, and
     nothing at all about any other player. */
  let byOwner = 0;
  try { byOwner = (await isAdmin(request, env)) ? 1 : 0; } catch (e) { byOwner = 0; }

  if (body.event === "start") {
    /* One row per play id. A retry, a double-fire on a flaky connection, or a
       refresh mid-puzzle must not become three plays. */
    const seen = await env.DB.prepare("SELECT id FROM plays WHERE play_id = ?")
      .bind(playId).first();
    /* Already numbered: hand the same number back rather than issuing another.
       This is what makes a refresh keep its reference. */
    if (seen) {
      const had = await env.DB.prepare("SELECT play_no FROM plays WHERE play_id = ?")
        .bind(playId).first();
      return json({ ok: true, already: true, playNo: (had && had.play_no) || null });
    }
    /* The next number for this board. Counted rather than kept in a counter
       table: one query, no second thing to keep in step, and at this scale a
       simultaneous pair getting the same number is both unlikely and harmless —
       the reference is for reading, not for joining on. */
    const scope = mode === "daily"
      ? await env.DB.prepare("SELECT COUNT(*) AS n FROM plays WHERE mode='daily' AND daily_no = ?")
          .bind(body.dailyNo ? int(body.dailyNo, 100000) : null).first()
      : mode === "theme"
        ? await env.DB.prepare("SELECT COUNT(*) AS n FROM plays WHERE mode='theme' AND theme_key = ?")
            .bind(themeKey).first()
        : await env.DB.prepare("SELECT COUNT(*) AS n FROM plays WHERE mode='practice'").first();
    const playNo = ((scope && scope.n) || 0) + 1;

    /* Where this visit came from. Validated to the same slug shape the client
       normalises to, and rejected rather than repaired if it does not match:
       a value that had to be cleaned up is a value that will not group with
       the others, which is the whole failure this is trying to avoid. */
    const attr = body.attribution && typeof body.attribution === "object"
      ? body.attribution : {};
    const slug = (v) => {
      const x = String(v == null ? "" : v).slice(0, 40);
      return /^[a-z0-9][a-z0-9-]*$/.test(x) ? x : null;
    };

    await env.DB.prepare(
      `INSERT INTO plays (id, play_id, mode, daily_no, phase, total, theme_key,
                          by_owner, play_no,
                          utm_source, utm_medium, utm_campaign, utm_content,
                          utm_term, referrer, attribution_scope)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId(), playId, mode,
            body.dailyNo ? int(body.dailyNo, 100000) : null,
            body.phase === "season" ? "season" : "preseason",
            int(body.total, 50), themeKey, byOwner, playNo,
            slug(attr.utm_source), slug(attr.utm_medium), slug(attr.utm_campaign),
            slug(attr.utm_content), slug(attr.utm_term), slug(attr.referrer),
            "session").run();
    return json({ ok: true, playNo });
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
