/* journey_test.mjs — one board, played from kick off to Full Time, through the
 * real page, the real engine and the real endpoint handlers.
 *
 *   npm install -D jsdom --no-save
 *   node scrambled/journey_test.mjs        (from the repo root)
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL. The other three suites test the
 * builder, the name rules and the arithmetic — none of them has ever run
 * game.js or an endpoint. `node --check` proves a file parses, not that it
 * runs, and this project has already shipped a live_check whose HEAD block
 * referenced a variable from the other game's file and crashed on first
 * contact with production. So: no stub engine, no reimplemented marking. The
 * page's own markup, its own scripts, and the same three handlers Cloudflare
 * would invoke.
 *
 * The one thing faked is the network hop. fetch() is routed straight into the
 * handler functions, so a payload that would not survive the wire — a name in
 * the JSON, a token the server refuses — fails here the same way.
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { onRequestGet as dailyGet } from "../functions/api/scrambled/daily.js";
import { onRequestPost as guessPost } from "../functions/api/scrambled/guess.js";
import { onRequestPost as revealPost } from "../functions/api/scrambled/reveal.js";
import { SC_BOARDS } from "../functions/_lib/sc-boards.js";

/* The name this suite solves with, taken from board one rather than written
   down. It was "beckham", true of the 1999 final and false the day the bank
   became the Daily boards — the suite then crashed rather than failed, because
   nothing matched and it read .textContent off null. A fixture that names a
   player is a fixture that expires; the board already knows who is on it. */
const ONE_NAME = SC_BOARDS[0].slots[7].name;
/* The cypher is what gets scrambled; the reveal is what the solved tile
   reads. They are different strings and the difference is the point. */
const ONE_REVEAL = SC_BOARDS[0].slots[7].display;
/* An alias belonging to a DIFFERENT slot, so typing it solves a second tile.
   Was "Andy Cole", true of the 1999 board only. */
const ALIAS_SLOT = SC_BOARDS[0].slots.find((s) => s.name !== ONE_NAME && (s.aliases || []).length);
const ONE_ALIAS = ALIAS_SLOT.aliases[0];
/* A real footballer this board does not field. Checked against the board
   rather than assumed, so it cannot quietly become one of the eleven. */
const NOT_HERE = ["ROY KEANE", "PELE", "MARADONA", "ZIDANE"]
  .find((n) => !SC_BOARDS[0].slots.some((s) => s.name === n || (s.aliases || []).includes(n)));
/* What this board sells, from the board. */
const SELLS = SC_BOARDS[0].hintField === "clubs" ? "Reveal career"
  : SC_BOARDS[0].hintField === "club" ? "Reveal club" : "Reveal nationality";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* Let every pending promise settle. The engine is fetch-driven, so an
   assertion made too early tests the screen before the answer arrived — and
   reading a Response body goes through the task queue, not just the microtask
   queue, so awaiting Promise.resolve() in a loop is NOT enough. That mistake
   made the first run of this suite report a correct guess as unsolved. */
const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const ORIGIN = "http://localhost";
const ROUTES = {
  "/api/scrambled/daily": (req) => dailyGet({ request: req }),
  "/api/scrambled/guess": (req) => guessPost({ request: req }),
  "/api/scrambled/reveal": (req) => revealPost({ request: req }),
};

let calls = [];
async function routedFetch(input, init) {
  const url = new URL(String(input), ORIGIN);
  const handler = ROUTES[url.pathname];
  calls.push(url.pathname);
  if (!handler) throw new Error("no route for " + url.pathname);
  return handler(new Request(url.href, init));
}

/* PINNED TO BOARD ONE, NOT LEFT ON TODAY'S.
   The first version of this suite assumed today's board was board one and
   asserted BECKHAM against it. That was true when it was written and false
   thirty-five minutes later, when the container clock crossed midnight UTC and
   the ring moved on to the 1966 board. A suite whose result depends on the
   date is a suite that goes red for a reason nobody can act on. The archive is
   open to any board up to today, so #1 is always reachable and always the
   same. */
