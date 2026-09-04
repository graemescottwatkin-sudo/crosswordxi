/* hl-board.js — HiLo XI: the one place a stored board becomes a public
 * payload, the rule for which board is today's, and the judge.
 *
 * THE SECRET IS THE VALUES. A board is twelve items in a fixed order; the
 * player sees the first value and calls the eleven that follow. Every value
 * after the first, and every row's source, stay on the server until that call
 * is made — the browser is given names and context up front so it can draw
 * the live pair, and one value per call, judged here. A board with its values
 * in the payload would be a board with its answer key in the payload.
 *
 * TWO KINDS OF BOARD. A DAILY board is the calendar's for one day; the past
 * is open (a missed day can be caught up as free play) and the future is
 * shut, because opening it gives away everything. A CLUB board — a club's
 * managers by year of appointment — is never in the calendar and is playable
 * from the club's own page whenever it is in the bank.
 *
 * THE BANK COMES FROM D1 WHEN IT IS BOUND, AND FROM THE SAMPLE WHEN IT IS
 * NOT — three boards that travel with the repository so a fresh clone, the
 * suites and an unbound preview have something real to play. `source` rides
 * in every payload so a live check can refuse a run that quietly fell back.
 */
import { HL_SAMPLE_BOARDS, HL_SAMPLE_SCHEDULE } from "./hl-sample.js";
import { utcDay } from "./daily.js";

export function hasDB(env) { return !!(env && env.DB); }

/* The server decides what day it is, in UTC. Never a date sent up. */
/* The family's, not this game's: see utcDay in daily.js. */
export function todayKey(now = Date.now()) { return utcDay(now); }

/* A club board is one whose category names a club and then a family of facts
   about it. The research side carries no club field, and a rule derived from
   the category is one the importer, the pages and the play route all share.
   THIS IS THE ONE PLACE IT IS WRITTEN — tools/import_hilo.js asks here rather
   than keeping the second copy it used to keep.
 *
 * IT MUST NAME EVERY FAMILY, or the boards it misses are buried alive.
 * It read `(managers|head coaches)` and matched 54 of the 274 club boards in
 * the September import. The other 220 — a club's Premier League appearances,
 * goals and assists, and the one longest-spell board — would have been filed
 * as dailies, and a daily that is not on the calendar is refused by
 * released(). They would have imported green and been unplayable and
 * invisible: not on the club pages, because clubOf() returned null, and not
 * playable, because no day names them.
 *
 * THE PREFIX IS REQUIRED, AND THAT IS THE WHOLE DIFFICULTY. Seven daily
 * boards are categorised "Premier League appearances" with no club in front,
 * beside 113 that read "Arsenal Premier League appearances". A rule that
 * matched on the tail alone would swallow the dailies too, so the club name
 * is `(.+\S)` — at least one character, non-blank — and a bare category
 * cannot satisfy it. Checked against all 363 boards of the import: 274 club,
 * 89 daily, no daily claimed and no previously-club board lost. */
/* The tail is captured as well as the club, because familyOf() below reads it.
   The alternation is written longest-first for reading, and ONLY for reading:
   the `$` means a branch that leaves " by longest spell" over cannot match at
   all, so the order changes nothing. That was worth checking rather than
   asserting — a comment claiming this file depends on branch order was
   written here first, and reversing the two branches proved it false. */
const CLUB_CATEGORY =
  /^(.+\S)\s+(managers by longest spell|managers|head coaches|Premier League (?:appearances|goals|assists))$/i;
export function clubOf(board) {
  const m = CLUB_CATEGORY.exec(String((board && board.category) || ""));
  return m ? m[1] : null;
}
export function isClubBoard(board) { return clubOf(board) !== null; }

/* WHICH FAMILY, OUT OF THE SAME MATCH. The club page states the rule behind
   each family once, at the top, rather than writing it into 274 titles — so it
   has to know which families are on the page. Read from the tail of the same
   expression that finds the club: a second regex over the same string is
   exactly the drift the comment above CLUB_CATEGORY was written about.

   Head coaches are managers. The word differs because Real Madrid's do; the
   rule behind the number is the same one. */
