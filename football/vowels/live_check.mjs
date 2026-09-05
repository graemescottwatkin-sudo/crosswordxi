/* vowels/live_check.mjs — what production is actually serving.
 *
 *   node vowels/live_check.mjs --expect v001
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
import { gamePath } from "../../functions/_lib/permalink.js";
const BASE = "https://www.thexigames.com";
const expectArg = process.argv.indexOf("--expect");
const EXPECT = expectArg > -1 ? process.argv[expectArg + 1] : null;

let pass = 0, fail = 0, warn = 0;
const t = (n, ok, d) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`);
};
const w = (n, d) => { warn++; console.log(`  ??  ${n}${d ? "  — " + d : ""}`); };

/* THIRTY run with --expect. Without it the tag is reported rather than
   judged, which is the one assertion that can legitimately skip, so twenty-six
   is the honest floor — the exact count would flap the first time somebody ran
   this without --expect.
   Set for THIS file rather than inherited: it arrived from Scrambled's saying
   seventeen, which was that file's honest floor and is not this one's. A floor
   five below the run cannot refuse a block that goes quiet, which is the whole
   job it has. */
const MIN_ASSERTIONS = 29;
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
const page = await get("/football/vowels/");
const html = await page.text();
t("the game answers 200", page.status === 200, String(page.status));

