/* GET /api/practice[?category=...&seen=1,2,3]
 *
 * The browser asks for a practice game; the server picks it. Selection happens
 * against the pool in the database, so no part of the bank is exposed and the
 * browser cannot choose for itself.
 */
import { publicPuzzle, json, bad } from "../_lib/puzzle.js";
import { getPracticePuzzle, getPuzzleForToken, parseToken, listCategories, makeToken, bankSize } from "../_lib/db.js";

/* Everything from the query string is untrusted. Category is checked against
   the values actually present rather than interpolated into SQL, and `seen` is
   coerced to a bounded list of integers. */
function parseSeen(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 40);
}

/* POST carries the list of clues already seen. A thousand ids will not fit in
   a query string, and this is not a state change — the body is simply the only
   place a list that long can go. */
export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const used = Array.isArray(body.usedClues)
    ? body.usedClues.filter((x) => typeof x === "string").slice(0, 2000) : [];
  return serve(request, env, used);
}

export async function onRequestGet({ request, env }) {
  return serve(request, env, []);
}

async function serve(request, env, usedClues) {
  const url = new URL(request.url);

  /* ?token= returns one named practice puzzle, so a player resuming a saved
     game gets the grid they left. It carries no answers — the same stripped
     payload as any other request — and practice puzzles are not day-locked, so
     naming one grants nothing a fresh request would not. */
  const wanted = url.searchParams.get("token");
  if (wanted) {
    const t = parseToken(wanted);
    if (!t || t.mode !== "practice") return bad("Not a practice puzzle.", 400);
    const saved = await getPuzzleForToken(env, wanted);
    if (!saved) return bad("That practice puzzle is no longer stored.", 404);
    return json({
      mode: "practice",
      poolId: t.id,
      category: saved.category || null,
      token: makeToken("practice", t.id),
      puzzle: publicPuzzle(saved.puzzle),
    });
  }

  const asked = url.searchParams.get("category");
  const seenIds = parseSeen(url.searchParams.get("seen"));

  let category = null;
  if (asked) {
    const allowed = await listCategories(env);
    if (!allowed.includes(asked)) {
      return bad("Unknown category. Ask /api/categories for the list.", 400);
    }
    category = asked;
  }

  const stored = await getPracticePuzzle(env, { category, seenIds, usedClues });
  if (!stored) {
    return bad("No practice puzzles are stored" + (category ? " for that category" : "") +
      ". Run tools/build_puzzles.js and import the result — see README step 5.", 404);
  }
  /* The token must name the database row, because that is what check-answer
     and reveal look up. It was built from a counter inside the payload, which
     does not match the table's primary key once the daily rows are inserted
     first — practice checks would have 404'd in production while working
     against the development data. */
  return json({
    mode: "practice",
    poolId: stored.rowId,
    category: stored.category || null,
    token: makeToken("practice", stored.rowId),
    puzzle: publicPuzzle(stored.puzzle),
    // How much of the bank exists, so the browser can show progress through it.
    bankSize: await bankSize(env),
    fresh: stored.fresh !== false,
  });
}
