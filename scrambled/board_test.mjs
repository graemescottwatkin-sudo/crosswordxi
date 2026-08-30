/* board_test.mjs — the builder's gate, and what leaves the server.
 *
 *   node scrambled/board_test.mjs        (from the repo root)
 *
 * EVERY GATE CHECK IS SABOTAGED HERE AND WATCHED TO REFUSE. A gate check that
 * has never been seen to fail is a check that might be returning true
 * unconditionally, and this project has found six of those. Asserting only
 * that the real boards pass proves nothing about the gate — it proves the
 * boards are fine, which was never in doubt.
 */
import fs from "node:fs";
import {
  gate, parseFormation, minimumFixedPoints, scrambleName,
} from "../tools/build_scrambled.js";
import { SC_BOARDS } from "../functions/_lib/sc-boards.js";
import { publicBoard, boardForNumber, playableTokenNo, slotHint } from "../functions/_lib/sc-board.js";
import { normalise, letterBag, isEnglishForm } from "../functions/_lib/sc-names.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const scLib = fs.readFileSync("functions/_lib/sc-board.js", "utf8");
const gamesLib = fs.readFileSync("functions/_lib/games.js", "utf8");
const openArchive = /const OPEN_ARCHIVE = true/.test(scLib);
const launched = /GAMES = \[[^\]]*"scrambled"/.test(gamesLib);

/* The sample sources, in-tree. The bank moved outside the repository, so a
   suite reading it would pass on this machine and fail in CI and in a fresh
   clone. These four are the ones the shipped module holds. */
const SRC = "tools/scrambled/sample-xi";
const good = JSON.parse(fs.readFileSync(`${SRC}/001-manchester-united-1999.json`, "utf8"));
const clone = () => JSON.parse(JSON.stringify(good));
const refuses = (src, fragment) => {
  const problems = gate(src, parseFormation(src.formation));
  return problems.some((p) => p.includes(fragment));
};

console.log("\n=== The formation is parsed, not captioned ===");
t("4-4-2 is eleven slots", (() => {
  const s = parseFormation("4-4-2");
  return !s.error && s.bands.reduce((a, b) => a + b.size, 0) === 11;
})());
t("4-2-3-1 is eleven slots too", (() => {
  const s = parseFormation("4-2-3-1");
  return !s.error && s.bands.reduce((a, b) => a + b.size, 0) === 11;
})());
t("the back four is labelled left to right",
  parseFormation("4-4-2").labels.slice(0, 5).join(",") === "GK,LB,CB,CB,RB");
t("the front two are strikers",
  parseFormation("4-4-2").labels.slice(-2).join(",") === "ST,ST");
t("a lone striker is one striker, not two",
  parseFormation("4-2-3-1").labels.slice(-1)[0] === "ST");
/* SABOTAGE: a formation that does not add up. The draft carried the formation
   as a caption beside a hand-written band list, so a board could say 4-4-2 and
   draw as something else; here the string IS the layout, so this has to be
   refused rather than drawn. */
t("SABOTAGE: 4-4-3 is refused as eleven outfielders", !!parseFormation("4-4-3").error,
  parseFormation("4-4-3").error);
t("SABOTAGE: a caption that is not a formation is refused",
  !!parseFormation("diamond").error);
t("the keeper is deeper than every outfielder", (() => {
  const b = parseFormation("4-4-2").bands;
  return b[0].id === "gk" && b.slice(1).every((x) => x.y < b[0].y);
})());
t("and the lines run back to front", (() => {
  const b = parseFormation("4-4-2").bands.slice(1).map((x) => x.y);
  return b.every((y, i) => i === 0 || y < b[i - 1]);
})());

console.log("\n=== The gate refuses what it claims to refuse ===");
t("the shipped XI passes clean", gate(good, parseFormation(good.formation)).length === 0);

let s = clone(); s.xi.pop();
t("SABOTAGE: ten players is refused", refuses(s, "an XI has eleven"));

s = clone(); s.xi[3].name = "MODRI\u0106";
t("SABOTAGE: a diacritic in an authored name is refused", refuses(s, "not English form"));

