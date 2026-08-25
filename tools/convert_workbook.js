#!/usr/bin/env node
/* tools/convert_workbook.js
 *
 * Turn a validated question workbook into rows in data.json shape.
 *
 *   node tools/convert_workbook.js --in Arsenal.xlsx --club Arsenal --out arsenal.json
 *   node tools/convert_workbook.js --in Arsenal.xlsx --club Arsenal --out arsenal.json --verified-only
 *
 * The workbook is the editorial record: sources, QA status, provenance, board
 * assignments. data.json is what the generator eats. They are deliberately
 * different shapes and this converts one to the other rather than merging them.
 *
 * Nothing is invented. Where a required field cannot be derived the row is
 * rejected and named, because a silently dropped clue is a board that quietly
 * comes up short weeks later.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i === -1 ? d : process.argv[i + 1];
};
const IN = arg("in", "");
const CLUB = arg("club", "");
const OUT = arg("out", "");
const PREFIX = arg("prefix", "");
const VERIFIED_ONLY = process.argv.includes("--verified-only");
const FULL_NAMES = process.argv.includes("--full-names");

if (!IN || !CLUB || !OUT) {
  console.error("\nnode tools/convert_workbook.js --in <xlsx> --club <name> --out <json>");
  console.error("  --verified-only   keep only rows verified first-hand (House Rule R3)");
  console.error("  --full-names      keep full names; default reduces people to surnames");
  console.error("  --prefix ARS      id prefix; defaults to the first three letters of --club\n");
  process.exit(1);
}
const ID_PREFIX = (PREFIX || CLUB.replace(/[^A-Za-z]/g, "").slice(0, 3)).toUpperCase();

/* ---- the club's own keywords, for deciding whether a clue names it ----
   A clue that never says "Arsenal" reads correctly under a board titled
   "Arsenal - Strikers" and is unanswerable on a mixed daily. Those are marked
   clubOnly so build_puzzles.js can hold them back. */
const CLUB_KEYS = {
  Arsenal: ["arsenal", "gunners", "highbury", "emirates"],
};
const keys = CLUB_KEYS[CLUB] || [CLUB.toLowerCase()];

/* ---- Question Type -> the Core category name ----
   cat carries the Core name verbatim so Core resolves from cat with no mapping
   layer to maintain. Primary Category is the workbook's editorial grouping and
   is deliberately not used for this: it files most player rows under "Player
   Identity / Who Am I", which is what the position boards exist to replace. */
const CAT = {
  "Manager": "Managers",
  "Goalkeeper": "Goalkeepers",
  "Defender": "Defenders",
  "Midfielder": "Midfielders",
  "Striker": "Strikers",
  "Captaincy": "Captains",
  "Domestic Cup": "Domestic Cup",
  "Ground / Stadium": "Grounds",
  "Rivalry": "Rivalries",
  "Wenger Era": "Wenger Era",
};

/* ---- era ----
   The engine knows Pre-1990, 1990s, 2000s, 2010s, 2020s, Modern and Timeless,
   and the daily draws only from 1990s-2020s plus Timeless. Anything older
   collapses to Pre-1990: it is a real era in the schema and keeps those rows
   available to themed boards while keeping them off the daily.
   A range takes its EARLIER decade — the era of when the thing started, which
   is what a clue about it is usually anchored to. */
function era(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const first = (s.match(/(\d{4})s/) || [])[1];
  if (!first) return /timeless/i.test(s) ? "Timeless" : null;
  const decade = Number(first);
  if (decade < 1990) return "Pre-1990";
  return decade + "s";
}

/* ---- answers ----
   House Rule R6: apostrophes are dropped, and the enumeration must match the
   stripped form. Accents are never transliterated - engine.js rejects a
   non-ASCII answer outright rather than converting it, so such a row is
   ineligible and is reported rather than mangled. */
