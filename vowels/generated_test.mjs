/* vowels/generated_test.mjs — Vowels XI is Scrambled XI's engine with the
 * other cypher, and this is what that must never stop meaning.
 *
 * The page and the script are GENERATED from scrambled/ by
 * tools/build_vowels.js, and `--check` in CI proves the files on disk are what
 * that generator produces. So this suite does not re-check the copying. It
 * checks the things a copy could get right and still be wrong about:
 *
 *   it is the CONSONANT cypher, always, and not by asking a query string
 *   it keeps its OWN keys, because board 7 here is not board 7 there
 *   it banks under its OWN entry key, for the same reason
 *   it shares the rules rather than copying them
 *   and the shared layer keeps its own version, not this game's tag
 *
 *   node vowels/generated_test.mjs        (from the repo root)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entryKey, GAMES, LABELS } from "../functions/_lib/games.js";
import { PERMA_GAMES } from "../functions/_lib/permalink.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const html = read("vowels/index.html");
const js = read("vowels/js/game.js");
const scrambledJs = read("scrambled/js/game.js");

console.log("=== It is the consonant cypher, and not by asking ===");
/* Scrambled reads ?cy=1 and defaults to the anagram. This game IS the other
   cypher, so the ask is made every time and a query string cannot turn it
   off — a game whose identity depended on a URL parameter would serve the
   wrong eleven to anyone who trimmed it. */
t("the page always asks for the consonant board",
  /var cy = true;/.test(js) && !/params\.get\("cy"\)/.test(js),
  "the ask is not a question here");
t("and Scrambled still asks, so this is a difference and not a change to both",
  /params\.get\("cy"\) === "1"/.test(scrambledJs));

console.log("\n=== It says which game it is, everywhere a reader looks ===");
/* IT SHIPPED SAYING SCRAMBLED. The masthead — the largest type on the page —
   read "Scrambled XI", because the generator replaced "Scrambled XI" as one
   string and the markup splits it across a span. Three meta descriptions and
   the lede said the names were scrambled. The results card and the share text
   said "Scrambled XI #10". And ?game=scrambled had this game reading the OTHER
   game's account results, which is not wording at all.
   The generator refuses on any of it now. This checks the same property from
   the other side, because a guard living inside the thing it guards is one
   mistake away from being edited out along with the fault it was catching. */
{
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\b(?:href|src)\s*=\s*("[^"]*"|'[^']*')/gi, "");
  t("no part of the page a reader sees names the other game",
    !/scrambl|anagram/i.test(visible),
    (visible.match(/.{0,30}(scrambl|anagram)[a-z]*.{0,20}/i) || ["clean"])[0]);
  t("the masthead is this game's name",
    /<div class="site-mast">Vowels <span class="site-xi">XI<\/span>/.test(html));
  t("and the script names this game on the card and in the share",
    js.includes('"Vowels XI #"') || js.includes('"Vowels XI"'),
    "the results card said Scrambled XI #10 on launch day");
  t("its account results are ITS results",
    js.includes("?game=vowels") && !js.includes("?game=scrambled"),
    "not a wording slip: the wrong game's history on the page and in the sync");
}

console.log("\n=== Every way into a board asks for THIS cypher ===");
/* THE FAULT THIS IS HERE FOR. Forcing the query string's default was half the
   job: five call sites build an ask — the calendar, the archive picker, the
   finals catalogue, the account fallback and the home button — and only the
   one derived from the URL carried `cy`. Today's board came back blanked and
   every other route came back scrambled. The owner found the finals boards
   still in anagrams.
   So this does not read the file, it RUNS askUrl: the function is lifted out
   of the generated script and called with the ask each of those sites actually
   builds. A textual check would have passed the broken version, which said
   `cy = true` in one place and ignored it in another. */
{
  const lift = (text) => {
    const m = /function askUrl\(ask\) \{([\s\S]*?)\n  \}/.exec(text);
    return m ? new Function("ask", m[1]) : null;
  };
  const askUrl = lift(js);
  t("askUrl can be lifted out of the generated script and run", !!askUrl);
  const ASKS = [
    ["the calendar", { kind: "daily", no: 12 }],
    ["the archive picker", { kind: "daily", no: 3 }],
    ["the finals catalogue", { kind: "iconic", id: 1001 }],
    ["the account fallback", { kind: "daily" }],
    ["the home button", { kind: "daily" }],
    ["a link carrying the query string", { kind: "daily", no: 5, cy: true }],
  ];
  const missing = ASKS.filter(([, a]) => !/[?&]cy=1(&|$)/.test(askUrl(a)));
  t("every ask a caller builds fetches the consonant board",
    missing.length === 0,
    missing.length ? missing.map(([n]) => n).join(", ") + " did not"
      : ASKS.length + " routes, all carrying cy=1");
  t("and it does not depend on the caller remembering to say so",
    /[?&]cy=1/.test(askUrl({ kind: "daily" })) &&
    /[?&]cy=1/.test(askUrl({ kind: "iconic", id: 1 })),
    askUrl({ kind: "iconic", id: 1 }));
  /* And Scrambled has NOT been turned into this game by the same edit. */
  const sAsk = lift(scrambledJs);
  t("while Scrambled still serves the anagram unless it is asked otherwise",
    !!sAsk && !/cy=1/.test(sAsk({ kind: "daily" })) && /cy=1/.test(sAsk({ kind: "daily", cy: true })),
    sAsk ? sAsk({ kind: "daily" }) : "could not lift");
}

