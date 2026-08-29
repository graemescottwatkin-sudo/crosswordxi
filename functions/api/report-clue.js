/* POST /api/report-clue  { game?, itemId | clueId, reason?, puzzle? }
 *
 * Flag a clue while playing. Deliberately open to any signed-in player rather
 * than admins only: the person who notices a bad clue is whoever happens to be
 * looking at it, and a note you have to remember until later is a note that
 * gets lost.
 *
 * Reading the reports is admin-only. Adding one is not.
 *
 * EVERY GAME, NOT JUST THE CROSSWORD. What is reportable differs by game — the
 * crossword addresses a clue, the word search and Scrambled a whole board,
 * QuickFire a question — so the body names the game and the id it addresses
 * by, and migration 024 stores the pair. The crossword's own call still sends
 * { clueId } and still works: renaming a field across a shipped client to tidy
 * an API is how a report button silently stops reporting.
 *
 * The id is NOT validated against that game's content here. It could be — a
 * SELECT per game, four more places to change when a fifth arrives — but a
 * report is a note for a person to read, and refusing one because an id looks
 * unfamiliar loses the note. The admin list shows the id it was given.
 */
import { json, bad } from "../_lib/puzzle.js";
import { hasDB } from "../_lib/db.js";
import { currentUser, csrfOk, newId } from "../_lib/auth.js";
import { limited } from "../_lib/limit.js";
import { validReportGame } from "../_lib/games.js";

export async function onRequestPost({ request, env }) {
  if (await limited(env, request, "report-clue", 20, 3600))
    return json({ error: "Too many requests. Give it a minute." }, 429);
  if (!csrfOk(request)) return bad("Missing request header.", 403);
  if (!hasDB(env)) return bad("Not configured.", 503);
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in to report a clue.", 401);

  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  /* One list, imported, not restated: the server's game list is the same one
     entry keys are checked against, widened to games that are BUILT but not
     yet launched — reporting wrong content is most useful exactly then. A
     report naming a game that does not exist is a bug in a client. */
  const game = String(body.game || "crossword");
  if (!validReportGame(game)) return bad("Unknown game.");

  /* itemId is the general name; clueId is what the crossword has always sent.
     Both mean "the thing that is wrong". */
  const itemId = String(body.itemId || body.clueId || "").slice(0, 40);
  if (!itemId) return bad("No item id.");

  const reason = String(body.reason || "").slice(0, 200) || null;

  /* One report per clue per person — pressing the button twice is far more
     likely to be a mis-tap than two separate objections. But a second report
     with a better reason replaces the first rather than being thrown away:
     coming back to a clue with a clearer idea of what is wrong with it is
     exactly what a second look is for. */
  const seen = await env.DB
    .prepare("SELECT id, reason FROM clue_reports WHERE game = ? AND clue_id = ? AND reported_by = ?")
    .bind(game, itemId, user.id).first();
  if (seen) {
    if (reason && reason !== seen.reason) {
      await env.DB.prepare("UPDATE clue_reports SET reason = ? WHERE id = ?")
        .bind(reason, seen.id).run();
      return json({ ok: true, already: true, updated: true });
    }
    return json({ ok: true, already: true });
  }

  await env.DB.prepare(
    "INSERT INTO clue_reports (id, game, clue_id, reported_by, reason, puzzle) VALUES (?,?,?,?,?,?)")
    .bind(newId(), game, itemId, user.id, reason,
          String(body.puzzle || "").slice(0, 40) || null).run();
  return json({ ok: true });
}
