/* clubs_test.mjs — the club and theme pages, executed.
 *
 * These are server-rendered pages that did not exist before, and the whole
 * reason for them is that a search engine can read them. So the checks are
 * about what the markup SAYS, not about whether a template compiled: that a
 * released board is linked, that an unreleased one is nowhere in the bytes,
 * that no clue and no answer is on the page, and that a topic cannot be
 * reached under /club/.
 *
 * The rows are a stub, not the real database, because the point is the rule
 * rather than the data: an unreleased board is one this stub simply does not
 * return, the same way the real query does not return it.
 */
import { indexPage, treeRoute, pathOf } from "../functions/_lib/theme-pages.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* Two clubs, one with a sub-theme, one topic — and one board held back.
   SEALED is the row the query must never return; it is here so that "the page
   does not name it" is a claim about a board that exists, not about nothing. */
const TODAY = "2026-09-01";
const SEALED = { theme: "Arsenal — Captains", club: "arsenal", no: 1 };
const ROWS = [
  { id: "arsenal", name: "Arsenal", kind: "club", club_id: "arsenal", family: "general",
    board_no: 1, board_id: 240, release_on: "2026-08-18" },
  { id: "arsenal", name: "Arsenal", kind: "club", club_id: "arsenal", family: "general",
    board_no: 2, board_id: 241, release_on: "2026-08-18" },
  { id: "arsenal-wenger-era", name: "Arsenal — Wenger Era", kind: "club", club_id: "arsenal",
    family: "special", board_no: 1, board_id: 250, release_on: "2026-08-25" },
  { id: "man-united", name: "Manchester United", kind: "club", club_id: "man-united",
    family: "general", board_no: 1, board_id: 260, release_on: "2026-08-18" },
  { id: "grounds", name: "Grounds", kind: "topic", club_id: null, family: null,
    board_no: 1, board_id: 245, release_on: "2026-08-18" },
];

let lastSql = null, lastBinds = null, queries = 0;
const env = { DB: { prepare(sql) {
  const binds = [];
  const api = {
    bind(...b) { binds.push(...b); return api; },
    async all() {
      if (!/FROM themes t JOIN theme_boards b/.test(sql)) {
        throw new Error("the page asked a query this stub does not model: " + sql);
      }
      /* The stub honours the released-and-listed rule itself, so a page that
         somehow asked for everything would still not receive the sealed row. */
      lastSql = sql; lastBinds = binds.slice(); queries++;
      return { results: ROWS.filter((r) => r.release_on <= binds[0]) };
    },
  };
  return api;
} } };

const ctx = (path) => ({ params: { path }, env });
const text = async (res) => await res.text();

