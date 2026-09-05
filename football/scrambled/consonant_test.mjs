/* consonant_test.mjs — the second cypher, and every rule it adds.
 *
 *   node scrambled/consonant_test.mjs        (from the repo root)
 *
 * EVERY NEW GATE CHECK IS SABOTAGED HERE AND WATCHED TO REFUSE, which is the
 * standard board_test.mjs already sets: a check that has never been seen to
 * fail is a check that might be returning true unconditionally, and this
 * project has found six of those. Asserting that the real boards pass proves
 * the boards are fine, which was never in doubt.
 *
 * Kept beside board_test.mjs rather than inside it while the mode is
 * unreleased, so the new suite can be run and read on its own. It should be
 * absorbed into board_test.mjs the day the mode goes public.
 */
import fs from "node:fs";
import {
  gate, parseFormation, build,
  blankVowels, consonantCyphers, consonantProblems,
} from "../../tools/build_scrambled.js";
import {
  publicBoard, scKey, iconicKey, tokenCypher, playableTokenNo, consonantsPublic,
  boardForNumber, boardForToken, boardForIconicToken, dailyRing,
} from "../../functions/_lib/sc-board.js";
import { SC_BOARDS } from "../../functions/_lib/sc-boards.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const SRC = "tools/scrambled/sample-xi";
const SAMPLES = fs.readdirSync(SRC).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
if (!SAMPLES.length) throw new Error("no sample boards in " + SRC);
const good = JSON.parse(fs.readFileSync(`${SRC}/${SAMPLES[0]}`, "utf8"));
const clone = () => JSON.parse(JSON.stringify(good));
const refuses = (src, fragment) =>
  gate(src, parseFormation(src.formation)).some((p) => p.includes(fragment));

console.log("\n=== The cypher is the name with its vowels blanked ===");
t("SCHMEICHEL blanks to SCHM__CH_L", blankVowels("SCHMEICHEL") === "SCHM__CH_L");
t("the apostrophe stays: O'SHEA is _'SH__", blankVowels("O'SHEA") === "_'SH__");
t("the space stays: VAN DIJK is V_N D_JK", blankVowels("VAN DIJK") === "V_N D_JK");
t("the hyphen stays: LEWIS-SKELLY is L_W_S-SK_LLY", blankVowels("LEWIS-SKELLY") === "L_W_S-SK_LLY");
t("Y is not a vowel here: BURLEY is B_RL_Y", blankVowels("BURLEY") === "B_RL_Y");
t("a name with no vowels blanks to itself", blankVowels("BLYTH") === "BLYTH");
t("case and stray spacing are settled, not carried",
  blankVowels("  van   dijk ") === "V_N D_JK");

console.log("\n=== A name with no vowels keeps its tile, and the tile starts solved ===");
{
  const xi = [{ name: "BLYTH", display: "JIM BLYTH" }, { name: "COLE", display: "ANDY COLE" }];
  const [blyth, cole] = consonantCyphers(xi);
  t("BLYTH is marked presolved", blyth.presolved === true);
  t("BLYTH is not widened to hide it", blyth.cy === "BLYTH" && blyth.cyOf === "name",
    "a fuller name would still print the surname");
  t("a name with vowels is not marked presolved", cole.presolved === undefined && cole.cy === "C_L_");
}

console.log("\n=== Two names that blank alike are told apart, or the board is refused ===");
{
  const both = [
    { name: "ANDERSON", display: "VIV ANDERSON" },
    { name: "ANDERSEN", display: "STEPHAN ANDERSEN" },
  ];
  const [a, b] = consonantCyphers(both);
  t("ANDERSON and ANDERSEN both widen", a.cyOf === "display" && b.cyOf === "display");
  t("and the widened tiles differ", a.cy !== b.cy, `${a.cy} vs ${b.cy}`);
  t("so the board is not refused", consonantProblems(both).length === 0);
}
{
  const stuck = [{ name: "ANDERSON", display: "ANDERSON" }, { name: "ANDERSEN", display: "ANDERSEN" }];
  t("with nothing to widen to, the board IS refused",
    consonantProblems(stuck).some((p) => p.includes("cannot be told")));
}
t("a name with no consonants is refused",
  consonantProblems([{ name: "AIA", display: "AIA" }]).some((p) => p.includes("no consonants")));

