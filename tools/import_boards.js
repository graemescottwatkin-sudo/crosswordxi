#!/usr/bin/env node
/* tools/import_boards.js
 *
 * Turn a curated board manifest into additive SQL.
 *
 *   node tools/import_boards.js --manifest arsenal-boards.json --bank arsenal.json --dry
 *   node tools/import_boards.js --manifest arsenal-boards.json --bank arsenal.json --renumber
 *
 * OUTPUT  data/themes-production.sql   gitignored, holds answers, never committed
 *         data/themes-plan.json        the answer lists, to read before importing
 *
 * Why this exists rather than build_themes.js doing it. build_themes.js picks
 * its own elevens from a pool. The board builder has done editorial work a
 * regenerating tool would throw away: resolving cross-naming, checking every
 * row against a source, deciding which clues sit together. This takes that
 * work as given and only proves it still builds.
 *
 * ADDITIVE ONLY. There is no DELETE anywhere in the output.
 *
 * challenges stores (theme_id, board_no) rather than a board row id, and
 * challenge_entries admits a result by matching play.theme_key against
 * theme_id + "-" + board_no. Deleting and recreating a board therefore does
 * not break a live challenge — it silently repoints it at a different puzzle,
 * with no error, no 404, and old scores sitting on the same standings table as
 * new ones set on a different board. Delete-and-recreate was only ever safe
 * while nothing outside the table pointed at a board. Since the challenge
 * links went out, something does, permanently.
 */
const fs = require("fs");
const path = require("path");

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i === -1 ? d : process.argv[i + 1];
};
const MANIFEST = arg("manifest", "");
const BANK = arg("bank", "");
const ENGINE = arg("engine", path.join(__dirname, "..", "js", "engine.js"));
const LAUNCH = arg("release-from", "");
const DRY = process.argv.includes("--dry");
const RENUMBER = process.argv.includes("--renumber");
const START_AT = parseInt(arg("start-board", "0"), 10) || 0;
const INCLUDE_UNREADY = process.argv.includes("--include-unready");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "themes-production.sql");

/* Generated SQL lands in <tools>\..\data, so running the tools where they were
   unpacked puts the output beside them. Created here rather than expected to
   exist: a missing folder is an ENOENT halfway through a run that otherwise
   worked, which reads as a real failure and is not one. */
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

const PLAN = path.join(ROOT, "data", "themes-plan.json");

if (!MANIFEST || !BANK) {
  console.error("\nnode tools/import_boards.js --manifest <boards.json> --bank <club.json>");
  console.error("  --dry               report only, write nothing");
  console.error("  --renumber          close gaps in board numbering within each theme");
  console.error("  --start-board N     first board number; use for a later batch into an");
  console.error("                      existing theme, so numbers do not collide");
  console.error("  --include-unready   include boards marked ready:false (House Rule R3)");
  console.error("  --release-from      first Friday; defaults to the next one");
  console.error("  --engine            defaults to ../js/engine.js\n");
  process.exit(1);
}

/* One engine, the one the site runs. A second copy beside the clue bank would
   hold its own scoring constants, family caps and epoch, and boards would be
   generated under one set of rules and scored under another with nothing
   reporting it. */
if (!fs.existsSync(ENGINE)) {
  console.error(`\nCannot find engine.js at ${ENGINE}`);
  console.error("Pass --engine, pointing at the repo's js/engine.js.\n");
  process.exit(1);
}
const FCW = require(path.resolve(ENGINE));

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const bank = JSON.parse(fs.readFileSync(BANK, "utf8"));
const byId = {};
bank.forEach((r) => { byId[String(r.id)] = r; });

/* ---- validate the bank before trusting a single board ---- */
const bankErrors = FCW.validateDataset(bank);
if (bankErrors.length) {
  console.error(`\n${bankErrors.length} validation error(s) in ${path.basename(BANK)}:`);
  bankErrors.slice(0, 10).forEach((e) => console.error("   " + JSON.stringify(e).slice(0, 160)));
  console.error("\nRefusing to build boards from a bank that does not validate.\n");
  process.exit(1);
}

/* ---- check every board actually builds ----
   The manifest asserts eleven clue ids make a board. That is regenerated here
   rather than believed: a board that cannot be laid out under the current
   engine must not reach the database, where it would 500 on open. */