const dom = new JSDOM(fs.readFileSync("scrambled/index.html", "utf8"), {
  url: ORIGIN + "/scrambled/?no=1",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;
const doc = window.document;
window.fetch = routedFetch;
/* The engine posts Requests built from these; jsdom does not supply them. */
window.Request = Request;
window.Response = Response;

for (const f of ["scrambled/js/config.js", "scrambled/js/scoring.js", "scrambled/js/game.js"]) {
  window.eval(fs.readFileSync(f, "utf8"));
}

const $ = (id) => doc.getElementById(id);
const board = SC_BOARDS[0];
const shown = (id) => !$(id).hidden;

await settle(20);

console.log("\n=== Kick off ===");
t("the engine asked the server for a board", calls.includes("/api/scrambled/daily"));
t("the start card is up, not the loading card", shown("screenStart") && !shown("screenLoading"));
t("it names the board", $("startTitle").textContent === board.title);
/* And it asked for the board this suite pins, not whichever one is today's —
   the assertion that would have caught the date dependency straight away. */
t("and it is the board that was asked for",
  calls[0] === "/api/scrambled/daily" &&
  $("startKicker").textContent === "Board #1",
  $("startKicker").textContent);
t("and states the pool, so nobody is guessing at the whole of football",
  $("startPool").textContent === board.pool);
/* The pool line is the fix for the draft's biggest playtest finding: the first
   build never said what the eleven WAS, so the player assumed a frame, never
   searched outside it, and three names were unreachable by construction. */
t("the pool line is not empty", $("startPool").textContent.length > 20);

$("kickOff").dispatchEvent(new window.Event("click"));
await settle();

t("the pitch is up", shown("screenGame"));
t("eleven tiles are drawn", doc.querySelectorAll(".slot").length === 11);
t("none of them is solved yet", doc.querySelectorAll(".slot.solved").length === 0);
t("every tile shows its scramble, not its name", (() => {
  const text = doc.getElementById("pitch").textContent.toUpperCase();
  return board.slots.every((s) => text.includes(s.scramble) && !text.includes(s.name));
})(), "the letters are the game; the spelling is not");
t("every tile carries an enumeration",
  doc.querySelectorAll(".slot .enum").length === 11);
t("the clock starts at 0'", $("clockValue").textContent === "0");
t("and the board is worth the full 114", $("worthNow").textContent === "114");

console.log("\n=== Marking a guess ===");
async function type(text) {
  $("answer").value = text;
  $("submit").dispatchEvent(new window.Event("click"));
  await settle(12);
}

await type(ONE_NAME.toLowerCase());
t("a correct name in the wrong case still solves",
  doc.querySelectorAll(".slot.solved").length === 1);
t("the tile now reads the whole name, not the cypher",
  doc.querySelector(".slot.solved .letters").textContent === ONE_REVEAL,
  ONE_NAME + " -> " + ONE_REVEAL);
t("and the reveal says more than the letters the player was given",
  ONE_REVEAL !== ONE_NAME);
t("the counter moved", $("solvedCount").textContent === "1");
t("and the box is cleared for the next one", $("answer").value === "");

await type(ONE_ALIAS);
t("an alias solves too", doc.querySelectorAll(".slot.solved").length === 2);

await type(NOT_HERE);
t("a real footballer who is not on this board does not solve",
  doc.querySelectorAll(".slot.solved").length === 2, NOT_HERE + " is not on this board");
t("and the player is told so", /not on this board/i.test($("feedback").textContent));

await type(ONE_NAME.toLowerCase());
t("solving the same name twice does not solve a second tile",
  doc.querySelectorAll(".slot.solved").length === 2);

console.log("\n=== The bench ===");
/* The pitch is rebuilt after every change, so an element captured once is
   detached a moment later. Hold the SLOT ID and re-query — the first draft of
   this suite held the node, and its "revealed letter" assertion then passed
   against stale text that happened to contain every letter of the name. A
   check that cannot fail is worse than no check. */
const pickedId = [...doc.querySelectorAll(".slot")]
  .find((el) => !el.classList.contains("solved")).dataset.slot;
const tile = () => doc.querySelector(`.slot[data-slot="${pickedId}"]`);
const pickedSlot = board.slots.find((s) => s.id === pickedId);
tile().dispatchEvent(new window.Event("click"));
await settle();
t("picking a tile opens the bench", !$("benchRow").hidden);
t("the bench names what this board sells",
  $("hintLabel").textContent === SELLS,
  "read from the board, not written down: the Daily sells a career");

const before = Number($("worthNow").textContent);
$("buyHint").dispatchEvent(new window.Event("click"));
await settle(12);
t("a hint appears on the tile", doc.querySelectorAll(".slot .hint").length === 1);
t("and it cost points", Number($("helpSpent").textContent) === 3);
t("which came off what the board is worth", Number($("worthNow").textContent) === before - 3);

t("buying the same hint twice is refused", $("buyHint").disabled);
$("buyLetter").dispatchEvent(new window.Event("click"));
await settle(12);
t("and cost two", Number($("helpSpent").textContent) === 5);
/* Non-vacuous on purpose: the scramble contains every letter of the name, so
   "the tile mentions the first letter somewhere" is true of an untouched tile.
   What is asserted is the PREFIX before the separator. */
t("the revealed letter is the real first letter, in position", (() => {
  const shownLetters = tile().querySelector(".letters").textContent;
  const prefix = shownLetters.split("\u00B7")[0].trim();
  return prefix === pickedSlot.name.replace(/[^A-Z]/g, "")[0];
})(), tile().querySelector(".letters").textContent);
t("and the rest of the bag is one letter shorter", (() => {
  const rest = tile().querySelector(".letters").textContent.split("\u00B7")[1].trim();
  return rest.length === pickedSlot.scramble.length - 1;
})());

$("buyName").dispatchEvent(new window.Event("click"));
await settle(12);
t("revealing the name ends that slot", doc.querySelectorAll(".slot.given").length === 1);
t("and it is marked given, not unravelled",
  doc.querySelectorAll(".slot.solved").length === 2);
t("the bench closes behind it", $("benchRow").hidden);

console.log("\n=== Full time ===");
for (const s of board.slots) {
  if (doc.querySelector(`.slot[data-slot="${s.id}"]`).classList.contains("solved") ||
      doc.querySelector(`.slot[data-slot="${s.id}"]`).classList.contains("given")) continue;
  await type(s.name);
}
t("solving the eleventh ends the match", shown("screenResults"), "no button to press");
t("the Full Time card shows a score out of 114",
  /\/ 114$/.test(doc.querySelector(".ftScore").textContent),
  doc.querySelector(".ftScore").textContent);
t("it lists all eleven", doc.querySelectorAll(".ftList li").length === 11);
t("and separates unravelled from given", (() => {
  const hows = [...doc.querySelectorAll(".ftList .how")].map((e) => e.textContent);
  return hows.filter((h) => h === "given").length === 1 &&
         hows.filter((h) => h === "unravelled").length === 10;
})());
/* The honest note. There is no play row, so this number was assembled in the
   browser. Saying so costs nothing; a leaderboard built on numbers nobody
   checked costs a lot. */
t("the card says the score is not verified",
  /not verified/i.test(doc.querySelector(".ftUnverified").textContent));
t("the share text does not leak the names", (() => {
  const share = $("shareText").value;
  return board.slots.every((s) => share.indexOf(s.name) === -1);
})(), "a shared result must be shareable before the other person has played");
t("but it does say how many were unravelled",
  /10 of 11 unravelled, 1 given/.test($("shareText").value), $("shareText").value.split("\n")[2]);

console.log("\n=== What the wire actually carried ===");
/* The SAME board the assertions below are about. Fetching the default here
   fetched today's board and compared it against board one's hint values, and
   the 1966 pool line contains the word "England" — so the check went red for a
   reason that had nothing to do with a leak. */
const payload = await (await routedFetch("/api/scrambled/daily?no=1")).json();
const wire = JSON.stringify(payload);
t("the daily payload holds no name",
  board.slots.every((s) => wire.indexOf(s.name) === -1));
t("no alias", board.slots.every((s) => (s.aliases || []).every((a) => wire.indexOf(a) === -1)));
t("and no hint value", board.slots.every((s) => wire.indexOf(s.nationality) === -1));
/* THE FUTURE, under whichever contract is in force — the same pairing
   board_test asserts. Closed is the live rule and shut by the SERVER's clock,
   because a number sent up is a number off a clock the player controls. Open
   is test mode while the game is unlaunched.
   Read from the source rather than assumed, so this suite states the contract
   the code actually runs instead of insisting on one it does not. */
const OPEN = /const OPEN_ARCHIVE = true/.test(
  fs.readFileSync("functions/_lib/sc-board.js", "utf8"));
const future = await routedFetch("/api/scrambled/daily?no=99999");
t(OPEN ? "a far board is served while the archive is open"
       : "a board in the future is refused with a 403",
  future.status === (OPEN ? 200 : 403), "HTTP " + future.status);
const stolen = await routedFetch("/api/scrambled/guess", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: "sc:99999", guess: ONE_NAME, solved: [] }),
});
t(OPEN ? "and a guess against it is marked rather than refused"
       : "and cannot be marked against either",
  stolen.status === (OPEN ? 200 : 403), "HTTP " + stolen.status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
