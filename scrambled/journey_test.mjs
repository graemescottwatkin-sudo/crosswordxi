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
import { slotHint, topClubs } from "../functions/_lib/sc-board.js";

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
  /* The play counter, captured rather than served: what the page SENDS is
     the thing under test, and the real route is proven by play_test. */
  "/api/play": async (req) => {
    let body = null;
    try { body = await req.json(); } catch (e) { body = { bad: true }; }
    plays.push(body);
    return new Response(JSON.stringify({ ok: true, playNo: plays.length }),
      { headers: { "Content-Type": "application/json" } });
  },
};
const plays = [];   /* every body the page posts to /api/play, in order */

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

/* The shared play helper too, as the page loads it: the engine counts
   attempts through it, and a suite that left it out would prove nothing
   about the counting. */
/* The drawn keyboard is loaded too, because the page loads it: a name typed
   on the keys has to reach the same place a name typed on a real keyboard
   does, and leaving it out would test one of the two ways in. */
for (const f of ["shared/xi-plays.js", "shared/xi-keys.js", "scrambled/js/config.js", "scrambled/js/scoring.js", "scrambled/js/game.js"]) {
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
  /* The kicker is set in caps by the landing, the way the other two games
     set theirs. Compared case-insensitively so this asserts WHICH board is
     named rather than how the shell chooses to shout it. */
  $("startKicker").textContent.toUpperCase() === "BOARD #1",
  $("startKicker").textContent);
t("and states the pool, so nobody is guessing at the whole of football",
  $("startPool").textContent === board.pool);
/* The pool line is the fix for the draft's biggest playtest finding: the first
   build never said what the eleven WAS, so the player assumed a frame, never
   searched outside it, and three names were unreachable by construction. */
t("the pool line is not empty", $("startPool").textContent.length > 20);

$("homeDaily").dispatchEvent(new window.Event("click"));
await settle();

t("the pitch is up", shown("screenGame"));
/* HOW FAR PEOPLE GET, now counted here too: kick off posts a start naming
   this game and this board, through the family's helper. */
t("kick off posts a play start naming the game and the board",
  plays.length === 1 && plays[0].event === "start" && plays[0].game === "scrambled" &&
  /* Board one, because the page was opened at ?no=1 and the kicker said so. */
  plays[0].boardKey === "sc:1" && plays[0].total === 11 &&
  typeof plays[0].playId === "string" && plays[0].playId.length >= 8,
  plays.length + " posted: " + plays.map((p) => p.event + (p.boardKey ? " " + p.boardKey : "")).join(", "));
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

/* THE CLUBS ARRIVE WITH THE SOLVE, not after it. The browser holds no names,
   so if they did not ride down with the answer the tile would paint twice. */
const SOLVED_TILE = doc.querySelector(".slot.solved");
const EXPECT = topClubs(board.slots[7]);
t("a solved tile names the clubs underneath",
  !!SOLVED_TILE.querySelector(".clubs"),
  SOLVED_TILE.querySelector(".clubs")
    ? SOLVED_TILE.querySelector(".clubs").textContent : "(no clubs element)");
t("two at most, most-appeared first", EXPECT.length <= 2 && EXPECT.length > 0,
  EXPECT.map((c) => c.club + " " + c.apps).join(" | "));
t("and it is those clubs, with their appearances",
  SOLVED_TILE.querySelector(".clubs").textContent ===
    EXPECT.map((c) => (c.apps ? c.club + " " + c.apps : c.club)).join(" · "));
t("an unsolved tile names none of them",
  [...doc.querySelectorAll(".slot:not(.solved)")].every((el) => !el.querySelector(".clubs")));
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

/* ---- A FINISHED NAME SENDS ITSELF ---------------------------------------

   Pressing Enter after typing a name you have already worked out asks
   nothing. The page can tell without asking the server: it holds each slot's
   scramble, so when the typed letters use a slot's letters up exactly, that
   guess is the only one worth sending — and it is one that was going to be
   sent anyway. This removes a keystroke, not a round trip.

   MEASURED IN REQUESTS, NOT IN OUTCOMES. The first draft of this section
   asserted that a partial name "sends nothing" by checking that nothing was
   SOLVED — which is true whether or not a guess went up, because a partial
   name is wrong either way. Six deliberate breakages walked straight through
   it. What the rule is actually about is how many guesses reach the server,
   so that is what is counted now.

   Typed as a person types, one letter at a time through the input event, and
   Enter is never pressed: the submit button is not touched anywhere below. */
