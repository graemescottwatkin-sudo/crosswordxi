#!/usr/bin/env node
/* verify_boards.mjs — read D1 and check what is published there.
 *
 *   node tools/football/quickfire/verify_boards.mjs --days 14
 *   node tools/football/quickfire/verify_boards.mjs --days 14 --local
 *
 * READS ONLY. It writes nothing anywhere.
 *
 * This began as an exporter that wrote quickfire/data/board.json for the game
 * to load. That file is gone: the game reads /api/quickfire/daily, because the
 * family gate refuses a bank in any public file. What was worth keeping is the
 * checking, which now runs against what is actually in the database rather than
 * against a file on the way out.
 *
 * The same rules run in tools/import_quickfire.js, before anything reaches D1.
 * This is the second look — at what is live, on the day it is live, including
 * rows that arrived some other way.
 */

import { execFileSync } from 'node:child_process';

const DB = 'crosswordxi';
const LOOKBACK_DAYS = 90;      // an answer must not reappear inside this window
const MAX_CHARS = 16;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const DAYS = Number(value('--days', 14));
const LOCAL = flag('--local');

function query(sql) {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB,
    LOCAL ? '--local' : '--remote',
    '--json', '--command', sql,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

/* ------------------------------------------------------------------ reading */

function boards() {
  return query(`
    SELECT d.play_date, s.role, s.slot,
           q.id, q.answer, q.aliases, q.clue, q.answer_type,
           q.difficulty, q.char_count, q.status
    FROM qf_daily d
    JOIN qf_daily_slot s ON s.play_date = d.play_date
    JOIN qf_question   q ON q.id = s.question_id
    WHERE d.status IN ('ready', 'published')
      AND d.play_date >= date('now', '-1 day')
      AND d.play_date <  date('now', '+${DAYS} day')
    ORDER BY d.play_date, s.role DESC, s.slot
  `);
}

function weeks() {
  return query(`
    SELECT w.week_ending, w.label, s.role, s.slot, s.theme,
           q.id, q.answer, q.aliases, q.clue, q.answer_type, q.status
    FROM qf_week w
    JOIN qf_week_slot s ON s.week_ending = w.week_ending
    JOIN qf_question  q ON q.id = s.question_id
    WHERE w.status IN ('ready', 'published')
      AND w.week_ending >= date('now', '-14 day')
    ORDER BY w.week_ending DESC, s.role DESC, s.slot
  `);
}

function priorUse() {
  return query(`
    SELECT q.answer_norm, s.play_date
    FROM qf_daily_slot s
    JOIN qf_question q ON q.id = s.question_id
    WHERE s.play_date >= date('now', '-${LOOKBACK_DAYS} day')
  `);
}

/* -------------------------------------------------------------------- shape */

function group(rows, key) {
  const out = new Map();
  for (const row of rows) {
    if (!out.has(row[key])) out.set(row[key], { xi: [], bench: [] });
    out.get(row[key])[row.role === 'bench' ? 'bench' : 'xi'].push(row);
  }
  return out;
}

const normalise = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/['’.]/g, '').replace(/[-–—]/g, ' ')
  .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const typeable = (s) => String(s).replace(/[^\p{L}\p{N}]/gu, '').length;

/* --------------------------------------------------------------------- gate */

export function checkBoard(label, board, history) {
  const problems = [];
  const all = [...board.xi, ...board.bench];

  if (board.xi.length !== 11) problems.push(`${board.xi.length} questions, expected 11`);
  if (board.bench.length !== 3) problems.push(`${board.bench.length} subs, expected 3`);

  for (const q of all) {
    if (q.status !== 'verified') problems.push(`${q.answer} is ${q.status}, not verified`);
    if (typeable(q.answer) > MAX_CHARS) problems.push(`${q.answer} is too long to type`);
    if (!q.clue?.trim()) problems.push(`${q.answer} has no clue`);
  }

  const answers = all.map((q) => normalise(q.answer));
  const seen = new Set();
  for (const a of answers) {
    if (seen.has(a)) problems.push(`answer appears twice on the board: ${a}`);
    seen.add(a);
  }

  // No clue may name another answer on the same board.
  for (const q of all) {
    const clue = normalise(q.clue);
    for (const other of all) {
      if (other.id === q.id) continue;
      const answer = normalise(other.answer);
      if (answer && clue.includes(answer)) {
        problems.push(`clue for ${q.answer} names another answer on the board (${other.answer})`);
      }
    }
  }

  // Aliases that aren't the same length can never be typed on the board.
  for (const q of all) {
    for (const alias of String(q.aliases || '').split('|').filter(Boolean)) {
      if (typeable(alias) !== typeable(q.answer)) {
        problems.push(`alias "${alias}" for ${q.answer} is a different length and can never be entered`);
      }
    }
  }

  // Lookback.
  for (const q of board.xi) {
    const norm = normalise(q.answer);
    const last = history.get(norm);
    if (last && last !== label) {
      const gap = Math.round((Date.parse(label) - Date.parse(last)) / 86400000);
      if (gap > 0 && gap < LOOKBACK_DAYS) {
        problems.push(`${q.answer} was used ${gap} days ago (${last}), inside the ${LOOKBACK_DAYS}-day lookback`);
      }
    }
  }

  return problems;
}

/* --------------------------------------------------------------------- main */

/* Imported by tests/export_gate_test.mjs, which must be able to reach checkBoard
   without touching D1. Only run the export when this file is the entry point. */
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) verify();

function verify() {
const dailyRows = boards();
const weekRows = weeks();

if (!dailyRows.length) {
  console.error('No boards marked ready or published in the window. Nothing to export.');
  process.exit(1);
}

const history = new Map();
for (const row of priorUse()) {
  const prev = history.get(row.answer_norm);
  if (!prev || row.play_date > prev) history.set(row.answer_norm, row.play_date);
}

const dailies = group(dailyRows, 'play_date');
const weekly = group(weekRows, 'week_ending');

let failures = 0;
for (const [date, board] of dailies) {
  const problems = checkBoard(date, board, history);
  if (problems.length) {
    failures += problems.length;
    console.error(`\n${date}`);
    for (const p of problems) console.error(`  - ${p}`);
  }
}
for (const [wk, board] of weekly) {
  const problems = checkBoard(wk, board, new Map()).filter(
    (p) => !p.includes('lookback'));
  if (problems.length) {
    failures += problems.length;
    console.error(`\nweek ${wk}`);
    for (const p of problems) console.error(`  - ${p}`);
  }
}

if (failures) {
  console.error(`\n${failures} problem(s) in what is published.`);
  process.exit(1);
}

console.log(`Clean: ${dailies.size} boards, ${weekly.size} weeks. Read only, nothing written.`);
}
