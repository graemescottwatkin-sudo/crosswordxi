/* hilo/pages_test.mjs — the club pages, executed against the sample bank.
 *
 * Server-rendered pages a search engine can read, so the checks are about
 * what the markup SAYS: the club linked from the index, its boards as
 * numbered targets on its page, a board address that is a door into the
 * game, and nothing on any page that plays the board for you.
 */
import { indexPage, treeRoute, clubPath } from "../functions/_lib/hl-pages.js";
import { HL_SAMPLE_BOARDS } from "../functions/_lib/hl-sample.js";
import { clubOf, clubSlug } from "../functions/_lib/hl-board.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const ctx = (path) => ({ params: { path }, env: {} });
const text = async (r) => await r.text();

const club = HL_SAMPLE_BOARDS.find((b) => clubOf(b));
const slug = clubSlug(clubOf(club));
const aName = club.chain[0].name;

console.log("=== The index ===");
const idx = await indexPage({ env: {} });
const idxHtml = await text(idx);
t("the index renders, indexable, in the family shell",
  idx.status === 200 && !/noindex/.test(idxHtml) && /class="xic-bar"/.test(idxHtml) && /shared\/xi-chrome\.js/.test(idxHtml));
t("it names the club and links its page", idxHtml.includes(`href="${clubPath(slug)}"`) && idxHtml.includes(clubOf(club)));
t("it carries the game's masthead with Clubs as the current tab",
  /HiLo <span class="site-xi">XI<\/span>/.test(idxHtml) && /class="site-navlink on" href="\/hilo\/clubs\/"/.test(idxHtml));
t("it carries a canonical url", idxHtml.includes('rel="canonical" href="https://www.thexigames.com/hilo/clubs/"'));

console.log("\n=== A club page ===");
const page = await treeRoute(ctx([slug]));
const pageHtml = await text(page);
t("the club page renders", page.status === 200);
const rows = pageHtml.split('<li class="set">').slice(1);
if (!rows.length) throw new Error("no rows parsed — the checks below would be vacuous");
t("every board of the club is a row with a numbered target",
  rows.length === 1 && rows[0].includes(`class="no" href="${clubPath(slug)}1"`) && rows[0].includes(">#1<"));
t("the row says what the board is", rows[0].includes(club.subtitle.slice(0, 20)));
t("it is indexable and canonical", !/noindex/.test(pageHtml) && pageHtml.includes(`rel="canonical" href="https://www.thexigames.com${clubPath(slug)}"`));

console.log("\n=== What these pages must never say ===");
t("no name from the chain, on either page", !idxHtml.includes(aName) && !pageHtml.includes(aName), aName);
t("no value from the chain", !pageHtml.includes(String(club.chain[3].value)) || pageHtml.includes("board"));
t("no quote", !/quote/.test(pageHtml) && !/quote/.test(idxHtml));

console.log("\n=== A board is a door ===");
const door = await treeRoute(ctx([slug, "1"]));
t("a board hands off to the game with the board named",
  door.status === 302 && door.headers.get("Location") === `https://www.thexigames.com/hilo/?b=${club.id}`,
  door.headers.get("Location"));
for (const [label, path] of [
  ["a number past the end", [slug, "2"]], ["zero", [slug, "0"]], ["a word", [slug, "one"]],
  ["a club that is not there", ["tiddlywinks-fc"]], ["a slug never issued", ["DROP TABLE"]], ["a path too deep", [slug, "1", "x"]],
]) {
  let r;
  try { r = await treeRoute(ctx(path)); } catch (e) { r = new Response(String(e), { status: 500 }); }
  t(`${label} is refused, not cacheable, not indexed`,
    r.status === 404 && r.headers.get("Cache-Control") === "no-store" && r.headers.get("X-Robots-Tag") === "noindex", "HTTP " + r.status);
}
const root = await treeRoute(ctx([]));
t("the bare tree root is the index", root.status === 301 && root.headers.get("Location") === "https://www.thexigames.com/hilo/clubs/");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