console.log("\n=== A finished name sends itself ===");
const guesses = () => calls.filter((c) => c === "/api/scrambled/guess").length;
const unsolvedTile = () => board.slots.find((s) => {
  const el = doc.querySelector('.slot[data-slot="' + s.id + '"]');
  return !el.classList.contains("solved") && !el.classList.contains("given");
});
const truthFor = (slot) => SC_BOARDS[0].slots.find((x) => x.id === slot.id);
const lettersOf = (name) => name.toUpperCase().replace(/[^A-Z]/g, "");

async function typeOut(text) {
  $("answer").value = "";
  $("answer").dispatchEvent(new window.Event("input"));
  for (const ch of text.replace(/[^A-Za-z]/g, "")) {
    $("answer").value += ch;
    $("answer").dispatchEvent(new window.Event("input"));
    await settle(2);
  }
  await settle(12);
}
{
  const target = unsolvedTile();
  const truth = truthFor(target);
  const full = lettersOf(truth.name);

  /* PART OF A NAME IS NOT A NAME. Every letter up to the last one leaves
     letters unused, so nothing is sent — this is what stops the rule becoming
     a request per keystroke, and it is counted rather than inferred. */
  let sentBefore = guesses();
  await typeOut(full.slice(0, -1));
  t("typing all but the last letter sends no guess at all",
    guesses() === sentBefore && $("answer").value !== "",
    (guesses() - sentBefore) + " requests for " + (full.length - 1) + " keystrokes");

  sentBefore = guesses();
  const solvedBefore = doc.querySelectorAll(".slot.solved").length;
  await typeOut(truth.name);
  t("and the last letter sends exactly one, with no Enter pressed",
    guesses() === sentBefore + 1, (guesses() - sentBefore) + " requests");
  t("which solves the tile", doc.querySelectorAll(".slot.solved").length === solvedBefore + 1 &&
    doc.querySelector('.slot[data-slot="' + target.id + '"]').classList.contains("solved"),
    truth.name);
  t("and the box is cleared, ready for the next one", $("answer").value === "");

  /* A TILE ALREADY SOLVED IS NOT CONSIDERED AGAIN. Its letters are still on
     the board; typing them a second time must go nowhere. */
  sentBefore = guesses();
  await typeOut(truth.name);
  t("retyping a name already solved sends nothing",
    guesses() === sentBefore, (guesses() - sentBefore) + " requests");
  $("answer").value = "";
  $("answer").dispatchEvent(new window.Event("input"));
}
{
  /* ONE GUESS IN THE AIR AT A TIME. Auto-submit fires from a keystroke, so a
     held key or a repeated event would send the same guess twice and be
     answered twice. Both events are dispatched before anything is awaited, so
     the second arrives while the first is still in flight — which is the only
     moment the guard is doing anything. */
  const target = unsolvedTile();
  const truth = truthFor(target);
  $("answer").value = "";
  $("answer").dispatchEvent(new window.Event("input"));
  $("answer").value = lettersOf(truth.name);
  const sentBefore = guesses();
  $("answer").dispatchEvent(new window.Event("input"));
  $("answer").dispatchEvent(new window.Event("input"));
  await settle(12);
  t("a repeated keystroke does not send the same guess twice",
    guesses() === sentBefore + 1, (guesses() - sentBefore) + " requests");
  $("answer").value = "";
  $("answer").dispatchEvent(new window.Event("input"));
}
{
  /* THE DRAWN KEYBOARD TAKES THE SAME ROUTE. It is a different path into the
     box — the shared keys append and repaint — and it must land in the same
     place a real keyboard does. */
  const target = unsolvedTile();
  const truth = truthFor(target);
  const keyFor = (ch) => [...doc.querySelectorAll(".osk-key")]
    .find((k) => k.textContent === ch);
  t("the shared keyboard is on the page", doc.querySelectorAll(".osk-key").length === 28,
    doc.querySelectorAll(".osk-key").length + " keys");
  const sentBefore = guesses();
  const solvedBefore = doc.querySelectorAll(".slot.solved").length;
  for (const ch of lettersOf(truth.name)) {
    const k = keyFor(ch);
    if (k) k.dispatchEvent(new window.Event("pointerdown", { bubbles: true, cancelable: true }));
    await settle(2);
  }
  await settle(12);
  t("a name typed on the drawn keys sends itself too, exactly once",
    guesses() === sentBefore + 1 &&
    doc.querySelectorAll(".slot.solved").length === solvedBefore + 1,
    truth.name + " — " + (guesses() - sentBefore) + " requests");
}
{
  /* AN ALIAS STILL NEEDS ENTER, and should: it is not an arrangement of the
     letters on the tile, so nothing on this page can see that it is finished.
     The rule is about letters running out, not about being right. */
  const aliasSlot = board.slots.find((s) => {
    const el = doc.querySelector('.slot[data-slot="' + s.id + '"]');
    const truth = truthFor(s);
    return truth && !el.classList.contains("solved") && !el.classList.contains("given") &&
      (truth.aliases || []).some((a) => lettersOf(a).length !== lettersOf(truth.name).length);
  });
  t("the board has an alias longer or shorter than its name to check with",
    !!aliasSlot);
  if (aliasSlot) {
    const truth = truthFor(aliasSlot);
    const alias = truth.aliases.find((a) => lettersOf(a).length !== lettersOf(truth.name).length);
    const sentBefore = guesses();
    const solvedBefore = doc.querySelectorAll(".slot.solved").length;
    await typeOut(alias);
    t("an alias is not sent on its own, because its letters are not the tile's",
      guesses() === sentBefore, alias + " — " + (guesses() - sentBefore) + " requests");
    $("submit").dispatchEvent(new window.Event("click"));
    await settle(12);
    t("and pressing Enter still solves it",
      doc.querySelectorAll(".slot.solved").length === solvedBefore + 1, alias);
  }
}
{
  /* THE HONEST COST. The letters of a name in the wrong order are still that
     name's letters, so a shuffle is sent and answered. Nothing is lost — a
     wrong guess costs nothing here — and the box keeps what was typed so it
     can be rearranged rather than retyped. */
  const target = unsolvedTile();
  const truth = truthFor(target);
  const letters = lettersOf(truth.name);
  const shuffled = letters.slice(1) + letters[0];
  if (shuffled !== letters) {
    const sentBefore = guesses();
    const solvedBefore = doc.querySelectorAll(".slot.solved").length;
    await typeOut(shuffled);
    t("the right letters in the wrong order are sent, and answered",
      guesses() === sentBefore + 1 &&
      doc.querySelectorAll(".slot.solved").length === solvedBefore &&
      /Not on this board/.test($("feedback").textContent),
      shuffled + " -> " + $("feedback").textContent);
    t("and what was typed is left in the box to be rearranged",
      lettersOf($("answer").value) === shuffled);
  }
  $("answer").value = "";
  $("answer").dispatchEvent(new window.Event("input"));
}
{
  /* PUNCTUATION IS NOT A LETTER. A scramble keeps the hyphen in
     MAITLAND-NILES and the space in VAN DIJK; what is typed is stripped to
     letters. So the rule asks whether any LETTER is left over, not whether
     the remainder is empty — written the other way, no hyphenated or two-word
     name would ever send itself. Those boards are not the one on screen, so
     the page's own predicate is exercised on them directly: the predicate
     itself, not the helper underneath it, because the line that decides this
     is the one being checked. */
  const usedUp = window.__scx.lettersUsedUp;
  const punctuated = SC_BOARDS.flatMap((b) => b.slots)
    .filter((s) => /[^A-Z]/.test(s.scramble));
  t("the sample bank has names with punctuation to check against",
    punctuated.length > 0, punctuated.map((s) => s.scramble).join(", "));
  t("a fully typed punctuated name counts as finished",
    punctuated.every((s) => usedUp(s.scramble, lettersOf(s.name))),
    punctuated.map((s) => s.name).join(", "));
  t("and one letter short does not",
    punctuated.every((s) => !usedUp(s.scramble, lettersOf(s.name).slice(0, -1))));
  /* And it is not simply saying yes to everything. */
  t("nor do the letters of a different name",
    punctuated.every((s) => !usedUp(s.scramble, "ZZZZ")));
}
{
  /* A GUESS THAT NEVER LANDED MUST NOT LOCK THE BOX. The in-flight guard is
     what stops one keystroke sending two guesses; if a dropped request left
     it raised, every later guess would be refused in silence and the game
     would look like it had stopped taking names. */
  const target = unsolvedTile();
  const truth = truthFor(target);
  const real = ROUTES["/api/scrambled/guess"];
  ROUTES["/api/scrambled/guess"] = () => { throw new Error("network down"); };
  await typeOut(truth.name);
  t("a guess that fails to reach the server says so", /did not reach/.test($("feedback").textContent),
    $("feedback").textContent);
  ROUTES["/api/scrambled/guess"] = real;
  const solvedBefore = doc.querySelectorAll(".slot.solved").length;
  await typeOut(truth.name);
  t("and the next guess is still accepted, rather than refused in silence",
    doc.querySelectorAll(".slot.solved").length === solvedBefore + 1, truth.name);
}

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
/* THE ECHO. On a phone the keyboard scrolls the pitch away, so the picked
   tile is repeated above the box: its position, its letters and its
   enumeration, with the letters lifting as they are typed. */
