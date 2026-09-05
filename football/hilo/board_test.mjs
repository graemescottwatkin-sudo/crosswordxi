/* hilo/board_test.mjs — the board rules, executed.
 *
 * The gate the bank passes through, sabotaged and watched refusing; what
 * leaves the server through publicBoard(); the judge; the tokens that shut
 * the future; and the owner's scoring, on the rule's own examples.
 *
 *   node hilo/board_test.mjs        (from the repo root)
 */
import { createRequire } from "node:module";
import { gate, isClub } from "../../tools/import_hilo.js";
import {
  clubOf, clubSlug, familyOf, readableQuote, publicBoard, judge, released, boardForToken, dayToken, boardToken,
  archive, clubCatalog, todayKey,
} from "../../functions/_lib/hl-board.js";
import { HL_SAMPLE_BOARDS, HL_SAMPLE_SCHEDULE } from "../../functions/_lib/hl-sample.js";

const require = createRequire(import.meta.url);
const S = require("./js/scoring.js");

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const clone = (b) => JSON.parse(JSON.stringify(b));

const daily = HL_SAMPLE_BOARDS.find((b) => !isClub(b));
const club = HL_SAMPLE_BOARDS.find((b) => isClub(b));
if (!daily || !club) throw new Error("the sample needs one daily and one club board");

console.log("=== The gate ===");
t("a sample board passes", gate(daily).length === 0, gate(daily).join(" | "));
for (const [label, spoil, frag] of [
  ["eleven rows", (b) => { b.chain.pop(); }, "twelve items"],
  ["thirteen rows", (b) => { b.chain.push(clone(b.chain[0])); }, "twelve items"],
  ["a value that is a string", (b) => { b.chain[3].value = "1905"; }, "must be a number"],
  ["two equal neighbours", (b) => { b.chain[4].value = b.chain[3].value; }, "equal to the row before"],
  ["a row with no source", (b) => { delete b.chain[2].source; }, "no source"],
  ["a source with no quote", (b) => { delete b.chain[2].source.quote; }, "no source"],
  ["a unit the contract does not name", (b) => { b.unit = "goals"; }, "unit must be"],
  ["a direction with one face", (b) => { b.direction = { higher: "Later" }; }, "both faces"],
  ["no subtitle", (b) => { delete b.subtitle; }, "no subtitle"],
  ["a fractional date value", (b) => { b.unit = "date"; b.chain[1].value = 20000.5; }, "whole count of days"],
  ["an unknown precision", (b) => { b.chain[1].precision = "hour"; }, "unknown precision"],
]) {
  const b = clone(daily); spoil(b);
  const p = gate(b);
  t(`SABOTAGE: ${label} is refused`, p.some((x) => x.includes(frag)), p[0] || "(passed)");
}

console.log("\n=== Kinds of board ===");
t("a club board is known by its category", isClub(club) && !isClub(daily) && clubOf(club) !== null && clubOf(daily) === null, clubOf(club));
t("the club's name is the category without its noun", !/managers|head coaches/i.test(clubOf(club)));
t("and slugs to its url form", /^[a-z0-9-]+$/.test(clubSlug(clubOf(club))));

console.log("\n=== What leaves the server ===");
const pub = publicBoard(daily, dayToken("2026-09-03"));
const wire = JSON.stringify(pub);
t("twelve rows go out", pub.rows.length === 12);
t("the first value goes out and no other", pub.rows[0].value === daily.chain[0].value &&
  pub.rows.slice(1).every((r) => r.value === undefined) && (wire.match(/"value"/g) || []).length === 1);
t("no row's source goes out", !/"source"|"quote"|"publisher"|"url"/.test(wire));
t("names go out, so the pair can be drawn", pub.rows.every((r, i) => r.name === daily.chain[i].name));
/* The first row is open — value, context, birth date. Every other row is
   its name and NOTHING else: a context is prose about the item and can
   carry the very date being asked for ("In charge until 2026" beside the
   year a coach took charge), and it did, on the live page, on launch day. */
