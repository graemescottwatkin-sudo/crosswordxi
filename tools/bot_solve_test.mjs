/* bot_solve_test.mjs — can a bot finish each game without being told anything?
 *
 * The whole design of item 14 rests on this being true. If a bot needed the
 * bank, the bank would have to reach CI, and a public repo holding the forward
 * bank in its secrets is a worse problem than the one the bot solves. So the
 * claim is checked rather than asserted:
 *
 *   every word on a real board is located from the GRID ALONE, using only the
 *   payload a browser is given — which has no placements in it
 *
 * and located against the real judge: the coordinates the solver produces are
 * fed to ws-round's own judge(), the same function production uses, so a
 * solver that found the right word in the wrong direction fails here rather
 * than at 01:10 in the morning.
 *
 *   node tools/bot_solve_test.mjs        (from the repo root)
 */
import {
  findWord, solveWordsearch, aFoul, hiloCalls,
  slotsToReveal, entriesToReveal, sessionPlan, SESSIONS,
} from "./bot_solve.mjs";
import { publicPuzzle } from "../functions/_lib/ws-public.js";
import { judge, selectionCells } from "../functions/_lib/ws-round.js";
import { SAMPLE_PUZZLES } from "../functions/_lib/ws-sample.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const BOARDS = Object.values(SAMPLE_PUZZLES);

console.log("Every word, from the grid alone");
{
  t("there are real boards to solve", BOARDS.length > 0, BOARDS.length + " boards");

  let words = 0, boards = 0, ms = 0;
  const failures = [];
  for (const board of BOARDS) {
    /* THE PAYLOAD A BROWSER GETS, not the board. publicPuzzle strips every
       placement — if the solver reached past it into the raw board this whole
       suite would be theatre, so it is handed the public shape and nothing
       else. */
    const seen = publicPuzzle(board);
    const started = Date.now();
    const solved = solveWordsearch(seen);
    ms += Date.now() - started;
    boards++;
    words += solved.found.length;
    if (solved.missing.length) failures.push(solved.missing.join(", "));
  }
  t("no placements travel in the payload the solver is given",
    JSON.stringify(publicPuzzle(BOARDS[0])).indexOf("placement") === -1,
    "the grid and the words, and nothing about where they are");
  t("every word on every board is located",
    failures.length === 0, failures.length ? "NOT FOUND: " + failures.join(" | ")
      : `${words} words across ${boards} boards`);
  t("and it takes no time worth measuring", ms < 2000, ms + "ms for " + boards + " boards");
}

console.log("\nAnd the real judge agrees with every one of them");
{
  /* THE CHECK THAT MATTERS. Finding the letters is not the same as producing
     the drag a player would make: a solver that ran a word backwards, or that
     was off by one at the end, would still "find" it and be refused by the
     server every night. So the coordinates go to the same judge production
     uses. */
  let judged = 0;
  const wrong = [];
  for (const board of BOARDS) {
    const seen = publicPuzzle(board);
    const solved = solveWordsearch(seen);
    const already = [];
    for (const f of solved.found) {
      const hit = judge(board, f.from, f.to, already);
      judged++;
      if (!hit || hit.bonus) { wrong.push(f.display); continue; }
      const got = (hit.item && hit.item.display) || "";
      if (got !== f.display) wrong.push(`${f.display} judged as ${got || "nothing"}`);
      else already.push(got);
    }
    /* AND THE BOARD IS ACTUALLY FINISHED, not merely eleven-things-judged:
       every named answer accounted for, once each. */
    if (already.length !== (seen.answers || []).length) {
      wrong.push(`board finished ${already.length}/${(seen.answers || []).length}`);
    }
  }
  t("the server's own judge accepts every selection the solver makes",
    wrong.length === 0, wrong.length ? "REFUSED: " + wrong.join(" | ") : judged + " selections judged");
}

console.log("\nA word that is not in the grid is a verdict about the board");
{
  const board = BOARDS[0];
  const seen = publicPuzzle(board);
  const bent = JSON.parse(JSON.stringify(seen));
  bent.answers[2] = { display: "Nobody", grid: "QQQQQQQ" };
  const solved = solveWordsearch(bent);
  t("it is reported as missing rather than crashing or being skipped",
    solved.missing.length === 1 && solved.missing[0] === "Nobody",
    JSON.stringify(solved.missing));
  t("and the rest of the board is still solved",
    solved.found.length === seen.answers.length - 1);
}

