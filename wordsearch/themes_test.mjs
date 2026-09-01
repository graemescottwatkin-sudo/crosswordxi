/* themes_test.mjs — the themes pages, executed.
 *
 * Server-rendered pages a search engine can read, so the checks are about
 * what the markup SAYS: that a released board is linked as a numbered target,
 * that an unreleased one is nowhere in the bytes, that the pages ask the
 * catalog and nothing else (so no grid can reach them), and that a board
 * address is a door into the game rather than a page.
 *
 * The rows are a stub, not the real database, because the point is the rule
 * rather than the data: an unreleased board is one this stub simply does not
 * return, the same way the real query does not return it.
 */
import { indexPage, treeRoute, categorySlug, groups } from "../functions/_lib/ws-theme-pages.js";
import { utcDayKey } from "../functions/_lib/wsdata.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* Two categories released, one held back. SEALED is the row the query must
   never return; it is here so "the page does not name it" is a claim about a
   board that exists. */
const TODAY = utcDayKey();
const SEALED = { id: "XIWS-0300", theme: "Arsenal — The Invincibles", category: "FA Cup Final XI" };
const ROWS = [
  { id: "XIWS-0002", theme: "Premier League Icons — 2000s", category: "PL Era Icons", first: "2026-08-20" },
  { id: "XIWS-0001", theme: "Premier League Icons — 1990s", category: "PL Era Icons", first: "2026-08-18" },
  { id: "XIWS-0057", theme: "Brazil — 2002 World Cup", category: "Tournament XI", first: "2026-08-25" },
  { ...SEALED, first: "2999-01-01" },
];

let queries = 0, otherSql = [];
const env = { DB: { prepare(sql) {
  const binds = [];
  const api = {
    bind(...b) { binds.push(...b); return api; },
    async all() {
      queries++;
      if (!/SELECT p\.id, p\.theme, p\.category, p\.status/.test(sql)) {
        otherSql.push(sql);
        return { results: [] };
      }
      /* The stub honours the release rule itself: released is first day <= the
         bound day, and only identity comes back. */
      return { results: ROWS.filter((r) => r.first <= binds[0])
        .map((r) => ({ id: r.id, theme: r.theme, category: r.category, status: "ready" })) };
    },
    async first() { queries++; otherSql.push(sql); return null; },
  };
  return api;
} } };

const ctx = (path) => ({ params: { path }, env });
const text = async (res) => await res.text();

console.log("=== Slugs ===");
t("a category slugs to its url form", categorySlug("FA Cup Final XI") === "fa-cup-final-xi");
t("punctuation and spacing collapse", categorySlug("  PL — Era, Icons!! ") === "pl-era-icons");
t("nothing slugs to nothing", categorySlug("") === "" && categorySlug(null) === "");

console.log("\n=== Grouping ===");
const gs = await groups(env);
t("released boards group by category, sorted by name",
  gs.map((g) => g.slug).join(",") === "pl-era-icons,tournament-xi", gs.map((g) => g.slug).join(","));
t("boards within a group are in id order, so their numbers hold",
  gs[0].boards.map((b) => b.id).join(",") === "XIWS-0001,XIWS-0002");
t("the sealed board's category is absent, because its only board is",
  !gs.some((g) => g.name === SEALED.category));

console.log("\n=== The index ===");
const idx = await indexPage({ env });
const idxHtml = await text(idx);
t("the index renders", idx.status === 200);
t("it names the categories with their counts",
  idxHtml.includes(">PL Era Icons</a><span class=\"meta\">2 boards</span>") &&
  idxHtml.includes(">Tournament XI</a><span class=\"meta\">1 board</span>"));
t("categories link to their own page under /theme/",
  idxHtml.includes('href="/wordsearch/theme/pl-era-icons/"') &&
  idxHtml.includes('href="/wordsearch/theme/tournament-xi/"'));
t("it is indexable", !/noindex/.test(idxHtml) && !idx.headers.get("X-Robots-Tag"));
t("it is cacheable", /max-age/.test(idx.headers.get("Cache-Control") || ""));
t("it carries a canonical url",
  idxHtml.includes('rel="canonical" href="https://www.thexigames.com/wordsearch/themes/"'));

console.log("\n=== A category page ===");
const page = await treeRoute(ctx(["pl-era-icons"]));
const pageHtml = await text(page);
t("the category page renders", page.status === 200);
/* Parsed by splitting rather than by regex — a backslash eaten on the way to
   a file has left checks that matched nothing before. */
