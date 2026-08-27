/* GET /wordsearch/answers/          — every published board, newest first
 * GET /wordsearch/answers/XIWS-NNNN — one board's answers
 *
 * WHY THESE PAGES CAN EXIST AT ALL. The crossword's answers are a secret the
 * server keeps — they are never sent to the browser, so publishing them is an
 * act with a seal on it. A word search is the opposite: the daily payload
 * already carries every answer and placement, because the answers are readable
 * off the grid by construction. The ONLY secret this game has is the schedule
 * — which board is tomorrow's — and these pages leak nothing about it.
 *
 * THE SEAL. A board's answers publish once its FIRST scheduled day is more
 * than ANSWERS_AFTER_DAYS old — the crossword's own constant, imported from
 * the one place it lives. No second seven anywhere: if the window ever
 * changes, both games change together. A board scheduled again later does not
 * re-seal; its answers were public the first time and pretending otherwise
 * would only make the page lie.
 *
 * THE REFUSAL. A sealed or unknown board gets the same 404: no theme, no
 * names, no hint of whether the id even exists. no-store, noindex — a cached
 * refusal would outlive its release date, and an indexed one is a page about
 * nothing. Identical posture to /crossword/answers/.
 *
 * ADDRESSED BY BOARD, NOT BY DAY. The schedule maps 730 days onto 374 boards,
 * so a day-addressed page would publish the same board twice under two URLs —
 * duplicate content, and a second copy of one fact.
 */
import { ANSWERS_AFTER_DAYS } from "../../_lib/daily.js";
import { hasDB, utcDayKey, boardById, firstScheduledDay } from "../../_lib/wsdata.js";

const SITE = "https://www.thexigames.com";

/* One day-arithmetic helper. Date maths inline in two places is how the
   midnight bug happened; this one works in whole UTC days on day-key strings,
   the same strings the schedule stores. */
function daysBetween(fromKey, toKey) {
  return Math.floor((Date.parse(toKey) - Date.parse(fromKey)) / 86400000);
}

