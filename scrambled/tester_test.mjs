/* tester_test.mjs — the generated tester is loaded and played.
 *
 *   npm install -D jsdom --no-save
 *   node scrambled/tester_test.mjs        (from the repo root)
 *
 * journey_test.mjs proves the SITE works: real page, real engine, real
 * handlers, fetch routed into them by the suite. This proves the FILE works:
 * scrambled-tester.html is loaded and its own inlined shim does the routing.
 *
 * They are not the same claim. The tester is a generated artefact and every
 * generator can produce something that parses and does not run — which is
 * exactly what happened on the first build, where all three handlers kept
 * their `export` keyword, `node --check` called the file fine because it saw
 * ESM syntax and checked it as a module, and the file would have been a syntax
 * error in every browser. Parsing is not running, and nothing short of running
 * it says so.
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
/* Read from the module, not off the tester's window: SC_BOARDS is a top-level
   `const` in the inlined script, and a top-level const is not a property of
   window. The tester's own controls reach it through script scope. */
import { SC_BOARDS } from "../functions/_lib/sc-boards.js";

/* The name this suite solves with, read from board one rather than written
   down. It was "beckham" — true of the 1999 final, false the day the bank
   became the Daily boards, and the suite then CRASHED rather than failed,
   reading .textContent off a tile that was never solved. */
const ONE_NAME = SC_BOARDS[0].slots[7].name;
/* The cypher is scrambled; the reveal is what a solved tile reads. The
   tester inlines the same boards, so it must carry the reveal too — if it
   were dropped in the inlining this is where that shows up. */
const ONE_REVEAL = SC_BOARDS[0].slots[7].display;

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}
const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const FILE = "scrambled-tester.html";
t("the tester has been built", fs.existsSync(FILE),
  "node tools/build_scrambled_tester.js");
if (!fs.existsSync(FILE)) process.exit(1);

const html = fs.readFileSync(FILE, "utf8");

