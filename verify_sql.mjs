/* verify_sql.mjs — load the generated SQL into a real database before sending it.
 *
 *   node verify_sql.mjs
 *
 * Catches what inspection does not: a value that looks fine in the text and is
 * rejected by SQLite. Requires node:sqlite (Node 22+).
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const files = ["data/clues-production.sql", "data/puzzles-production.sql"].filter(fs.existsSync);
if (!files.length) {
  console.log("No generated SQL present — run tools/import_clues.js and tools/build_puzzles.js first.");
  process.exit(0);
}

const db = new DatabaseSync(":memory:");
// node:sqlite rejects the partial-index syntax D1 accepts; the table shapes
// are what matter here.
const schema = fs.readFileSync("data/schema.sql", "utf8")
  .replace(/CREATE (UNIQUE )?INDEX[^;]*WHERE[^;]*;/g, "");
db.exec(schema);
t("the schema loads", true);

for (const f of files) {
  let ok = true, err = "";
  try { db.exec(fs.readFileSync(f, "utf8")); } catch (e) { ok = false; err = e.message; }
  t(`${f} loads into a database`, ok, err);
}

const one = (sql) => db.prepare(sql).get();
if (files.some((f) => f.includes("clues"))) {
  const n = one("SELECT COUNT(*) AS n FROM clues").n;
  t("every clue landed", n > 2000, n + " rows");
  t("no clue lost its answer", one("SELECT COUNT(*) AS n FROM clues WHERE answer IS NULL OR answer = ''").n === 0);
  t("difficulty survived as a label", /^(Easy|Medium|Hard)$/.test(one("SELECT difficulty AS d FROM clues LIMIT 1").d));
}
if (files.some((f) => f.includes("puzzles"))) {
  t("dailies are numbered from 1", one("SELECT MIN(daily_no) AS n FROM puzzles WHERE mode='daily'").n === 1);
  t("practice puzzles carry categories",
    one("SELECT COUNT(DISTINCT category) AS n FROM puzzles WHERE mode='practice' AND category IS NOT NULL").n >= 2);
  t("every payload is valid JSON with a puzzle in it", (() => {
    const rows = db.prepare("SELECT payload FROM puzzles").all();
    return rows.every((r) => { try { return !!JSON.parse(r.payload).puzzle; } catch (e) { return false; } });
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