const built = [];
const failed = [];
for (const e of manifest) {
  if (!e.ready && !INCLUDE_UNREADY) { failed.push({ e, why: "ready:false (R3)" }); continue; }

  const missing = (e.clueIds || []).filter((i) => !byId[i]);
  if (missing.length) { failed.push({ e, why: `${missing.length} clue id(s) not in the bank` }); continue; }
  if (new Set(e.clueIds).size !== e.clueIds.length) { failed.push({ e, why: "duplicate clue ids" }); continue; }

  /* A theme id ending in digits is unparseable. boardOf() uses /^(.*)-(\d+)$/
     and the client uses /[?&]t=([a-z0-9-]+)-(\d+)/, both greedy — so
     "arsenal-strikers-2" reads as theme "arsenal-strikers", board 2, and a
     theme genuinely named that would collide with its own board numbers. */
  if (/-\d+$/.test(e.themeId)) {
    failed.push({ e, why: "themeId ends in digits; the share-link parser would misread it" });
    continue;
  }
  if (!["core", "special", "general"].includes(e.family)) {
    failed.push({ e, why: `family "${e.family}" is not core, special or general` });
    continue;
  }

  const set = e.clueIds.map((i) => byId[i]);
  let puzzle = null;
  if (e.seed) {
    const p = FCW.generate(set, { seed: e.seed, maxPerFamily: { "*": 11 } });
    if (p && p.entries.length === 11) puzzle = p;
  }
  for (let s = 0; s < 80 && !puzzle; s++) {
    const p = FCW.generate(set, { seed: 500 + s * 7919, maxPerFamily: { "*": 11 } });
    if (p && p.entries.length === 11) puzzle = p;
  }
  if (!puzzle) { failed.push({ e, why: "will not place eleven answers" }); continue; }

  built.push({ e, puzzle, set });
}

/* ---- board numbering ----
   Gaps are harmless to the database, where (theme_id, board_no) only has to be
   unique, but read oddly when "In the Cups #3" is the only one on the shelf.
   Renumbering is offered here and nowhere else: once a board is imported its
   number is pinned by any challenge referencing it, and renumbering after the
   fact is the operation that silently repoints them. */
const byTheme = {};
built.forEach((b) => { (byTheme[b.e.themeId] = byTheme[b.e.themeId] || []).push(b); });
const renumbered = [];
Object.values(byTheme).forEach((list) => {
  list.sort((a, b) => a.e.boardNo - b.e.boardNo);
  list.forEach((b, i) => {
    const want = i + 1 + (START_AT ? START_AT - 1 : 0);
    if (RENUMBER && b.e.boardNo !== want) {
      renumbered.push(`${b.e.themeId} #${b.e.boardNo} -> #${want}`);
      b.no = want;
    } else {
      b.no = b.e.boardNo;
    }
  });
});

/* ---- release dates ----
   One board a Friday, matching the existing cadence. */
const addDays = (d, n) => { const c = new Date(d.getTime()); c.setUTCDate(c.getUTCDate() + n); return c; };
const nextFriday = (d) => addDays(d, ((5 - d.getUTCDay() + 7) % 7) || 7);
const iso = (d) => d.toISOString().slice(0, 10);
const launch = LAUNCH ? new Date(LAUNCH + "T00:00:00Z") : new Date();
let friday = nextFriday(launch);
const dates = built.map(() => { const d = iso(friday); friday = addDays(friday, 7); return d; });

/* ---- SQL ---- */
const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const out = [
  "-- Generated by tools/import_boards.js. Do not edit by hand.",
  "-- Contains answers: never commit this file.",
  "-- ADDITIVE ONLY. No DELETE: live challenges reference (theme_id, board_no),",
  "-- so removing and recreating a board silently repoints them.",
  "",
];

const themes = {};
built.forEach((b) => { themes[b.e.themeId] = b.e; });
for (const [id, e] of Object.entries(themes)) {
  /* OR IGNORE so a re-run does not fail on a theme that already exists. It
     also means a re-run changes nothing, which is reported below rather than
     left to look like success. */
  out.push(`INSERT OR IGNORE INTO themes (id, name, kind, club_id, family) VALUES (` +
    `${sqlStr(id)}, ${sqlStr(e.displayName)}, 'club', ${sqlStr(e.club)}, ${sqlStr(e.family)});`);
}
out.push("");

