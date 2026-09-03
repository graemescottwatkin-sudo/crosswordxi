/* functions/_lib/daily.js — which day it is, decided in one place.
   Daily #1 is 26 August 2026 — the day of the thexigames.com move and the
   epoch reset. This is one of TWO places the launch date is
   written; the other is DAILY_EPOCH in js/engine.js, which stores the day
   *before* #1 in local-time components. Change one without the other and the
   browser asks for a puzzle the server will not accept reveals for, so every
   check and reveal returns 403. epoch_test.mjs checks they agree. */
const EPOCH = Date.UTC(2026, 7, 26);   // 2026-08-26 = Puzzle #1

export function dailyNumber(now = Date.now()) {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(1, Math.round((midnight - EPOCH) / 86400000) + 1);
}

/* WHAT DAY IT IS, in UTC, as YYYY-MM-DD. The server decides the day for
   every game in the family, and this is where it decides it. Two games
   already had this function under two names — utcDayKey in wsdata.js and
   todayKey in hl-board.js, identical to the character — and a third copy for
   the permalinks would have made three. Both now call this one. */
export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/* The day a board number stands for, as YYYY-MM-DD: the inverse of
   dailyNumber, from the same epoch, so a numbered result (the crossword's,
   Scrambled's) can carry the shared played_on column without a second
   statement of when day one was. */
export function dailyDayKey(no) {
  const n = Number(no);
  if (!Number.isFinite(n) || n < 1) return null;
  return new Date(EPOCH + (Math.floor(n) - 1) * 86400000).toISOString().slice(0, 10);
}

/* A token names a stored puzzle, and check-answer and reveal will read answers
   out of it. For daily puzzles that has to be pinned to today: the puzzles
   table holds a year of pre-generated dailies, so without this guard a player
   could POST { token: "daily:<tomorrow>" } and read tomorrow's answers straight
   out of the API — the same leak as putting future answers in the source, just
   through a different door. */
/* Any daily up to today, never one after it.

   It was `asked === dailyNumber()` — today alone. That made every past board
   unreachable forever: nobody could catch up a missed day, and somebody
   arriving in November had no way to build a season, because a season is
   thirty-eight played boards and only one exists per day.

   The half that matters is unchanged. A number ABOVE today is still refused, so
   tomorrow cannot be read early however the clock is set, and the day is still
   decided by the server. Opening the past gives nothing away; opening the
   future gives away everything. */
export function playableDailyNo(token) {
  const m = /^daily:(\d+)$/.exec(String(token || ""));
  if (!m) return null;
  const asked = Number(m[1]);
  if (asked < 1) return false;
  return asked <= dailyNumber() ? asked : false;
}

/* When a board's answers may be published.

   The archive is replayable, which Wordle's is not — so where Wordle can let
   yesterday's answer circulate at no cost, publishing ours spoils a board
   someone could still play. The trade taken here: boards stay sealed for a
   week, then their answers become an indexable page. The fresh archive — the
   boards people compete on, share and challenge each other with — stays
   clean; the older ones become the pages a searcher can find.

   ONE rule, used by the answers pages and asserted by their tests. Anything
   else that ever needs to know (a sitemap, an archive badge) reads this,
   never its own copy of the arithmetic. */
export const ANSWERS_AFTER_DAYS = 7;

/* The daily entry key, COMPOSED next to the parser that reads it. External
   review counted "daily:" + n built in six independent places — client,
   suite, server normaliser, two admin sites — the entrant-key fault in its
   original costume. Server-side callers ask here; the browser's game.js is a
   plain script that cannot import this module, so its one copy in keyOf()
   carries a comment pointing here instead. */
export const dailyKey = (n) => "daily:" + n;

export function answersAvailable(no, today) {
  const t = today || dailyNumber();
  return Number.isInteger(no) && no >= 1 && t - no > ANSWERS_AFTER_DAYS;
}
