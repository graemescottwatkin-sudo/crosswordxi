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

function boardRow(club, b, n) {
  return `<li class="set"><span class="name">${esc(b.subtitle)}</span><span class="chips">` +
    `<a class="no" href="${esc(clubPath(club.slug))}${n}" aria-label="${esc(club.name)}, board ${n}">#${n}</a>` +
    `</span></li>`;
}

function clubPage(club) {
  const body = `<p class="crumb"><a href="${INDEX}">Clubs and themes</a></p>
<h1>${esc(club.name)}</h1>
<p class="sub">${plural(club.boards.length, "board", "boards")}. Pick one — it opens on the
board, and the first clock starts when you kick off.</p>
<ul>${club.boards.map((b, i) => boardRow(club, b, i + 1)).join("")}</ul>
<a class="cta" href="/hilo/">Play today's board</a>`;
  return htmlResponse(sitePage({
    title: `${club.name} — HiLo XI`,
    description: `${plural(club.boards.length, "board", "boards")} of ${club.name} managers, earlier or later. ` +
      `Free to play, nothing given away.`,
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
