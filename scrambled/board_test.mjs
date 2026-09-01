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
  gate, parseFormation, minimumFixedPoints, scrambleName, nameFloor,
  build, seedOf, poolOf, LAST2_POS,
} from "../tools/build_scrambled.js";
import { SC_BOARDS } from "../functions/_lib/sc-boards.js";
import {
  publicBoard, boardForNumber, playableTokenNo, slotHint, topClubs, sellsHint, hintLabel,
} from "../functions/_lib/sc-board.js";
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
/* The first sample board, whichever it is. Naming the file here made this
   suite crash with ENOENT the day the samples changed — the same lesson the
   fixtures above already carry: a test that names a board is a test that
   expires, and it fails by crashing rather than by failing. */
const SAMPLES = fs.readdirSync(SRC)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
if (!SAMPLES.length) throw new Error("no sample boards in " + SRC);
const good = JSON.parse(fs.readFileSync(`${SRC}/${SAMPLES[0]}`, "utf8"));
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
/* An anagram of another slot on THIS board, rather than "ELOC" — which was
   an anagram of COLE and collided only while Andy Cole was on the sample. */
s = clone();
s.xi[10].name = [...normalise(s.xi[0].name)].reverse().join("");
s.xi[10].aliases = [];
t("SABOTAGE: two slots with the same letters are refused",
  refuses(s, "two identical tiles cannot be told apart"));

/* AND ITS SIBLING. An alias that matches two slots is a wrong answer accepted
   — exactly as broken as two identical names, and quieter. */
/* A spelling that is already another slot's name, taken from the board. */
s = clone(); s.xi[2].aliases = [s.xi[0].name];
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

/* A BOARD THAT SELLS NOTHING SAYS SO. Forty-four iconic boards declare
   "none" because neither club nor nationality varies enough to be worth a
   purchase; the builder used to refuse the word, and the game used to charge
   for an empty answer on any board like it. */
s = clone(); s.hintField = "none";
t("a board declaring no hint is accepted", gate(s, parseFormation(s.formation)).length === 0);
{
  const b = build(s, "none.json");
  t("and the bench has nothing to sell on it", !!b && !sellsHint(b) && hintLabel(b) === null);
  t("so no hint reaches the wire and no label is offered",
    !!b && publicBoard(b, 1).hintLabel === null && b.slots.every((sl) => slotHint(b, sl.id) === null));
}

console.log("\n=== A last-two board: the league's record of one night ===");
/* Built from the sample rather than from a bank file: the set goes stale
   every round, so a fixture in the repo would be a lie within a month. */
const last2 = () => {
  const x = clone();
  x.type = "prem-last2"; x.club = "Sampleton"; x.gameweek = 2;
  x.title = "Sampleton 2–1 Elsewhere"; x.kickoff = "Sat 29 Aug 2026, 15:00 BST";
  x.kickoffMillis = 1788012000000; x.venue = "home"; x.hintField = "clubs";
  delete x.seed; delete x.pool; delete x.daily;
  x.xi.forEach((p, i) => { delete p.clubs; delete p.premClubs; p.shirt = i + 1; p.captain = i === 3; });
  return x;
};
t("a last-two board with no careers, no seed and no pool line is accepted",
  gate(last2(), parseFormation(last2().formation)).length === 0,
  gate(last2(), parseFormation(last2().formation)).join(" | "));
t("but a Daily with an empty career is still refused",
  (() => { const x = clone(); x.hintField = "clubs"; x.xi.forEach((p) => { p.clubs = [{ club: "A" }]; });
    delete x.xi[2].clubs; return refuses(x, "no club history for"); })(),
  "the guard is the type, not the absence of careers");