console.log("\nReading the letters, not the name");
{
  /* "O'Neill" is ONEILL in a grid. A solver comparing the display name would
     report a sound board as broken, which is the wrong way round for a check
     that is meant to find broken boards. */
  const grid = ["XONEILLX", "XXXXXXXX"];
  t("punctuation and case are ignored",
    !!findWord(grid, "O'Neill") && !!findWord(grid, "o'neill"),
    JSON.stringify(findWord(grid, "O'Neill")));
  t("a word that is not there is null", findWord(grid, "Rooney") === null);
  t("and neither an empty word nor an empty grid throws",
    findWord(grid, "") === null && findWord([], "ANY") === null);
}

console.log("\nAll eight directions, including backwards and up");
{
  const grid = [
    "ABCDE",
    "FGHIJ",
    "KLMNO",
    "PQRST",
    "UVWXY",
  ];
  const cases = [
    ["ABCDE", "east"], ["EDCBA", "west"], ["AFKPU", "south"], ["UPKFA", "north"],
    ["AGMSY", "south-east"], ["YSMGA", "north-west"], ["EIMQU", "south-west"],
    ["UQMIE", "north-east"],
  ];
  const missed = cases.filter(([w]) => !findWord(grid, w)).map(([, n]) => n);
  t("a word lying any of the eight ways is found",
    missed.length === 0, missed.length ? "missed: " + missed.join(", ") : "all eight");
  /* AND THE COORDINATES POINT THE RIGHT WAY. A solver returning from/to
     reversed would find every word and drag every one of them backwards. */
  const west = findWord(grid, "EDCBA");
  t("and from/to run in the word's own direction, not always left to right",
    west.from[1] === 4 && west.to[1] === 0, JSON.stringify(west));
  /* THE SELECTION IS A LINE THE SERVER WILL ACCEPT. selectionCells refuses
     anything that is not a row, a column or a true diagonal. */
  const diag = findWord(grid, "AGMSY");
  t("a diagonal produces a selection the server can read",
    selectionCells(diag.from, diag.to).length === 5,
    selectionCells(diag.from, diag.to).join(" "));
}

console.log("\nA foul that is really a foul");
{
  const board = BOARDS[0];
  const seen = publicPuzzle(board);
  const solved = solveWordsearch(seen);
  const foul = aFoul(seen, []);
  t("there is a selection to make that spells nothing", !!foul, JSON.stringify(foul));
  /* PROVED AGAINST THE JUDGE, not assumed. A "foul" that happened to land on a
     word would score points instead of conceding minutes, and the escalation
     it was meant to exercise would never fire. */
  t("and the server judges it as a miss",
    judge(board, foul.from, foul.to, []) === null,
    "a foul the server disagrees with is not a foul");
  const late = aFoul(seen, solved.found);
  t("one is still available once the board is solved",
    !!late && judge(board, late.from, late.to, solved.found.map((f) => f.display)) === null,
    JSON.stringify(late));
}

console.log("\nThe other games need no answers either");
{
  t("HiLo calls every row without knowing a value",
    hiloCalls(11).length === 11 && hiloCalls(11).every((c) => c === "higher"));
  t("and can vary its calls without varying the driver",
    hiloCalls(4, "alternate").join(",") === "higher,lower,higher,lower");
  t("no rows is no calls, rather than an error", hiloCalls(0).length === 0);

  const sc = { slots: [{ id: "a" }, { id: "b", presolved: true }, { id: "c" }] };
  t("the cypher games buy every slot that is not already open",
    slotsToReveal(sc).join(",") === "a,c",
    "buying a presolved slot is a purchase with nothing behind it");
  t("and an empty board asks for nothing", slotsToReveal({}).length === 0);

  const cw = { puzzle: { entries: [{ num: 1, dir: "across" }, { num: 2, dir: "down" }] } };
  t("the crossword buys every entry", entriesToReveal(cw).length === 2);
  t("and a payload with no puzzle in it asks for nothing", entriesToReveal({}).length === 0);
}

console.log("\nTen sessions a night");
{
  const plan = sessionPlan(["crossword", "wordsearch", "scrambled", "hilo", "vowels"]);
  t("five games, two sessions each", plan.length === 10, plan.length + " sessions");
  t("one that completes and one that walks away, per game",
    SESSIONS.join(",") === "complete,abandon" &&
    plan.filter((p) => p.kind === "abandon").length === 5,
    "the abandon is the only thing that produces a LOSS in the season");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
