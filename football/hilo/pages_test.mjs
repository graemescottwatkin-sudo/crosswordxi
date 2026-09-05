/* hilo/pages_test.mjs — the club pages, executed against the sample bank.
 *
 * Server-rendered pages a search engine can read, so the checks are about
 * what the markup SAYS: the club linked from the index, its boards as
 * numbered targets on its page, a board address that is a door into the
 * game, and nothing on any page that plays the board for you.
 */
import { indexPage, treeRoute, clubPath } from "../../functions/_lib/hl-pages.js";
import { HL_SAMPLE_BOARDS } from "../../functions/_lib/hl-sample.js";
import { clubOf, clubSlug } from "../../functions/_lib/hl-board.js";

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
  /HiLo <span class="site-xi">XI<\/span>/.test(idxHtml) && /class="site-navlink on" href="\/football\/hilo\/clubs\/"/.test(idxHtml));
t("it carries a canonical url", idxHtml.includes('rel="canonical" href="https://www.thexigames.com/football/hilo/clubs/"'));

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

console.log("\n=== A row is a set, and no label is written twice ===");
{
  /* Three boards to a label is the ordinary case — a club has three boards of
     Premier League appearances and they are all called the same thing — and
     the page used to print the label once per board. Aston Villa's read four
     labels down twelve rows, eight of them repeats. */
  const mk = (id, category, subtitle) => ({ ...club, id, category, subtitle,
    trueAsOf: "2026-09-02" });
  const bank = [
    mk("r1", "Rowton managers", "Manager appointed"),
    mk("r2", "Rowton managers", "Manager appointed"),
    mk("r3", "Rowton managers", "Manager appointed"),
    mk("r4", "Rowton Premier League goals", "Most Premiership goals"),
    mk("r5", "Rowton Premier League goals", "Most Premiership goals"),
  ];
  const env = { DB: { prepare: (sql) => ({ all: async () => ({
    results: /hl_board/.test(sql) ? bank.map((b) => ({ payload: JSON.stringify(b) })) : [],
  }) }) } };
  const html = await (await treeRoute({ params: { path: ["rowton"] }, env })).text();
  const labels = [...html.matchAll(/<span class="name">([^<]*)<\/span>/g)].map((m) => m[1]);

  t("every label appears once, however many boards wear it",
    labels.length === new Set(labels).size && labels.length === 2, labels.join(" | "));
  t("and the repeats become more numbers on that one row",
    /<span class="name">Manager appointed<\/span><span class="chips">(?:[^<]*<a[^>]*>#[123]<\/a>){3}<\/span>/
      .test(html.replace(/\s+/g, " ")),
    (/Manager appointed<\/span><span class="chips">.*?<\/span>/.exec(html.replace(/\s+/g, " ")) || ["not found"])[0]
      .replace(/<[^>]*>/g, " ").trim());

  /* THE NUMBER IS THE ADDRESS. A chip reading #4 that opens .../5 would be one
     board with two numbers, and every door on the page would have moved the
     day the rows were grouped. Checked by following each chip to the number in
     its own href. */
  const chips = [...html.matchAll(/href="\/football\/hilo\/club\/rowton\/(\d+)"[^>]*>#(\d+)</g)];
  t("the number on a chip is the number in the url it opens",
    chips.length === 5 && chips.every((m) => m[1] === m[2]),
    chips.map((m) => `#${m[2]}->${m[1]}`).join(" "));
  t("and they run 1 to 5 across the club, not 1 to 3 then 1 to 2",
    chips.map((m) => m[2]).join(",") === "1,2,3,4,5", chips.map((m) => m[2]).join(","));
  t("the page counts sets as well as boards", /5 boards in\s*2 sets/.test(html));

  /* And the doors still land where they did. */
  const door = await treeRoute({ params: { path: ["rowton", "4"] }, env });
  t("board #4 is the fourth board of the club, as its number says",
    door.status === 302 && door.headers.get("Location").endsWith("?b=r4"),
    door.headers.get("Location"));
}

console.log("\n=== What the numbers mean, and when they were true ===");
{
  /* THE MIXED-DATE CLUB, WHICH THE SAMPLE BANK CANNOT REACH. It holds one club
     board, so every check above sees a page with one family and one date — and
     the line that needed proving is the one covering boards read on different
     days. The assists tables were read two days after the rest, so a club with
     assists has two dates on one page and a single "as at" over the lot would
     be wrong about one of them. Built here rather than waited for. */
  const mk = (id, category, subtitle, trueAsOf) => ({
    ...club, id, category, subtitle, trueAsOf,
  });
  const bank = [
    mk("t1", "Testville managers", "Manager appointed", "2026-09-02"),
    mk("t2", "Testville Premier League goals", "Most Premiership goals", "2026-09-02"),
    mk("t3", "Testville Premier League assists", "Most Premiership assists", "2026-09-04"),
  ];
  const env = { DB: { prepare: (sql) => ({ all: async () => ({
    results: /hl_board/.test(sql) ? bank.map((b) => ({ payload: JSON.stringify(b) })) : [],
  }) }) } };
  const r = await treeRoute({ params: { path: ["testville"] }, env });
  const html = await r.text();

  t("the page states when the figures were true, once",
    (html.match(/Figures as at/g) || []).length === 1, "found " + (html.match(/Figures as at/g) || []).length);
  t("and where two dates meet on one page, it names which is which",
    /Figures as at 2 September 2026; assists as at 4 September 2026\./.test(html),
    (/Figures as at[^<]*/.exec(html) || ["not found"])[0]);
  t("the rule behind each family is stated on the page, not in the titles",
    /caretaker spells/.test(html) && /since 1992/.test(html));
  t("and only for the families this club has",
    !/Longest spell is/.test(html), "no longest-spell board here, so no rule for one");
  t("the description names the families rather than calling them all managers",
    /content="3 boards of Testville managers, goals and assists, earlier or later\./.test(html),
    (/description" content="([^"]*)/.exec(html) || [, "not found"])[1]);
}
{
  /* A club whose boards all agree needs no second clause. */
  const one = [{ ...club, id: "u1", category: "Onedate managers",
    subtitle: "Manager appointed", trueAsOf: "2026-09-02" }];
  const env = { DB: { prepare: (sql) => ({ all: async () => ({
    results: /hl_board/.test(sql) ? one.map((b) => ({ payload: JSON.stringify(b) })) : [],
  }) }) } };
  const html = await (await treeRoute({ params: { path: ["onedate"] }, env })).text();
  t("one date is one clause and no semicolon",
    /Figures as at 2 September 2026\./.test(html) && !/;/.test(/Figures as at[^<]*/.exec(html)[0]));
}

console.log("\n=== A board is a door ===");
const door = await treeRoute(ctx([slug, "1"]));
t("a board hands off to the game with the board named",
  door.status === 302 && door.headers.get("Location") === `https://www.thexigames.com/football/hilo/?b=${club.id}`,
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
t("the bare tree root is the index", root.status === 301 && root.headers.get("Location") === "https://www.thexigames.com/football/hilo/clubs/");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