for (const [label, spoil, fragment] of [
  ["no club", (x) => { delete x.club; }, "names no club"],
  ["a gameweek that is not a number", (x) => { x.gameweek = "two"; }, "gameweek must be"],
  ["no kickoff", (x) => { delete x.kickoff; }, "no kickoff"],
  ["no kickoff millis", (x) => { delete x.kickoffMillis; }, "kickoffMillis must be"],
  ["a neutral venue", (x) => { x.venue = "neutral"; }, "venue must be"],
  ["two players in one shirt", (x) => { x.xi[5].shirt = x.xi[4].shirt; }, "two players, one shirt"],
  ["a shirt of 0", (x) => { x.xi[5].shirt = 0; }, "shirt must be"],
  ["two captains", (x) => { x.xi[7].captain = true; }, "2 captains"],
  ["no captain", (x) => { x.xi[3].captain = false; }, "0 captains"],
  ["a position the record never uses", (x) => { x.xi[6].pos = "CDM"; }, "not one the league"],
  ["a board type this builder has never met", (x) => { x.type = "friendly"; }, "unknown board type"],
]) {
  const x = last2(); spoil(x);
  t(`SABOTAGE: ${label} is refused`, refuses(x, fragment));
}
{
  const src = last2();
  const b = build(src, "last2.json");
  t("it builds with the fixture on the board and never in the daily ring",
    !!b && b.type === "prem-last2" && b.club === "Sampleton" && b.gameweek === 2 &&
    b.venue === "home" && b.kickoffMillis === src.kickoffMillis && b.daily === false);
  t("its pool line is the fixture, derived once",
    !!b && b.pool === poolOf(src) && /Sampleton 2–1 Elsewhere/.test(b.pool) && /at home/.test(b.pool) &&
    /gameweek 2/.test(b.pool), b && b.pool);
  t("its seed is the kickoff, so the scramble is reproducible from the fixture",
    seedOf(src) === seedOf(last2()) && Number.isInteger(seedOf(src)) &&
    build(last2(), "again.json").slots[0].scramble === b.slots[0].scramble);
  t("a different round is a different seed",
    (() => { const y = last2(); y.gameweek = 3; return seedOf(y) !== seedOf(src); })());
  t("the slots carry the shirt and the armband",
    !!b && b.slots.every((sl, i) => sl.shirt === i + 1) && b.slots.filter((sl) => sl.captain).length === 1 &&
    b.slots.filter((sl) => "captain" in sl).length === 1);
  const pub = publicBoard(b, 1);
  const wire = JSON.stringify(pub);
  t("the public board names the fixture — club, round, kickoff, venue",
    pub.type === "prem-last2" && pub.club === "Sampleton" && pub.gameweek === 2 &&
    pub.venue === "home" && !!pub.kickoff);
  t("and offers no hint, because the fixture is the hint", pub.hintLabel === null && !sellsHint(b));
  t("no shirt and no armband leave the server unsolved",
    !/"shirt"/.test(wire) && !/"captain"/.test(wire) && b.slots.every((sl) => wire.indexOf(sl.name) === -1));
  t("the positions are the record's wider set, and LAST2_POS names all fourteen",
    LAST2_POS.length === 14 && ["LWB", "RWB", "DM", "AM", "LM", "RM", "LW", "RW"].every((p) => LAST2_POS.includes(p)));
}

/* Whatever this board sells, withheld for one player. Written down as
   "nationality" it tested a field the Daily boards do not even use. */
s = clone(); delete s.xi[5][good.hintField];
/* A career is refused in its own words — "no club history for" — because an
   empty career is a hint paid for and not received, not a missing field. */
t("SABOTAGE: a missing hint value is refused",
  refuses(s, good.hintField === "clubs"
    ? "no club history for" : "no " + good.hintField + " for"),
  "this board sells " + good.hintField);

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
    return fixed === nameFloor(sl.name);
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
/* The reveal is the fullest form of the answer — the whole name, not just
   the letters on the tile. publicBoard is an allowlist, so this cannot leak
   by construction; the check exists because the allowlist is one careless
   line away from not being one. */
t("no reveal is in the payload", (() => {
  /* Both sides normalised, or the check is vacuous: the needle GYLFISIGURDSSON
     never matches the payload GYLFI SIGURDSSON, and a leak walks straight
     through. This check passed its own sabotage once for exactly that. */
  const wire = normalise(JSON.stringify(publicBoard(SC_BOARDS[0], 1)));
  return SC_BOARDS[0].slots.every((sl) => !wire.includes(normalise(sl.display)));
})(), "the whole name never reaches the browser unsolved");
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


console.log("\n=== The cypher is scrambled word by word ===");
/* A blob makes the enumeration a lie. If DE JONG can shuffle into a single
   six-letter run, the "(2,4)" under the tile tells the player about a word
   break the letters never respected. So every word's letters stay in that
   word, and the enumeration stays true. */
t("no letter ever leaves its own word", SC_BOARDS.every((b) =>
  b.slots.every((sl) => {
    const words = String(sl.name).trim().split(/\s+/).map(normalise).filter(Boolean);
    let at = 0;
    return words.every((w) => {
      const part = sl.scramble.slice(at, at + w.length);
      at += w.length;
      return letterBag(part) === letterBag(w);
    });
  })));
/* Named separately because the check above passes vacuously on a bank of
   single-word cyphers, and most cyphers ARE single words. If this ever reads
   zero the check above is proving nothing and should be read as silent. */
