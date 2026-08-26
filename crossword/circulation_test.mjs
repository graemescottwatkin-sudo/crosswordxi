/* circulation_test.mjs — practice variety: does the pool contain enough
   different clues, and does the server pick by what has not been seen? */
import { onRequestPost as practicePost } from "../functions/api/practice.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A stub pool: 40 puzzles of 11 clues each, all distinct — so "picked the one
   with least overlap" is measurable rather than lucky. */
const POOL = [];
let next = 0;
for (let i = 1; i <= 40; i++) {
  const ids = Array.from({ length: 11 }, () => "c" + (++next).toString().padStart(4, "0"));
  POOL.push({
    id: i, category: i % 2 ? "England" : null, clue_ids: JSON.stringify(ids),
    payload: JSON.stringify({ salt: "s", category: i % 2 ? "England" : null, puzzle: {
      width: 5, height: 5, cells: {}, stats: {},
      entries: ids.map((id, n) => ({ num: n + 1, dir: "A", x: 0, y: n, len: 3, cells: [],
        row: { id, clue: "clue " + id, enum: "(3)", grid: "ABC" } })),
    } }),
  });
}
const env = { DB: { prepare(sql) {
  let b = [];
  const api = {
    bind(...args) { b = args; return api; },
    async all() {
      let rows = POOL;
      if (sql.includes("category = ?")) rows = rows.filter((r) => r.category === b[0]);
      if (sql.includes("DISTINCT category")) {
        return { results: [...new Set(POOL.map((r) => r.category).filter(Boolean))].map((category) => ({ category })) };
      }
      if (sql.includes("clue_ids IS NOT NULL")) return { results: rows.map((r) => ({ clue_ids: r.clue_ids })) };
      return { results: rows.map((r) => ({ id: r.id, clue_ids: r.clue_ids })) };
    },
    async first() {
      if (sql.includes("WHERE id = ?")) {
        const r = POOL.find((x) => x.id === b[0]);
        return r ? { id: r.id, payload: r.payload } : null;
      }
      const r = POOL[0];
      return { id: r.id, payload: r.payload };
    },
  };
  return api;
} } };

const ask = (used, category) => practicePost({
  request: new Request("https://x/api/practice" + (category ? "?category=" + category : ""), {
    method: "POST", body: JSON.stringify({ usedClues: used }),
    headers: { "Content-Type": "application/json" },
  }), env,
});

const first = await (await ask([])).json();
t("a practice puzzle comes back", !!first.puzzle && first.puzzle.entries.length === 11);
t("the response says how much of the bank is reachable", first.bankSize === 440, first.bankSize + " clues");

/* Walk the pool: after each puzzle, add its clues to the used set. Every pick
   should be fresh until the pool is exhausted. */
const used = new Set();
let repeats = 0, picks = 0;
for (let i = 0; i < 30; i++) {
  const r = await (await ask([...used])).json();
  const ids = r.puzzle.entries.map((e) => e.row.id);
  if (ids.some((id) => used.has(id))) repeats++;
  ids.forEach((id) => used.add(id));
  picks++;
}
t("thirty puzzles in a row, none repeating a clue already seen",
  repeats === 0, repeats + " repeats over " + picks + " puzzles");
t("that is 330 distinct clues before anything came round again", used.size === 330, used.size + " clues");

/* Past exhaustion it must still serve something rather than fail. */
const everything = POOL.flatMap((p) => JSON.parse(p.clue_ids));
const after = await (await ask(everything)).json();
t("once every clue has been seen it still returns a puzzle", !!after.puzzle);
t("and says so, rather than pretending it is fresh", after.fresh === false, "fresh=" + after.fresh);

const cat = await (await ask([], "England")).json();
t("a category filter still applies", cat.category === "England", cat.category);
t("a huge used list is bounded, not trusted whole", (() => {
  const huge = Array.from({ length: 9000 }, (_, i) => "x" + i);
  return practicePost({ request: new Request("https://x/api/practice", {
    method: "POST", body: JSON.stringify({ usedClues: huge }),
  }), env }).then((r) => r.status === 200);
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