console.log("\n=== The gate refuses what the cypher cannot express ===");
t("a good sample board passes the gate", gate(good, parseFormation(good.formation)).length === 0);
t("two slots blanking alike is refused by gate()", (() => {
  const src = clone();
  src.xi[0].name = "ANDERSON"; src.xi[0].display = "ANDERSON"; src.xi[0].aliases = [];
  src.xi[1].name = "ANDERSEN"; src.xi[1].display = "ANDERSEN"; src.xi[1].aliases = [];
  return refuses(src, "cannot be told");
})());
t("a no-consonant name is refused by gate()", (() => {
  const src = clone();
  src.xi[0].name = "AIA"; src.xi[0].display = "AIA"; src.xi[0].aliases = [];
  return refuses(src, "no consonants");
})());
t("the anagram's own rules still refuse what they always did", (() => {
  const src = clone();
  src.xi.pop();
  return refuses(src, "an XI has eleven");
})());

console.log("\n=== Every slot is built with both cyphers ===");
{
  const built = build(clone(), "sample", null);
  t("the board builds", !!built);
  t("every slot has a scramble AND a blanked cypher",
    built.slots.every((s) => s.scramble && s.cy && s.cyOf));
  t("every cypher is its own name blanked, not another's",
    built.slots.every((s) => s.cy === blankVowels(s.cyOf === "display" ? s.display : s.name)));
  t("no slot claims to be presolved unless it has no vowels",
    built.slots.every((s) => !s.presolved || s.cy === (s.cyOf === "display" ? s.display : s.name).toUpperCase()));
  t("every sample board builds in both cyphers", SAMPLES.every((f) =>
    !!build(JSON.parse(fs.readFileSync(`${SRC}/${f}`, "utf8")), f, null)));
}

console.log("\n=== The payload sends ONE cypher, and says which ===");
{
  const board = build(clone(), "sample", null);
  /* The third argument is the TOKEN, and the cypher is read off it: there is no
     separate mode parameter that can get out of step with the token. */
  const ana = publicBoard(board, 1, null);
  const con = publicBoard(board, 1, scKey(1, "consonants"));
  t("the anagram payload says so", ana.cypher === "anagram");
  t("the consonant payload says so", con.cypher === "consonants");
  t("the anagram sends scrambles and no blanked cypher",
    ana.slots.every((s) => s.scramble && s.cy === undefined));
  t("the consonant board sends blanks and no scramble",
    con.slots.every((s) => s.cy && s.scramble === undefined));
  t("the enumeration is the anagram's alone",
    ana.slots.every((s) => Array.isArray(s.len)) && con.slots.every((s) => s.len === undefined),
    "a blanked tile is already its own length");
  t("no payload ever carries a name, unless the cypher IS the name",
    [...ana.slots, ...con.slots].every((s) => !s.name || s.presolved === true));
  t("the token carries the mode", con.token === scKey(1, "consonants") && con.token !== ana.token);
  t("a finals payload reads its cypher off the finals token", (() => {
    const f = publicBoard(board, null, iconicKey(7, "consonants"));
    return f.cypher === "consonants" && f.slots.every((x) => x.cy && x.scramble === undefined);
  })());
}

console.log("\n=== The token names the cypher, and changes nothing else ===");
t("sc:1 is the anagram", tokenCypher("sc:1") === "anagram");
t("sc:c:1 is the consonant board", tokenCypher("sc:c:1") === "consonants");
t("a token from before this existed is still the anagram", tokenCypher("sc:12") === "anagram");
t("rubbish is the anagram, not a crash", tokenCypher(null) === "anagram" && tokenCypher("nope") === "anagram");
t("both tokens resolve to the SAME board number",
  playableTokenNo("sc:1") === playableTokenNo("sc:c:1"));
t("a consonant token is refused past today exactly as a plain one is",
  playableTokenNo("sc:c:99999") === playableTokenNo("sc:99999"));
t("a malformed consonant token is refused", playableTokenNo("sc:c:") === null && playableTokenNo("sc:c:x") === null);

console.log("\n=== The two games walk one ring, half a turn apart ===");
{
  const ring = dailyRing(SC_BOARDS);
  const len = ring.length;
  let same = 0;
  const reached = new Set();
  for (let n = 1; n <= len; n++) {
    if (boardForNumber(n, SC_BOARDS) === boardForNumber(n, SC_BOARDS, "consonants")) same++;
    reached.add(boardForNumber(n, SC_BOARDS, "consonants"));
  }
  t("no day shows the same board in both games", same === 0, `ring of ${len}`);
  t("the consonant rotation still reaches every board in the ring", reached.size === len);
  t("the offset is half the ring",
    boardForNumber(1, SC_BOARDS, "consonants") === ring[Math.floor(len / 2) % len]);
  t("an anagram token resolves to the anagram's board",
    boardForToken(scKey(1), SC_BOARDS) === boardForNumber(1, SC_BOARDS));
  t("a consonant token resolves to the CONSONANT board, not the anagram's",
    boardForToken(scKey(1, "consonants"), SC_BOARDS) === boardForNumber(1, SC_BOARDS, "consonants"),
    "or the tile on screen and the answer being marked are different boards");
}