console.log("\n=== The file, before it is run ===");
t("it is one file with no external references", (() => {
  const refs = [...html.matchAll(/<(?:script|link)[^>]*\b(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1]);
  return refs.length === 0;
})(), "it has to work from a Downloads folder with no network");
t("nothing of the shared chrome came with it",
  !/xic-bar|xic-drawer|xic-foot/.test(html),
  "a tester carrying the squad list would name unreleased games in markup");
t("and it is marked noindex", /name="robots" content="noindex/.test(html));
t("it says out loud that the answers are inside it",
  /answers are in this file|View Source gives the answers/i.test(html));

console.log("\n=== It runs ===");
/* Pinned to board one for the same reason journey_test is: the ring moves with
   the date, and a suite that asserts a name against "whichever board is
   today's" is red on some days and green on others. */
const dom = new JSDOM(html, {
  /* file:// on purpose: that is how it will actually be opened, and it is the
     case where an origin-relative fetch has nothing to resolve against, and
     where some browsers refuse localStorage. */
  url: "file:///home/graeme/Downloads/scrambled-tester.html?no=1",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(w) { w.Request = Request; w.Response = Response; },
});
const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const shown = (id) => !$(id).hidden;

await settle(20);

t("no script threw on load", !!$("screenStart"), "the whole game is one <script>");
t("the shim answered for the board", shown("screenStart"));
/* Counted against the TESTER's own bank, not the module's.
   The module became a four-board sample when the bank moved outside the
   repository; the tester is built from the full bank because a review tool
   that shows four of two hundred and sixty-two is not one. Comparing the
   picker to SC_BOARDS.length asserted that those two are the same set, which
   is now false by design — and it failed for that reason rather than for
   anything wrong with the picker. What the check is actually for is that the
   picker offers every board the tester carries, so that is what it reads. */
const testerBoards = (html.match(/"title":"/g) || []).length;
t("the board picker lists every board the tester carries",
  testerBoards > 0 && $("tstBoard").options.length === testerBoards,
  `${$("tstBoard").options.length} in the picker, ${testerBoards} in the file`);
t("and the pinned board is the one on screen",
  $("tstBoard").value === "1" && $("startTitle").textContent === SC_BOARDS[0].title,
  `picker says #${$("tstBoard").value}, screen says "${$("startTitle").textContent}"`);
t("the clock override is offered", $("tstClock").options.length === 3);

console.log("\n=== It plays ===");
$("homeDaily").dispatchEvent(new window.Event("click"));
await settle();
t("eleven tiles are drawn", doc.querySelectorAll(".slot").length === 11);

$("answer").value = ONE_NAME.toLowerCase();
$("submit").dispatchEvent(new window.Event("click"));
await settle(12);
t("a guess is marked by the inlined handler, not by the page",
  doc.querySelectorAll(".slot.solved").length === 1);
t("and the tile reads the whole name, not the cypher",
  doc.querySelector(".slot.solved .letters").textContent === ONE_REVEAL,
  ONE_NAME + " -> " + doc.querySelector(".slot.solved .letters").textContent);
t("which the inlining carried through", ONE_REVEAL !== ONE_NAME);

console.log("\n=== The tester's own controls ===");
$("tstKey").dispatchEvent(new window.Event("click"));
await settle();
const key = $("tstKeyPanel");
t("the answer key opens", key.classList.contains("open"));
t("it lists all eleven", key.querySelectorAll("li").length === 11);
t("with the scramble beside the name, for proofing",
  SC_BOARDS[0].slots.every((s) =>
    key.textContent.includes(s.scramble) && key.textContent.includes(s.name)));
t("and it names the source", key.textContent.includes(SC_BOARDS[0].source),
  "a board is a claim about who played");

/* The theme is a FAMILY fact. A tester writing it under this game's prefix
   would be the fault the word search already shipped once, when it wrote
   fcw.theme. */
$("tstTheme").dispatchEvent(new window.Event("click"));
await settle();
t("the theme flips", doc.documentElement.getAttribute("data-theme") === "dark");
/* The theme is a FAMILY fact and belongs under "xi.". A tester writing it
   under this game's prefix would repeat the fault the word search shipped once
   when it wrote fcw.theme. Where storage is blocked — which is the file://
   case this suite runs in — the assertion is that the game SURVIVES it, not
   that it wrote something. */
const storageOk = (() => {
  try { window.localStorage.setItem("probe", "1"); return true; } catch (e) { return false; }
})();
if (storageOk) {
  t("and it is stored under the family prefix, not this game's",
    window.localStorage.getItem("xi.theme") === "dark" &&
    window.localStorage.getItem("xisc.theme") === null);
} else {
  t("blocked storage does not break the game", !!$("screenGame") && !$("screenGame").hidden,
    "some browsers refuse localStorage on file:// and the engine must not care");
  t("and the tester says so rather than looking broken",
    /blocks storage/.test($("tstStore").textContent),
    $("tstStore").textContent.trim().slice(0, 60));
}

console.log("\n=== It is generated, and says so ===");
t("the file warns against editing it by hand",
  /GENERATED by tools\/build_scrambled_tester\.js/.test(html));
t("no ESM plumbing survived the inlining", (() => {
  const js = html.split("<script>")[1].split("</script>")[0];
  return !js.split("\n").some((l) => /^\s*(import|export)\s/.test(l));
})(), "the failure the first build shipped");

/* THE PICKER MUST SAY WHAT IS ON SCREEN, AND THAT CANNOT BE TESTED ON THE
   PINNED LOAD. With ?no=1 in the URL a picker hardcoded to "1" is also correct,
   so the assertion above passes either way — it was vacuous, and a sabotage
   putting the hardcode back did not turn it red. The defect only shows with no
   ?no= at all, which is how the file is actually opened: the engine loads
   whichever board today's number lands on, and the caption has to follow. */
console.log("\n=== Opened with no board asked for, which is how it is opened ===");
{
  const plain = new JSDOM(html, {
    url: "file:///home/graeme/Downloads/scrambled-tester.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) { w.Request = Request; w.Response = Response; },
  });
  await settle(20);
  const d = plain.window.document;
  const picked = Number(d.getElementById("tstBoard").value);
  const onScreen = d.getElementById("startTitle").textContent;
  /* Titles read from the TESTER, not from the module. The module is a
     four-board sample since the bank moved outside the repository; the tester
     carries the whole bank. Indexing SC_BOARDS here was right when they were
     the same set and became a latent bug when they stopped being — it kept
     passing only while today's board number stayed inside the sample, and went
     red the day the ring reached #5. A suite that breaks on a date is a suite
     that was asserting against the wrong source. */
  /* Titles read from the TESTER, not from the module. The module is a
     four-board sample since the bank moved outside the repository; the tester
     carries the whole bank. Indexing SC_BOARDS here was right when they were
     the same set and became a latent bug when they stopped being — it kept
     passing only while today's board number stayed inside the sample, and went
     red the day the ring reached #5. A suite that breaks on a date was
     asserting against the wrong source. */
  const testerTitles = [...html.matchAll(/"title":"([^"]*)"/g)].map((m) => m[1]);
  t("the picker names the board the engine loaded",
    !!testerTitles[picked - 1] && testerTitles[picked - 1] === onScreen,
    `picker says #${picked} (${testerTitles[picked - 1]}), screen says "${onScreen}"`);
  t("and it is today's board, derived from the same rotation the server uses",
    /* Compared case-insensitively: the landing sets the kicker in caps the
       way the other two games do, and what is asserted is WHICH board is
       named rather than how the shell shouts it. */
    d.getElementById("startKicker").textContent.toUpperCase() === "TODAY",
    d.getElementById("startKicker").textContent);
  plain.window.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
