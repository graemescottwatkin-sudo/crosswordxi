/* functions/api/admin/[[route]].js — the owner's tools.
 *
 * Every route here checks the admin flag on the server, on every request. The
 * browser is told whether to show the panel, but that is a convenience: hiding
 * a button is not access control, and the panel could be conjured up by anyone
 * with a console. The gate is here.
 *
 * The flag is set by hand in the database. Nothing in this file grants it, and
 * no endpoint anywhere writes it — an account cannot promote itself.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB } from "../../_lib/db.js";
import { currentUser, csrfOk, newId } from "../../_lib/auth.js";
import { dailyNumber } from "../../_lib/daily.js";

async function requireAdmin(request, env) {
  if (!hasDB(env)) return { error: bad("Accounts are not configured.", 503) };
  const user = await currentUser(request, env);
  if (!user) return { error: bad("Not signed in.", 401) };
  /* Not "is the flag truthy in something the browser sent" — the row, read
     fresh, every time. */
  if (!user.is_admin) return { error: bad("Not found.", 404) };
  return { user };
}

export async function onRequest({ request, env, params }) {
  const route = (params.route || []).join("/");

  /* Whether to show the panel at all. Deliberately answers for everyone —
     false for anyone who is not an admin — so the shape of the response gives
     nothing away. */
  if (route === "whoami" && request.method === "GET") {
    if (!hasDB(env)) return json({ admin: false });
    const user = await currentUser(request, env);
    return json({ admin: !!(user && user.is_admin) });
  }

  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const me = gate.user;

  if (request.method !== "GET" && !csrfOk(request)) {
    return bad("Missing request header.", 403);
  }

  /* ---- What is in the database ---- */
  if (route === "summary" && request.method === "GET") {
    /* Bound parameters, not interpolation — even for an id that came from our
       own database. The first version of this built the user id into the SQL
       string, which is safe here and a bad habit anywhere. */
    const one = async (sql, ...binds) => {
      try {
        const stmt = env.DB.prepare(sql);
        const r = await (binds.length ? stmt.bind(...binds) : stmt).first();
        return r ? Object.values(r)[0] : null;
      } catch (e) { return null; }
    };
    return json({
      today: dailyNumber(),
      users: await one("SELECT COUNT(*) AS n FROM users"),
      results: await one("SELECT COUNT(*) AS n FROM results"),
      myResults: await one("SELECT COUNT(*) AS n FROM results WHERE user_id = ?", me.id),
      reports: await one("SELECT COUNT(*) AS n FROM clue_reports"),
      clues: await one("SELECT COUNT(*) AS n FROM clues"),
      dailies: await one("SELECT COUNT(*) AS n FROM puzzles WHERE mode = 'daily'"),
      lastDay: await one("SELECT MAX(daily_no) AS n FROM puzzles WHERE mode = 'daily'"),
    });
  }

  /* ---- Any stored daily, for the owner only ----
     /api/daily deliberately serves today and nothing else, and reveal and check
     refuse a token for another day. That guard stays exactly as it is: this is
     a separate route behind the admin gate, not a loosening of it. Without it
     the Matchday 1 changeover could not be seen until September. */
  if (route === "daily" && request.method === "GET") {
    const url = new URL(request.url);
    const n = parseInt(url.searchParams.get("n") || "", 10);
    if (!Number.isInteger(n) || n < 1) return bad("Give a day number.");
    const row = await env.DB
      .prepare("SELECT payload FROM puzzles WHERE mode = 'daily' AND daily_no = ? LIMIT 1")
      .bind(n).first();
    if (!row) return bad(`No daily puzzle stored for day ${n}.`, 404);
    const stored = JSON.parse(row.payload);
    const { publicPuzzle: strip } = await import("../../_lib/puzzle.js");
    return json({
      mode: "daily", dailyNo: n, token: `daily:${n}`,
      puzzle: strip(stored.puzzle), preview: true,
    });
  }

  /* ---- Clear my own record ---- */
  if (route === "reset-my-record" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM results WHERE user_id = ?").bind(me.id).run();
    return json({ ok: true, cleared: true });
  }

  /* ---- Flagged clues ---- */
  if (route === "reports" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT r.id, r.clue_id, r.reason, r.puzzle, r.created_at,
              c.clue, c.answer, c.category
         FROM clue_reports r LEFT JOIN clues c ON c.id = r.clue_id
        ORDER BY r.created_at DESC LIMIT 200`).all();
    return json({ reports: rows.results || [] });
  }

  if (route === "reports/clear" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) {}
    if (body.id) {
      await env.DB.prepare("DELETE FROM clue_reports WHERE id = ?").bind(String(body.id)).run();
    } else {
      await env.DB.prepare("DELETE FROM clue_reports").run();
    }
    return json({ ok: true });
  }

  /* ---- Archive a clue without a deploy ---- */
  if (route === "archive-clue" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
    const id = String(body.clueId || "").slice(0, 40);
    if (!id) return bad("No clue id.");
    const on = body.archive !== false;
    await env.DB.prepare("UPDATE clues SET max_per = ? WHERE id = ?")
      .bind(on ? 0 : 1, id).run();
    /* Only affects puzzles generated from here on: the stored ones already
       contain the clue. Say so rather than imply it has vanished. */
    return json({ ok: true, clueId: id, archived: on,
      note: "Applies to puzzles generated from now on. Puzzles already stored still contain it." });
  }

  return bad("Not found.", 404);
}