const plan = [];
built.forEach((b, i) => {
  const payload = JSON.stringify({ puzzle: b.puzzle });
  const clueIds = b.puzzle.entries.map((x) => x.row.id);
  /* Plain INSERT, deliberately, where themes above uses OR IGNORE.
     A theme that already exists is the same row and skipping it is right. A
     board that already exists at this (theme_id, board_no) is NOT the same
     row — it is a different puzzle occupying the slot, and OR IGNORE would
     drop this one in silence while the import reported success. The UNIQUE
     constraint failing is the correct outcome: it says which slot is taken,
     and the fix is to renumber this batch, not to overwrite what is there. */
  out.push(`INSERT INTO theme_boards (theme_id, board_no, release_on, payload, clue_ids, listed) VALUES (` +
    `${sqlStr(b.e.themeId)}, ${b.no}, ${sqlStr(dates[i])}, ${sqlStr(payload)}, ` +
    `${sqlStr(JSON.stringify(clueIds))}, 1);`);
  plan.push({
    theme: b.e.themeId, name: b.e.displayName, family: b.e.family, no: b.no,
    release: dates[i], size: b.puzzle.stats.width + "x" + b.puzzle.stats.height,
    answers: b.puzzle.entries.map((x) => x.row.answer),
  });
});

/* ---- report ---- */
console.log(`\nManifest  ${manifest.length} boards`);
console.log(`Bank      ${bank.length} rows, validates clean`);
console.log(`Building  ${built.length}`);
if (failed.length) {
  console.log(`\nNot built (${failed.length}):`);
  failed.forEach((f) => console.log(`   ${f.e.themeId} #${f.e.boardNo}  ${f.why}`));
}
if (renumbered.length) {
  console.log(`\nRenumbered:`);
  renumbered.forEach((r) => console.log(`   ${r}`));
} else if (!RENUMBER) {
  const gaps = [];
  Object.entries(byTheme).forEach(([t, l]) => {
    l.forEach((b, i) => { if (b.no !== i + 1) gaps.push(`${t} #${b.no} (would be #${i + 1})`); });
  });
  if (gaps.length) {
    console.log(`\nGaps in board numbering — pass --renumber to close them:`);
    gaps.forEach((g) => console.log(`   ${g}`));
    console.log(`   Cheap now. After import a board number is pinned by any challenge`);
    console.log(`   referencing it, and renumbering then repoints them silently.`);
  }
}
console.log(`\nReleases  ${dates[0]} to ${dates[dates.length - 1]}, one a Friday`);

/* This tool writes SQL offline and cannot see the database, so it cannot know
   which board numbers are already taken. Renumbering makes that worse rather
   than better: closing a gap fills the slot a later batch expects. Said out
   loud because a UNIQUE failure at import time is recoverable and a silently
   missing board is not. */
if (RENUMBER) {
  console.log(`\n--renumber assigns numbers from ${START_AT || 1} within this batch.`);
  console.log(`This tool cannot see the database. If any of these themes already`);
  console.log(`have boards, pass --start-board with the next free number, or the`);
  console.log(`import will fail on a UNIQUE constraint naming the taken slot.`);
  console.log(`Check first:`);
  console.log(`  npx wrangler d1 execute crosswordxi --remote --command \\`);
  console.log(`    "SELECT theme_id, MAX(board_no) FROM theme_boards GROUP BY theme_id"`);
}

if (DRY) { console.log(`\n--dry: nothing written.\n`); process.exit(0); }

fs.writeFileSync(OUT, out.join("\n") + "\n");
fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1) + "\n");
console.log(`\nWrote ${OUT}`);
console.log(`Wrote ${PLAN}`);
console.log(`\nRead themes-plan.json before importing — it holds every answer,`);
console.log(`board by board. A bad board is cheaper to catch here than on the site.`);
console.log(`\n  npx wrangler d1 execute crosswordxi --remote --file=data/themes-production.sql`);
console.log(`\nBoards use a plain INSERT: if a (theme_id, board_no) is already taken`);
console.log(`the import fails and names the slot, rather than dropping the board in`);
console.log(`silence. Re-run with --start-board at the next free number.`);
console.log(`Check the themed board count on the status panel afterwards.\n`);
