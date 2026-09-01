/* The club and theme pages: /crossword/club/… and /crossword/theme/…
 *
 * ONE RENDERER, TWO TREES. Clubs and topics are the same shape of thing with
 * different words around them — Arsenal has boards, so does Grounds — and the
 * only real difference is the noun and which kind belongs at which path. Two
 * copies of this would drift the first time a page gained a line.
 *
 * WHAT THESE PAGES MAY SAY. Everything comes from listThemes(), which returns
 * released, listed boards and nothing else, so no page here can name a board
 * that has not come out. They carry NO CLUES AND NO ANSWERS: the searchable
 * thing is the club, and a page that reprinted the clues would let the puzzle
 * be read without being played, and would sit in an index waiting to be paired
 * with the answers when they unseal. Answers already wait ANSWERS_AFTER_DAYS;
 * clues do not get a weaker rule than the answers to them.
 *
 * A BOARD URL IS A DOOR, NOT A PAGE. /club/arsenal/1 hands off to the game
 * with the board named, and the game does what it always does: shows the kick
 * off card and waits. Starting a clock because somebody followed a link is the
 * fault the landing screen was built to remove.
 */
import { hasDB, serverToday } from "./db.js";
import { listThemes, siblingsOf, isSlug } from "./theme-catalog.js";
import { sitePage, htmlResponse, esc } from "./site-page.js";

const SITE = "https://www.thexigames.com";

/* The two trees, and the words each uses. */
const TREES = {
  club:  { path: "club",  one: "club",  many: "Clubs" },
  topic: { path: "theme", one: "theme", many: "Themes" },
};

export function pathOf(theme) {
  return `/crossword/${TREES[theme.kind] ? TREES[theme.kind].path : "theme"}/${theme.id}/`;
}

