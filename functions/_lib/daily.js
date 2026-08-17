/* functions/_lib/daily.js — which day it is, decided in one place.
   Daily #1 is 16 August 2026. This is one of TWO places the launch date is
   written; the other is DAILY_EPOCH in js/engine.js, which stores the day
   *before* #1 in local-time components. Change one without the other and the
   browser asks for a puzzle the server will not accept reveals for, so every
   check and reveal returns 403. epoch_test.mjs checks they agree. */
const EPOCH = Date.UTC(2026, 7, 16);

export function dailyNumber(now = Date.now()) {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(1, Math.round((midnight - EPOCH) / 86400000) + 1);
}

/* A token names a stored puzzle, and check-answer and reveal will read answers
   out of it. For daily puzzles that has to be pinned to today: the puzzles
   table holds a year of pre-generated dailies, so without this guard a player
   could POST { token: "daily:<tomorrow>" } and read tomorrow's answers straight
   out of the API — the same leak as putting future answers in the source, just
   through a different door. */
export function playableDailyNo(token) {
  const m = /^daily:(\d+)$/.exec(String(token || ""));
  if (!m) return null;
  const asked = Number(m[1]);
  return asked === dailyNumber() ? asked : false;
}
