/* The bug from the screenshot: Check Grid flagged empty squares as wrong, and
   worse, shifted every letter after a gap. */
import { onRequestPost as check } from "./functions/api/check-answer.js";
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const puzzle = { entries: [{ row: { grid: "HULLCITY" } }], cells: {} };
"HULLCITY".split("").forEach((ch, i) => { puzzle.cells["0," + i] = { ch }; });
const env = { DB: { prepare() { return { bind() { return this; },
  async first() { return { id: 1, payload: JSON.stringify({ puzzle }) }; } }; } } };
const ask = (body) => check({ request: new Request("https://x", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
}), env }).then((r) => r.json());

const T = "practice:1";
t("a fully correct entry is correct",
  (await ask({ token: T, entry: 0, guess: "HULLCITY".split("") })).correct === true);

/* The failing case: first square blank, the rest right. */
const gap = await ask({ token: T, entry: 0, guess: [null, "U", "L", "L", "C", "I", "T", "Y"], detail: 1 });
t("a leading blank does not shift the letters after it",
  gap.wrong.length === 0, "wrong positions: [" + gap.wrong.join(",") + "]");
t("and the entry is simply not complete", gap.correct === false);

const mid = await ask({ token: T, entry: 0, guess: ["H", "U", null, "L", "C", null, "T", "Y"], detail: 1 });
t("two gaps mid-answer flag nothing wrong", mid.wrong.length === 0,
  "wrong positions: [" + mid.wrong.join(",") + "]");

const bad = await ask({ token: T, entry: 0, guess: ["H", "U", "L", "L", "X", "I", "T", "Y"], detail: 1 });
t("a genuinely wrong letter is still caught", bad.wrong.join() === "4", "[" + bad.wrong.join(",") + "]");

const g = await ask({ token: T, grid: [null, "U", "L", "L", "C", "I", "T", "Y"], detail: 1 });
t("the grid check counts no wrong cells for a blank", g.wrongCells === 0 && g.correct === false,
  g.wrongCells + " wrong");
const gAll = await ask({ token: T, grid: "HULLCITY".split(""), detail: 1 });
t("a complete correct grid reads as correct", gAll.correct === true && gAll.wrongCells === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
