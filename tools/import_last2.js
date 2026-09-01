#!/usr/bin/env node
/* tools/import_last2.js — the last-two boards into SQL for D1.
 *
 *   node tools/import_last2.js [--source <dir>] [--max-age-days N]
 *   npx wrangler d1 execute crosswordxi --remote --file=data/sc-last2-production.sql
 *
 * OUTPUT data/sc-last2-production.sql   gitignored by data/*-production.sql
 *
 * THE SET IS REPLACED WHOLE. "Each club's last two league games" moves every
 * round, so the SQL deletes every row and writes the staged set — never a
 * merge, because a merge would leave one club on last month's games beside
 * another on this week's. The staged set is under <source>/last2/, copied
 * there wholesale from the research side's outbox/prem-last2/.
 *
 * IT TRANSPORTS, IT DOES NOT DERIVE. Every board is built by the builder's own
 * build(), so the rows carry the same scrambles, bands and enumerations the
 * bank's rows do. A second builder would eventually be a second board.
 *
 * WHAT IT REFUSES. A single board the gate refuses refuses the set: a set of
 * thirty-nine is not "each club's last two". Then the set's own claims: one
 * type, one id per board, exactly two boards per club, exactly two rounds.
 * And it says how old the newest board is, because a stale set is detectable
 * only if somebody looks — --max-age-days turns that look into a refusal.
 *
 * NOT RUN THROUGH verify_scrambled.mjs: these boards cite the league's own
 * fixture record, not a Wikipedia article, and that tool would skip every one
 * of them as "not machine-checkable". Accuracy is the research side's, checked
 * against the record the board names.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "sc-last2-production.sql");

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const SRC = path.join(arg("--source") || path.join(ROOT, "..", "scrambledxi-source"), "last2");
const MAX_AGE_DAYS = arg("--max-age-days") ? Number(arg("--max-age-days")) : null;

if (!fs.existsSync(SRC)) {
  console.error(`REFUSED: no last-two sources at ${SRC}`);
  console.error("Copy the research side's outbox/prem-last2/ there whole, replacing what was there.");
  process.exit(1);
}

const { gate, parseFormation, build } = await import(
  "file://" + path.join(ROOT, "tools", "build_scrambled.js").split(path.sep).join("/"));

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
if (!files.length) { console.error(`REFUSED: ${SRC} holds no boards.`); process.exit(1); }

const boards = [];
let refused = 0;
for (const f of files) {
  const src = JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));
  const problems = gate(src, parseFormation(src.formation)) || [];
  if (problems.length) {
    refused++;
    console.error(`REFUSED: ${f}\n  x ${problems.join("\n  x ")}`);
    continue;
  }
  const board = build(src, f);
  if (!board) { refused++; console.error(`REFUSED: ${f} did not build.`); continue; }
  boards.push(board);
}
if (refused) {
  console.error(`\n${refused} of ${files.length} refused. The set is replaced whole or not at all. Nothing written.`);
  process.exit(1);
}

/* ---- the set's own claims ------------------------------------------------ */
const fail = (msg) => { console.error(`REFUSED: ${msg}\nNothing written.`); process.exit(1); };
const notLast2 = boards.filter((b) => b.type !== "prem-last2");
if (notLast2.length) fail(`${notLast2.length} board(s) are not type "prem-last2" — this set is one type only`);
const ids = boards.map((b) => b.id);
if (new Set(ids).size !== ids.length) fail("duplicate board ids in the set");
const perClub = new Map();
for (const b of boards) perClub.set(b.club, (perClub.get(b.club) || 0) + 1);
const uneven = [...perClub.entries()].filter(([, n]) => n !== 2);
if (uneven.length) fail(`not two boards per club: ${uneven.map(([c, n]) => `${c} has ${n}`).join(", ")}`);
/* A club missing altogether is not "uneven" — it is simply not counted. The
   league has twenty, so the set has twenty; a set of eighteen is a set with
   two clubs' games left out, and it was one when Hull's two files were held
   back and nothing above noticed. */
const LEAGUE_CLUBS = 20;
if (perClub.size !== LEAGUE_CLUBS) {
  fail(`${perClub.size} clubs in the set — the league has ${LEAGUE_CLUBS}, and each must have its last two`);
}
const rounds = [...new Set(boards.map((b) => b.gameweek))].sort((a, b) => a - b);
if (rounds.length !== 2) fail(`the set spans ${rounds.length} round(s) (${rounds.join(", ")}) — "the last two games" is two`);
for (const b of boards) {
  if (!b.source) fail(`board ${b.id} has no source URL`);
  if (!b.title) fail(`board ${b.id} has no title`);
}

/* ---- freshness ----------------------------------------------------------- */
const latest = Math.max(...boards.map((b) => b.kickoffMillis));
const ageDays = (Date.now() - latest) / 86400000;
const when = new Date(latest).toUTCString();
console.log(`${boards.length} boards, ${perClub.size} clubs, gameweeks ${rounds.join(" and ")}, ` +
  `latest kickoff ${when} (${ageDays.toFixed(1)} days ago)`);
if (MAX_AGE_DAYS !== null && ageDays > MAX_AGE_DAYS) {
  fail(`the newest board is ${ageDays.toFixed(1)} days old, past --max-age-days ${MAX_AGE_DAYS}. ` +
    `Regenerate the set on the research side (/update-last2) and replace it whole.`);
}

/* ---- the SQL ------------------------------------------------------------- */
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const now = new Date().toISOString();
const lines = [
  "-- GENERATED by tools/import_last2.js — do not edit.",
  "-- Contains every name on every board. Gitignored.",
  "-- Apply migration 025-scrambled-last2.sql first.",
  `-- Set: gameweeks ${rounds.join("+")}, latest kickoff ${when}.`,
  "",
  "DELETE FROM sc_last2;",
  "",
];
for (const b of boards) {
  lines.push(
    "INSERT INTO sc_last2 (id, club, gameweek, kickoff_ms, title, payload, source, updated_at) VALUES (" +
    [b.id, q(b.club), b.gameweek, b.kickoffMillis, q(b.title), q(JSON.stringify(b)), q(b.source), q(now)].join(", ") + ");");
}
lines.push("");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n"));
const names = boards.reduce((n, b) => n + (b.slots || []).length, 0);
console.log(`${boards.length} board(s), ${names} names -> data/sc-last2-production.sql`);
console.log("\nApply with:\n  npx wrangler d1 execute crosswordxi --remote --file=data/migrations/025-scrambled-last2.sql");
console.log("  npx wrangler d1 execute crosswordxi --remote --file=data/sc-last2-production.sql\n");
