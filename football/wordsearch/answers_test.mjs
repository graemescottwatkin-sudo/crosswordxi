/* answers_test.mjs — the Wordsearch XI answers pages.
 *
 * What is being protected: the ONLY secret this game has is the schedule.
 * The answers themselves ship in every daily payload by construction, so
 * these pages leak nothing — provided the seal holds, the refusal says
 * nothing, and no address distinguishes "sealed" from "does not exist".
 *
 * The handler runs for real against a stub D1, the same way functions_test
 * exercises the API. Assertions about a page nobody rendered are assertions
 * about a comment.
 *
 *   node wordsearch/answers_test.mjs        (from the repo root)
 */
import { onRequestGet, sealedNow } from "../../functions/football/wordsearch/answers/[[path]].js";
import { ANSWERS_AFTER_DAYS } from "../../functions/_lib/daily.js";
import fs from "node:fs";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* Today, as the handler will compute it. The suite must not hardcode a date
   the way the schedule bug hardcoded a midnight. */
const TODAY = new Date().toISOString().slice(0, 10);
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/* A board old enough to publish, one inside the window, one never scheduled. */
const BOARD = {
  id: "XIWS-0001", theme: "Premier League Icons — 1990s", category: "PL Era Icons",
  status: "ready", hash: "x", version: 2, share_key: "k",
  payload: JSON.stringify({
    grid: Array(14).fill("ABCDEFGHIJKL"),
    answers: [
      { display: "Shearer", grid: "SHEARER",
        placement: { direction: "W", start_row: 7, start_col: 6, end_row: 7, end_col: 0 } },
      ...Array.from({ length: 10 }, (_, i) => ({
        display: "Player" + i, grid: "PLAYER" + i,
        placement: { direction: "E", start_row: i, start_col: 0, end_row: i, end_col: 6 } })),
    ],
    bonus: { display: "GOLDEN", grid: "GOLDEN", clue: "The boot",
      placement: { direction: "S", start_row: 2, start_col: 2, end_row: 7, end_col: 2 } },
  }),
};

function stubEnv(firstDays) {
  return { DB: { prepare: (sql) => ({
    bind: (...args) => ({
      first: async () => {
        if (/MIN\(day\)/.test(sql)) {
          const d = firstDays[args[0]];
          return d === undefined ? { d: null } : { d };
        }
        if (/FROM ws_puzzles WHERE id/.test(sql)) {
          /* The SEALED board is fetchable too. With only one board stocked,
             the sealed request 404d for being unfetchable, and the refusal
             assertion passed without the seal being tested at all — the
             vacuous-check fault, in this suite's own first draft. The only
             thing between XIWS-0002 and a served page is the seal. */
          if (args[0] === BOARD.id) return { ...BOARD };
          if (args[0] === "XIWS-0002") {
            return { ...BOARD, id: "XIWS-0002", theme: "Sealed Theme That Must Not Appear" };
          }
          return null;
        }
        return null;
      },
      all: async () => {
        if (/GROUP BY s.puzzle_id/.test(sql)) {
          /* The index query: the stub applies the same HAVING rule in JS so a
             change to the window shows up as a disagreement, not a rubber
             stamp. args = [today, ANSWERS_AFTER_DAYS]. */
          const cutoff = new Date(Date.parse(args[0]) - args[1] * 86400000)
            .toISOString().slice(0, 10);
          const rows = Object.entries(firstDays)
            .filter(([, d]) => d !== null && d < cutoff)
            .sort((a, b) => (a[1] < b[1] ? 1 : -1))
            .map(([id, d]) => ({ id, first: d, theme: "Theme for " + id }));
          return { results: rows };
        }
        return { results: [] };
      },
    }),
  }) } };
}

const req = (path) => onRequestGet({
  params: { path: path === "" ? undefined : path.split("/") },
  env: stubEnv({
    "XIWS-0001": dayAgo(ANSWERS_AFTER_DAYS + 3),   // published
    "XIWS-0002": dayAgo(2),                        // sealed
  }),
});