t("and echoes the picked tile above the box",
  !$("echo").hidden && $("echoPos").textContent === pickedSlot.pos &&
  $("echoLetters").textContent === pickedSlot.scramble &&
  $("echoEnum").textContent === "(" + pickedSlot.len.join(",") + ")" &&
  $("echoLifted").textContent === "");
{
  const first = pickedSlot.scramble.replace(/[^A-Z]/g, "")[0];
  $("answer").value = first.toLowerCase();
  $("answer").dispatchEvent(new window.Event("input"));
  t("a typed letter lifts out of the echo as it lifts out of the tile",
    $("echoLifted").textContent === first &&
    $("echoLetters").textContent.replace(/[^A-Z]/g, "").length ===
      pickedSlot.scramble.replace(/[^A-Z]/g, "").length - 1,
    $("echoLifted").textContent + " · " + $("echoLetters").textContent);
  $("answer").value = "";
  $("answer").dispatchEvent(new window.Event("input"));
  t("and clearing the box puts it back", $("echoLetters").textContent === pickedSlot.scramble);
}
t("the bench names what this board sells",
  $("hintLabel").textContent === SELLS,
  "read from the board, not written down: the Daily sells a career");

const before = Number($("worthNow").textContent);
$("buyHint").dispatchEvent(new window.Event("click"));
await settle(12);
/* ONE PURCHASE, THE WHOLE BOARD. Counted against what the board can actually
   answer for rather than against eleven: a slot whose player has no career on
   file never gets one, and asserting eleven would fail on honest data. */