export function sealedNow(firstDay, todayKey) {
  /* Never scheduled counts as released — there is no date to protect. */
  if (firstDay === null) return false;
  return daysBetween(firstDay, todayKey) <= ANSWERS_AFTER_DAYS;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* The same visual shell as the crossword's answers pages — paper, ink, one
   green CTA. These are static strings on purpose: an answers page must render
   with no script and no shared asset, because it is the page most likely to be
   opened from a search result on a slow connection. */
function shell(title, description, canonical, body, indexable) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${indexable ? "" : '<meta name="robots" content="noindex">'}
<style>
body{margin:0;background:#F4F5F2;color:#182219;font:16px/1.55 "Public Sans",-apple-system,"Segoe UI",Arial,sans-serif}
main{max-width:720px;margin:0 auto;padding:34px 20px 60px}
h1{font-family:"Barlow Condensed",Arial,sans-serif;font-weight:700;font-size:32px;
  letter-spacing:.02em;text-transform:uppercase;margin:0 0 6px}
.sub{color:#5A675D;margin:0 0 24px}
ol{padding-left:22px}
li{margin:0 0 9px}
table{border-collapse:collapse;width:100%;margin:14px 0 6px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #D9DDD6;font-size:15px}
th{font-family:"Barlow Condensed",Arial,sans-serif;font-size:13px;letter-spacing:.12em;
  text-transform:uppercase;color:#8A968D}
.bonus{background:#fff;border:1px solid #D9DDD6;border-radius:10px;padding:14px 16px;margin:20px 0 4px}
.bonus b{font-family:"Barlow Condensed",Arial,sans-serif;font-size:19px;letter-spacing:.06em}
.dir{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8A968D}
nav{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:30px;padding-top:18px;border-top:1px solid #D9DDD6}
a{color:#1E6B45}
.cta{display:inline-block;background:#1E6B45;color:#fff;text-decoration:none;
  font-family:"Barlow Condensed",Arial,sans-serif;font-weight:700;font-size:17px;
  letter-spacing:.1em;text-transform:uppercase;padding:11px 22px;border-radius:999px;margin-top:26px}
</style>
</head>
<body><main>${body}</main></body></html>`;
}

const html = (markup, cacheable, status = 200) =>
  new Response(markup, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheable
        ? "public, max-age=86400"   /* a published answer never changes */
        : "no-store",               /* a refusal must never outlive its release date */
    },
  });

function refusal() {
  return html(shell(
    "Not published yet \u00b7 Wordsearch XI answers",
    "Answers appear " + ANSWERS_AFTER_DAYS + " days after a board first runs.",
    SITE + "/wordsearch/answers/",
    `<h1>Not published yet</h1>
<p class="sub">Answers appear ${ANSWERS_AFTER_DAYS} days after a board first runs, so the
fresh archive stays worth playing.</p>
<a class="cta" href="/wordsearch/">Play today's board</a>
<nav><a href="/wordsearch/answers/">All published answers</a></nav>`,
    false), false, 404);
}

const DIRECTIONS = { E: "east", W: "west", S: "south", N: "north",
                     SE: "south-east", SW: "south-west", NE: "north-east", NW: "north-west" };

/* Where a word sits, in words. "Row 8, from column 1, west" reads back to the
   grid the player was just staring at; a coordinate pair does not. 1-based on
   purpose: it is the convention the source bank uses and the one a person
   counting rows on a screen uses. The 0-based form belongs to the engine. */
function placementLine(pl) {
  return `row ${pl.start_row + 1}, column ${pl.start_col + 1}, ${DIRECTIONS[pl.direction] || pl.direction}`;
}

export async function onRequestGet({ params, env }) {
  const parts = (params.path || []);
  const today = utcDayKey();

  /* ---- one board -------------------------------------------------------- */
  if (parts.length === 1 && parts[0]) {
    const id = String(parts[0]).toUpperCase();
    /* Shape first: a malformed id gets the same refusal as a sealed board, so
       the response never distinguishes "wrong" from "not yet". */
    if (!/^XIWS-\d{4}$/.test(id)) return refusal();

    const first = await firstScheduledDay(env, id);
    if (sealedNow(first, today)) return refusal();

    const board = await boardById(env, id);
    if (!board) return refusal();

    const rows = board.answers.map((a) =>
      `<tr><td><b>${esc(a.display)}</b></td><td>${placementLine(a.placement)}</td></tr>`).join("");

    const body = `<h1>${esc(board.theme)}</h1>
<p class="sub">Board ${esc(id)} \u00b7 ${esc(board.category)} \u00b7 the eleven and where they hid.</p>
<table>
<tr><th>Name</th><th>Where</th></tr>
${rows}
</table>
<div class="bonus"><span class="dir">Secret bonus</span><br>
<b>${esc(board.bonus.display)}</b> \u2014 ${esc(board.bonus.clue)}<br>
${placementLine(board.bonus.placement)}</div>
<a class="cta" href="/wordsearch/">Play today's board</a>
<nav><a href="/wordsearch/answers/">All published answers</a>
<a href="/crossword/answers/">Crossword XI answers</a></nav>`;

    return html(shell(
      `${board.theme} \u2014 Wordsearch XI answers`,
      `All eleven answers for ${board.theme} (${id}), with the secret bonus word and where each name hides in the grid.`,
      `${SITE}/wordsearch/answers/${id}`,
      body, true), true);
  }

  if (parts.length > 1) return refusal();

  /* ---- the index -------------------------------------------------------- */
  /* Publishable = first scheduled day older than the window. One query, and
     ordered by that day so the list reads newest first, the same as the
     crossword's. Boards never scheduled do not appear here: they are released
     by the rule, but a list entry needs a date to stand in. */
  let items = [];
  if (hasDB(env)) {
    const q = await env.DB.prepare(
      `SELECT s.puzzle_id AS id, MIN(s.day) AS first, p.theme AS theme
         FROM ws_schedule s JOIN ws_puzzles p ON p.id = s.puzzle_id
        GROUP BY s.puzzle_id
       HAVING first < date(?, '-' || ? || ' days')
        ORDER BY first DESC`).bind(today, ANSWERS_AFTER_DAYS).all();
    items = (q.results || []).map((r) => ({ id: r.id, theme: r.theme }));
  }

  const body = items.length
    ? `<h1>Wordsearch XI \u2014 answers</h1>
<p class="sub">Every board more than ${ANSWERS_AFTER_DAYS} days old: the eleven, the secret
bonus, and where each one hid. Newer boards stay sealed so the archive is worth playing.</p>
<ol>${items.map((b) =>
      `<li><a href="/wordsearch/answers/${b.id}">${esc(b.theme)} \u2014 answers</a></li>`).join("")}</ol>
<a class="cta" href="/wordsearch/">Play today's board</a>
<nav><a href="/crossword/answers/">Crossword XI answers</a></nav>`
    : `<h1>Wordsearch XI \u2014 answers</h1>
<p class="sub">Answers appear here once a board is more than ${ANSWERS_AFTER_DAYS} days old.
The game is new \u2014 the first will arrive shortly.</p>
<a class="cta" href="/wordsearch/">Play today's board</a>
<nav><a href="/crossword/answers/">Crossword XI answers</a></nav>`;

  return html(shell(
    "Wordsearch XI answers \u2014 every published board",
    `Answers for past Wordsearch XI boards \u2014 the eleven names, the secret bonus word and where each one hides. Published ${ANSWERS_AFTER_DAYS} days after a board first runs.`,
    SITE + "/wordsearch/answers/",
    body, true), true);
}