t("the first row carries its context", typeof pub.rows[0].context === "string" && pub.rows[0].context === (daily.chain[0].context || ""));
t("a hidden row is its name and nothing else — no context, birth date or precision",
  pub.rows.slice(1).every((r) => Object.keys(r).join() === "name"));
t("the verdict releases the row's context with its value", (() => {
  const v = judge(daily, 1, "higher");
  return !!v && v.context === (daily.chain[1].context || "");
})());
t("the token rides with it", pub.token === "hl:2026-09-03");

console.log("\n=== The judge ===");
const truth = (i) => (daily.chain[i].value > daily.chain[i - 1].value ? "higher" : "lower");
const v1 = judge(daily, 1, truth(1));
t("a right call is right, and brings the value and the source back",
  !!v1 && v1.right === true && v1.value === daily.chain[1].value && !!v1.source.quote && !!v1.source.url);
t("a wrong call is wrong", judge(daily, 1, truth(1) === "higher" ? "lower" : "higher").right === false);
t("a call that ran out of clock is wrong and still reveals the value",
  judge(daily, 2, "none").right === false && judge(daily, 2, "none").value === daily.chain[2].value);
t("call zero and call twelve are not calls", judge(daily, 0, "higher") === null && judge(daily, 12, "higher") === null);
t("and a call that is not a call is refused", judge(daily, 1, "sideways") === null);

/* WHERE ON THE PAGE THE ROW IS. Rows read from the league's ranked feed link
   to a hundred-row page of JSON, and a link that opened page one for a player
   ranked eightieth showed ten names without him — the owner followed one for
   Emerson Thome and found exactly that. The content side puts the right page
   in the URL and a sentence in source.page saying which; the judge has to
   carry that sentence or the player lands on the wall of JSON with nothing to
   look for. */
{
  const feed = JSON.parse(JSON.stringify(daily));
  feed.chain[1].source = {
    publisher: "Premier League",
    url: "https://footballapi.pulselive.com/football/stats/ranked/players/appearances?comps=1&pageSize=100&page=0",
    quote: "\"display\":\"Nigel Winterburn\"",
    page: "the league feed, one hundred rows a page; this row is rank 80 on page 1",
  };
  const v = judge(feed, 1, truth(1));
  t("a league-feed row brings its page note back with the verdict",
    !!v && v.source.page === feed.chain[1].source.page, v && v.source.page);
  /* And a row without one says null rather than undefined, so the page can ask
     without guessing. */
  const plain = judge(daily, 2, truth(2));
  t("a row with no page note says so plainly", plain.source.page === null);
}

/* ---- A QUOTE IS EVIDENCE, AND NOT ALL EVIDENCE IS COPY ----
   The club boards are sourced from the league's data endpoint, so their
   verbatim quote is a slice of JSON — and the settled row printed it to the
   player between quotation marks. It went out live. */
console.log("\nWhat a quote is fit to be shown as");
const JSONISH = '"display":"Ricardo Gardner","first":"Ricardo","id":2041.0,"value":251.0';
t("a slice of JSON is not shown to anybody", readableQuote(JSONISH) === null);
t("a sentence is", readableQuote("Wrexham AFC was founded in 1864.") === "Wrexham AFC was founded in 1864.");
/* THE HALF THAT WAS WRONG FIRST. Squared brackets were in this rule for one
   draft and took 2,400 real sentences out with the JSON: an editorial
   insertion in brackets is ordinary written English, not structured data. */
t("a sentence with an editorial insertion in brackets is still a sentence",
  readableQuote("the Brentford Local Board [a forerunner of today's councils] met") !== null);
t("and a sentence quoting speech is too — a colon before a quote, not after",
  readableQuote('He said: "we go again" and they did') !== null);