s = clone(); s.xi[3].name = "XI";
t("SABOTAGE: a two-letter name is refused", refuses(s, "too short to scramble"));

/* THE ONE THE DRAFT DID NOT HAVE. Two slots whose letters agree are the same
   tile: the player cannot know which goes where and neither can the marker.
   This is what forces JACK CHARLTON and BOBBY CHARLTON to carry forenames. */
s = clone(); s.xi[10].name = "ELOC"; s.xi[10].aliases = [];
t("SABOTAGE: two slots with the same letters are refused",
  refuses(s, "two identical tiles cannot be told apart"));

/* AND ITS SIBLING. An alias that matches two slots is a wrong answer accepted
   — exactly as broken as two identical names, and quieter. */
s = clone(); s.xi[2].aliases = ["JAAP STAM"];
t("SABOTAGE: one spelling claimed by two slots is refused",
  refuses(s, "one spelling, two slots"));

s = clone(); s.hintField = "nationality";
s.xi.forEach((p) => { p.nationality = "England"; });
t("SABOTAGE: a hint that reads the same for all eleven is refused",
  refuses(s, "sells the player something already on their screen"),
  "eleven purchases of nothing");

s = clone(); s.hintField = "club";
t("SABOTAGE: and the club board is refused for the same reason",
  refuses(s, "sells the player something already on their screen"));

s = clone(); s.hintField = "boots";
t("SABOTAGE: an invented hint field is refused", refuses(s, "hintField must be"));

s = clone(); delete s.xi[5].nationality;
t("SABOTAGE: a missing hint value is refused", refuses(s, "no nationality for"));

s = clone(); delete s.source;
t("SABOTAGE: a board with no source is refused", refuses(s, "no source"),
  "a board is a claim about who played");

s = clone(); delete s.seed;
t("SABOTAGE: a board with no seed is refused", refuses(s, "no integer seed"));

s = clone(); delete s.pool;
t("SABOTAGE: a board with no pool line is refused", refuses(s, "no pool line"));

console.log("\n=== As deranged as the letters allow ===");
t("BECKHAM can be fully deranged", minimumFixedPoints("BECKHAM") === 0);
/* GIGGS is the case that broke the draft's first scrambler. Three Gs in five
   positions leaves the Gs only two positions that are not their own, so one G
   must stay put and no full derangement exists. */
t("GIGGS cannot: one G is stuck", minimumFixedPoints("GIGGS") === 1);
t("and the floor is the worst letter's floor, not a tolerance",
  minimumFixedPoints("AAAB") === 2);
t("every shipped scramble hits its floor exactly", SC_BOARDS.every((b) =>
  b.slots.every((sl) => {
    const letters = normalise(sl.name);
    let fixed = 0;
    for (let i = 0; i < letters.length; i++) if (sl.scramble[i] === letters[i]) fixed++;
    return fixed === minimumFixedPoints(letters);
  })));
t("every shipped scramble is a true anagram of its name", SC_BOARDS.every((b) =>
  b.slots.every((sl) => letterBag(sl.scramble) === letterBag(sl.name))));
t("and no scramble is just the name", SC_BOARDS.every((b) =>
  b.slots.every((sl) => sl.scramble !== normalise(sl.name))));
/* Determinism: the seed is what makes a stored board reproducible from its
   source file. Two runs of the same seed must agree or the file is not the
   board. */
