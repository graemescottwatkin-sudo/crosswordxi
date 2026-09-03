/* The family, as the server understands it.
 *
 * WHY THIS FILE EXISTS. "One value living in two places and drifting apart" is
 * the fault this project keeps paying for: the entrant key computed in four
 * places, the help cost stated four ways, a palette declared twice, the build
 * tag known to three regexes that disagreed about letters. A second game is
 * exactly the moment a third copy of "what games are there" would appear — one
 * in migrate, one in results, one in whatever reads them next.
 *
 * So: the list of games, and the rule for what makes a row unique, live here
 * and nowhere else. Game three adds a line to GAMES and composes a key; it
 * does not touch the schema and it does not touch an endpoint.
 */

/* Released games only. An id here is a value that can reach the database, so
   an unreleased game must not appear — the same rule the hub and live_check
   already keep about naming unbuilt games. */
import { dailyKey, dailyDayKey } from "./daily.js";

export const GAMES = ["crossword", "wordsearch", "scrambled"];

export const DEFAULT_GAME = "crossword";

/* Anything not on the list is refused rather than coerced. A typo that becomes
   a silently-accepted game id is a row nobody will ever read again. */
export function validGame(v) {
  const g = String(v || DEFAULT_GAME).toLowerCase();
  return GAMES.indexOf(g) === -1 ? null : g;
}

/* BUILT, which is a different question from RELEASED.
   GAMES above is "whose rows the account system may write" — results, board
   state, entry keys — and an unreleased game must not be on it, because a row
   written for a game nobody can play is a row nobody will ever read.

   Reporting bad content is not that. A game can be PLAYABLE in the repo before
   it is launched — /scrambled/ and /quickfire/ both are — and the whole point
   of reporting is to hear about wrong content BEFORE anyone else sees it. A
   built game that cannot be reported is the one stage where reports are most
   useful and least available.

   Derived from GAMES rather than restated, so the released set is written
   once. A game leaves this list only by being deleted. */
export const BUILT = [...GAMES, "quickfire", "scrambled"];

export function validReportGame(v) {
  const g = String(v || DEFAULT_GAME).toLowerCase();
  return BUILT.indexOf(g) === -1 ? null : g;
}

/* THE ONE KEY. What makes a result unique for a player, per game.
 *
 *   crossword    daily:2            the daily number, as it always was
 *   wordsearch   ws:2026-08-27      the server's UTC day
 *
 * Returns null when the row carries nothing to be unique by — the caller skips
 * it rather than inserting a row that will be inserted again tomorrow. That is
 * why practice boards were never migrated: no key, no row.
 */
export function entryKey(game, row) {
  if (game === "crossword") {
    const n = Number(row && row.dailyNo);
    return Number.isFinite(n) && n > 0 ? dailyKey(Math.floor(n)) : null;
  }
  if (game === "wordsearch") {
    /* The day the board was the daily, not the day it was played: a board
       finished after midnight under the grace rule still belongs to its own
       day, and must not become a second row. */
    const d = String((row && (row.day || row.date)) || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? "ws:" + d : null;
  }
  if (game === "scrambled") {
    /* THE THIRD GAME HAD NO KEY, so every Scrambled result pushed to an
       account was skipped by migrate.js and the client believed it had
       pushed. A board is addressed by its number in the daily ring. */
    const n = Number(row && row.no);
    return Number.isFinite(n) && n > 0 ? "sc:" + Math.floor(n) : null;
  }
  return null;
}

/* THE DAY THE ROW BELONGS TO, for the shared `played_on` column.
 *
 * The crossword's browser record calls it `date`; the word search's calls it
 * `day`. migrate.js read only `date`, so every word search row landed with
 * played_on NULL — and results.js orders by that column, so an entire game's
 * history sorted as null. Read here, once, for the same reason the key is:
 * a field name that differs per game must be reconciled in one place or it is
 * reconciled in several and one of them is forgotten. It was.
 */
export function playedOn(game, row) {
  const d = String((row && (row.date || row.day)) || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  /* A numbered board carries no date of its own; its day is its number's,
     from the one epoch. Scrambled's ring counts by the same daily number. */
  if (game === "scrambled") return dailyDayKey(row && row.no);
  return null;
}

/* The fields a game keeps that the others have no column for. The shared
   columns — score, elapsed_seconds, played_on, solved — stay shared; this is
   everything else, and it goes to `detail` as JSON.

   Adding a column per game per fact is the duplication fault written into the
   schema, where it is far more expensive to undo than in a file. */
export function detailOf(game, row) {
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), 1e6) : 0;
  };
  if (game === "scrambled") {
    /* What a Scrambled result keeps beyond the shared columns: the help
       bought, the names revealed outright, and the board's title so a row
       reads as a board rather than a number. */
    return JSON.stringify({
      help: n(row.help),
      revealed: n(row.revealed),
      title: row.title == null ? null : String(row.title).slice(0, 80),
    });
  }
  if (game !== "wordsearch") return null;
  const pick = (a, b) => {
    const v = a === undefined || a === null ? b : a;
    return v === undefined || v === null ? null : String(v).slice(0, 40);
  };
  return JSON.stringify({
    foundCount: n(row.foundCount != null ? row.foundCount : row.found_count),
    bonusFound: !!(row.bonusFound != null ? row.bonusFound : row.bonus_found),
    minute: n(row.minute),
    /* Both spellings, like the fields above it. The browser writes snake_case
       and an earlier build of this file read only camelCase, which is how
       puzzleId arrived null on every row. */
    puzzleId: pick(row.puzzleId, row.puzzle_id),
    assisted: !!row.assisted,
  });
}
