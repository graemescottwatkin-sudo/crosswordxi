/* archive.js — how far back anyone may go without an account.
 *
 * Today and the week behind it are open to everybody. Older than that, a
 * board asks the player to register. That is the whole rule, and it is here
 * rather than in four endpoints because four copies of a window is four
 * windows the day somebody changes one.
 *
 * SEVEN, AND THE OTHER SEVEN. ANSWERS_AFTER_DAYS in daily.js is also seven,
 * and this must NOT be written in terms of it. They are two decisions that
 * happen to agree today: one says when a board's answers may be published,
 * the other says when playing it starts needing an account. Tie them together
 * and moving the answers window silently moves the paywall, which is the kind
 * of coupling this codebase has paid for before. Two facts, two constants,
 * and this comment so the next person does not "tidy" them into one.
 *
 * WHAT IS GATED IS THE DAILY ARCHIVE, NOT EVERYTHING OLD. A board is gated by
 * how long ago it was the board of the day. Boards that never had a day — the
 * word search's free-play catalogue, Scrambled's finals, the crossword's club
 * boards — are not part of the archive and are not gated by this. They are a
 * catalogue, not a back issue.
 *
 * AND IT DOES NOT GATE WHERE NOBODY CAN REGISTER. If the site cannot offer an
 * account — no database bound, or no sign-in configured — then "sign in to
 * play this" is a door with no handle, and the archive stays open. That is
 * also what keeps the suites honest: they run without either, so they exercise
 * the ungated path, and the live_checks assert the gate really is up in
 * production, where it is the only place it means anything.
 */
import { currentUser } from "./auth.js";
import { utcDay } from "./daily.js";

/* Today plus this many days behind it are free. Seven, so a player who missed
   a week can catch the week up. */
export const FREE_ARCHIVE_DAYS = 7;

/* `back` is how many days ago the board was the board of the day: 0 is
   today, 1 is yesterday. Anything not a number is not gated — a board with no
   day is not a back issue, and refusing what cannot be measured would shut
   the free-play catalogues by accident. */
export function beyondFreeArchive(back) {
  return Number.isInteger(back) && back > FREE_ARCHIVE_DAYS;
}

/* Whole days between two YYYY-MM-DD keys, `then` before `now`. Both are UTC
   day keys, which is what every game in the family schedules by, so this is
   subtraction rather than timezone arithmetic. */
export function daysBack(then, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(then || ""))) return null;
  const today = now || utcDay();
  const a = Date.parse(then + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* Can this site offer an account at all? Both halves matter: without a
   database there is nowhere to put a user, and without a client id there is
   no way to sign in. /api/auth/session reports the same pair to the browser
   as `accounts`, and reads it from here so the two cannot disagree. */
export function accountsOffered(env) {
  return !!(env && env.DB && env.GOOGLE_CLIENT_ID);
}

/* The one question an endpoint asks. True means serve the board.
 *
 * Ordered so the expensive part is last: most requests are for today or the
 * week behind it and never touch the session table at all. */
export async function mayOpenArchive(request, env, back) {
  if (!beyondFreeArchive(back)) return true;
  if (!accountsOffered(env)) return true;
  try {
    return !!(await currentUser(request, env));
  } catch (e) {
    /* A session lookup that fails is not a player who is signed out. Serving
       the board is the safe direction here: the cost of being wrong is a free
       archive board, and the cost the other way is locking a signed-in player
       out of a board they are entitled to. */
    return true;
  }
}

/* What a refused board says. `needsAccount` is the flag the pages act on —
   the message is for a human, the flag is for the client, and a client that
   matched on the message would break the first time the wording changed. */
export function archiveRefusal(back) {
  return {
    error: "That board is more than " + FREE_ARCHIVE_DAYS +
      " days old. Sign in to play the full archive.",
    needsAccount: true,
    freeDays: FREE_ARCHIVE_DAYS,
    daysBack: Number.isInteger(back) ? back : null,
  };
}
