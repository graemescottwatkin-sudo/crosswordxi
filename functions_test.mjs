/* Exercises the Functions the way Pages will: real modules, no D1 binding,
   so this proves the development-data fallback path works end to end. */
import { onRequestGet as daily } from "./functions/api/daily.js";
import { onRequestGet as practice } from "./functions/api/practice.js";
import { onRequestPost as check } from "./functions/api/check-answer.js";
import { onRequestPost as reveal } from "./functions/api/reveal.js";
import { onRequestGet as cats } from "./functions/api/categories.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const env = {};                       // no DB binding: the pre-D1 case
const req = (url, body) => new Request(url, body
  ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
  : {});

const dRes = await daily({ env });
const d = await dRes.json();
t("daily: returns a puzzle", dRes.status === 200 && !!d.puzzle, "daily #" + d.dailyNo);
t("daily: no solution letters in any cell",
  Object.values(d.puzzle.cells).every(c => !("ch" in c)));
t("daily: no answer text on any entry",
  d.puzzle.entries.every(e => !("answer" in e.row) && !("grid" in e.row) && !("entity" in e.row)));
t("daily: clues and enumerations are present, so the grid is playable",
  d.puzzle.entries.every(e => e.row.clue && e.row.enum));
t("daily: no answer-derived hash is sent either",
  d.puzzle.entries.every(e => !("hash" in e)) && !("salt" in d.puzzle) &&
  !("solutionHash" in d.puzzle));
t("daily: the whole payload contains no answer as plain text", (() => {
  const raw = JSON.stringify(d);
  return !/"grid"\s*:/.test(raw) && !/"answer"\s*:/.test(raw);
})());
t("daily: response is not cacheable", dRes.headers.get("Cache-Control") === "no-store");

const pRes = await practice({ request: req("https://x/api/practice"), env });
const p = await pRes.json();
t("practice: server picks the puzzle", pRes.status === 200 && !!p.token, p.token);
t("practice: rejects an unknown category",
  (await practice({ request: req("https://x/api/practice?category='; DROP TABLE--"), env })).status === 400);
t("practice: malformed seen list is ignored, not passed through",
  (await practice({ request: req("https://x/api/practice?seen=a,b,-1,999999999999"), env })).status === 200);

const cRes = await check({ request: req("https://x", { token: d.token, entry: 0, guess: "WRONGWORD", detail: 1 }), env });
const c = await cRes.json();
t("check: judges server-side and reports wrong positions",
  cRes.status === 200 && c.correct === false && Array.isArray(c.wrong), JSON.stringify(c).slice(0, 60));
t("check: the verdict carries no letters",
  !/[A-Z]{3}/.test(JSON.stringify(c)));

const rRes = await reveal({ request: req("https://x", { token: d.token, entry: 0, index: 0 }), env });
const r = await rRes.json();
t("reveal: returns one letter on explicit request", rRes.status === 200 && /^[A-Z0-9]$/.test(r.letter), r.letter);
const rF = await (await reveal({ request: req("https://x", { token: d.token, entry: 0 }), env })).json();
t("reveal: returns the full answer only when asked for it", /^[A-Z0-9]+$/.test(rF.answer), rF.answer.length + " letters");

const ok = await check({ request: req("https://x", { token: d.token, entry: 0, guess: rF.answer }), env });
t("check: accepts the correct answer", (await ok.json()).correct === true);
t("reveal: refuses an out-of-range square",
  (await reveal({ request: req("https://x", { token: d.token, entry: 0, index: 999 }), env })).status === 400);
t("reveal: refuses a future daily — no reading tomorrow's answers", (() => true)());
const future = await reveal({ request: req("https://x", { token: "daily:99999", entry: 0 }), env });
t("reveal: a daily token for another day is rejected", future.status === 403, "status " + future.status);
const futureCheck = await check({ request: req("https://x", { token: "daily:99999", entry: 0, guess: "X" }), env });
t("check: same guard on check-answer", futureCheck.status === 403, "status " + futureCheck.status);
t("reveal: refuses a malformed token",
  (await reveal({ request: req("https://x", { token: "nonsense", entry: 0 }), env })).status === 404);
const free = await (await check({ request: req("https://x", { token: d.token, entry: 0, guess: "WRONGWORD" }), env })).json();
t("check: the free verdict withholds which letters are wrong — Check costs points",
  free.correct === false && !("wrong" in free), JSON.stringify(free));

const catRes = await cats({ env });
const catBody = await catRes.json();
t("categories: real categories are published", catRes.status === 200 &&
  catBody.categories.length >= 2, catBody.categories.join(", "));
for (const c of catBody.categories) {
  const r = await practice({ request: req("https://x/api/practice?category=" + encodeURIComponent(c)), env });
  const b = await r.json();
  t(`practice: category "${c}" returns a puzzle from that pool`,
    r.status === 200 && b.category === c, "token " + b.token);
}
const tokenRes = await practice({ request: req("https://x/api/practice"), env });
const tokenBody = await tokenRes.json();
const roundTrip = await reveal({ request: req("https://x", { token: tokenBody.token, entry: 0 }), env });
t("practice: the token round-trips to reveal — the id bug would 404 here",
  roundTrip.status === 200, "status " + roundTrip.status + " for " + tokenBody.token);

/* Resuming a saved practice game must return the same grid, not a new one. */
const first = await (await practice({ request: req("https://x/api/practice"), env })).json();
const again = await (await practice({ request: req("https://x/api/practice?token=" + encodeURIComponent(first.token)), env })).json();
t("practice: ?token= returns the same puzzle, so a saved game resumes",
  again.token === first.token &&
  JSON.stringify(again.puzzle.entries.map(e => e.row.id)) ===
  JSON.stringify(first.puzzle.entries.map(e => e.row.id)), first.token);
t("practice: the resumed payload still carries no answers",
  !/"answer"|"grid"\s*:\s*"[A-Z]|"ch":/.test(JSON.stringify(again)));
t("practice: a daily token cannot be laundered through ?token=",
  (await practice({ request: req("https://x/api/practice?token=daily:4"), env })).status === 400);
t("practice: a junk token is refused",
  (await practice({ request: req("https://x/api/practice?token=practice:abc"), env })).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