const tag = (html.match(/js\/game\.js\?v=([^"]+)"/) || [])[1];
t("the page carries a build tag", !!tag, tag);
if (EXPECT) {
  t(`and it is the version expected (${EXPECT})`, tag === EXPECT, `live ${tag}`);
} else {
  w("no --expect given, so the tag is reported and not judged", tag);
}
/* ITS OWN ASSETS, ANCHORED ON THE QUOTE — the same correction the deploy gate
   needed, and missed here first: this page loads config.js and scoring.js from
   ../football/scrambled/js/ on purpose, one file and one cache entry for two games, and
   they carry SCRAMBLED's tag. Unanchored, the pattern matched "js/config.js"
   inside that longer path and failed the live game for doing the right thing.
   Fixed in the gate and not here, so it passed offline and refused in
   production — which is exactly the class of fault a live_check is for. */
t("every asset on the page of its OWN carries that same tag", (() => {
  const tags = [...html.matchAll(/(?:src|href)="(?:css|js)\/[a-z_]+\.(?:css|js)\?v=([^"]+)"/g)]
    .map((m) => m[1]);
  return tags.length > 0 && tags.every((x) => x === tag);
})());
t("and the rules it borrows are served on Scrambled's tag, not this game's", (() => {
  /* Read by splitting on the path rather than by a regex over it. The pattern
     was written for `../scrambled/js/`, the theme move rewrote the dots into
     `../football/scrambled/js/`, and the page actually serves the absolute
     `/football/scrambled/js/` — three spellings of one path, which is what a
     literal in a check buys you. Built from gamePath, matched by hand. */
  const base = gamePath("scrambled") + "js/";
  const borrowed = [];
  for (const file of ["config.js", "scoring.js"]) {
    const key = base + file + "?v=";
    const at = html.indexOf(key);
    if (at < 0) continue;
    const after = html.slice(at + key.length);
    borrowed.push(after.slice(0, after.indexOf('"')));
  }
  return borrowed.length === 2 && borrowed.every((v) => v !== tag);
})(), "one file, one cache entry, two games");
/* shared/ has its own lifecycle and must NOT match the game tag: they move for
   different reasons, and a shared change riding a game tag is a change nobody
   can see in the other three games. */
const sharedTag = (html.match(/xi-chrome\.js\?v=(v[0-9]+)"/) || [])[1];
t("the shared chrome carries its own tag, not the game's",
  !!sharedTag && sharedTag !== tag, `shared ${sharedTag}, game ${tag}`);

console.log("\nThe board it is serving");
const daily = await get("/api/scrambled/daily?cy=1");   /* THIS game's cypher */
const board = await daily.json();
t("the daily endpoint answers", daily.status === 200, String(daily.status));
t("it serves a board with eleven slots", (board.slots || []).length === 11,
  `board #${board.no}, ${(board.slots || []).length} slots`);

/* AND THE SLOTS CARRY THE LETTERS THIS GAME IS MADE OF.
 *
 * This game launched serving eleven slots with nothing on them. The bank in
 * production had been imported before the consonant cypher existed, so not one
 * board carried the blanked name — the API said `cypher: "consonants"`, the
 * eleven slots were there, and every tile was empty. This file passed it.
 *
 * "A board with eleven slots" was a check whose name was broader than its
 * behaviour: eleven of anything satisfied it. The letters ARE the game. */
t("and every slot carries its blanked name, which is the game",
  (board.slots || []).length > 0 && (board.slots || []).every((s) => typeof s.cy === "string" && s.cy.length > 0),
  (board.slots || []).filter((s) => s.cy).length + " of " +
    (board.slots || []).length + " — e.g. " + ((board.slots || [])[0] || {}).cy);
/* And not the OTHER game's cypher. Each mode's difficulty is the other's
   giveaway: a scramble beside the blanks hands over the enumeration. */
t("and no slot carries the anagram's scramble or enumeration",
  (board.slots || []).every((s) => s.scramble === undefined && s.len === undefined),
  "one cypher per payload, never both");
t("a blanked name is the name with vowels gone, not a mask of the same width",
  (board.slots || []).some((s) => /[A-Z]/.test(s.cy || "")) &&
  (board.slots || []).every((s) => /^[A-Z_'\- ]+$/.test(s.cy || "")),
  "consonants kept, vowels underscored");
t("the board says what its hint sells", !!board.hintLabel, board.hintLabel);

console.log("\nWhat the browser is NOT given");
const wire = JSON.stringify(board);
t("no answer rides down with the board",
  !/"name"|"display"|"aliases"/.test(wire),
  "the browser holds scrambles, positions and enumerations only");
/* A PROPERTY named clubs, not the word. The board legitimately publishes
   hintField:"clubs" — it says what it sells, which is the point of the bench
   — and matching the bare word failed a payload that was doing exactly what
   it should. What must never appear is a clubs LIST hanging off a slot. */
t("and no career values either",
  wire.indexOf(String.fromCharCode(34) + "clubs" + String.fromCharCode(34) + ":") === -1,
  "the hint is named; its answers are not");

console.log("\nThe archive is shut");
/* The point of closing it. A board that has not been released must not be
   playable by asking for it, however the number is guessed. */
const future = await get("/api/scrambled/daily?cy=1&no=" + ((board.no || 1) + 30));
t("a board past today is refused", future.status === 403 || future.status === 400,
  String(future.status));

console.log("\nIt is part of the family");
t("the shared chrome is loaded, not a copy of it",
  html.indexOf("/shared/xi-chrome.js") > -1);
t("the page names the game once, as itself", /Vowels XI/.test(html));
const hub = await get("/");
const hubHtml = await hub.text();
t("the hub links to it", hubHtml.indexOf('href="/football/vowels/"') > -1);
const map = await get("/sitemap.xml");
t("the sitemap lists it", (await map.text()).indexOf("/football/vowels/</loc>") > -1);

console.log("\nNo unreleased game is named anywhere it is served");
const UNRELEASED = ["QuickFire", "Missing XI", "Transfer XI",
                    "Kit XI", "Manager XI", "Stadium XI"];
/* HOW A NAME IS LOOKED FOR, and why it is not indexOf any more.

   Case-insensitively: these matched "QuickFire" exactly, so "quickfire xi"
   in a sentence would have walked straight past a check called "names no
   unreleased game". A check whose name is broader than its behaviour is the
   fault this project keeps a rule about.

   And with href and src VALUES removed first, because a game in testing is
   now reachable — the hub's number-four card and the drawer's slot both link
   to /football/quickfire/, deliberately, and a path is not the page naming the game.
   Everything a reader can actually see is still searched, including titles,
   meta descriptions and link text. */
function namesAny(markup, names) {
  const clean = markup
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\b(?:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return names.filter((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(clean));
}
const servedLeaks = namesAny(html, UNRELEASED);
t("the game page names none of them", servedLeaks.length === 0,
  servedLeaks.join(", ") || "clean");

console.log("\nHeaders");
const head = await get("/api/scrambled/daily?cy=1", { method: "HEAD" });
t("HEAD on the API answers without a body",
  head.status === 200 || head.status === 405, String(head.status));
t("and the API is not indexed",
  (head.headers.get("x-robots-tag") || "").includes("noindex") ||
  (daily.headers.get("x-robots-tag") || "").includes("noindex"),
  daily.headers.get("x-robots-tag") || "(none)");

/* ---- the permalink: one URL, one puzzle, forever ---------------------- */
/* The whole contract a linking bot depends on, checked against production:
   /football/vowels/daily lands on a dated address, that address serves the game, and a
   board that does not exist yet is not a page. Here rather than only in the
   offline suite because the route is a Function, and the offline suite runs
   in node, which has no Workers runtime to run one in. */
{
  /* /daily IS today, at the address that was asked for: a player who came
     from the site's own button must not be handed a board number, which is
     the archive's way of pointing at a board. The permanent address is named
     in the Link header instead. */
  const hop = await fetch(BASE + "/football/vowels/daily", { redirect: "manual" });
  const link = hop.headers.get("link") || "";
  const key = (link.match(/\/football\/vowels\/daily\/([^>]+)>/) || [])[1] || "";
  t("/football/vowels/daily serves today, with no number in the address",
    hop.status === 200, String(hop.status));
  t("and names today's permanent address in a Link header", !!key, link);
  t("and never lets that answer be cached",
    (hop.headers.get("cache-control") || "").includes("no-store"));

  const page = await fetch(BASE + "/football/vowels/daily/" + key, { redirect: "manual" });
  const html = page.status === 200 ? await page.text() : "";
  t("the permalink serves the game itself",
    page.status === 200 && html.includes("js/game.js"), String(page.status));
  /* Every asset on the page is relative and the page is served one level
     deeper than it lives. Without this the board is a blank screen. */
  t("with a base, so its relative assets still resolve",
    html.includes('<base href="/football/vowels/">'));
  t("naming the board in its title and its canonical",
    /<title>[^<]+ \u00b7 /.test(html) && html.includes("/football/vowels/daily/" + key + '"'));
  t("and offered to a crawler with a line of its own",
    !/noindex/.test(html) && /name="description" content="[^"]*\d{4}"?/.test(html));

  const future = await fetch(BASE + "/football/vowels/daily/99999", { redirect: "manual" });
  t("a board that does not exist yet is not a page", future.status === 404, String(future.status));
}

console.log(`\n${pass} passed, ${fail} failed, ${warn} unjudged`);
t(`the run made at least ${MIN_ASSERTIONS} assertions`,
  pass + fail >= MIN_ASSERTIONS, `${pass + fail} ran, floor ${MIN_ASSERTIONS}`);
finished = true;
process.exit(fail ? 1 : 0);