t("nothing is not a quote", readableQuote("") === null && readableQuote(null) === null &&
  readableQuote("   ") === null);
{
  /* Through the judge, which is what the page actually reads. The publisher
     and the link SURVIVE — the claim stays sourced on the page whether or not
     its evidence reads as prose. */
  const b = clone(daily);
  b.chain[1].source = { publisher: "Premier League", url: "https://example.test/x", quote: JSONISH };
  const v = judge(b, 1, "higher");
  t("the judge withholds an unreadable quote and keeps the source",
    v.source.quote === null && v.source.publisher === "Premier League" && v.source.url === "https://example.test/x",
    JSON.stringify(v.source));
  t("and the bank still holds it, for the audit",
    b.chain[1].source.quote === JSONISH, "withheld from the wire, not deleted");
}

console.log("\n=== The future is shut ===");
const bank = { boards: HL_SAMPLE_BOARDS, schedule: HL_SAMPLE_SCHEDULE, source: "sample" };
const days = Object.keys(HL_SAMPLE_SCHEDULE).sort();
const now = Date.parse(days[0] + "T12:00:00Z");
t("today's token resolves to today's board", boardForToken(bank, dayToken(days[0]), now) !== null &&
  String(boardForToken(bank, dayToken(days[0]), now).id) === HL_SAMPLE_SCHEDULE[days[0]]);
t("tomorrow's token resolves to nothing", boardForToken(bank, dayToken(days[1]), now) === null);
t("a daily is released only once its day has come",
  released(bank, daily, now) === (Object.keys(HL_SAMPLE_SCHEDULE).some((d) => HL_SAMPLE_SCHEDULE[d] === String(daily.id) && d <= todayKey(now))));
t("a club board is always released, and its token always resolves",
  released(bank, club, now) && boardForToken(bank, boardToken(club.id), now) === club);
t("a token nobody issued resolves to nothing", boardForToken(bank, "hl:tomorrow", now) === null && boardForToken(bank, "x", now) === null);
t("the archive stops at yesterday", archive(bank, now).every((e) => e.day < todayKey(now)));
t("the catalogue groups club boards by club, identity only",
  clubCatalog(bank).length >= 1 && clubCatalog(bank).every((c) => c.boards.every((b) => !b.chain && !b.value)));

console.log("\n=== The owner's scoring ===");
t("a right call is worth ten inside the grace, then falls a point a second to nothing",
  S.worthAt(0) === 10 && S.worthAt(2000) === 10 && S.worthAt(7000) === 5 && S.worthAt(11999) === 1 && S.worthAt(12000) === 0);
const T = true, F = false;
t("eleven right at full value is 110 plus four for the run: 114, the ceiling",
  S.score([T,T,T,T,T,T,T,T,T,T,T], [10,10,10,10,10,10,10,10,10,10,10]) === 114);
t("two runs of five earn two each", S.runBonus([T,T,T,T,T,F,T,T,T,T,T]) === 4 && S.runBonus([T,T,T,T,F,T,T,T,T,F,T]) === 0);
t("nothing exceeds 114", S.score([T,T,T,T,T,T,T,T,T,T,T], [10,10,10,10,10,10,10,10,10,10,10]) <= S.CEILING);
t("win with three wrong, draw with four, loss if unfinished",
  S.result([T,T,T,T,T,T,T,T,F,F,F]) === "W" && S.result([T,T,T,T,T,T,T,F,F,F,F]) === "D" && S.result([T,T,T]) === "L");
t("three substitutions and a twelve-second clock with two of grace",
  S.SUBS === 3 && S.CLOCK_MS === 12000 && S.GRACE_MS === 2000 && S.CALLS === 11);

/* ---- WHICH CATEGORIES ARE A CLUB'S ------------------------------------

   The rule is derived from the category, because the research side carries no
   club field — so it has to name every family the content side writes, and
   the cost of missing one is silence rather than an error. It read
   `(managers|head coaches)` and matched 54 of the 274 club boards in the
   September import: the other 220 were filed as dailies, and a daily that is
   not on the calendar is refused by released(). They imported green and were
   unplayable and invisible. The importer printed "220 daily board(s) are not
   on the calendar", which reads like a scheduling note.

   THE HARD HALF IS THE PREFIX. Seven daily boards are categorised "Premier
   League appearances" with no club in front of them, beside 113 that read
   "Arsenal Premier League appearances". A rule matched on the tail alone
   claims both. So each family is checked in the pair it comes in: the club
   form claimed, the bare form left alone. */
