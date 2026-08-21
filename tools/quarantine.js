#!/usr/bin/env node
/* tools/quarantine.js
 *
 * Move clues out of the working bank into a quarantine file, so the bank can be
 * rebuilt from a smaller, better set without losing anything.
 *
 *   node tools/quarantine.js --source ../crosswordxi-source --cat "Promoted Club → Season" --dry
 *   node tools/quarantine.js --source ../crosswordxi-source --cat "Promoted Club → Season,Relegated Club → Season"
 *   node tools/quarantine.js --source ../crosswordxi-source --ids TRL0055,V30291
 *   node tools/quarantine.js --source ../crosswordxi-source --restore --ids V30291
 *
 * INPUT   <source>/data.json           the working bank
 * OUTPUT  <source>/data.json           rewritten without the moved rows
 *         <source>/data-archive.json   appended with them
 *
 * Why a separate file rather than max_per = 0. Archiving keeps a row in the
 * bank and in every count, so "how many clues do I have" quietly answers with
 * material that will never be drawn. A separate file makes the working bank's
 * size honest, and re-adding is a merge when a clue earns it rather than a flag
 * nobody remembers to look at.
 *
 * Nothing already stored is affected. Themed boards, dailies and practice
 * puzzles embed the full clue row in their payload rather than referencing the
 * bank, so every board that exists — and every live challenge pointing at one —
 * keeps working with clues that are no longer here. The only thing that goes
 * stale is clue_ids reporting on old boards, which is a statistic rather than a
 * game.
 */
const fs = require("fs");
const path = require("path");

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i === -1 ? d : process.argv[i + 1];
};
const SOURCE = arg("source", path.join(__dirname, "..", "..", "crosswordxi-source"));
const DRY = process.argv.includes("--dry");
const RESTORE = process.argv.includes("--restore");

const BANK = path.join(SOURCE, "data.json");
const ARCHIVE = path.join(SOURCE, "data-archive.json");

if (!fs.existsSync(BANK)) {
  console.error(`\nCannot find ${BANK}`);
  console.error("Point --source at the folder holding data.json.\n");
  process.exit(1);
}

const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : []);
const bank = read(BANK);
const archive = read(ARCHIVE);

/* What to move. Categories match exactly — the arrow forms carry a real
   character, so "Promoted Club -> Season" will not match "Promoted Club →
   Season", and a silent zero-row run is the likeliest way to get this wrong. */
const cats = String(arg("cat", "")).split(",").map((s) => s.trim()).filter(Boolean);
const ids = String(arg("ids", "")).split(",").map((s) => s.trim()).filter(Boolean);
const idSet = new Set(ids);

if (!cats.length && !ids.length) {
  console.error("\nNothing named. Pass --cat and/or --ids.");
  console.error("  --cat \"Promoted Club → Season,Relegated Club → Season\"");
  console.error("  --ids TRL0055,V30291\n");
  process.exit(1);
}

const from = RESTORE ? archive : bank;
const matches = (r) => cats.includes(String(r.cat)) || idSet.has(String(r.id));
const moving = from.filter(matches);
const staying = from.filter((r) => !matches(r));

/* A category typed slightly wrong matches nothing and the run reports a
   cheerful zero. Say so loudly instead. */
if (!moving.length) {
  console.error(`\nNothing matched in ${RESTORE ? "data-archive.json" : "data.json"}.`);
  if (cats.length) {
    console.error("\nCategories asked for:");
    cats.forEach((c) => console.error(`  ${c}`));
    const have = [...new Set(from.map((r) => String(r.cat)))].sort();
    console.error("\nCategories actually present (first 20):");
    have.slice(0, 20).forEach((c) => console.error(`  ${c}`));
    console.error("\nThe arrow is → (U+2192), not ->.");
  }
  if (ids.length) console.error(`\nIds asked for: ${ids.join(", ")}`);
  console.error("");
  process.exit(1);
}

const byCat = {};
moving.forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + 1; });
console.log(`\n${RESTORE ? "Restoring to" : "Quarantining from"} the working bank:`);
Object.entries(byCat).sort((a, b) => b[1] - a[1])
  .forEach(([c, n]) => console.log(`  ${String(n).padStart(5)}  ${c}`));

const inCirculation = (rows) => rows.filter((r) => String(r.maxPer).trim() !== "0").length;
console.log(`\n  moving          ${moving.length} rows (${inCirculation(moving)} in circulation)`);

if (RESTORE) {
  console.log(`  bank            ${bank.length} -> ${bank.length + moving.length}`);
  console.log(`  archive         ${archive.length} -> ${staying.length}`);
} else {
  console.log(`  bank            ${bank.length} -> ${staying.length} (${inCirculation(staying)} in circulation)`);
  console.log(`  archive         ${archive.length} -> ${archive.length + moving.length}`);
}

if (DRY) {
  console.log(`\n--dry: nothing written. Drop --dry to do it.\n`);
  process.exit(0);
}

/* Ids must stay unique across both files, or a restore silently duplicates a
   row and the generator can place the same clue twice under two ids. */
const target = RESTORE ? bank : archive;
const clash = moving.filter((r) => target.some((t) => String(t.id) === String(r.id)));
if (clash.length) {
  console.error(`\n${clash.length} row(s) already exist in the destination:`);
  console.error("  " + clash.slice(0, 10).map((r) => r.id).join(", ") +
    (clash.length > 10 ? " ..." : ""));
  console.error("Refusing to write: duplicate ids would let one clue be placed twice.\n");
  process.exit(1);
}

/* Written beside the originals before either is replaced. The bank is the one
   thing here with no other copy. */
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.copyFileSync(BANK, path.join(SOURCE, `data.backup-${stamp}.json`));
if (fs.existsSync(ARCHIVE)) {
  fs.copyFileSync(ARCHIVE, path.join(SOURCE, `data-archive.backup-${stamp}.json`));
}

const write = (f, rows) => fs.writeFileSync(f, JSON.stringify(rows, null, 1) + "\n");
if (RESTORE) {
  write(BANK, bank.concat(moving));
  write(ARCHIVE, staying);
} else {
  write(BANK, staying);
  write(ARCHIVE, archive.concat(moving));
}

console.log(`\nWrote ${BANK}`);
console.log(`Wrote ${ARCHIVE}`);
console.log(`Backup: data.backup-${stamp}.json`);
console.log(`\nNothing on the site has changed. Rerun build_puzzles.js and`);
console.log(`build_themes.js and import them before any of this reaches a board.\n`);