console.log("\n=== The finals are independent of the daily, in both cyphers ===");
t("sc:iconic:1 is the anagram", tokenCypher("sc:iconic:1") === "anagram");
t("sc:iconic:c:1 is the consonant board", tokenCypher("sc:iconic:c:1") === "consonants");
t("both finals tokens name the same board", (() => {
  const out = SC_BOARDS.filter((b) => b && b.daily === false);
  if (!out.length) return true;   /* the sample module may hold no finals */
  const id = out[0].id;
  return boardForIconicToken(iconicKey(id), SC_BOARDS)
      === boardForIconicToken(iconicKey(id, "consonants"), SC_BOARDS);
})());
t("a finals token is not a daily token", playableTokenNo("sc:iconic:c:1") === null);

console.log("\n=== It shipped, as Vowels XI ===");
/* This read "CONSONANTS_PUBLIC is false — delete this assertion the day the
   mode ships, and not before". That day was 4 Sep 2026: the cypher became
   Vowels XI at /football/vowels/, the fifth shirt. The assertion is turned over rather
   than deleted — the flag still has to say something definite, and a mode that
   silently stopped being public would take a live game off the site. */
t("the consonant boards are public, because they are a game now",
  consonantsPublic() === true, "Vowels XI, shirt 5, /football/vowels/");


