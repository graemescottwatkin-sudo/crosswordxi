#!/usr/bin/env node
/* tools/import_hilo.js — HiLo XI's boards and calendar into SQL for D1, and
 * the three-board sample the Worker falls back to.
 *
 *   node tools/import_hilo.js            gate, write data/hl-production.sql and the sample
 *   node tools/import_hilo.js --check    gate and compare the sample, write nothing
 *   node tools/import_hilo.js --source <dir>
 *
 * THE SOURCE lives outside this repository, like every bank: the research
 * side's folder, ../Other/HiLoXI from the repo root, holding boards/*.json,
 * boards-index.json and schedule.json. Nothing there is committed here except
 * the sample.
 *
 * WHAT THIS GATE SEES. Shape, not truth: twelve rows, numeric values, no two
 * neighbours equal, a source on every row, a calendar whose every day names a
 * daily board that exists. The research side's own gate and audit prove the
 * facts against their sources; a green run here is a well-formed bank, not a
 * correct one, and every board carries the URLs that back it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/* THE CLUB RULE IS THE SERVER'S, ASKED FOR RATHER THAN COPIED. This file
   kept its own CLUB_CATEGORY, identical to the one in hl-board.js on the
   day both were written and stale in both on the day the content side
   added three families. Two statements of "what is a club board" is the
   fault this project pays for most often, and here it would have buried
   220 boards. One place now: functions/_lib/hl-board.js. */
import { clubOf, isClubBoard } from "../functions/_lib/hl-board.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");
const SOURCE_ARG = (() => { const i = process.argv.indexOf("--source"); return i > -1 ? process.argv[i + 1] : null; })();
const SOURCE = SOURCE_ARG || path.join(ROOT, "..", "Other", "HiLoXI");
const OUT = path.join(ROOT, "data", "hl-production.sql");
const SAMPLE = path.join(ROOT, "functions", "_lib", "hl-sample.js");

const UNITS = ["year", "count", "pounds", "date"];
const VALUE_CLASSES = ["fixed-by-nature", "retired-only", "snapshot"];

/* ---- the gate, exported so board_test can sabotage it ---- */
export function gate(board) {
  const p = [];
  if (!board || typeof board !== "object") return ["not an object"];
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(board.id || ""))) p.push("no id, or an id that is not an id");
  if (!board.category || typeof board.category !== "string") p.push("no category");
  if (!board.subtitle || typeof board.subtitle !== "string") p.push("no subtitle — the line that says what the number is");
  if (!UNITS.includes(board.unit)) p.push(`unit must be one of ${UNITS.join(", ")}, not ${JSON.stringify(board.unit)}`);
  if (board.valueClass !== undefined && !VALUE_CLASSES.includes(board.valueClass)) p.push(`unknown valueClass ${JSON.stringify(board.valueClass)}`);
  if (board.direction != null) {
    const d = board.direction;
    if (typeof d !== "object" || typeof d.higher !== "string" || typeof d.lower !== "string" || !d.higher || !d.lower) {
      p.push("direction must be { higher, lower } with both faces named, or absent");
    }
  }
  const chain = Array.isArray(board.chain) ? board.chain : [];
  if (chain.length !== 12) p.push(`${chain.length} rows — a board is twelve items, eleven calls, and nothing else fits the ladder`);
  chain.forEach((r, i) => {
    const where = `row ${i + 1}`;
    if (!r || typeof r !== "object") { p.push(`${where}: not a row`); return; }
    if (!r.name || typeof r.name !== "string") p.push(`${where}: no name`);
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) p.push(`${where}: value must be a number`);
    if (board.unit === "date" && typeof r.value === "number" && !Number.isInteger(r.value)) p.push(`${where}: a date value is a whole count of days`);
    if (r.precision !== undefined && !["day", "month", "year"].includes(r.precision)) p.push(`${where}: unknown precision`);
    if (!r.source || typeof r.source !== "object" || !r.source.url || !r.source.quote) {
      p.push(`${where}: no source with a url and a quote — a value is a claim and must carry what backs it`);
    }
    if (i > 0 && chain[i - 1] && typeof chain[i - 1].value === "number" && r.value === chain[i - 1].value) {
      p.push(`${where}: equal to the row before it — a call with no answer`);
    }
  });
  return p;
}

export const isClub = isClubBoard;

function readJSON(f) { return JSON.parse(fs.readFileSync(f, "utf8")); }

function loadSource() {
  const idx = readJSON(path.join(SOURCE, "boards-index.json"));
  const list = idx.list || [];
  const boards = list.map((e) => readJSON(path.join(SOURCE, e.file)));
  const sched = readJSON(path.join(SOURCE, "schedule.json"));
  const schedule = {};
  for (const e of sched.schedule || []) schedule[e.date] = String(e.id);
  return { boards, schedule };
}

/* ---- the calendar's own rules ---- */
function gateSchedule(boards, schedule) {
  const p = [];
  const byId = new Map(boards.map((b) => [String(b.id), b]));
  const seenIds = new Set();
  for (const day of Object.keys(schedule)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) p.push(`calendar: ${day} is not a day`);
    const id = schedule[day];
    const b = byId.get(id);
    if (!b) { p.push(`calendar: ${day} names board ${id}, which is not in the bank`); continue; }
    if (isClub(b)) p.push(`calendar: ${day} names a club board (${b.category}) — club boards are never dailies`);
    if (seenIds.has(id)) p.push(`calendar: board ${id} is scheduled twice`);
    seenIds.add(id);
  }
  return p;
}

