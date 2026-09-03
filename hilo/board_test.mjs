/* hilo/board_test.mjs — the board rules, executed.
 *
 * The gate the bank passes through, sabotaged and watched refusing; what
 * leaves the server through publicBoard(); the judge; the tokens that shut
 * the future; and the owner's scoring, on the rule's own examples.
 *
 *   node hilo/board_test.mjs        (from the repo root)
 */
import { createRequire } from "node:module";
import { gate, isClub } from "../tools/import_hilo.js";
import {
  clubOf, clubSlug, publicBoard, judge, released, boardForToken, dayToken, boardToken,
  archive, clubCatalog, todayKey,
} from "../functions/_lib/hl-board.js";
import { HL_SAMPLE_BOARDS, HL_SAMPLE_SCHEDULE } from "../functions/_lib/hl-sample.js";

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
t("names and context go out, so the pair can be drawn", pub.rows.every((r, i) => r.name === daily.chain[i].name));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