console.log("The seal");
t(`a board is sealed until it is more than ${ANSWERS_AFTER_DAYS} days old`,
  sealedNow(dayAgo(ANSWERS_AFTER_DAYS), TODAY) === true &&
  sealedNow(dayAgo(ANSWERS_AFTER_DAYS + 1), TODAY) === false,
  "the boundary day stays sealed");
t("a board never scheduled is released — there is no date to protect",
  sealedNow(null, TODAY) === false);
/* THE WINDOW IS THE CROSSWORD'S CONSTANT. A second seven written here would be
   the two games disagreeing about what 'sealed' means the day one changes. */
t("the window is imported from _lib/daily.js, not restated", (() => {
  const src = fs.readFileSync("functions/football/wordsearch/answers/[[path]].js", "utf8");
  /* The depth of that import moved with the functions — ../../../_lib now.
     Matched on the MODULE rather than on how many hops reach it: what this
     asserts is that the window is imported and not restated, and the number of
     dots is not the property. */
  return /import \{ ANSWERS_AFTER_DAYS \} from "[.\/]*_lib\/daily\.js"/.test(src) &&
         !/=\s*7\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, ""));
})());

console.log("\nA published board");
const ok = await req("XIWS-0001");
const okText = await ok.text();
t("answers with 200 and is cacheable — a published answer never changes",
  ok.status === 200 && /max-age/.test(ok.headers.get("cache-control")));
t("carries the theme, the eleven and the bonus",
  okText.indexOf(BOARD.theme) > -1 && okText.indexOf("Shearer") > -1 &&
  okText.indexOf("GOLDEN") > -1 &&
  (okText.match(/row \d+, column \d+/g) || []).length === 12);
/* The wire is 0-based; a person counting rows on a screen is 1-based. Getting
   this wrong reads as every answer being one square off. */
t("placements read 1-based, converted from the 0-based wire",
  okText.indexOf("row 8, column 7, west") > -1,
  "Shearer at wire (7,6) prints as row 8, column 7");
t("and it is indexable", okText.indexOf("noindex") === -1);

console.log("\nThe refusal");
const sealed = await req("XIWS-0002");
const sealedText = await sealed.text();
const missing = await req("XIWS-9999");
const garbage = await req("DROP-TABLE");
t("a sealed board is refused with 404", sealed.status === 404);
t("the refusal is not cacheable — it would outlive its release date",
  /no-store/.test(sealed.headers.get("cache-control")));
t("and is not indexable", sealedText.indexOf("noindex") > -1);
/* The sealed board's own title, not the word "Theme": the family shell's
   masthead carries a "Themes" tab on every wordsearch page, which is
   furniture, and a check on the bare word read it as a leak. */
t("and names nothing — no theme, no player, no hint the id exists",
  sealedText.indexOf("XIWS-0002") === -1 && sealedText.indexOf("Sealed Theme") === -1 &&
  sealedText.indexOf("Must Not Appear") === -1);
/* One refusal for every kind of no. A different answer for "sealed" versus
   "does not exist" would let the address book be probed. */
t("sealed, unknown and malformed ids are indistinguishable", (() => {
  const a = sealed.status, b = missing.status, c = garbage.status;
  return a === 404 && a === b && b === c;
})());

console.log("\nThe index");
const idx = await req("");
const idxText = await idx.text();
t("lists the published board and not the sealed one",
  idxText.indexOf("XIWS-0001") > -1 && idxText.indexOf("XIWS-0002") === -1);
t("is served cacheable and indexable",
  /max-age/.test(idx.headers.get("cache-control")) && idxText.indexOf("noindex") === -1);
t("and links the crossword's answers, because the two archives cross-reference",
  idxText.indexOf("/football/crossword/answers/") > -1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