function titleCase(s) {
  return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
function normalise(answer) {
  const display = titleCase(String(answer).replace(/['\u2019]/g, "").trim());
  const words = display.split(/\s+/).filter(Boolean);
  const grid = words.join("").toUpperCase();
  const breaks = [];
  let n = 0;
  words.forEach((w, i) => { n += w.length; if (i < words.length - 1) breaks.push(n); });
  const lens = words.map((w) => w.length);
  return { display, grid, breaks, enum: "(" + lens.join(",") + ")" };
}

/* ---- surnames ----
   The live bank answers on surnames - Wright, Henry, Van Persie - and the
   workbook arrived on full names. This is not cosmetic: full names average
   11.4 letters against 9.4, put 10% of rows past the 15-letter grid limit, and
   are hard to intersect. Measured on this workbook, full names generated 0 of 9
   shippable boards and surnames generated 4 of 8.

   Particles travel with the surname (VAN PERSIE, DE BRUYNE). Places, clubs and
   trophies are left alone - only people are reduced. A reduction that would
   make the clue self-answering is skipped and the full name kept. */
const PARTICLES = new Set(["VAN", "DE", "DER", "DEN", "DI", "DA", "DOS", "LA", "LE", "MC", "O"]);
/* Reduction is decided by what the ANSWER is, not by which board it sits on.
   Keying it on category left people on the Cups and Wenger Era boards at full
   length - CHARLIE NICHOLAS, PATRICK VIEIRA - because those categories are not
   named after a position. A place, club or trophy keeps every word. */
const NOT_A_PERSON = /\b(STADIUM|GROUND|GROVE|PARK|STAND|LANE|ROAD|STREET|ROVERS|UNITED|CITY|TOWN|COUNTY|ALBION|WANDERERS|HOTSPUR|VILLA|FOREST|COUNTY|ATHLETIC|ORIENT|PALACE|CUP|LEAGUE|TROPHY|SHIELD|FINAL|DOUBLE|INVINCIBLES)\b/;
function surname(display) {
  const w = display.split(" ");
  if (w.length < 2) return display;
  let i = w.length - 1;
  while (i > 0 && PARTICLES.has(w[i - 1].toUpperCase())) i--;
  return w.slice(i).join(" ");
}

/* ---- read ---- */
const wb = XLSX.readFile(IN);
const sheet = wb.Sheets["Question Bank"];
if (!sheet) { console.error(`No "Question Bank" sheet in ${IN}`); process.exit(1); }
const raw = XLSX.utils.sheet_to_json(sheet, { defval: null });

const VERIFIED = ["VERIFIED FIRST-HAND", "VERIFIED PLUS SUPPORTING SOURCE",
                  "VERIFIED VIA SUPPLIED SOURCE", "VERIFIED BY HUMAN CHECK"];

const out = [];
const rejected = [];
const reject = (r, why) => rejected.push({
  id: r["Master ID"], board: r["Suggested / Final Board"],
  answer: r["Answer"], why,
});

for (const r of raw) {
  if (!r["Clue"] || !r["Answer"]) continue;
  if (String(r["QA Status"]).toUpperCase() === "DROP") { reject(r, "QA Status DROP"); continue; }
  if (VERIFIED_ONLY && !VERIFIED.includes(String(r["Verification Provenance"]))) {
    reject(r, "not verified first-hand"); continue;
  }

  const cat = CAT[String(r["Question Type"])];
  if (!cat) { reject(r, `Question Type "${r["Question Type"]}" has no category mapping`); continue; }

  const e = era(r["Era"]);
  if (!e) { reject(r, `Era "${r["Era"]}" could not be resolved`); continue; }

  const clue = String(r["Clue"]).trim();
  let a = normalise(r["Answer"]);

  if (!FULL_NAMES && !NOT_A_PERSON.test(a.display.toUpperCase())) {
    const short = normalise(surname(a.display));
    const flat0 = clue.toUpperCase().replace(/[^A-Z]/g, "");
    if (short.grid !== a.grid && !flat0.includes(short.grid)) a = short;
  }

  if (/[^\x00-\x7F]/.test(a.display)) { reject(r, "answer is not ASCII - ineligible"); continue; }
  if (!/^[A-Z]+$/.test(a.grid)) { reject(r, `grid form "${a.grid}" is not A-Z only`); continue; }
  if (a.grid.length > 15) { reject(r, `${a.grid.length} letters - will not fit the grid`); continue; }

  /* A clue naming its own answer gives it away. The check strips spaces, so
     naming the player anywhere in the clue is caught. */
  const flat = clue.toUpperCase().replace(/[^A-Z]/g, "");
  if (flat.includes(a.grid)) { reject(r, "self-answering: the clue contains its answer"); continue; }

  /* The workbook's enumeration is editorial and R6 changed the rules under it.
     Recomputed from the answer and reported where it disagrees, rather than
     trusted - engine.js rejects the row outright if the two do not match. */
  const given = String(r["Enumeration"] || "").replace(/\s/g, "");
  const enumMismatch = given && given !== a.enum ? given : null;

  const hay = (clue + " " + a.display).toLowerCase();
  const namesClub = keys.some((k) => hay.includes(k));

  const row = {
    id: ID_PREFIX + String(r["Master ID"]).padStart(4, "0"),
    cat,
    clue,
    answer: a.display,
    grid: a.grid,
    enum: a.enum,
    breaks: a.breaks,
    entity: CLUB,
    diff: ["Easy", "Medium", "Hard"].includes(String(r["Difficulty"]))
      ? String(r["Difficulty"]) : "Medium",
    /* Person or place, the answer is its own puzzle group. Keyed on the club
       instead, only ONE row could be placed per puzzle and a Strikers board
       could never reach eleven - it would simply fail, with nothing to say
       why. */
    pgk: a.grid,
    maxPer: 1,
    group: "England",
    era: e,
    /* Source and provenance are their own fields, not joined into notes.

       They were a pipe-separated string, which meant anything wanting the URL
       had to split on "|" and trust the position — and a clue whose board name
       contained a pipe would have silently shifted every field along. They are
       carried into the board payload as-is, so a board keeps the evidence for
       its own clues wherever it ends up.

       Not sent to the browser with the puzzle: publicPuzzle allowlists what
       reaches it, and a source URL usually names the answer. They are served
       separately, once the player has earned them. */
    source: r["Source URL"] ? String(r["Source URL"]).trim() : null,
    prov: r["Verification Provenance"] ? String(r["Verification Provenance"]).trim() : null,
    notes: r["Suggested / Final Board"] ? String(r["Suggested / Final Board"]).trim() : null,
  };
  if (!namesClub) row.clubOnly = true;
  if (enumMismatch) row._enumWas = enumMismatch;
  out.push(row);
}

/* ---- duplicate answers ----
   Kept, not dropped: two clues to the same answer are fine across boards and
   pgk stops both landing on one. Reported because a board assignment holding
   two is a board that comes up short. */
const byGrid = {};
out.forEach((r) => { (byGrid[r.grid] = byGrid[r.grid] || []).push(r.id); });
const dupes = Object.entries(byGrid).filter(([, v]) => v.length > 1);

/* ---- board readiness, House Rule R3 ----
   The board is the unit, not the row: a board ships only when all eleven of
   its rows are verified first-hand. Reported per board so it is obvious which
   are shippable rather than which are nearly shippable. */
const boards = {};
for (const r of raw) {
  if (!r["Clue"] || String(r["QA Status"]).toUpperCase() === "DROP") continue;
  const b = String(r["Suggested / Final Board"] || "unassigned");
  boards[b] = boards[b] || { total: 0, verified: 0 };
  boards[b].total++;
  if (VERIFIED.includes(String(r["Verification Provenance"]))) boards[b].verified++;
}

const enumIssues = out.filter((r) => r._enumWas);
out.forEach((r) => { delete r._enumWas; });

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

console.log(`\nRead    ${raw.length} rows from ${path.basename(IN)}`);
console.log(`Wrote   ${out.length} rows to ${OUT}`);
console.log(`Rejected ${rejected.length}`);
if (rejected.length) {
  const why = {};
  rejected.forEach((x) => { why[x.why] = (why[x.why] || 0) + 1; });
  Object.entries(why).sort((a, b) => b[1] - a[1])
    .forEach(([w, n]) => console.log(`   ${String(n).padStart(4)}  ${w}`));
}
console.log(`\nclubOnly (club not named in the clue): ${out.filter((r) => r.clubOnly).length}`);
if (enumIssues.length) {
  console.log(`\nEnumeration recomputed on ${enumIssues.length} row(s) - R6 strips apostrophes:`);
  enumIssues.slice(0, 6).forEach((r) => console.log(`   ${r.id}  ${r.answer}  ${r.enum}`));
}
if (dupes.length) {
  console.log(`\nAnswers appearing more than once (${dupes.length}):`);
  dupes.slice(0, 8).forEach(([g, ids]) => console.log(`   ${g}  ${ids.join(", ")}`));
}

console.log(`\nBoard readiness - House Rule R3, all eleven verified first-hand:`);
const ready = [], part = [];
Object.entries(boards).sort().forEach(([b, s]) => {
  (s.total >= 11 && s.verified >= 11 ? ready : part).push(`${b}  ${s.verified}/${s.total} verified`);
});
console.log(`\n  SHIPPABLE (${ready.length}):`);
ready.forEach((b) => console.log(`    ${b}`));
console.log(`\n  NOT SHIPPABLE (${part.length}):`);
part.forEach((b) => console.log(`    ${b}`));
console.log("");
