/* teamtalk_test.mjs — half time, and the free hints that make a board finishable.
 *
 * WHY THIS SUITE EXISTS. The team talk was the only path in the game that
 * nothing tested: automatic, free, and fired by the clock rather than by a
 * click, so no journey through the game ever reached it. It was then rewritten
 * from eleven parallel requests into one board-wide request — exactly the kind
 * of change that fails silently, because a player who never receives their
 * hints has nothing to see and nothing to report. An untested automatic path
 * is a path that only production tests.
 *
 * THE CLOCK IS THE INPUT, so the clock is what is faked. Date.now is replaced
 * before the scripts are evaluated and moved forward by hand; nothing else is
 * stubbed, and the real endpoint answers the real request.
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { onRequestGet as dailyGet } from "../../functions/api/scrambled/daily.js";
import { onRequestPost as revealPost } from "../../functions/api/scrambled/reveal.js";
import { SC_BOARDS } from "../../functions/_lib/sc-boards.js";
import { slotHint, hintLabel } from "../../functions/_lib/sc-board.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const ORIGIN = "http://localhost";
let calls = [];
const ROUTES = {
  "/api/scrambled/daily": (req) => dailyGet({ request: req }),
  "/api/scrambled/reveal": (req) => revealPost({ request: req }),
};
async function routedFetch(input, init) {
  const url = new URL(String(input), ORIGIN);
  calls.push(url.pathname);
  const h = ROUTES[url.pathname];
  if (!h) throw new Error("no route for " + url.pathname);
  return h(new Request(url.href, init));
}

const dom = new JSDOM(fs.readFileSync("football/scrambled/index.html", "utf8"), {
  url: ORIGIN + "/football/scrambled/?no=1",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;
const doc = window.document;
window.fetch = routedFetch;
window.Request = Request;
window.Response = Response;

/* The fake clock, installed before the game reads it. */
let NOW = 1750000000000;
window.Date.now = () => NOW;

for (const f of ["football/scrambled/js/config.js", "football/scrambled/js/scoring.js", "football/scrambled/js/game.js"]) {
  window.eval(fs.readFileSync(f, "utf8"));
}
const $ = (id) => doc.getElementById(id);
const board = SC_BOARDS[0];
const CFG = window.SCX_CONFIG;

await settle(20);
$("homeDaily").dispatchEvent(new window.Event("click"));
await settle(20);

console.log("\n=== Before half time ===");
t("the board is being played", $("clockValue").textContent === "0");
t("and nothing has been given away yet",
  doc.querySelectorAll(".slot .hint").length === 0);
const callsBefore = calls.filter((c) => c === "/api/scrambled/reveal").length;
t("nothing has been bought either", callsBefore === 0);

/* Half time is a MATCH minute; the real clock is what the player experiences,
   and config states the ratio once. Derived here rather than written down, so
   changing the match length in config cannot leave this suite testing a
   moment that is no longer half time. */
const halfTimeRealSeconds =
  (CFG.HALF_TIME_MINUTE / 90) * CFG.MATCH_CLOCK_REAL_SECONDS;

console.log("\n=== The manager speaks ===");
NOW += (halfTimeRealSeconds + 1) * 1000;
/* The ticker runs on a 500ms interval, so this waits in real time rather than
   draining microtasks: the tick is what calls the team talk. */
await new Promise((r) => setTimeout(r, 700));
await settle(20);

t("the clock reached half time",
  Number($("clockValue").textContent) >= CFG.HALF_TIME_MINUTE,
  "minute " + $("clockValue").textContent);

const owed = board.slots.filter((s) => slotHint(board, s.id)).length;
t("every hint the board has is now on the pitch",
  doc.querySelectorAll(".slot .hint").length === owed,
  doc.querySelectorAll(".slot .hint").length + " shown, " + owed + " owed");
t("and that is the whole XI, or this proves nothing", owed > 1, owed + " slots");
t("the manager said so", /half time/i.test($("feedback").textContent),
  $("feedback").textContent);
/* hintField is a data key. It read "every clubs, free" until the noun was
   taken off the board's own label instead, and nothing would have caught it:
   the sentence was grammatical enough to survive a glance.

   Asserted POSITIVELY — the sentence contains the noun the board states —
   rather than as "does not contain the data key". The negative form was
   written first and was vacuous: a backslash-b written into a JS string is a
   backspace character, not a word boundary, so the regex hunted U+0008 and
   matched nothing ever. It passed its own sabotage while the screen plainly
   read "every clubs, free". */
const NOUN = hintLabel(board).replace(/^Reveal /, "");
t("in the board's own words", $("feedback").textContent.includes(NOUN),
  "expected " + JSON.stringify(NOUN) + " in: " + $("feedback").textContent);

console.log("\n=== Free means free ===");
t("it cost nothing", Number($("helpSpent").textContent) === 0,
  "spent " + $("helpSpent").textContent);
t("and the board is still worth what the clock says it is",
  Number($("worthNow").textContent) ===
    window.SCX_SCORING.computeScore(
      Math.round((NOW - 1750000000000) / 1000), 0).score);

/* One request, not eleven. The rewrite's whole point, and the thing that would
   regress silently back to a fan-out that mostly works. */
const revealCalls = calls.filter((c) => c === "/api/scrambled/reveal").length;
t("the whole board was asked for in one request", revealCalls === 1,
  revealCalls + " reveal request(s)");

console.log("\n=== Once, not every tick ===");
NOW += 60 * 1000;
await new Promise((r) => setTimeout(r, 700));
await settle(20);
t("a later tick does not ask again",
  calls.filter((c) => c === "/api/scrambled/reveal").length === 1);
t("and the bench cannot sell what was given",
  (() => {
    const tile = doc.querySelector(".slot:not(.solved)");
    tile.dispatchEvent(new window.Event("click"));
    return $("buyHint").disabled;
  })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
