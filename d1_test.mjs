/* Proves the practice-token fix against production insert order.
   A stub D1 that behaves like the real table: daily rows inserted first, so
   practice rows start at id = DAILY_COUNT + 1 and never match a 1..N counter. */
import { onRequestGet as practice } from "./functions/api/practice.js";
import { onRequestPost as reveal } from "./functions/api/reveal.js";
import { onRequestGet as cats } from "./functions/api/categories.js";
import { SAMPLE_PUZZLES } from "./functions/_lib/sample-puzzles.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const rows = [];
let id = 0;
for (const p of SAMPLE_PUZZLES.daily) rows.push({ id: ++id, mode: "daily", daily_no: rows.length + 1, category: null, payload: JSON.stringify({ puzzle: p.puzzle }) });
for (const p of SAMPLE_PUZZLES.practice) rows.push({ id: ++id, mode: "practice", daily_no: null, category: p.category, payload: JSON.stringify({ puzzle: p.puzzle, category: p.category }) });
console.log(`Stub D1: ${rows.length} rows, practice ids ${rows.filter(r => r.mode === "practice").map(r => r.id).join(",")}\n`);

const env = { DB: { prepare(sql) {
  const binds = [];
  const api = {
    bind(...b) { binds.push(...b); return api; },
    async first() {
      let out = rows.filter(r => r.mode === (sql.includes("'daily'") ? "daily" : "practice"));
      if (sql.includes("daily_no = ?")) out = out.filter(r => r.daily_no === binds[0]);
      if (sql.includes("AND id = ?")) out = out.filter(r => r.id === binds[binds.length - 1]);
      if (sql.includes("category = ?")) out = out.filter(r => r.category === binds[0]);
      if (sql.includes("NOT IN")) { const ex = binds.slice(sql.includes("category = ?") ? 1 : 0); out = out.filter(r => !ex.includes(r.id)); }
      const r = out[Math.floor(Math.random() * out.length)];
      return r ? { id: r.id, payload: r.payload } : null;
    },
    async all() {
      const seen = [...new Set(rows.filter(r => r.mode === "practice" && r.category).map(r => r.category))];
      return { results: seen.map(category => ({ category })) };
    },
  };
  return api;
} } };

const req = (url, body) => new Request(url, body
  ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {});

for (let i = 0; i < 6; i++) {
  const r = await practice({ request: req("https://x/api/practice"), env });
  const b = await r.json();
  const idNum = Number(String(b.token).split(":")[1]);
  const rv = await reveal({ request: req("https://x", { token: b.token, entry: 0 }), env });
  t(`practice token ${b.token} resolves for reveal`, rv.status === 200, "status " + rv.status);
  t(`  token id ${idNum} is a real practice row id, not a 1..N counter`,
    rows.some(r2 => r2.id === idNum && r2.mode === "practice"));
}
const cb = await (await cats({ env })).json();
t("categories come from the table's category column", cb.categories.length >= 2, cb.categories.join(", "));
for (const c of cb.categories) {
  const b = await (await practice({ request: req("https://x/api/practice?category=" + encodeURIComponent(c)), env })).json();
  t(`category "${c}" filters to its own pool`, b.category === c, b.token);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
