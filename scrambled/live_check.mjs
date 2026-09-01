/* scrambled/live_check.mjs — what production is actually serving.
 *
 *   node scrambled/live_check.mjs --expect v001k
 *
 * Run AFTER a deploy. The deploy gate reads the tree; this reads the site, and
 * the two answer different questions: the gate says what would ship, this says
 * what did.
 *
 * THE FLOOR. MIN_ASSERTIONS is the second net under the completion marker: the
 * marker catches a crash, the floor catches a block that goes quiet without
 * crashing. It is set BELOW the run's real count on purpose, by the number of
 * assertions that can legitimately skip. When assertions are added, REVIEW the
 * floor rather than raising it by reflex — a floor set to the exact count
 * flaps on a legitimate skip, and a floor left alone for five releases stops
 * being able to refuse anything.
 */
const BASE = "https://www.thexigames.com";
const expectArg = process.argv.indexOf("--expect");
const EXPECT = expectArg > -1 ? process.argv[expectArg + 1] : null;

let pass = 0, fail = 0, warn = 0;
const t = (n, ok, d) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`);
};
const w = (n, d) => { warn++; console.log(`  ??  ${n}${d ? "  — " + d : ""}`); };

const MIN_ASSERTIONS = 18;
let finished = false;
const done = () => {
  if (!finished) {
    console.log("\nTHE RUN DID NOT REACH THE END. Everything above may be true " +
      "and still not be the whole check.");
    process.exit(1);
  }
};
process.on("exit", done);
/* uncaughtException, not exit alone: a rejected top-level await in an ES module
   does not run an exit handler in time to be useful. */
process.on("uncaughtException", (e) => {
  console.log("\nCRASHED: " + (e && e.message));
  process.exit(1);
});

const get = (path, opts) => fetch(BASE + path, { redirect: "manual", ...opts });

console.log("The page production is serving");
const page = await get("/scrambled/");
const html = await page.text();
t("the game answers 200", page.status === 200, String(page.status));

const tag = (html.match(/js\/game\.js\?v=([^"]+)"/) || [])[1];
t("the page carries a build tag", !!tag, tag);
if (EXPECT) {
  t(`and it is the version expected (${EXPECT})`, tag === EXPECT, `live ${tag}`);
} else {
  w("no --expect given, so the tag is reported and not judged", tag);
}
t("every asset on the page carries that same tag", (() => {
  const tags = [...html.matchAll(/(?:css|js)\/[a-z_]+\.(?:css|js)\?v=([^"]+)"/g)]
    .map((m) => m[1]);
  return tags.length > 0 && tags.every((x) => x === tag);
})());
/* shared/ has its own lifecycle and must NOT match the game tag: they move for
   different reasons, and a shared change riding a game tag is a change nobody
   can see in the other three games. */
const sharedTag = (html.match(/xi-chrome\.js\?v=(v[0-9]+)"/) || [])[1];
t("the shared chrome carries its own tag, not the game's",
  !!sharedTag && sharedTag !== tag, `shared ${sharedTag}, game ${tag}`);

console.log("\nThe board it is serving");
const daily = await get("/api/scrambled/daily");
const board = await daily.json();
t("the daily endpoint answers", daily.status === 200, String(daily.status));
t("it serves a board with eleven slots", (board.slots || []).length === 11,
  `board #${board.no}, ${(board.slots || []).length} slots`);
t("the board says what its hint sells", !!board.hintLabel, board.hintLabel);

console.log("\nWhat the browser is NOT given");
const wire = JSON.stringify(board);
t("no answer rides down with the board",
  !/"name"|"display"|"aliases"/.test(wire),
  "the browser holds scrambles, positions and enumerations only");
t("and no career values either",
  !/"clubs"/.test(wire), "the hint is named; its answers are not");

console.log("\nThe archive is shut");
/* The point of closing it. A board that has not been released must not be
   playable by asking for it, however the number is guessed. */
const future = await get("/api/scrambled/daily?no=" + ((board.no || 1) + 30));
t("a board past today is refused", future.status === 403 || future.status === 400,
  String(future.status));

console.log("\nIt is part of the family");
t("the shared chrome is loaded, not a copy of it",
  html.indexOf("/shared/xi-chrome.js") > -1);
t("the page names the game once, as itself", /Scrambled XI/.test(html));
const hub = await get("/");
const hubHtml = await hub.text();
t("the hub links to it", hubHtml.indexOf('href="/scrambled/"') > -1);
const map = await get("/sitemap.xml");
t("the sitemap lists it", (await map.text()).indexOf("/scrambled/</loc>") > -1);

console.log("\nNo unreleased game is named anywhere it is served");
const UNRELEASED = ["QuickFire", "Missing XI", "Transfer XI",
                    "Kit XI", "Manager XI", "Stadium XI"];
const served = html.replace(/<!--[\s\S]*?-->/g, "");
t("the game page names none of them",
  UNRELEASED.every((n) => served.indexOf(n) === -1),
  UNRELEASED.find((n) => served.indexOf(n) > -1) || "clean");

console.log("\nHeaders");
const head = await get("/api/scrambled/daily", { method: "HEAD" });
t("HEAD on the API answers without a body",
  head.status === 200 || head.status === 405, String(head.status));
t("and the API is not indexed",
  (head.headers.get("x-robots-tag") || "").includes("noindex") ||
  (daily.headers.get("x-robots-tag") || "").includes("noindex"),
  daily.headers.get("x-robots-tag") || "(none)");

console.log(`\n${pass} passed, ${fail} failed, ${warn} unjudged`);
t(`the run made at least ${MIN_ASSERTIONS} assertions`,
  pass + fail >= MIN_ASSERTIONS, `${pass + fail} ran, floor ${MIN_ASSERTIONS}`);
finished = true;
process.exit(fail ? 1 : 0);
