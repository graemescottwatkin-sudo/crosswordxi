/* The club pages: /hilo/clubs/ and /hilo/club/<club>/…
 *
 * THE SAME SHAPE AS THE CROSSWORD'S CLUBS AND THE WORD SEARCH'S THEMES: an
 * index that names the clubs, one page per club with every board a numbered
 * target, and a board address that is a DOOR into the game — the board's
 * card, with the first call waiting for Kick off — rather than a page of its
 * own. Starting eleven clocks because somebody followed a link is the fault
 * the landing screen was built to remove.
 *
 * WHAT THESE PAGES MAY SAY. Everything comes from clubCatalog(), which is
 * identity only: a board's subtitle and the date its values are true as of.
 * No names on the chain, no values, no sources. A page that listed the
 * twelve would let the board be read without being played.
 */
import { loadBank, clubCatalog } from "./hl-board.js";
import { sitePage, htmlResponse, esc } from "./site-page.js";

const SITE = "https://www.thexigames.com";
const INDEX = "/hilo/clubs/";
const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function clubPath(slug) { return `/hilo/club/${slug}/`; }

function notFound(what) {
  const page = sitePage({
    title: "Not found — HiLo XI",
    description: "That page does not exist.",
    canonical: SITE + "/hilo/",
    game: "hilo", current: INDEX,
    noindex: true,
    body: `<h1>Not found</h1>
<p class="sub">There is no ${esc(what)} here. It may not have been released yet.</p>
<a class="cta" href="${INDEX}">Clubs and themes</a>`,
  });
  return new Response(page, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---- /hilo/clubs/ ---- */
export async function indexPage({ env }) {
  let clubs = [];
  try { clubs = clubCatalog(await loadBank(env)); } catch (e) { clubs = []; }
  const items = clubs.map((c) =>
    `<li><a href="${esc(clubPath(c.slug))}">${esc(c.name)}</a>` +
    `<span class="meta">${plural(c.boards.length, "board", "boards")}</span></li>`).join("");
  const body = `<h1>Clubs and themes</h1>
<p class="sub">A club's managers by the year they took charge: twelve names, eleven calls,
earlier or later. Every board here is free to play, and none of them touch your run.</p>
${items ? `<ul>${items}</ul>` : `<p class="sub">No club boards have been released yet.</p>`}
<a class="cta" href="/hilo/">Play today's board</a>`;
  return htmlResponse(sitePage({
    title: "HiLo XI by club — the higher-or-lower football game",
    description: "HiLo XI club boards: a club's managers by the year they took charge. " +
      "Twelve names, eleven calls, earlier or later, three substitutions.",
    canonical: SITE + INDEX,
    game: "hilo", current: INDEX,
    body,
  }));
}

/* ---- /hilo/club/<club>/ and /<n> ---- */
export async function treeRoute({ params, env }) {
  const parts = (params && params.path) || [];
  const list = Array.isArray(parts) ? parts.filter(Boolean) : [parts].filter(Boolean);
  if (!list.length) return Response.redirect(SITE + INDEX, 301);
  const slug = String(list[0]).toLowerCase();
  if (!SLUG.test(slug) || list.length > 2) return notFound("club");
  let clubs = [];
  try { clubs = clubCatalog(await loadBank(env)); } catch (e) { return notFound("club"); }
  const club = clubs.find((c) => c.slug === slug);
  if (!club) return notFound("club");
  if (list.length === 2) return boardDoor(club, list[1]);
  return clubPage(club);
}

/* ---- a row is a SET of boards, not one board ----
 *
 * A row used to be a single board, so a label repeated down the page: 43 of
 * the 47 clubs had duplicate rows and one had eight identical ones, because a
 * club has three boards of Premier League appearances and they are all called
 * "Most Premiership appearances". Now the label is written once and every
 * board wearing it is a numbered target beside it.
 *
 * THE NUMBER IS THE ADDRESS. It counts across the whole club rather than
 * restarting inside each row, so the number a player presses is the number in
 * the URL it opens and no door moves when the rows are regrouped. The word
 * search's theme pages hold the same rule for the same reason — a chip reading
 * "#2" that opens ".../3" is one thing with two numbers, which is the fault
 * this project pays for most often.
 */
export function boardRows(club) {
  const rows = [];
  const byLabel = new Map();
  (club.boards || []).forEach((b, i) => {
    const label = b.subtitle;
    if (!byLabel.has(label)) { byLabel.set(label, { label, chips: [] }); rows.push(byLabel.get(label)); }
    byLabel.get(label).chips.push(i + 1);
  });
  return rows;
}

function boardRow(club, row) {
  const chips = row.chips.map((n) =>
    `<a class="no" href="${esc(clubPath(club.slug))}${n}" aria-label="${esc(club.name)}, board ${n}">#${n}</a>`)
    .join("");
  return `<li class="set"><span class="name">${esc(row.label)}</span><span class="chips">${chips}</span></li>`;
}

/* ---- what the numbers mean, said once ----
 *
 * The rules used to be written into the titles, all 274 of them. The owner
 * took them out on 4 Sep so a title says what the number is and nothing else,
 * which puts them here: one statement per family, on the page that shows the
 * family, and only for the families this club actually has. A club with no
 * assists boards is not told how assists are counted.
 *
 * The three stat families share one rule, because it is one rule. */
const FAMILY_RULE = [
  ["managers", "Managers in order is the year he first took charge — caretaker spells " +
    "included — going back to 1960."],
  ["longest-spell", "Longest spell is the end year less the start year, and counts " +
    "departed permanent managers only."],
  ["stats", "Appearances, goals and assists are Premier League figures for this club " +
    "alone, since 1992. They are not the club's all-time record."],
];
const STAT_FAMILIES = ["appearances", "goals", "assists"];

function rulesFor(boards) {
  const here = new Set(boards.map((b) => b.family).filter(Boolean));
  if (STAT_FAMILIES.some((f) => here.has(f))) here.add("stats");
  const lines = FAMILY_RULE.filter(([k]) => here.has(k)).map(([, text]) => text);
  return lines.length ? `<p class="note">${lines.map(esc).join(" ")}</p>` : "";
}

/* ---- when the numbers were true ----
 *
 * WRITTEN ONCE, AND ONLY WHERE IT IS TRUE. Every club board carries trueAsOf
 * and most of a club's agree, so one line covers the page. They do not always:
 * the assists tables were read two days after the rest, and a single line over
 * boards with two dates would be wrong about one of them. So the dates are
 * counted, the commonest leads, and any other is named with the families it
 * covers. Nothing is invented — a board with no date contributes no claim. */
function monthName(iso) {
  const M = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const mi = Number(m[2]) - 1;
  if (!M[mi]) return null;
  return `${Number(m[3])} ${M[mi]} ${m[1]}`;
}
const FAMILY_NOUN = { managers: "managers", "longest-spell": "longest spell",
  appearances: "appearances", goals: "goals", assists: "assists" };

/* The families a club has, in reading order, for the page's description. */
function familyList(boards) {
  const order = ["managers", "longest-spell", "appearances", "goals", "assists"];
  const here = new Set(boards.map((b) => b.family).filter(Boolean));
  const named = order.filter((f) => here.has(f)).map((f) => FAMILY_NOUN[f]);
  if (!named.length) return "boards";
  if (named.length === 1) return named[0];
  return named.slice(0, -1).join(", ") + " and " + named[named.length - 1];
}

function asAtLine(boards) {
  const byDate = new Map();
  for (const b of boards) {
    if (!b.trueAsOf || !monthName(b.trueAsOf)) continue;
    if (!byDate.has(b.trueAsOf)) byDate.set(b.trueAsOf, new Set());
    if (b.family) byDate.get(b.trueAsOf).add(b.family);
  }
  if (!byDate.size) return "";
  const dates = [...byDate.entries()].sort((a, b) => b[1].size - a[1].size ||
    (a[0] < b[0] ? -1 : 1));
  const [main] = dates;
  let line = `Figures as at ${monthName(main[0])}`;
  for (const [iso, fams] of dates.slice(1)) {
    const named = [...fams].map((f) => FAMILY_NOUN[f] || f).sort();
    line += `; ${named.join(" and ")} as at ${monthName(iso)}`;
  }
  return `<p class="note">${esc(line + ".")}</p>`;
}

function clubPage(club) {
  const rows = boardRows(club);
  const body = `<p class="crumb"><a href="${INDEX}">Clubs and themes</a></p>
<h1>${esc(club.name)}</h1>
<p class="sub">${plural(club.boards.length, "board", "boards")} in
${plural(rows.length, "set", "sets")}. Pick one — it opens on the
board, and the first clock starts when you kick off.</p>
${rulesFor(club.boards)}
${asAtLine(club.boards)}
<ul>${rows.map((r) => boardRow(club, r)).join("")}</ul>
<a class="cta" href="/hilo/">Play today's board</a>`;
  return htmlResponse(sitePage({
    title: `${club.name} — HiLo XI`,
    /* IT IS NOT ALL MANAGERS ANY MORE. This said "boards of <club> managers"
       from the day the only club family WAS managers; there are now four, and
       a description naming one of them is wrong on most pages. Named from the
       families the club actually has, so it cannot go stale again. */
    description: `${plural(club.boards.length, "board", "boards")} of ${club.name} ` +
      `${familyList(club.boards)}, earlier or later. Free to play, nothing given away.`,
    canonical: SITE + clubPath(club.slug),
    game: "hilo", current: INDEX,
    body,
  }));
}

/* The board itself: a redirect into the game with the board named, and the
   game shows its card and waits for Kick off. */
function boardDoor(club, raw) {
  const n = parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n <= 0 || n > club.boards.length) return notFound("board");
  return Response.redirect(`${SITE}/hilo/?b=${encodeURIComponent(club.boards[n - 1].id)}`, 302);
}