function notFound(what) {
  const page = sitePage({
    title: "Not found — Crossword XI",
    description: "That page does not exist.",
    canonical: SITE + "/crossword/",
    noindex: true,
    body: `<h1>Not found</h1>
<p class="sub">There is no ${esc(what)} here. It may not have been released yet.</p>
<a class="cta" href="/crossword/clubs/">Clubs and themes</a>`,
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

function boardList(theme) {
  return theme.boards.map((b) =>
    `<li><a href="${esc(pathOf(theme))}${b.no}">${esc(theme.name)} #${b.no}</a>` +
    `<span class="meta">Released ${esc(b.releasedOn)}</span></li>`).join("");
}

/* ---- /crossword/clubs/ — the index both trees are reached from ---- */
export async function indexPage({ env }) {
  if (!hasDB(env)) return notFound("index");
  let themes = [];
  try { themes = await listThemes(env, serverToday()); } catch (e) { themes = []; }

  const clubs = themes.filter((t) => t.kind === "club");
  const topics = themes.filter((t) => t.kind !== "club");

  /* Grouped by club, so Arsenal and its four sub-themes read as one club with
     five ways in rather than as five unrelated entries. */
  const byClub = new Map();
  for (const t of clubs) {
    const key = t.club || t.id;
    if (!byClub.has(key)) byClub.set(key, []);
    byClub.get(key).push(t);
  }

  const clubBlocks = [...byClub.values()].map((group) => {
    const boards = group.reduce((n, t) => n + t.boards.length, 0);
    const head = group[0];
    return `<li><a href="${esc(pathOf(head))}">${esc(head.club ? clubName(group) : head.name)}</a>` +
      `<span class="meta">${group.length} ${group.length === 1 ? "board set" : "board sets"}, ` +
      `${boards} ${boards === 1 ? "puzzle" : "puzzles"}</span></li>`;
  }).join("");

  const topicBlocks = topics.map((t) =>
    `<li><a href="${esc(pathOf(t))}">${esc(t.name)}</a>` +
    `<span class="meta">${t.boards.length} ${t.boards.length === 1 ? "puzzle" : "puzzles"}</span></li>`).join("");

  const body = `<h1>Clubs and themes</h1>
<p class="sub">Football crosswords by club and by subject. A new board every Friday.</p>
${clubBlocks ? `<h2>Clubs</h2><ul>${clubBlocks}</ul>` : ""}
${topicBlocks ? `<h2>Themes</h2><ul>${topicBlocks}</ul>` : ""}
${!clubBlocks && !topicBlocks
  ? `<p class="sub">No club or theme boards have been released yet.</p>` : ""}
<a class="cta" href="/crossword/">Play today's board</a>
<a class="cta ghost" href="/crossword/?themes=1">Request a board</a>`;

  return htmlResponse(sitePage({
    title: "Football crosswords by club — Crossword XI",
    description: "Crossword XI club and theme boards: Arsenal, Manchester United and more, " +
      "plus themed football crosswords. A new board every Friday.",
    canonical: SITE + "/crossword/clubs/",
    body,
  }));
}

/* The club's name without the sub-theme suffix. "Arsenal — Midfielders" is a
   theme of Arsenal; the club is Arsenal, and the group is headed by whichever
   theme has the shortest name rather than by a second lookup table. */
function clubName(group) {
  return group.map((t) => t.name).reduce((a, b) => (b.length < a.length ? b : a));
}

/* ---- /crossword/club/<id>/ and /crossword/club/<id>/<no> ---- */
export async function treeRoute({ params, env }, kind) {
  const parts = (params && params.path) || [];
  const list = Array.isArray(parts) ? parts.filter(Boolean) : [parts].filter(Boolean);

  /* The bare tree root is not a page of its own — the index is. */
  if (!list.length) return Response.redirect(SITE + "/crossword/clubs/", 301);

  const id = String(list[0]).toLowerCase();
  if (!isSlug(id) || list.length > 2) return notFound(TREES[kind].one);
  if (!hasDB(env)) return notFound(TREES[kind].one);

  let themes = [];
  try { themes = await listThemes(env, serverToday()); } catch (e) { return notFound(TREES[kind].one); }

  /* Kind is enforced by the path: a topic at /club/ is not found rather than
     served under the wrong noun, so each page has exactly one address. */
  const theme = themes.find((t) => t.id === id && t.kind === kind);
  if (!theme) return notFound(TREES[kind].one);

  if (list.length === 2) return boardDoor(theme, list[1]);

  const siblings = siblingsOf(themes, theme).filter((t) => t.kind === kind);
  const body = `<p class="crumb"><a href="/crossword/clubs/">Clubs and themes</a></p>
<h1>${esc(theme.name)}</h1>
<p class="sub">${theme.boards.length} ${theme.boards.length === 1 ? "crossword" : "crosswords"}.
Pick one and it opens ready to start — the clock waits for you to kick off.</p>
<ul>${boardList(theme)}</ul>
${siblings.length ? `<h2>More from this club</h2><ul>${siblings.map((t) =>
  `<li><a href="${esc(pathOf(t))}">${esc(t.name)}</a>` +
  `<span class="meta">${t.boards.length} ${t.boards.length === 1 ? "puzzle" : "puzzles"}</span></li>`
).join("")}</ul>` : ""}
<a class="cta" href="/crossword/">Play today's board</a>`;

  return htmlResponse(sitePage({
    title: `${theme.name} crossword — Crossword XI`,
    description: `${theme.boards.length} ${theme.name} football crosswords. ` +
      `Free to play, no answers given away.`,
    canonical: SITE + pathOf(theme),
    body,
  }));
}

/* The board itself: hand off to the game with the board named. A redirect
   rather than a copy of the game served under a second path — the game is one
   page, and two of it is two things to keep in step. */
function boardDoor(theme, raw) {
  const no = parseInt(String(raw), 10);
  if (!Number.isInteger(no) || no <= 0) return notFound("board");
  if (!theme.boards.some((b) => b.no === no)) return notFound("board");
  return Response.redirect(`${SITE}/crossword/?t=${theme.id}-${no}`, 302);
}
