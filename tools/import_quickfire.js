#!/usr/bin/env node
/* tools/import_quickfire.js — turns the private question bank into SQL for D1.
 *
 *   node tools/import_quickfire.js --source ../quickfirexi-source
 *
 * OUTPUT data/qf-production.sql   gitignored: it contains every answer.
 *
 *   npx wrangler d1 execute crosswordxi --remote --file=data/qf-production.sql
 *
 * The same shape as import_clues.js and import_wordsearch.js, for the same
 * reason: the bank lives OUTSIDE this repository — not ignored, absent — and
 * reaches the database through wrangler rather than through a deploy. Nothing
 * about a question is edited on the live site.
 *
 * SOURCE ../quickfirexi-source/bank.json
 * {
 *   "questions": [
 *     { "id": 1, "answer": "Everton", "aliases": [],
 *       "clue": "Club nicknamed The Toffees", "source": "https://…",
 *       "answerType": "club", "difficulty": "easy" }
 *   ],
 *   "dailies": [ { "date": "2026-09-01", "questionIds": [ …11… ],
 *                  "benchIds": [ …3… ] } ],
 *   "weeks":   [ { "weekEnding": "2026-08-30", "label": "The Last 7 Days",
 *                  "questionIds": [ …11… ], "benchIds": [ …3… ],
 *                  "themes": [ …11… ] } ]
 * }
 *
 * VALIDATION IS NOT OPTIONAL. This writes nothing if a board would be unfair or
 * unplayable, because the alternative is finding out at 8am from a player. Every
 * rule below is one the export gate already held; they live here now because
 * here is where a bad board can still be stopped.
 */
import fs from "node:fs";
import path from "node:path";

const argIdx = process.argv.indexOf("--source");
const SRC = argIdx > -1 ? process.argv[argIdx + 1] : "../quickfirexi-source";
const OUT = path.join(process.cwd(), "data", "qf-production.sql");

const LOOKBACK_DAYS = 90;   // an answer must not reappear inside this window
const MAX_CHARS = 16;       // past this the answer row wraps on a phone
const PER_BOARD = 11;
const BENCH = 3;

const bankPath = path.join(SRC, "bank.json");
if (!fs.existsSync(bankPath)) {
  console.error(`\nNo bank at ${bankPath}\n` +
    `The source folder is deliberately not in this repository. Point --source at it.\n`);
  process.exit(1);
}
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
const questions = bank.questions || [];
const dailies = bank.dailies || [];
const weeks = bank.weeks || [];

/* ------------------------------------------------------------- helpers --- */