export function familyOf(board) {
  const m = CLUB_CATEGORY.exec(String((board && board.category) || ""));
  if (!m) return null;
  const tail = String(m[2]).toLowerCase();
  if (tail === "managers by longest spell") return "longest-spell";
  if (tail === "managers" || tail === "head coaches") return "managers";
  return tail.replace("premier league ", "");   // appearances | goals | assists
}
export function clubSlug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/* ---- the bank ---- */
export async function loadBank(env) {
  if (!hasDB(env)) return { boards: HL_SAMPLE_BOARDS, schedule: HL_SAMPLE_SCHEDULE, source: "sample" };
  try {
    const b = await env.DB.prepare("SELECT payload FROM hl_board ORDER BY id").all();
    const boards = (b.results || [])
      .map((r) => { try { return JSON.parse(r.payload); } catch (e) { return null; } })
      .filter(Boolean);
    const s = await env.DB.prepare("SELECT day, board_id FROM hl_schedule ORDER BY day").all();
    const schedule = {};
    for (const r of s.results || []) schedule[r.day] = r.board_id;
    /* An empty table is the un-imported state, not an empty bank. */
    if (boards.length) return { boards, schedule, source: "d1" };
  } catch (e) { /* table absent, or unreadable: the sample, said so */ }
  return { boards: HL_SAMPLE_BOARDS, schedule: HL_SAMPLE_SCHEDULE, source: "sample" };
}

export function boardById(bank, id) {
  return (bank.boards || []).find((b) => String(b.id) === String(id)) || null;
}

/* The day a daily board stands on, from the calendar; null for a club board
   or a board the calendar never names. */
export function dayOf(bank, id) {
  const s = bank.schedule || {};
  for (const day of Object.keys(s)) if (String(s[day]) === String(id)) return day;
  return null;
}

/* Which boards may be played. A club board: always. A daily: only once its
   day has come. Refused rather than explained — a refusal that says "that
   is next Tuesday's" has already leaked what it guards. */
export function released(bank, board, now) {
  if (!board) return false;
  if (isClubBoard(board)) return true;
  const day = dayOf(bank, board.id);
  return !!day && day <= todayKey(now);
}

/* ---- tokens ---- */
/* hl:2026-09-03 is a day's board; hlb:398 is a board by id (a club board, or
   a past daily played as free play). One spelling, parsed here and composed
   here, so the routes cannot disagree about which board a call is for. */
export const dayToken = (day) => "hl:" + day;
export const boardToken = (id) => "hlb:" + id;
export function boardForToken(bank, token, now) {
  const s = String(token || "");
  let m = /^hl:(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m) {
    if (m[1] > todayKey(now)) return null;
    const id = (bank.schedule || {})[m[1]];
    return id ? boardById(bank, id) : null;
  }
  m = /^hlb:([A-Za-z0-9_-]{1,40})$/.exec(s);
  if (m) {
    const b = boardById(bank, m[1]);
    return released(bank, b, now) ? b : null;
  }
  return null;
}

/* ---- what leaves the server ---- */
/* Twelve rows, but only the FIRST carries its value, and no row carries its
   source: the rest is names and context so the page can draw the pair it is
   asking about. detail rides only where it is display (a birth date for a
   live age); nothing in it decides a call. */
/* ONLY THE FIRST ROW IS OPEN. A hidden row goes out as its name and nothing
   else: no value, and no context or birth date either. The context is
   authored prose about the item and it can carry a date — "In charge until
   2026" beside a coach whose answer is the year he took charge gave the
   call away on the live page, on launch day. So the context, the birth
   date and the precision travel with the verdict, from judge(), and the
   page shows them as the call settles. The name is enough to ask the
   question; everything else is part of the answer. */
export function publicBoard(board, token) {
  const rows = (board.chain || []).map((r, i) => (i === 0 ? {
    name: r.name,
    context: r.context || "",
    value: r.value,
    ...(r.detail && r.detail.birthDate ? { birthDate: r.detail.birthDate } : {}),
    ...(r.precision ? { precision: r.precision } : {}),
  } : { name: r.name }));
  return {
    token,
    id: String(board.id),
    category: board.category,
    subtitle: board.subtitle,
    unit: board.unit,
    direction: board.direction || null,
    valueClass: board.valueClass || null,
    trueAsOf: board.trueAsOf || null,
    sourceLine: board.sourceLine || null,
    club: clubOf(board),
    rows,
  };
}