t("the same seed produces the same scramble", (() => {
  const mk = () => { let a = 12345 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
  return scrambleName("BECKHAM", mk()).scramble === scrambleName("BECKHAM", mk()).scramble;
})());

console.log("\n=== The boards as built ===");
t("there is at least one board", SC_BOARDS.length > 0, `${SC_BOARDS.length} boards`);
t("every board is eleven slots", SC_BOARDS.every((b) => b.slots.length === 11));
t("every slot id is unique within its board", SC_BOARDS.every((b) =>
  new Set(b.slots.map((sl) => sl.id)).size === 11));
t("every board has exactly one goalkeeper", SC_BOARDS.every((b) =>
  b.slots.filter((sl) => sl.pos === "GK").length === 1));
t("every slot sits on a band the board declares", SC_BOARDS.every((b) =>
  b.slots.every((sl) => b.bands.some((x) => x.id === sl.band))));
t("every name is still English form after the build", SC_BOARDS.every((b) =>
  b.slots.every((sl) => isEnglishForm(sl.name))));
/* A LINEUP board's source is the article that proves who played, so it must be
   a URL. A DAILY board is a selection rather than a claim about a match — its
   source is the provenance of the generation, and every PLAYER carries their
   own article instead. Requiring a URL of both asserted that every board is a
   lineup, which stopped being true the day the Daily arrived. */
t("every board carries a source", SC_BOARDS.every((b) => !!(b.source || "").trim()));
t("and a lineup board's source is the article that proves it",
  SC_BOARDS.filter((b) => b.hintField !== "clubs")
    .every((b) => /^https?:\/\//.test(b.source || "")));
t("while every player on a Daily board carries their own",
  SC_BOARDS.filter((b) => b.hintField === "clubs")
    .every((b) => b.slots.every((sl) => /^https?:\/\//.test(sl.source || ""))),
  "the claim moves from the board to the player");

console.log("\n=== What leaves the server ===");
const board = boardForNumber(1);
const payload = publicBoard(board, 1);
const wire = JSON.stringify(payload);
/* The scramble is the letters and cannot be hidden — that IS the game. What
   must not ride along is the spelling, the aliases and the priced hint. */
t("no name is in the payload",
  board.slots.every((sl) => wire.indexOf(sl.name) === -1));
t("no alias is in the payload",
  board.slots.every((sl) => (sl.aliases || []).every((a) => wire.indexOf(a) === -1)));
t("no hint VALUE is in the payload", (() => {
  const values = new Set(board.slots.map((sl) => slotHint(board, sl.id)).filter(Boolean));
  return [...values].every((v) => wire.indexOf(v) === -1);
})(), "the field is named; the answers to it are not");
t("but the scrambles, positions and enumerations are",
  payload.slots.every((sl) => sl.scramble && sl.pos && Array.isArray(sl.len)));
t("and the board says which hint it sells",
  payload.hintField === board.hintField && !!payload.hintLabel);

console.log("\n=== Which board is playable ===");
t("a board in the past is playable", playableTokenNo("sc:1") === 1);
/* THE FUTURE, under whichever contract is in force.
   Closed is the live rule: a number sent up from a browser is a number off a
   clock the player controls, so tomorrow must be refused however that clock is
   set. Open is the test-mode rule while the game is unlaunched and its owner
   is proofing a thirty-board bank.
   Asserted against the flag rather than against one of them, because a suite
   that insists on the closed rule while the code runs the open one is not
   guarding anything — it is just red. Which contract is CORRECT is the
   assertion above: open is allowed only while the game is unlaunched. */
t(openArchive
    ? "every board is reachable while the archive is open"
    : "SABOTAGE: a board far in the future is refused",
  openArchive ? playableTokenNo("sc:99999") === 99999
              : playableTokenNo("sc:99999") === false);
t("a token from another game is not a token here",
  playableTokenNo("daily:1") === null && playableTokenNo("ws:2026-08-27") === null);
t("board zero is refused", playableTokenNo("sc:0") === false);
t("the ring repeats visibly rather than running out",
  boardForNumber(SC_BOARDS.length + 1) === SC_BOARDS[0]);

/* THE TEST-MODE FLAG CANNOT SURVIVE LAUNCH.
   OPEN_ARCHIVE makes every board playable, which is right while Scrambled is
   unlaunched and its owner is proofing thirty boards, and wrong the moment
   anybody else can reach it — it hands over the whole schedule.
   Tied to the launch state rather than to a promise: a game is launched when
   its id is in the server's GAMES list, because that is the list an id must be
   on before any row can be written for it. So the day Scrambled joins that
   list, this assertion goes red unless the flag has been turned off. */
t("the open archive is only allowed while the game is unlaunched",
  !openArchive || !launched,
  openArchive
    ? (launched ? "LAUNCHED WITH THE ARCHIVE OPEN — every future board is public"
                : "open, and the game is unlaunched, which is the intended pairing")
    : "closed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