const q = (v) => (v === null || v === undefined || v === ""
  ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");

const norm = (s) => String(s ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/['’.]/g, "").replace(/[-–—]/g, " ")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

const typeable = (s) => String(s).replace(/[^\p{L}\p{N}]/gu, "").length;
const words = (s) => String(s).trim().split(/\s+/).length;

const byId = new Map(questions.map((x) => [x.id, x]));
const problems = [];
const fault = (m) => problems.push(m);

/* ------------------------------------------------------------ questions -- */

const seenIds = new Set();
for (const x of questions) {
  const at = `question ${x.id} (${x.answer || "no answer"})`;
  if (!Number.isInteger(x.id)) fault(`${at}: id must be a whole number`);
  if (seenIds.has(x.id)) fault(`${at}: duplicate id`);
  seenIds.add(x.id);
  if (!x.answer || !String(x.answer).trim()) fault(`${at}: no answer`);
  if (!x.clue || !String(x.clue).trim()) fault(`${at}: no clue`);
  /* Every claim traceable to a named source. The crossword's rule, and the
     reason its bank can be re-checked years later. */
  if (!x.source || !String(x.source).trim()) fault(`${at}: no source`);
  const chars = typeable(x.answer || "");
  if (chars < 4 || chars > MAX_CHARS) {
    fault(`${at}: ${chars} typeable characters, the board holds 4 to ${MAX_CHARS}`);
  }
  /* THE BOARD IS THE INPUT, so it fixes the character count. An alias of a
     different length can never be entered — it is not a lenient alternative,
     it is a dead row that makes the bank look more forgiving than it is. */
  for (const a of x.aliases || []) {
    if (typeable(a) !== chars) {
      fault(`${at}: alias "${a}" is a different length and can never be typed`);
    }
  }
  if (norm(x.clue || "").includes(norm(x.answer || ""))) {
    fault(`${at}: the clue contains its own answer`);
  }
}

/* --------------------------------------------------------------- boards -- */

function checkBoard(label, ids, benchIds, history) {
  const all = [...ids, ...benchIds].map((id) => byId.get(id));
  if (ids.length !== PER_BOARD) fault(`${label}: ${ids.length} questions, expected ${PER_BOARD}`);
  if (benchIds.length !== BENCH) fault(`${label}: ${benchIds.length} subs, expected ${BENCH}`);

  for (const [i, id] of [...ids, ...benchIds].entries()) {
    if (!byId.has(id)) fault(`${label}: slot ${i + 1} names unknown question ${id}`);
  }
  const present = all.filter(Boolean);

  const answers = present.map((x) => norm(x.answer));
  const seen = new Set();
  for (const a of answers) {
    if (seen.has(a)) fault(`${label}: the answer "${a}" appears twice on the board`);
    seen.add(a);
  }

  for (const x of present) {
    for (const other of present) {
      if (other.id === x.id) continue;
      if (norm(x.clue).includes(norm(other.answer))) {
        fault(`${label}: the clue for ${x.answer} names another answer on the board (${other.answer})`);
      }
    }
  }

  if (history) {
    for (const x of present.slice(0, PER_BOARD)) {
      const last = history.get(norm(x.answer));
      if (!last) continue;
      const gap = Math.round((Date.parse(label) - Date.parse(last)) / 86400000);
      if (gap > 0 && gap < LOOKBACK_DAYS) {
        fault(`${label}: ${x.answer} was used ${gap} days ago (${last}), inside the ${LOOKBACK_DAYS}-day lookback`);
      }
    }
  }
}

const history = new Map();
for (const d of [...dailies].sort((a, b) => (a.date < b.date ? -1 : 1))) {
  checkBoard(d.date, d.questionIds || [], d.benchIds || [], history);
  for (const id of d.questionIds || []) {
    const x = byId.get(id);
    if (x) history.set(norm(x.answer), d.date);
  }
}
for (const w of weeks) {
  checkBoard(w.weekEnding, w.questionIds || [], w.benchIds || [], null);
}

if (problems.length) {
  console.error(`\nNothing written. ${problems.length} problem(s):\n`);
  for (const p of problems) console.error("  - " + p);
  console.error("");
  process.exit(1);
}

/* ------------------------------------------------------------------ SQL -- */

const out = [
  "-- Generated by tools/import_quickfire.js. Contains answers: never commit.",
  "DELETE FROM qf_daily_slot;",
  "DELETE FROM qf_week_slot;",
  "DELETE FROM qf_daily;",
  "DELETE FROM qf_week;",
  "DELETE FROM qf_question;",
];

for (const x of questions) {
  const chars = typeable(x.answer);
  out.push("INSERT INTO qf_question (id, answer, answer_norm, answer_type, aliases, " +
    "clue, source, difficulty, char_count, word_count, status, origin, verified_at) VALUES (" +
    [x.id, q(x.answer), q(norm(x.answer)), q(x.answerType || "unknown"),
     q((x.aliases || []).join("|")), q(x.clue), q(x.source),
     q(x.difficulty || "medium"), chars, words(x.answer),
     "'verified'", q(x.origin || "authored"), "datetime('now')"].join(", ") + ");");
}

for (const d of dailies) {
  out.push(`INSERT INTO qf_daily (play_date, status) VALUES (${q(d.date)}, 'published');`);
  (d.questionIds || []).forEach((id, i) => {
    out.push("INSERT INTO qf_daily_slot (play_date, slot, question_id, role) VALUES (" +
      `${q(d.date)}, ${i + 1}, ${id}, 'xi');`);
  });
  (d.benchIds || []).forEach((id, i) => {
    out.push("INSERT INTO qf_daily_slot (play_date, slot, question_id, role) VALUES (" +
      `${q(d.date)}, ${i + 1}, ${id}, 'bench');`);
  });
}

for (const w of weeks) {
  out.push("INSERT INTO qf_week (week_ending, label, status) VALUES (" +
    `${q(w.weekEnding)}, ${q(w.label || "The Last 7 Days")}, 'published');`);
  (w.questionIds || []).forEach((id, i) => {
    out.push("INSERT INTO qf_week_slot (week_ending, slot, question_id, role, theme) VALUES (" +
      `${q(w.weekEnding)}, ${i + 1}, ${id}, 'xi', ${q((w.themes || [])[i])});`);
  });
  (w.benchIds || []).forEach((id, i) => {
    out.push("INSERT INTO qf_week_slot (week_ending, slot, question_id, role, theme) VALUES (" +
      `${q(w.weekEnding)}, ${i + 1}, ${id}, 'bench', NULL);`);
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join("\n") + "\n");

const distinct = new Set(questions.map((x) => norm(x.answer))).size;
console.log(`Wrote ${OUT}`);
console.log(`  ${questions.length} questions, ${distinct} distinct answers`);
console.log(`  ${dailies.length} boards, ${weeks.length} weekly rounds`);
console.log(`  ${Math.floor(distinct / PER_BOARD)} days before an answer must repeat ` +
  `(the ${LOOKBACK_DAYS}-day rule needs ${LOOKBACK_DAYS * PER_BOARD})`);
console.log(`\nImport with:\n  npx wrangler d1 execute crosswordxi --remote --file=data/qf-production.sql\n`);