/* THE JUDGE. Call i (1..11) asks whether row i is higher than row i-1. The
   answer, the row's value and its source come back together: the source is
   the answers payload and is shown as the call settles, never before. */
/* A QUOTE IS EVIDENCE, AND NOT ALL EVIDENCE IS COPY.
 *
 * Every row carries the text its value was read from, and the audit needs that
 * text to be verbatim. For the 274 club boards the source is the league's data
 * endpoint, so verbatim means a slice of JSON — and the settled row printed it
 * to the player between quotation marks:
 *
 *   ""display":"Ricardo Gardner","first":"Ricardo","last":"Gardner"},"id":
 *   2041.0,"altIds":{"opta":"p1307"}},"rank":4.0,"name":"appearances"…
 *
 * That went out live. So the SERVER decides what a quote is fit for: prose
 * goes to the player, structured data does not, and either way the row keeps
 * its publisher and its link — the claim is still sourced on the page, and the
 * quote is still in the bank for the audit. Not a client-side tidy-up: the
 * share text and anything else built later would each have had to remember. */
export function readableQuote(q) {
  const s = String(q == null ? "" : q).trim();
  if (!s) return null;
  /* The test is a JSON KEY — a quoted string with a colon straight after it —
     and nothing else. Squared brackets were in this rule for one draft and
     took 2,400 real sentences out with the JSON, because a quote reads "the
     Brentford Local Board [a forerunner of today's councils]" and an editorial
     insertion in square brackets is ordinary written English.
     Prose that quotes speech reads `said: "we go again"` — a colon then a
     quote, never a quote then a colon — so it is not caught either. */
  if (/"[^"]*":/.test(s)) return null;
  return s;
}

export function judge(board, index, call) {
  const chain = board.chain || [];
  const i = Number(index);
  if (!Number.isInteger(i) || i < 1 || i >= chain.length) return null;
  const c = String(call);
  /* "none" is a call that ran out of clock: a wrong call by the rule, and
     the row still has to reveal its value so the settled row can show it. */
  if (c !== "higher" && c !== "lower" && c !== "none") return null;
  const prev = Number(chain[i - 1].value), next = Number(chain[i].value);
  const truth = next > prev ? "higher" : "lower";
  const src = chain[i].source || {};
  const row = chain[i];
  return {
    index: i, right: c === truth, value: next,
    /* The rest of the row, released with its value: see publicBoard. */
    context: row.context || "",
    ...(row.detail && row.detail.birthDate ? { birthDate: row.detail.birthDate } : {}),
    ...(row.precision ? { precision: row.precision } : {}),
    source: { publisher: src.publisher || null, url: src.url || null, quote: readableQuote(src.quote) },
  };
}

/* ---- the catalogue: club boards by club, released dailies by day ---- */
export function clubCatalog(bank) {
  const byClub = new Map();
  for (const b of bank.boards || []) {
    const club = clubOf(b);
    if (!club) continue;
    const slug = clubSlug(club);
    if (!slug) continue;
    if (!byClub.has(slug)) byClub.set(slug, { slug, name: club, boards: [] });
    byClub.get(slug).boards.push({ id: String(b.id), subtitle: b.subtitle,
      trueAsOf: b.trueAsOf || null, family: familyOf(b) });
  }
  for (const c of byClub.values()) c.boards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...byClub.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* Days already played, newest first, strictly before today, each with its
   board's category — identity only, no values. */
export function archive(bank, now) {
  const today = todayKey(now);
  const s = bank.schedule || {};
  return Object.keys(s).filter((d) => d < today).sort().reverse().map((day) => {
    const b = boardById(bank, s[day]);
    return { day, id: String(s[day]), category: b ? b.category : null, subtitle: b ? b.subtitle : null };
  }).filter((e) => e.category);
}