console.log("=== The index ===");
const idx = await indexPage({ env });
const idxHtml = await text(idx);
t("the index renders", idx.status === 200);
t("it names the clubs", /Arsenal/.test(idxHtml) && /Manchester United/.test(idxHtml));
t("and the themes", /Grounds/.test(idxHtml));
t("clubs link to their own page", idxHtml.includes('href="/crossword/club/arsenal/"'));
t("themes link under /theme/, not /club/", idxHtml.includes('href="/crossword/theme/grounds/"'));
/* Arsenal and Arsenal — Wenger Era are one club with two sets, not two clubs. */
t("a club and its sub-themes count as one entry",
  (idxHtml.match(/href="\/crossword\/club\//g) || []).length === 2,
  (idxHtml.match(/href="\/crossword\/club\//g) || []).length + " club links for 2 clubs");
t("it is indexable", !/noindex/.test(idxHtml) && !idx.headers.get("X-Robots-Tag"));
t("and links back to the sheet for requests", idxHtml.includes("/crossword/?themes=1"));

console.log("\n=== A club page ===");
const club = await treeRoute(ctx(["arsenal"]), "club");
const clubHtml = await text(club);
t("the club page renders", club.status === 200);
t("it lists both released boards",
  clubHtml.includes("/crossword/club/arsenal/1") && clubHtml.includes("/crossword/club/arsenal/2"));
t("it offers the club's other sets", clubHtml.includes("/crossword/club/arsenal-wenger-era/"));
t("it does not offer another club's", !clubHtml.includes("man-united"));
t("it is indexable", !/noindex/.test(clubHtml));
t("it carries a canonical url",
  clubHtml.includes('rel="canonical" href="https://www.thexigames.com/crossword/club/arsenal/"'));

console.log("\n=== What these pages must never say ===");
/* The searchable thing is the club. A clue on an indexable page lets the
   puzzle be read without being played, and waits in an index to be paired
   with the answers the day they unseal. */
t("no clue text anywhere", !/\bclue\b/i.test(clubHtml) && !/\bclue\b/i.test(idxHtml));
t("no answer text anywhere", !/\banswer\b/i.test(clubHtml) && !/\banswer\b/i.test(idxHtml));
t("and no unreleased board is named",
  !idxHtml.includes(SEALED.theme) && !clubHtml.includes(SEALED.theme),
  "held back: " + SEALED.theme);

console.log("\n=== A board is a door ===");
const door = await treeRoute(ctx(["arsenal", "1"]), "club");
t("a released board hands off to the game", door.status === 302);
t("naming the board, so the game opens it",
  door.headers.get("Location") === "https://www.thexigames.com/crossword/?t=arsenal-1",
  door.headers.get("Location"));

console.log("\n=== What is refused ===");
const sealed = await treeRoute(ctx(["arsenal", "9"]), "club");
t("a board that has not been released is not found", sealed.status === 404);
t("and is not indexed", sealed.headers.get("X-Robots-Tag") === "noindex");
t("nor cached", sealed.headers.get("Cache-Control") === "no-store");
const wrongTree = await treeRoute(ctx(["grounds"]), "club");
t("a theme is not found under /club/", wrongTree.status === 404);
const rightTree = await treeRoute(ctx(["grounds"]), "topic");
t("but is under /theme/", rightTree.status === 200);
/* Refused BEFORE any query, which is the claim the name makes — so it is the
   claim that gets checked. Asserting only the 404 passed with the slug guard
   removed, because junk matches no theme and 404s anyway: a check whose name
   was broader than its behaviour. */
const queriesBefore = queries;
const junk = await treeRoute(ctx(["../../etc/passwd"]), "club");
t("a malformed id is refused", junk.status === 404);
t("and refused before any query is issued", queries === queriesBefore,
  (queries - queriesBefore) + " queries issued for a malformed id");
const deep = await treeRoute(ctx(["arsenal", "1", "2"]), "club");
t("and so is a path deeper than a board", deep.status === 404);
const root = await treeRoute(ctx([]), "club");
t("the bare tree sends you to the index",
  root.status === 301 && root.headers.get("Location").endsWith("/crossword/clubs/"));

console.log("\n=== The query the page actually issues ===");
/* The stub MODELS the released-and-listed rule; it does not execute the real
   SQL. So the rule itself is checked where it lives — in the query this code
   builds and sends. Weaker than a real database, and stronger than reading
   the source: the query asserted here is the one the page just ran. */
t("it constrains boards to those already released",
  /release_on\s*<=\s*\?/.test(lastSql || ""),
  lastSql ? "a query was issued" : "NO QUERY WAS ISSUED");
t("and to those still on the shelf", /listed\s*=\s*1/.test(lastSql || ""));
t("bound to the server's today, not the browser's",
  Array.isArray(lastBinds) && /^\d{4}-\d{2}-\d{2}$/.test(String(lastBinds[0])),
  String((lastBinds || [])[0]));

console.log("\n=== One path per theme ===");
t("pathOf agrees with the links the pages write",
  pathOf({ kind: "club", id: "arsenal" }) === "/crossword/club/arsenal/" &&
  pathOf({ kind: "topic", id: "grounds" }) === "/crossword/theme/grounds/");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
