/* season_test.mjs — one season, and the rule that decides a day.
 *
 * The owner's rule is four lines and every one of them has an edge:
 *
 *   finished 2 or more        W
 *   finished exactly 1        D
 *   started, finished none    L
 *   started nothing           no fixture
 *
 * The third and fourth are the ones worth checking hardest. A day with nothing
 * started is NOT a loss — a season that counted a holiday as a defeat would be
 * punishing absence — and a day with one finished and one abandoned is a DRAW,
 * because an unfinished puzzle only counts against a day with nothing
 * completed. That is what "unless you have 1+ already complete" means.
 *
 *   node tools/season_test.mjs        (from the repo root)
 */
import { dayResult, daySettled, pointsFor, season, RESULTS, NO_SEASON_YET }
  from "../functions/_lib/season.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

console.log("A day, from what was played in it");
t("two finished is a win", dayResult(2, 2) === RESULTS.WIN);
t("five finished is still one win, because a day is one fixture",
  dayResult(5, 5) === RESULTS.WIN, "max of 1 win per day");
t("one finished is a draw", dayResult(1, 1) === RESULTS.DRAW);
t("started one and finished none is a loss", dayResult(1, 0) === RESULTS.LOSS);
/* THE CLAUSE THAT IS EASY TO GET WRONG. */
t("one finished and one abandoned is a DRAW, not a loss",
  dayResult(2, 1) === RESULTS.DRAW,
  "an unfinished puzzle only counts against a day with nothing completed");
t("two finished and three abandoned is still a win", dayResult(5, 2) === RESULTS.WIN);
/* AND THE ONE THAT WOULD PUNISH A HOLIDAY. */
t("a day with nothing started is no fixture, not a loss",
  dayResult(0, 0) === null, "a season that counts absence as defeat is not a season");
t("rubbish counts as nothing rather than throwing",
  dayResult(null, undefined) === null && dayResult(-4, -9) === null);

console.log("\nWhat a day is worth");
t("three for a win, one for a draw, none for a loss",
  pointsFor(RESULTS.WIN) === 3 && pointsFor(RESULTS.DRAW) === 1 &&
  pointsFor(RESULTS.LOSS) === 0);
t("and nothing for a day that was never played", pointsFor(null) === 0);

console.log("\nA day is settled only once it is over");
t("yesterday is settled", daySettled("2026-09-04", "2026-09-05"));
t("today is not — a loss cannot be known while it can still become a draw",
  !daySettled("2026-09-05", "2026-09-05"));
t("and neither is a day the server has not reached",
  !daySettled("2026-09-06", "2026-09-05"));

console.log("\nA season, from settled days");
{
  const days = [
    { day: "2026-09-01", started: 3, finished: 3 },   // W
    { day: "2026-09-02", started: 1, finished: 1 },   // D
    { day: "2026-09-03", started: 2, finished: 0 },   // L
    { day: "2026-09-04", started: 2, finished: 1 },   // D
  ];
  const s = season(days, "2026-09-05");
  t("four days, counted", s.played === 4, `${s.won}W ${s.drawn}D ${s.lost}L`);
  t("one win, two draws, one loss", s.won === 1 && s.drawn === 2 && s.lost === 1);
  t("and five points", s.points === 5, `${s.points} pts`);
  t("the form strip reads oldest first, like a fixture list",
    s.marks.join("") === "WDLD", s.marks.join(""));
  /* THE ORDER OF THE INPUT MUST NOT CHANGE THE ANSWER. */
  const shuffled = season([days[2], days[0], days[3], days[1]], "2026-09-05");
  t("and the answer does not depend on what order the days arrive in",
    shuffled.marks.join("") === s.marks.join("") && shuffled.points === s.points);
}

console.log("\nToday is in flight, not in the table");
{
  const s = season([
    { day: "2026-09-04", started: 2, finished: 2 },
    { day: "2026-09-05", started: 1, finished: 0 },
  ], "2026-09-05");
  t("yesterday is counted", s.played === 1 && s.won === 1);
  t("today is not counted, however it looks so far",
    s.marks.join("") === "W", s.marks.join(""));
  /* A day in flight is shown as what it WOULD be, because a player wants to
     know where they stand — and it is not banked, because it can still move. */
  t("but today is reported as provisional",
    !!s.inFlight && s.inFlight.day === "2026-09-05" && s.inFlight.provisional === RESULTS.LOSS,
    JSON.stringify(s.inFlight));
  t("and finishing a second puzzle today would turn it into a win",
    season([{ day: "2026-09-05", started: 2, finished: 2 }], "2026-09-05")
      .inFlight.provisional === RESULTS.WIN);
}

console.log("\nHas the season started at all");
{
  t("no play ever is no season", season([], "2026-09-05").started === false);
  t("and that is when the hub invites one", NO_SEASON_YET.length > 10 &&
    /first game/i.test(NO_SEASON_YET), NO_SEASON_YET);
  /* THE CASE THAT IS EASY TO MISS. A player who kicked off an hour ago has a
     season under way with nothing settled in it; telling them to start one
     would be wrong. */
  t("a day in flight IS a season, even with nothing settled",
    season([{ day: "2026-09-05", started: 1, finished: 0 }], "2026-09-05").started === true,
    "they have started; they have not finished");
  t("and a settled day is a season too",
    season([{ day: "2026-09-04", started: 1, finished: 1 }], "2026-09-05").started === true);
  /* A day with nothing played is not a season either — it is a row that says
     nothing, and it must not count as turning up. */
  t("a recorded day with nothing played in it is still no season",
    season([{ day: "2026-09-04", started: 0, finished: 0 }], "2026-09-05").started === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