console.log("\nWhich categories name a club");
const CLUB_FAMILIES = [
  ["Arsenal managers", "managers"],
  ["Brighton & Hove Albion head coaches", "head coaches"],
  ["Everton managers by longest spell", "managers by longest spell"],
  ["Arsenal Premier League appearances", "Premier League appearances"],
  ["Chelsea Premier League goals", "Premier League goals"],
  ["Aston Villa Premier League assists", "Premier League assists"],
];
for (const [withClub, bare] of CLUB_FAMILIES) {
  t(`"${bare}" is a club board when a club is named`,
    clubOf({ category: withClub }) !== null, clubOf({ category: withClub }));
  /* The pair. Without this the rule could claim everything ending in those
     words and both halves of the check would still read as passing. */
  t(`  and a daily when it is not`, clubOf({ category: bare }) === null);
}
t("the club name comes out with no family word left on it",
  CLUB_FAMILIES.every(([withClub]) =>
    !/managers|head coaches|Premier League|longest spell/i.test(clubOf({ category: withClub }))),
  CLUB_FAMILIES.map(([c]) => clubOf({ category: c })).join(" | "));
t("a category with nothing before the family word is never a club board",
  ["managers", "head coaches", "Premier League goals", ""]
    .every((c) => clubOf({ category: c }) === null));
/* The importer must not keep a second opinion. It kept its own copy of this
   regex, identical when both were written and stale in both when the content
   side added three families. */
t("the importer asks this rule rather than keeping its own",
  isClub({ category: "Arsenal Premier League appearances" }) === true &&
  isClub({ category: "Premier League appearances" }) === false,
  "one statement of what a club board is");

/* THE FAMILY, WHICH THE CLUB PAGE NOW STATES A RULE FOR. Five categories, four
   families: head coaches ARE managers, because Real Madrid's are called that
   and the rule behind the number is the same one. A daily has no family. */
t("each club category reports its family, and head coaches are managers",
  familyOf({ category: "Arsenal managers" }) === "managers" &&
  familyOf({ category: "Real Madrid head coaches" }) === "managers" &&
  familyOf({ category: "Everton managers by longest spell" }) === "longest-spell" &&
  familyOf({ category: "Arsenal Premier League appearances" }) === "appearances" &&
  familyOf({ category: "Chelsea Premier League goals" }) === "goals" &&
  familyOf({ category: "Aston Villa Premier League assists" }) === "assists" &&
  familyOf({ category: "Premier League goals" }) === null,
  [familyOf({ category: "Real Madrid head coaches" }),
    familyOf({ category: "Everton managers by longest spell" })].join(" / "));

/* WHEN THE NUMBERS WERE TRUE, REQUIRED OF A CLUB BOARD. The date used to live
   in all 274 subtitles and was taken out on 4 Sep so a title says what the
   number is and nothing else. It moved to trueAsOf and the club page states it
   there — so a club board arriving without one would put an undated snapshot
   on a page, and is refused here instead. A daily is not a snapshot and owes
   nothing. */
{
  const snapshot = { ...daily, category: "Arsenal Premier League appearances" };
  const dated = { ...snapshot, trueAsOf: "2026-09-02" };
  const { trueAsOf, ...undated } = snapshot;
  const said = (b) => gate(b).filter((x) => /trueAsOf/.test(x));
  t("a club board with no trueAsOf is refused", said(undated).length === 1, said(undated)[0]);
  t("  and one with a date is not", said(dated).length === 0);
  t("  and a malformed date is refused too",
    said({ ...snapshot, trueAsOf: "2 September 2026" }).length === 1);
  const { trueAsOf: _t, ...bareDaily } = daily;
  t("  while a daily owes no such date", said(bareDaily).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
