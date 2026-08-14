/* functions/_lib/puzzle.js
 *
 * The one place where a stored puzzle becomes a public payload. Every API
 * response that carries a puzzle goes through publicPuzzle(), so there is a
 * single function to audit rather than four endpoints each deciding for
 * themselves what is safe to send.
 *
 * What is removed:
 *   - cells[].ch          the solution letter in every square
 *   - entries[].answer    the answer text
 *   - entries[].grid      the answer with spacing removed
 *   - entries[].entity    the club a clue belongs to, which often gives it away
 *
 * Earlier drafts also sent a salted hash per answer so the browser could tell a
 * typed word was right on its own. Those are gone: every correctness question
 * now goes to /api/check-answer, so the hashes bought nothing and were one more
 * thing an attacker could work against offline. Nothing derived from an answer
 * leaves this function.
 */

export function normalise(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* The full solution, read in a fixed cell order so client and server agree. */
export function solutionString(puzzle) {
  return Object.keys(puzzle.cells).sort()
    .map((k) => puzzle.cells[k].ch).join("");
}

export function publicPuzzle(puzzle) {
  const cells = {};
  for (const k of Object.keys(puzzle.cells)) {
    const c = puzzle.cells[k];
    cells[k] = { across: c.across, down: c.down, num: c.num };   // no ch
  }

  const entries = puzzle.entries.map((e) => ({
    num: e.num, dir: e.dir, x: e.x, y: e.y, len: e.len, cells: e.cells,
    /* Kept nested under `row` so the browser's existing references — e.row.id,
       e.row.clue, e.row.enum, e.row.diff — go on working unchanged. */
    row: {
      id: e.row.id,
      clue: e.row.clue,
      enum: e.row.enum,
      breaks: e.row.breaks || [],
      cat: e.row.cat,
      era: e.row.era,
      diff: e.row.diff,
    },
  }));

  return { width: puzzle.width, height: puzzle.height, cells, entries, stats: puzzle.stats };
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Puzzles are per-day or per-request; never let a shared cache hold them.
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

export function bad(message, status = 400) {
  return json({ error: message }, status);
}
