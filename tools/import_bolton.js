#!/usr/bin/env node
/* tools/import_bolton.js — the validated Bolton set, as bank rows.
 *
 *   node tools/import_bolton.js --xlsx ../bolton.xlsx --out data/bolton.json
 *
 * The sheet arrives QA'd with sources against every row, so this does not
 * re-judge the football. What it does is put the rows into the shape the
 * generator needs and refuse the ones it cannot place:
 *
 *   - an answer longer than MAX_DIM (15) will never fit on a board
 *   - a clue naming another clue's answer cannot sit beside it, and the
 *     generator drops one of the pair silently — better to see it here
 *
 * Categories are derived rather than carried over. Every row in the sheet is
 * "Bolton Wanderers", and the generator caps how many clues of one family land
 * on a board — so a single category would mean two clues per board and no
 * eleventh. The families below are the existing taxonomy's, matched on what
 * the clue is actually asking.
 */
const fs = require("fs");
const path = require("path");

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i === -1 ? d : process.argv[i + 1];
};
const XLSX = arg("xlsx");
const OUT = arg("out", path.join(__dirname, "..", "data", "bolton.json"));
const MAX_DIM = 15;

if (!XLSX || !fs.existsSync(XLSX)) {
  console.error("Need --xlsx pointing at the validated sheet");
  process.exit(1);
}

/* The sheet is read by a small python helper rather than a node xlsx library:
   openpyxl is already present and adding a dependency to read one file once is
   a poor trade. */
const { execFileSync } = require("child_process");
const raw = JSON.parse(execFileSync("python3", ["-c", `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True)
rows = list(wb['Question Bank'].values)
hdr = rows[0]
print(json.dumps([dict(zip(hdr, r)) for r in rows[1:]], default=str))
`, XLSX], { maxBuffer: 32 * 1024 * 1024 }).toString());

const norm = (s) => String(s == null ? "" : s)
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const gridOf = (s) => norm(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const clueGrid = (s) => norm(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

/* Word breaks, so "BURNDEN PARK" renders as two words in the slots. */
function breaksOf(answer) {
  const out = [];
  let n = 0;
  for (const ch of norm(answer)) {
    if (/[A-Za-z0-9]/.test(ch)) n++;
    else if (n && out[out.length - 1] !== n) out.push(n);
  }
  return out;
}

const FAMILY = [
  [/stadium|ground|reebok|burnden|macron|toughsheet|university of bolton|terrace|stand\b/i,
   "Stadiums & Club History"],
  [/manager|in charge|boss|took over|appointed|caretaker/i, "Managers"],
  [/joined|signed|transfer|moved to|sold to|from which club/i, "Transfer → Club Joined"],
  [/scor|goal|hat-trick|winner|equalis|penalt/i, "Famous Goals & Moments"],
  [/cup|final|play-off|wembley|europe|uefa|promot|relegat|finish/i, "Records & Milestones"],
];
const familyFor = (clue) => {
  for (const [re, name] of FAMILY) if (re.test(clue)) return name;
  return "Player Identity / Who Am I";
};

const ERA = { "1950s": "Pre-1990", "1980s": "Pre-1990", "1990s": "1990s",
              "2000s": "2000s", "2010s": "2010s", "2020s": "2020s" };

const kept = [], dropped = [];
for (const r of raw) {
  const answer = String(r.Answer || "").trim();
  const clue = String(r.Clue || "").trim();
  const grid = gridOf(answer);
  if (!answer || !clue) { dropped.push([r.ID, answer, "blank row"]); continue; }
  if (grid.length > MAX_DIM) {
    dropped.push([r.ID, answer, `${grid.length} letters, over the ${MAX_DIM} the grid allows`]);
    continue;
  }
  if (clueGrid(clue).includes(grid)) {
    dropped.push([r.ID, answer, "self-answering — the answer is inside its own clue"]);
    continue;
  }
  kept.push({
    id: "BOL" + r.ID,
    cat: familyFor(clue),
    clue,
    answer: answer.length > 3 ? answer[0] + answer.slice(1).toLowerCase() : answer,
    grid,
    enum: String(r.Enumeration || "").trim(),
    breaks: breaksOf(answer),
    entity: "Bolton Wanderers",
    diff: String(r.Difficulty || "Medium"),
    pgk: "BOL" + r.ID,
    maxPer: 1,
    group: "England",
    era: ERA[String(r.Decade || "").trim()] || "Timeless",
    notes: String(r.Notes || "").trim(),
  });
}

/* Cross-naming: one clue naming another's answer. Reported, not dropped — the
   generator will simply never place the pair together, which costs nothing
   when the pool is bigger than one board. */
const clashes = [];
for (const a of kept) {
  for (const b of kept) {
    if (a === b) continue;
    if (clueGrid(a.clue).includes(b.grid)) clashes.push(`${a.id} names ${b.answer}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(kept, null, 1) + "\n");
console.log(`${kept.length} rows written to ${OUT}`);
if (dropped.length) {
  console.log(`\n${dropped.length} could not be used:`);
  dropped.forEach(([id, a, why]) => console.log(`  ${id}  ${a}  — ${why}`));
}
if (clashes.length) {
  console.log(`\n${clashes.length} cross-naming pairs (never placed together):`);
  clashes.forEach((c) => console.log("  " + c));
}
const fam = {};
kept.forEach((r) => { fam[r.cat] = (fam[r.cat] || 0) + 1; });
console.log("\nfamilies:", JSON.stringify(fam));