/* ---- THE PAGE, PLAYED ---------------------------------------------------

   Everything above this line is the server. None of it runs game.js, and that
   is exactly how the first draft of this mode reached me with eight call
   sites that throw: the payload sends `cy` and sends neither `scramble` nor
   `len`, ten places read those two fields, and every suite in this game was
   green. A cypher that changes what the payload carries has to be played.

   Booted the way journey_test boots it — the real page, the real handlers,
   fetch routed into them — with the daily asked for in the consonant cypher.
*/
console.log("\n=== The page, played in the consonant cypher ===");
{
  const { JSDOM } = await import("jsdom");
  const { onRequestGet: dailyGet } = await import("../../functions/api/scrambled/daily.js");
  const { onRequestPost: guessPost } = await import("../../functions/api/scrambled/guess.js");
  const { onRequestPost: revealPost } = await import("../../functions/api/scrambled/reveal.js");

  const ORIGIN = "http://localhost";
  /* The mode is not public, so the route would refuse a guest. The suite is
     the owner for the length of this block: an env whose isAdmin says yes.
     That is the door the owner tests through, and it is the door being
     exercised — not a way round the flag, which is still asserted false. */
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ id: "u1", is_admin: 1 }) }) }) } };
  /* isAdmin reads the session cookie and then the row it names, so the request
     has to carry one — a stub that answers the query is not enough on its own. */
  const asOwner = (url, init) => new Request(url, Object.assign({}, init, {
    headers: Object.assign({ Cookie: "cxi_session=owner" }, (init && init.headers) || {}),
  }));
  const ROUTES = {
    "/api/scrambled/daily": (req) => dailyGet({ request: req, env }),
    "/api/scrambled/guess": (req) => guessPost({ request: req, env }),
    "/api/scrambled/reveal": (req) => revealPost({ request: req, env }),
    "/api/play": async () => new Response(JSON.stringify({ ok: true }),
      { headers: { "Content-Type": "application/json" } }),
    /* The page syncs the account on boot. Answered rather than left to reject,
       so a caught rejection does not print over the run. */
    "/api/auth/session": async () => new Response(JSON.stringify({ user: null, accounts: false }),
      { headers: { "Content-Type": "application/json" } }),
  };
  const dom = new JSDOM(fs.readFileSync("football/scrambled/index.html", "utf8"), {
    url: ORIGIN + "/football/scrambled/?no=1&cy=1",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;
  const thrown = [];
  window.addEventListener("error", (e) => thrown.push(String(e.message)));
  window.Request = Request;
  window.Response = Response;
  window.fetch = (input, init) => {
    const url = new URL(String(input), ORIGIN);
    const r = ROUTES[url.pathname];
    if (!r) return Promise.reject(new Error("no route for " + url.pathname));
    return Promise.resolve(r(asOwner(url.href, init)));
  };
  for (const f of ["shared/xi-plays.js", "shared/xi-keys.js", "football/scrambled/js/config.js",
                   "football/scrambled/js/scoring.js", "football/scrambled/js/game.js"]) {
    window.eval(fs.readFileSync(f, "utf8"));
  }
  const $ = (id) => doc.getElementById(id);
  const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  await settle(24);

  /* Against the board's OWN title, not merely "something is there": the
     static page ships "Today's XI" in that element, so a truthiness test
     passes on a board that never loaded — which is what it did. */
  /* NOT SC_BOARDS[0]. The consonant ring is walked half a turn from the
     anagram one, so board #1 in this cypher is a different eleven — which is
     the whole point of the offset, and this is where a suite that assumed
     otherwise finds out. Asked for the way the server picks it. */
  const served = boardForNumber(1, SC_BOARDS, "consonants");
  t("the consonant board loaded and the page did not throw",
    $("startTitle").textContent === served.title && thrown.length === 0,
    JSON.stringify($("startTitle").textContent) + " " + (thrown.join("; ") || ""));
  t("and it is NOT the board the anagram serves at the same number",
    served.title !== SC_BOARDS[0].title || served.id !== SC_BOARDS[0].id,
    served.id + " vs " + SC_BOARDS[0].id);

  $("homeDaily").dispatchEvent(new window.Event("click"));
  await settle(12);
  const tiles = [...doc.querySelectorAll(".slot .letters")].map((e) => e.textContent);
  t("eleven tiles are drawn, blanked rather than scrambled",
    tiles.length === 11 && tiles.every((x) => /_/.test(x)), tiles[0]);
  /* The enumeration is the anagram's: the blanked tile already shows its own
     length, and printing it underneath is the same fact twice. */
  t("and no enumeration is printed under them",
    doc.querySelectorAll(".slot .enum").length === 0);

  /* THE FIRST KEYSTROKE. This is the one that threw: paintTyped asked
     supplyFrom(slot.scramble, …) and scramble is not there. */
  const target = served.slots.find((sl) => sl.cy && /_/.test(sl.cy));
  const answer = String(target.name).toUpperCase().replace(/[^A-Z]/g, "");
  $("answer").value = answer[0];
  $("answer").dispatchEvent(new window.Event("input"));
  await settle(6);
  t("a single keystroke does not throw, and lights the tiles it could be",
    thrown.length === 0 && doc.querySelectorAll(".slot.could").length >= 1,
    thrown.join("; ") || doc.querySelectorAll(".slot.could").length + " lit");

  /* PICKING A TILE. This threw twice: the echo read slot.scramble and then
     slot.len.join. */
  const tileEl = doc.querySelector('.slot[data-slot="' + target.id + '"]');
  $("answer").value = "";
  $("answer").dispatchEvent(new window.Event("input"));
  tileEl.dispatchEvent(new window.Event("click", { bubbles: true }));
  await settle(8);
  t("picking a tile opens the echo without throwing",
    !$("echo").hidden && thrown.length === 0, thrown.join("; ") || $("echoLetters").textContent);
  t("the echo shows the blanks and no enumeration",
    /_/.test($("echoLetters").textContent) && $("echoEnum").textContent === "");
  /* And the bench, which read slot.len.reduce and slot.len.join. */
  t("the bench opens, and sells a vowel rather than a letter",
    !$("benchRow").hidden && $("letterLabel").textContent === "Reveal a vowel" &&
    thrown.length === 0, $("benchFor").textContent);

  /* A BOUGHT VOWEL HAS TO SHOW. It did not: tileText returned the pattern
     whatever had been bought, so the bench took the points and the tile was
     identical. Found by playing it, and only by playing it. */
  const before = doc.querySelector('.slot[data-slot="' + target.id + '"] .letters').textContent;
  $("buyLetter").dispatchEvent(new window.Event("click"));
  await settle(14);
  const after = doc.querySelector('.slot[data-slot="' + target.id + '"] .letters').textContent;
  t("buying a vowel changes the tile it was bought for",
    after !== before && after.length === before.length,
    JSON.stringify(before) + " -> " + JSON.stringify(after));
  t("and it is charged for", Number($("helpSpent").textContent) > 0,
    $("helpSpent").textContent);

  /* A FINISHED NAME SENDS ITSELF, in this cypher too: the pattern filled is
     the consonant board's version of the bag used up. */
  $("answer").value = answer;
  $("answer").dispatchEvent(new window.Event("input"));
  await settle(16);
  t("a name that fills the pattern sends itself, with no Enter pressed",
    doc.querySelectorAll(".slot.solved").length >= 1 && thrown.length === 0,
    $("feedback").textContent);

  /* THE ADDRESS HAS TO KEEP THE CYPHER. It did not: the archive gate's
     address() cleared the query wholesale to drop a stale ?iconic=, and once a
     second cypher existed it took ?cy= with it — so a reload, a copied link
     and the back button all handed back the anagram. Found by reloading the
     page by hand, which is why this check exists rather than the other way
     round. */
  t("the address still says which cypher this is",
    /(\?|&)cy=1(&|$)/.test(window.location.search),
    window.location.pathname + window.location.search);

  t("nothing threw across the whole round", thrown.length === 0, thrown.join("; ") || "clean");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
