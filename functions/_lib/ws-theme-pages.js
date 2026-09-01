/* The themes pages: /wordsearch/themes/ and /wordsearch/theme/<category>/…
 *
 * THE SAME SHAPE AS THE CROSSWORD'S CLUB PAGES, because a player who has
 * learnt one should already know the other: an index that names the groups,
 * one page per group with every board a numbered target, and a board address
 * that is a DOOR into the game rather than a page of its own — the game shows
 * the kick-off card and waits. Starting a clock because somebody followed a
 * link is the fault the landing screen was built to remove.
 *
 * WHAT THEY MAY SAY. Everything comes from catalog(), the one derivation the
 * in-game list and the board of the week already use: released boards,
 * identity only. No grid, no names, no bonus and no schedule — a page that
 * reprinted the eleven would let a board be read without being played, and
 * the answers pages already wait ANSWERS_AFTER_DAYS for that.
 *
 * GROUPED BY CATEGORY, because that is the grouping the bank holds. The
 * crossword groups by club; this bank's boards are eras, finals and
 * tournaments, and a page that split "Brazil — 2002 World Cup" on a dash to
 * find a club would be guessing at a fact the data does not carry.
 */
import { catalog } from "./wsdata.js";
import { sitePage, htmlResponse, esc } from "./site-page.js";

const SITE = "https://www.thexigames.com";
const INDEX = "/wordsearch/themes/";

/* A category as it may appear in a URL. Anything else was not issued by
   categorySlug and is refused before it is looked up. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

/* "FA Cup Final XI" -> "fa-cup-final-xi". Derived, not stored: the bank has
   no slug column, and a slug that is a pure function of the name cannot
   drift from it. */
export function categorySlug(name) {
  return String(name == null ? "" : name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 49);
}

export function groupPath(slug) { return `/wordsearch/theme/${slug}/`; }

/* Released boards grouped by category, id order within a group, so a board's
   number on its page is its place in the group. Two names that slug the same
   share a group under the first name seen — an edge the bank does not have,
   handled rather than crashed on. */
export async function groups(env, now) {
  const boards = await catalog(env, now);
  const map = new Map();
  for (const b of boards) {
    const slug = categorySlug(b.category);
    if (!slug) continue;
    if (!map.has(slug)) map.set(slug, { slug, name: b.category, boards: [] });
    map.get(slug).boards.push({ id: b.id, theme: b.theme });
  }
  for (const g of map.values()) g.boards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function notFound(what) {
  const page = sitePage({
    title: "Not found — Wordsearch XI",
    description: "That page does not exist.",
    canonical: SITE + "/wordsearch/",
    noindex: true,
    body: `<h1>Not found</h1>
<p class="sub">There is no ${esc(what)} here. It may not have been released yet.</p>
<a class="cta" href="${INDEX}">Clubs and themes</a>`,
  });
  return new Response(page, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---- /wordsearch/themes/ — the index ---- */
export async function indexPage({ env }) {
  let list = [];
  try { list = await groups(env); } catch (e) { list = []; }

  const items = list.map((g) =>
    `<li><a href="${esc(groupPath(g.slug))}">${esc(g.name)}</a>` +
    `<span class="meta">${plural(g.boards.length, "board", "boards")}</span></li>`).join("");

  const body = `<h1>Clubs and themes</h1>
<p class="sub">Football word searches by theme: club sides, eras, finals and nations.
Every board here is free to play, and none of them touch your run.</p>
${items ? `<ul>${items}</ul>` : `<p class="sub">No themed boards have been released yet.</p>`}
<a class="cta" href="/wordsearch/">Play today's board</a>`;

  return htmlResponse(sitePage({
    title: "Football word searches by theme — Wordsearch XI",
    description: "Wordsearch XI themed boards: club sides, eras, cup finals and tournament " +
      "elevens. Eleven names to find in every grid, plus a secret bonus.",
    canonical: SITE + INDEX,
    body,
  }));
}

/* ---- /wordsearch/theme/<category>/ and /<n> ---- */
export async function treeRoute({ params, env }) {
  const parts = (params && params.path) || [];
  const list = Array.isArray(parts) ? parts.filter(Boolean) : [parts].filter(Boolean);

  /* The bare tree root is not a page of its own — the index is. */
  if (!list.length) return Response.redirect(SITE + INDEX, 301);

  const slug = String(list[0]).toLowerCase();
  if (!SLUG.test(slug) || list.length > 2) return notFound("theme");

  let all = [];
  try { all = await groups(env); } catch (e) { return notFound("theme"); }
  const group = all.find((g) => g.slug === slug);
  if (!group) return notFound("theme");

  if (list.length === 2) return boardDoor(group, list[1]);
  return groupPage(group);
}

/* A THEME IS "SERIES — EDITION": "Euros Winner Starting XI — 1980",
   "Manchester United — 1998/99". The series is the row and each edition is
   the thing you press, so twenty-three Euros finals read as two rows of
   years rather than twenty-three lines saying nearly the same thing. A theme
   without the dash is a series of one, and its chip is its number. */
export function splitTheme(theme) {
  const s = String(theme == null ? "" : theme);
  const i = s.indexOf(" — ");
  if (i < 0) return { series: s.trim(), edition: "" };
  return { series: s.slice(0, i).trim(), edition: s.slice(i + 3).trim() };
}

/* Boards of a group as rows: series in order of first appearance, each with
   its editions in the group's own order. A board's address is still its
   place in the whole group, so the doors do not move when the rows do. */
export function seriesRows(group) {
  const rows = [];
  const byName = new Map();
  group.boards.forEach((b, i) => {
    const { series, edition } = splitTheme(b.theme);
    if (!byName.has(series)) { byName.set(series, { series, chips: [] }); rows.push(byName.get(series)); }
    byName.get(series).chips.push({ no: i + 1, label: edition || `#${i + 1}`, theme: b.theme });
  });
  return rows;
}

function seriesRow(group, row) {
  const chips = row.chips.map((c) =>
    `<a class="no" href="${esc(groupPath(group.slug))}${c.no}"` +
    ` aria-label="${esc(c.theme)}">${esc(c.label)}</a>`).join("");
  return `<li class="set"><span class="name">${esc(row.series)}</span>${chips}</li>`;
}

function groupPage(group) {
  const rows = seriesRows(group);
  const body = `<p class="crumb"><a href="${INDEX}">Clubs and themes</a></p>
<h1>${esc(group.name)}</h1>
<p class="sub">${plural(group.boards.length, "board", "boards")} in
${plural(rows.length, "series", "series")}. Pick one — it opens on the board, and the
clock waits for you to kick off.</p>
<ul>${rows.map((r) => seriesRow(group, r)).join("")}</ul>
<a class="cta" href="/wordsearch/">Play today's board</a>`;

  return htmlResponse(sitePage({
    title: `${group.name} word searches — Wordsearch XI`,
    description: `${plural(group.boards.length, "board", "boards")} of ${group.name} football ` +
      `word searches. Eleven names in every grid, free to play, nothing given away.`,
    canonical: SITE + groupPath(group.slug),
    body,
  }));
}

/* The board itself: hand off to the game with the board named, and the game
   shows its card and waits for Kick off. A redirect rather than a copy of
   the game under a second path — the game is one page. */
function boardDoor(group, raw) {
  const n = parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n <= 0 || n > group.boards.length) return notFound("board");
  return Response.redirect(`${SITE}/wordsearch/?b=${group.boards[n - 1].id}`, 302);
}
