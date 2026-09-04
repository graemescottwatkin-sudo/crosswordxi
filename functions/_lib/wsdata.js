/* Word Search data access — the one place the release rule lives.
 *
 * THE RULE: a board is released once its first scheduled day is today or
 * earlier. Unreleased boards are refused with a 404 that carries not one word
 * of the board — the refusal is the security property, same as the crossword's
 * answers pages. Everything else (daily, free play, catalog) is a lookup.
 *
 * THE DAY: the server decides what day it is, in UTC, exactly as
 * /api/daily does for the crossword. The browser never computes a date and
 * sends it up; it asks. Changing a device clock changes nothing.
 */
import { SAMPLE_PUZZLES, samplePuzzleForDay, sampleFirstDay } from "./ws-sample.js";
import { utcDay } from "./daily.js";

export function hasDB(env) { return !!(env && env.DB); }

/* The family's, not this game's: see utcDay in daily.js. Kept as a name this
   file already used so nothing that calls it has to change. */
export function utcDayKey(now) { return utcDay(now || Date.now()); }

function parsePayload(row) {
  const body = JSON.parse(row.payload);
  return {
    id: row.id, theme: row.theme, category: row.category,
    status: row.status, hash: row.hash, version: row.version,
    share_key: row.share_key,
    grid: body.grid, answers: body.answers, bonus: body.bonus,
  };
}

/* Today's board. Returns { day, puzzle } or null if the schedule has no row
   for today — which the client must treat as "no daily", not an error, so the
   day the schedule runs out degrades to Free Play rather than a broken page. */
export async function dailyBoard(env, now) {
  const day = utcDayKey(now);
  if (!hasDB(env)) return { day, puzzle: samplePuzzleForDay(day), sample: true };
  const row = await env.DB.prepare(
    `SELECT p.* FROM ws_schedule s JOIN ws_puzzles p ON p.id = s.puzzle_id
      WHERE s.day = ?`).bind(day).first();
  return { day, puzzle: row ? parsePayload(row) : null };
}

/* When a board first appears as a daily. Null means it is never scheduled,
   which counts as released — an unscheduled board has no date to protect. */
export async function firstScheduledDay(env, id) {
  if (!hasDB(env)) return sampleFirstDay(id);
  const row = await env.DB.prepare(
    `SELECT MIN(day) AS d FROM ws_schedule WHERE puzzle_id = ?`).bind(id).first();
  return row && row.d ? row.d : null;
}

/* The most recent day this board WAS the daily, on or before today, or null
   if it has never had one.
 *
 * Not firstScheduledDay. That one answers "may this be shown at all", where
 * the first appearance is the right question — a board is a secret until its
 * first day. This answers "how old is this to a player", and a board that ran
 * again last Tuesday is a week old however long ago it debuted. Asking the
 * first day for the age would lock a board that is currently in rotation.
 *
 * A board that has never been scheduled has no age. That is not a gap: the
 * free-play catalogue is a catalogue, not a set of back issues, and it is not
 * what the archive gate is about. */
export async function lastScheduledDay(env, id, now) {
  const today = utcDayKey(now);
  if (!hasDB(env)) {
    const first = sampleFirstDay(id);
    return first && first <= today ? first : null;
  }
  const row = await env.DB.prepare(
    `SELECT MAX(day) AS d FROM ws_schedule WHERE puzzle_id = ? AND day <= ?`)
    .bind(id, today).first();
  return row && row.d ? row.d : null;
}

export async function boardById(env, id) {
  if (!hasDB(env)) {
    return SAMPLE_PUZZLES.find((p) => p.id === id) || null;
  }
  const row = await env.DB.prepare(`SELECT * FROM ws_puzzles WHERE id = ?`)
    .bind(id).first();
  return row ? parsePayload(row) : null;
}

export async function released(env, id, now) {
  const first = await firstScheduledDay(env, id);
  if (first === null) return true;
  return first <= utcDayKey(now);
}

/* The Free Play index: identity only, no grids, no answers. 374 rows of
   theme/category is a few KB; 374 full boards is the 827KB page this
   architecture exists to retire. Unreleased boards are simply absent, so the
   browser cannot list what it must not open. */
export async function catalog(env, now) {
  const today = utcDayKey(now);
  if (!hasDB(env)) {
    const out = [];
    for (const p of SAMPLE_PUZZLES) {
      const first = sampleFirstDay(p.id);
      if (first === null || first <= today) {
        out.push({ id: p.id, theme: p.theme, category: p.category, status: p.status });
      }
    }
    return out;
  }
  const rows = await env.DB.prepare(
    `SELECT p.id, p.theme, p.category, p.status
       FROM ws_puzzles p
      WHERE COALESCE((SELECT MIN(day) FROM ws_schedule s WHERE s.puzzle_id = p.id), '0000') <= ?
      ORDER BY p.id`).bind(today).all();
  return rows.results || [];
}

/* Previous days: every day the schedule has already played, newest first,
   with the board that stood that day. STRICTLY BEFORE TODAY — today is the
   hero on the landing, and tomorrow is the one secret this game has. A day
   that has gone is released by the rule above (its first day is behind us),
   so this list can never name a board the catalog would not. Identity only:
   no grid, no names, no bonus. */
export async function archive(env, now) {
  const today = utcDayKey(now);
  if (!hasDB(env)) {
    /* One day back only. The sample schedule is a rolling fiction, and two
       days back it lands on the board the sample holds as unreleased. */
    const day = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    const p = samplePuzzleForDay(day);
    return [{ day, id: p.id, theme: p.theme, category: p.category }];
  }
  const rows = await env.DB.prepare(
    `SELECT s.day AS day, p.id AS id, p.theme AS theme, p.category AS category
       FROM ws_schedule s JOIN ws_puzzles p ON p.id = s.puzzle_id
      WHERE s.day < ?
      ORDER BY s.day DESC`).bind(today).all();
  return rows.results || [];
}
