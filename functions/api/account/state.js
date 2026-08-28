/* /api/account/state — a board in progress, following the player.
 *
 *   GET  ?game=crossword&key=daily:3      -> { state, updatedAt } | { state: null }
 *   POST { game, key, state }             -> { updatedAt }   (save; server stamps)
 *   POST { game, key, state: null }       -> { cleared: true } (finishing a board)
 *
 * WHY THIS IS SMALL. The state column is the game's OWN local save, verbatim.
 * The save format is already the one-fact-in-one-place per game; inventing a
 * "sync format" here would be a second copy that drifts. The server stores,
 * stamps, and returns — it never interprets the snapshot.
 *
 * NEWEST WINS, BY THE SERVER'S CLOCK ONLY. The client keeps the updatedAt this
 * server returned from its last push, and on open adopts the server snapshot
 * iff the server's stamp is newer than that. Two clocks never meet: device
 * time is not consulted anywhere in the comparison, per the standing rule
 * (midnight UTC vs local broke a real daily once).
 *
 * Results are untouched. A finished board still banks through migrate; this
 * table is only the journey, and the row is cleared when the journey ends.
 */
import { currentUser, csrfOk } from "../../_lib/auth.js";
import { validGame } from "../../_lib/games.js";

const MAX_STATE_BYTES = 64 * 1024;   /* a 15x15 grid's save is ~2KB; 64KB is
                                        generous headroom, not an invitation */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const bad = (m) => json({ error: m }, 400);

/* The key is validated by SHAPE, not against the games module's composer —
   the composer needs a full row, and this endpoint only ever sees the key.
   The shape rule: the game's own prefix, a colon, and a value. A key that
   does not parse is refused, never stored: an unparseable key is a row no
   pull will ever find again. */
function validKey(game, key) {
  const k = String(key || "");
  if (game === "crossword") return /^daily:\d{1,6}$/.test(k) ? k : null;
  if (game === "wordsearch") return /^ws:\d{4}-\d{2}-\d{2}$/.test(k) ? k : null;
  return null;
}

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Signed out." }, 401);

  const q = new URL(request.url).searchParams;
  const game = validGame(q.get("game") === null ? undefined : q.get("game"));
  if (!game) return bad("Unknown game.");
  const key = validKey(game, q.get("key"));
  if (!key) return bad("Unknown key.");

  const row = await env.DB.prepare(
    `SELECT state, updated_at FROM board_state
      WHERE user_id = ? AND game = ? AND entry_key = ?`)
    .bind(user.id, game, key).first();

  /* No row is a normal answer, not an error: most boards were never started
     elsewhere. */
  return json(row ? { state: row.state, updatedAt: row.updated_at }
                  : { state: null });
}

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return json({ error: "Refused." }, 403);
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Signed out." }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return bad("Not JSON."); }

  const game = validGame(body.game === undefined ? undefined : body.game);
  if (!game) return bad("Unknown game.");
  const key = validKey(game, body.key);
  if (!key) return bad("Unknown key.");

  /* state: null is the CLEAR — a finished board ends its journey here. */
  if (body.state === null) {
    await env.DB.prepare(
      `DELETE FROM board_state WHERE user_id = ? AND game = ? AND entry_key = ?`)
      .bind(user.id, game, key).run();
    return json({ cleared: true });
  }

  /* The snapshot is stored verbatim but it must BE a snapshot: a JSON object,
     under the cap. The server never reads inside it beyond that. */
  const state = typeof body.state === "string" ? body.state : JSON.stringify(body.state);
  if (state.length > MAX_STATE_BYTES) return bad("State too large.");
  let parsed;
  try { parsed = JSON.parse(state); } catch (e) { return bad("State is not JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return bad("State is not an object.");
  }

  /* The server's clock, the only clock. Returned so the client can remember
     what "my last push" means in server time. */
  const now = new Date().toISOString();
  /* 23 columns and 21 placeholders once reached production behind a green
     suite; this INSERT is small enough to count on sight — 5 and 5 — and
     state_test counts it anyway. */
  await env.DB.prepare(
    `INSERT INTO board_state (user_id, game, entry_key, state, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, game, entry_key)
     DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`)
    .bind(user.id, game, key, state, now).run();

  return json({ updatedAt: now });
}