const solvedNow = new Set([...doc.querySelectorAll(".slot.solved")].map((el) => el.dataset.slot));
const owed = board.slots.filter((sl) => !solvedNow.has(sl.id) && slotHint(board, sl.id)).length;
t("the whole XI is revealed, not the one tile",
  doc.querySelectorAll(".slot .hint").length === owed,
  doc.querySelectorAll(".slot .hint").length + " tiles carry a career, " + owed + " owed");
t("and it is more than the tile that was picked, or this proves nothing",
  owed > 1, owed + " unsolved tiles have a career");
t("exactly one of them is the one in front",
  doc.querySelectorAll(".slot .hint.focus").length === 1);
t("and it is the tile the player picked",
  tile().querySelector(".hint").classList.contains("focus"));
t("the bench repeats that one where it can be read",
  !$("benchHint").hidden && $("benchHint").textContent === slotHint(board, pickedSlot.id));
t("and it cost points", Number($("helpSpent").textContent) === 3);
t("which came off what the board is worth", Number($("worthNow").textContent) === before - 3);

t("and the board cannot be bought a second time", $("buyHint").disabled);
/* The disabled attribute is a courtesy to the player, not the guard. A
   dispatched click reaches a disabled button here exactly as a scripted one
   would in a real browser, so the refusal has to live in the code and this is
   what proves it does. */
$("buyHint").dispatchEvent(new window.Event("click"));
await settle(12);
t("and a second click charges nothing", Number($("helpSpent").textContent) === 3,
  "spent " + $("helpSpent").textContent);
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