t("and the bank actually contains a multi-word cypher to prove it on",
  SC_BOARDS.some((b) => b.slots.some((sl) => sl.len.length > 1)));

console.log("\n=== The cypher is scrambled, the reveal is shown ===");
/* Two fields on purpose: the surname is the puzzle, the whole name is the
   moment of recognition. A board that reveals LINEKER has answered a question
   nobody was asking. */
t("every slot carries a reveal", SC_BOARDS.every((b) =>
  b.slots.every((sl) => typeof sl.display === "string" && sl.display.length > 0)));
t("and the reveal contains the cypher that was scrambled", SC_BOARDS.every((b) =>
  b.slots.every((sl) => normalise(sl.display).includes(normalise(sl.name)))));
t("and only the cypher's letters are on the tile",
  SC_BOARDS.every((b) => b.slots.every((sl) =>
    letterBag(sl.scramble) === letterBag(sl.name))));


console.log("\n=== What a solved player is known for ===");
/* Two clubs, most-appeared first, spells at the same club summed. Every
   number below is read off the board rather than written here: a fixture that
   names a club is a fixture that expires the day the bank changes. */
t("never more than two clubs", SC_BOARDS.every((b) =>
  b.slots.every((sl) => topClubs(sl).length <= 2)));
t("and every player on the board has at least one", SC_BOARDS.every((b) =>
  b.slots.every((sl) => topClubs(sl).length >= 1)));
t("ordered by appearances, most first", SC_BOARDS.every((b) =>
  b.slots.every((sl) => {
    const got = topClubs(sl);
    return got.every((c, i) => i === 0 || got[i - 1].apps >= c.apps);
  })));

/* THE CASE THAT MOTIVATED THE SUMMING. A player with two spells at one club
   must have them counted together — otherwise his real second club loses to
   a three-game cameo. Found on the board rather than assumed, and the suite
   says so if the board stops containing one. */
const REPEATER = SC_BOARDS.flatMap((b) => b.slots).find((sl) => {
  const names = (sl.clubs || []).map((c) => c.club);
  return new Set(names).size < names.length;
});
t("the bank contains a player with two spells at one club", !!REPEATER,
  REPEATER ? REPEATER.display : "none — the summing rule is untested");
t("whose spells are summed, not listed twice", (() => {
  if (!REPEATER) return false;
  const got = topClubs(REPEATER, 99);
  const names = got.map((c) => c.club);
  if (new Set(names).size !== names.length) return false;
  /* and the total is the sum of every spell at that club */
  return got.every((c) => c.apps === (REPEATER.clubs || [])
    .filter((sp) => sp.club === c.club)
    .reduce((n, sp) => n + (typeof sp.apps === "number" && sp.apps > 0 ? sp.apps : 0), 0));
})());

/* The reveal is the answer; the clubs come with it. Neither may ride down in
   the board payload, which is served before anything is solved. */
t("no club appears in the unsolved payload", (() => {
  const wire = JSON.stringify(publicBoard(SC_BOARDS[0], 1));
  return SC_BOARDS[0].slots.every((sl) =>
    topClubs(sl).every((c) => !wire.includes(c.club)));
})());

console.log("\n=== The hint and the reveal are different careers ===");
/* clubs is the WHOLE career and the bench sells it before the answer is
   known. premClubs is the Premier League only and it is what a solved tile
   says. Whelan bought reads Home Farm, Liverpool, Southend; Whelan solved
   reads Liverpool. Swap them and the game either hands over the answer as a
   hint or prints a reveal about clubs it is not about. */
const SPLIT = SC_BOARDS.flatMap((b) => b.slots).filter((sl) =>
  (sl.premClubs || []).length && (sl.clubs || []).length);
t("the bank carries both careers", SPLIT.length > 0,
  SPLIT.length + " slots carry premClubs and clubs");
t("the reveal is drawn from the Premier League career", SPLIT.every((sl) => {
  const names = new Set((sl.premClubs || []).map((c) => c.club));
  return topClubs(sl).every((c) => names.has(c.club));
}));
/* The two must not have quietly become the same list, or nothing above is
   being tested: at least one player played somewhere outside the league. */
const NARROWER = SPLIT.find((sl) => sl.premClubs.length < sl.clubs.length);
t("and it is NARROWER than the career the hint sells", !!NARROWER,
  NARROWER ? NARROWER.display + ": " + NARROWER.clubs.length + " clubs, " +
    NARROWER.premClubs.length + " in the league" : "every career is all-league");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

