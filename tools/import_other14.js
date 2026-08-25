#!/usr/bin/env node
/* tools/import_other14.js — The Other 14 set, as bank rows.
 *
 *   node tools/import_other14.js --json ../other14-boards.json --out data/other14.json
 *
 * The file arrives grouped into seven boards of eleven. Those groupings are
 * advisory and are not honoured: eleven chosen answers have to interlock in a
 * grid, and a hand-picked set almost never does. The clues become a pool and
 * the generator lays out the boards, as it did for the Bolton set.
 *
 * Two clues are dropped rather than converted. Both are correct football and
 * both name a Big Six club as the answer — Coventry beating Tottenham in 1987,
 * Hull facing Arsenal in 2014. On a board for the supporters who define
 * themselves as not-the-big-six, an answer of TOTTENHAM is the wrong word to
 * ask for. Same reasoning as striking a club's own name out of its club board.
 *
 * One row is corrected rather than dropped: 631 is typed as a nickname and
 * names a stadium. Type drives the per-board family cap, so a ground filed as a
 * nickname quietly lets four grounds onto one board.
 */
const fs = require("fs");
const path = require("path");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i === -1 ? d : process.argv[i + 1]; };
const SRC = arg("json");
const OUT = arg("out", path.join(__dirname, "..", "data", "other14.json"));
const MAX_DIM = 15;

if (!SRC || !fs.existsSync(SRC)) { console.error("Need --json"); process.exit(1); }
const src = JSON.parse(fs.readFileSync(SRC, "utf8"));

const norm = (s) => String(s == null ? "" : s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const gridOf = (s) => norm(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
function breaksOf(a) {
  const out = []; let n = 0;
  for (const ch of norm(a)) {
    if (/[A-Za-z0-9]/.test(ch)) n++;
    else if (n && out[out.length - 1] !== n) out.push(n);
  }
  return out;
}

/* Its own type vocabulary mapped onto the bank's categories, because the family
   cap counts categories: a board with four "ground" clues reads as one question
   asked four times whatever the file calls them. */
const CATEGORY = {
  ground: "Stadiums & Club History",
  nickname: "Nicknames & Identities",
  manager: "Managers",
  player: "Player Identity / Who Am I",
  "match/cup": "Famous Goals & Moments",
  rivalry: "Derbies & Rivalries",
};
const ERA = { "1970s": "Pre-1990", "1980s": "Pre-1990", "1990s": "1990s",
              "2000s": "2000s", "2010s": "2010s", "2020s": "2020s", Current: "Modern" };

/* Correct football, wrong word to ask a non-big-six supporter for. */
const DROP = new Set([642, 659]);
const RETYPE = { 631: "ground" };

const seen = new Set(), rows = [], dropped = [];
const all = [];
for (const sec of src.sections) for (const b of sec.boards) for (const c of b.clues) all.push(c);
for (const c of src.reserve) all.push(c);

for (const c of all) {
  if (seen.has(c.id)) continue;          // a clue may appear on more than one board
  seen.add(c.id);
  if (DROP.has(c.id)) { dropped.push([c.id, c.answer, "big six as the answer"]); continue; }
  const grid = gridOf(c.answer);
  if (grid.length > MAX_DIM) { dropped.push([c.id, c.answer, `${grid.length} letters`]); continue; }
  if (gridOf(c.clue).includes(grid)) { dropped.push([c.id, c.answer, "self-answering"]); continue; }
  const type = RETYPE[c.id] || c.type;
  rows.push({
    id: "O14" + c.id,
    cat: CATEGORY[type] || "Records & Milestones",
    clue: String(c.clue).trim(),
    answer: String(c.answer).trim().replace(/^(.)(.*)$/, (m, a, b) => a + b.toLowerCase()),
    grid,
    enum: String(c.enumeration || "").trim(),
    breaks: breaksOf(c.answer),
    entity: c.club || "The Other 14",
    diff: c.difficulty || "Medium",
    pgk: "O14" + c.id,
    maxPer: 1,
    group: "England",
    era: ERA[String(c.decade || "").trim()] || "Timeless",
    notes: "The Other 14 set",
  });
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 1) + "\n");
console.log(`${rows.length} rows written to ${OUT}`);
if (dropped.length) {
  console.log(`\n${dropped.length} not used:`);
  dropped.forEach(([id, a, why]) => console.log(`  ${id}  ${a}  — ${why}`));
}
const fam = {};
rows.forEach((r) => { fam[r.cat] = (fam[r.cat] || 0) + 1; });
console.log("\nfamilies:", JSON.stringify(fam));