const rows = pageHtml.split('<li class="set">').slice(1).map((chunk) => {
  const cell = chunk.split("</li>")[0];
  const name = cell.split('<span class="name">')[1].split("</span>")[0];
  const href = (cell.split('class="no" href="')[1] || "").split('"')[0];
  const no = Number((cell.split(">#")[1] || "").split("<")[0]);
  return { name, href, no };
});
if (!rows.length) throw new Error("no board rows parsed — the checks below would be vacuous");
t("every released board in the category is a row, in id order",
  rows.length === 2 && rows[0].name === "Premier League Icons — 1990s" &&
  rows[1].name === "Premier League Icons — 2000s",
  rows.map((r) => r.name + " #" + r.no).join(" | "));
t("each row's number is its own target under this category",
  rows[0].no === 1 && rows[0].href === "/wordsearch/theme/pl-era-icons/1" &&
  rows[1].no === 2 && rows[1].href === "/wordsearch/theme/pl-era-icons/2");
t("it does not offer another category's boards", !pageHtml.includes("Brazil"));
t("it links back to the index", pageHtml.includes('href="/wordsearch/themes/"'));
t("it is indexable", !/noindex/.test(pageHtml));
t("it carries a canonical url",
  pageHtml.includes('rel="canonical" href="https://www.thexigames.com/wordsearch/theme/pl-era-icons/"'));
t("an uppercase slug finds the same page",
  (await treeRoute(ctx(["PL-Era-Icons"]))).status === 200);

console.log("\n=== What these pages must never say ===");
t("no unreleased board is named",
  !idxHtml.includes(SEALED.theme) && !pageHtml.includes(SEALED.theme) &&
  !idxHtml.includes(SEALED.category) && !pageHtml.includes(SEALED.id),
  "held back: " + SEALED.theme);
t("the pages ask the catalog query and nothing else, so no grid can reach them",
  queries > 0 && otherSql.length === 0, queries + " queries");

console.log("\n=== A board is a door ===");
const door = await treeRoute(ctx(["pl-era-icons", "2"]));
t("a released board hands off to the game", door.status === 302, "HTTP " + door.status);
t("with the board named on the game's address, and nothing else",
  door.headers.get("Location") === "https://www.thexigames.com/wordsearch/?b=XIWS-0002",
  door.headers.get("Location"));
for (const [label, path] of [
  ["a number past the end", ["pl-era-icons", "3"]],
  ["zero", ["pl-era-icons", "0"]],
  ["a word", ["pl-era-icons", "two"]],
  ["a category that is not there", ["fa-cup-final-xi"]],
  ["a slug that was never issued", ["DROP TABLE ws_puzzles"]],
  ["a path too deep", ["pl-era-icons", "1", "extra"]],
]) {
  /* A refusal that throws is a failed check, not a dead suite: sabotaging the
     door's bound made the route crash on an undefined board, and the crash
     killed the run before this line could report it. */
  let r;
  try { r = await treeRoute(ctx(path)); }
  catch (e) { r = new Response(String(e), { status: 500 }); }
  t(`${label} is refused`, r.status === 404 && r.headers.get("Cache-Control") === "no-store" &&
    r.headers.get("X-Robots-Tag") === "noindex", "HTTP " + r.status);
}
{
  const before = queries;
  await treeRoute(ctx(["DROP TABLE ws_puzzles"]));
  t("a malformed slug is refused before any query", queries === before);
}
const root = await treeRoute(ctx([]));
t("the bare tree root is the index", root.status === 301 &&
  root.headers.get("Location") === "https://www.thexigames.com/wordsearch/themes/");

console.log("\n=== Without a database ===");
{
  const s = await indexPage({ env: {} });
  const sHtml = await text(s);
  const slug = (sHtml.match(/href="\/wordsearch\/theme\/([a-z0-9-]+)\/"/) || [])[1];
  t("the sample catalog renders an index", s.status === 200 && !!slug, slug);
  const sDoor = slug ? await treeRoute({ params: { path: [slug, "1"] }, env: {} }) : null;
  t("and a sample board is a door too",
    !!sDoor && sDoor.status === 302 && /\?b=XIWS-\d{4}$/.test(sDoor.headers.get("Location") || ""),
    sDoor && sDoor.headers.get("Location"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