/* Counted before, not written down. This asserted a solved count of 2, which
   was how many happened to be solved by this point in the suite — so adding a
   check anywhere above it turned it red for a reason that had nothing to do
   with what it is about. What it means is that a name you bought does not
   join the ones you worked out, and that reads the same however many of those
   there are. */
const solvedBeforeReveal = doc.querySelectorAll(".slot.solved").length;
$("buyName").dispatchEvent(new window.Event("click"));
await settle(12);
t("revealing the name ends that slot", doc.querySelectorAll(".slot.given").length === 1);
t("and it is marked given, not unravelled",
  doc.querySelectorAll(".slot.solved").length === solvedBeforeReveal,
  solvedBeforeReveal + " unravelled before it, and after");
t("the bench closes behind it", $("benchRow").hidden);

console.log("\n=== Full time ===");
for (const s of board.slots) {
  if (doc.querySelector(`.slot[data-slot="${s.id}"]`).classList.contains("solved") ||
      doc.querySelector(`.slot[data-slot="${s.id}"]`).classList.contains("given")) continue;
  await type(s.name);
}
t("solving the eleventh ends the match", shown("screenResults"), "no button to press");
/* AND THE BOARD IS STILL THERE. The four screens were exclusive, so the
   moment the eleventh name went in the pitch was hidden and all that was left
   was a score and a block of share text — the finished XI, which is the whole
   payoff, thrown away at the instant it was finished. The crossword never did
   it: its result opens beside the grid. So the result now sits UNDER the
   board rather than instead of it, and what goes away is the controls for a
   round that is over. */
t("and the finished board is still on screen, not replaced by the card",
  shown("screenGame") && doc.querySelectorAll(".slot").length === 11,
  doc.querySelectorAll(".slot.solved, .slot.given").length + " of 11 tiles still drawn");
t("marked finished, so the answer box and the bench go",
  $("screenGame").classList.contains("finished"),
  $("screenGame").className);
/* The eleven names are readable on it — the thing the player just earned. */
t("and the tiles read the names rather than the cypher",
  [...doc.querySelectorAll(".slot")].every((el) => {
    const txt = (el.querySelector(".letters") || {}).textContent || "";
    return txt.length > 0;
  }) && board.slots.some((sl) =>
    doc.querySelector(`.slot[data-slot="${sl.id}"] .letters`).textContent
      .includes(String(sl.name).split(" ").pop())));
/* The end: the same attempt, finished, eleven of eleven, the help spent in
   detail. Sent by fetch here — the beacon path is the page-leaving one. */
{
  const end = plays.find((p) => p.event === "end");
  t("full time posts the play's end: finished, eleven of eleven, help in detail",
    !!end && end.playId === plays[0].playId && end.game === "scrambled" && end.completed === true &&
    end.solved === 11 && end.detail && typeof end.detail.help === "number" &&
    typeof end.detail.revealed === "number",
    JSON.stringify(end || null));
}
t("the Full Time card shows a score out of 114",
  /\/ 114$/.test(doc.querySelector(".ftScore").textContent),
  doc.querySelector(".ftScore").textContent);
t("it lists all eleven", doc.querySelectorAll(".ftList li").length === 11);
t("and separates unravelled from given", (() => {
  const hows = [...doc.querySelectorAll(".ftList .how")].map((e) => e.textContent);
  return hows.filter((h) => h === "given").length === 1 &&
         hows.filter((h) => h === "unravelled").length === 10;
})());
/* THE NOTE CHANGED WITH THE GAME. It used to say nothing was recorded, which
   was true when there was no result store; the game banks a result now, on
   the device and on the account. What is still true is that the SCORE was
   worked out in the browser with no play row behind it, so the card says that
   and does not claim a verified time.

   Both halves are asserted, because a note that dropped either would be
   wrong in a different direction: silent about the record, or overclaiming
   the score. */
t("the card says the result is kept", (() => {
  const note = doc.querySelector(".ftUnverified");
  return !!note && /record/i.test(note.textContent);
})());
t("and does not claim the score is verified", (() => {
  const note = doc.querySelector(".ftUnverified");
  return !!note && /not a verified/i.test(note.textContent);
})(), (doc.querySelector(".ftUnverified") || {}).textContent);
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