/* ---- the sample: three real boards that travel with the repository ---- */
function sampleOf(boards, schedule) {
  const days = Object.keys(schedule).sort();
  const picks = [];
  for (const d of days.slice(0, 2)) picks.push(boards.find((b) => String(b.id) === schedule[d]));
  const club = boards.find((b) => isClub(b));
  if (club) picks.push(club);
  const sampleSchedule = {};
  for (const d of days.slice(0, 2)) sampleSchedule[d] = schedule[d];
  return { boards: picks.filter(Boolean), schedule: sampleSchedule };
}

function sampleModule(sample) {
  return `/* hl-sample.js — GENERATED by tools/import_hilo.js. Do not edit.
 *
 * Three real boards and the two calendar days they stand on: what the Worker
 * falls back to with no database bound, and what the suites play. The bank
 * lives outside the repository; this is a sample of it, and small on purpose
 * so committing the bank by accident would show in a diff. */
export const HL_SAMPLE_BOARDS = ${JSON.stringify(sample.boards, null, 1)};
export const HL_SAMPLE_SCHEDULE = ${JSON.stringify(sample.schedule, null, 1)};
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

function main() {
  if (!fs.existsSync(path.join(SOURCE, "boards-index.json"))) {
    if (CHECK_ONLY && fs.existsSync(SAMPLE)) {
      /* No bank on this machine (CI, a fresh clone): gate the committed
         sample itself, so --check is never a silent pass. */
      import(`file://${SAMPLE.split(path.sep).join("/")}`).then((m) => {
        let refused = 0;
        for (const b of m.HL_SAMPLE_BOARDS) {
          const p = gate(b);
          if (p.length) { refused++; console.error(`REFUSED sample board ${b.id}: ${p[0]}`); }
        }
        const sp = gateSchedule(m.HL_SAMPLE_BOARDS, m.HL_SAMPLE_SCHEDULE);
        sp.forEach((x) => { refused++; console.error("REFUSED " + x); });
        console.log(`${m.HL_SAMPLE_BOARDS.length} sample board(s) gated, no bank on this machine`);
        process.exit(refused ? 1 : 0);
      });
      return;
    }
    console.error(`REFUSED: no board sources at ${SOURCE}. Pass --source <dir>.`);
    process.exit(1);
  }
  const { boards, schedule } = loadSource();
  let refused = 0;
  const ids = new Set();
  for (const b of boards) {
    const p = gate(b);
    if (ids.has(String(b.id))) p.push("duplicate id");
    ids.add(String(b.id));
    if (p.length) { refused++; console.error(`REFUSED board ${b.id} (${b.category}):\n  x ${p.join("\n  x ")}`); }
  }
  for (const x of gateSchedule(boards, schedule)) { refused++; console.error("REFUSED " + x); }
  const dailies = boards.filter((b) => !isClub(b)), clubs = boards.filter(isClub);
  const scheduled = new Set(Object.values(schedule));
  const unscheduled = dailies.filter((b) => !scheduled.has(String(b.id)));
  if (unscheduled.length) console.log(`note: ${unscheduled.length} daily board(s) are not on the calendar and will not be played until they are`);
  if (refused) { console.error(`\n${refused} refusal(s). Nothing written.`); process.exit(1); }

  const sample = sampleOf(boards, schedule);
  const moduleText = sampleModule(sample);
  if (CHECK_ONLY) {
    const have = fs.existsSync(SAMPLE) ? fs.readFileSync(SAMPLE, "utf8") : "";
    if (have !== moduleText) {
      console.error("REFUSED: functions/_lib/hl-sample.js is not what the sources produce. Run node tools/import_hilo.js");
      process.exit(1);
    }
    console.log(`${boards.length} boards gated (${dailies.length} daily, ${clubs.length} club), ${Object.keys(schedule).length} days; sample matches`);
    process.exit(0);
  }

  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const now = new Date().toISOString();
  const lines = [
    "-- GENERATED by tools/import_hilo.js — do not edit.",
    "-- Contains every value and every source on every board. Gitignored.",
    "-- Apply migration 027-hilo.sql first.",
    "",
    "DELETE FROM hl_board;",
    "DELETE FROM hl_schedule;",
    "",
  ];
  for (const b of boards) {
    const club = clubOf(b);
    const slug = club ? club.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : null;
    lines.push("INSERT INTO hl_board (id, kind, club, category, subtitle, payload, updated_at) VALUES (" +
      [q(b.id), q(club ? "club" : "daily"), slug ? q(slug) : "NULL", q(b.category), q(b.subtitle), q(JSON.stringify(b)), q(now)].join(", ") + ");");
  }
  for (const day of Object.keys(schedule).sort()) {
    lines.push(`INSERT INTO hl_schedule (day, board_id) VALUES (${q(day)}, ${q(schedule[day])});`);
  }
  lines.push("");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"));
  fs.writeFileSync(SAMPLE, moduleText);
  console.log(`${boards.length} boards (${dailies.length} daily, ${clubs.length} club), ${Object.keys(schedule).length} days -> data/hl-production.sql`);
  console.log(`sample: ${sample.boards.map((b) => b.id).join(", ")} -> functions/_lib/hl-sample.js`);
  console.log("\nApply with:\n  npx wrangler d1 execute crosswordxi --remote --file=data/migrations/027-hilo.sql");
  console.log("  npx wrangler d1 execute crosswordxi --remote --file=data/hl-production.sql\n");
}