console.log("\n=== Its own keys, because board 7 is not board 7 ===");
/* The consonant ring is offset half a turn from the anagram ring, so the two
   games' board 7s are different elevens. A shared storage prefix would have
   two boards saving over one key — a bug already found once in this game —
   and a shared entry key would file the second as a board already played. */
t("the page stores under xivw., never xisc.",
  /var PREFIX = "xivw\.";/.test(js) && !/xisc/.test(js));
t("a Vowels result banks under vw:, and Scrambled's under sc:",
  entryKey("vowels", { no: 7 }) === "vw:7" && entryKey("scrambled", { no: 7 }) === "sc:7",
  entryKey("vowels", { no: 7 }) + " vs " + entryKey("scrambled", { no: 7 }));
t("and the same board number in the two games is not the same row",
  entryKey("vowels", { no: 7 }) !== entryKey("scrambled", { no: 7 }));
t("a board with no number banks nothing, in this game as in the other",
  entryKey("vowels", { no: 0 }) === null && entryKey("vowels", {}) === null);

console.log("\n=== It is in the family's registries, by name ===");
t("the games list carries it", GAMES.includes("vowels"));
t("it is labelled Vowels XI", LABELS.vowels === "Vowels XI");
t("its permalink is a board number, like Scrambled's",
  !!PERMA_GAMES.vowels && PERMA_GAMES.vowels.kind === "number" &&
  PERMA_GAMES.vowels.name === "Vowels XI");
t("and the route that serves that permalink exists",
  fs.existsSync(path.join(ROOT, "functions/vowels/daily/[[path]].js")));
t("the squad list gives it the fifth shirt, and QuickFire is no longer wearing it",
  (() => {
    const squad = read("shared/xi-chrome.js");
    const at = squad.indexOf("var SQUAD");
    const list = squad.slice(at, squad.indexOf("];", at));
    return /\{\s*n:\s*5,\s*name:\s*"Vowels XI"/.test(list) &&
      !/\{\s*n:\s*5,[^}]*quickfire/.test(list);
  })());

console.log("\n=== It shares the rules rather than copying them ===");
/* config.js holds the prices and the clock; scoring.js holds what a score is.
   Both games keep the same ones, so the page loads Scrambled's files from
   Scrambled's path: one file, one cache entry, and nothing to drift. */
t("the prices and the scoring are loaded from scrambled/js/, not copied here",
  /src="\.\.\/scrambled\/js\/config\.js/.test(html) &&
  /src="\.\.\/scrambled\/js\/scoring\.js/.test(html));
t("and this game ships no copy of them",
  !fs.existsSync(path.join(ROOT, "vowels/js/config.js")) &&
  !fs.existsSync(path.join(ROOT, "vowels/js/scoring.js")));
t("the API it calls is the server's one scrambled endpoint",
  /\/api\/scrambled\//.test(js) && !/\/api\/vowels\//.test(js),
  "one server, two cyphers");

console.log("\n=== The tags are two lifecycles, not one ===");
/* The shared layer carries its own plain vN and must NOT move with a game
   tag. The first build of the generator rewrote every ?v= in the page and
   put the shared layer on the game's tag, which is the exact fault the
   cross-game contract exists to catch. */
{
  const own = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+)\?v=(v[0-9a-z]+)"/g)];
  const shared = [...html.matchAll(/\.\.\/shared\/[^"?]+\?v=(v[0-9a-z]+)"/g)].map((m) => m[1]);
  const sharedTag = (read("functions/_lib/site-page.js").match(/SHARED_TAG = "([a-z0-9]+)"/) || [])[1];
  t("its own assets all carry one tag", own.length >= 2 &&
    new Set(own.map((m) => m[2])).size === 1, own.map((m) => m[1] + "=" + m[2]).join(" "));
  t("the script's BUILD is that same tag",
    js.indexOf(`var BUILD = "${own[0][2]}"`) > -1, own[0][2]);
  t("and the shared layer is on the SHARED tag, not this game's",
    shared.length > 0 && shared.every((v) => v === sharedTag) && shared[0] !== own[0][2],
    `shared ${sharedTag}, game ${own[0][2]}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
