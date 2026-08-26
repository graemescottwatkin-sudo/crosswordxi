/* The win/draw/loss rule.
 *
 * One function decides what a finished board was worth, so the finish screen,
 * the season table, the form chips and the server cannot disagree. If this
 * drifts, every one of those drifts with it — which is why it is tested on its
 * own rather than through whatever happens to call it.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, "js/engine.js"), "utf8"), ctx);
const FCW = ctx.FCW || ctx.window.FCW;

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const rec = (x) => Object.assign({
  complete: true, elapsedSeconds: 300, revealedLetters: 0, revealedAnswers: 0,
}, x);

console.log("\nWhat counts as a win");
t("solved with nothing used", FCW.outcome(rec({})) === "W");
t("solved having spent all three substitutions",
  FCW.outcome(rec({ revealedLetters: 3 })) === "W",
  "spending the allocation is not exceeding it");
t("a revealed answer uses exactly three, so it is still a win",
  FCW.outcome(rec({ revealedAnswers: 1 })) === "W");

console.log("\nWhat makes it a draw");
t("a fourth letter", FCW.outcome(rec({ revealedLetters: 4 })) === "D");
t("an answer with one already spent",
  FCW.outcome(rec({ revealedLetters: 1, revealedAnswers: 1 })) === "D",
  "needs three, has two");
t("two revealed answers", FCW.outcome(rec({ revealedAnswers: 2 })) === "D");
t("solved after full time, with everything in hand",
  FCW.outcome(rec({ elapsedSeconds: 60 * 31 })) === "D",
  "90 match minutes is 30 real ones");
t("and exactly at full time is late enough",
  FCW.outcome(rec({ elapsedSeconds: FCW.SCORING.MATCH_CLOCK_REAL_SECONDS })) === "D");

console.log("\nWhat makes it a loss");
t("started and not finished", FCW.outcome(rec({ complete: false })) === "L");
t("no record at all", FCW.outcome(null) === "L");
t("an unfinished board is a loss however little help was used",
  FCW.outcome(rec({ complete: false, revealedLetters: 0 })) === "L");

console.log("\nSubstitutions");
t("three per board", FCW.SCORING.SUBS_PER_BOARD === 3);
t("a letter costs one", FCW.subsSpent(rec({ revealedLetters: 1 })) === 1);
t("an answer costs three", FCW.subsSpent(rec({ revealedAnswers: 1 })) === 3);
t("remaining never goes below zero",
  FCW.subsRemaining(rec({ revealedLetters: 9 })) === 0);
t("spending all three leaves none but does not exceed",
  FCW.subsRemaining(rec({ revealedAnswers: 1 })) === 0 &&
  !FCW.subsExceeded(rec({ revealedAnswers: 1 })));

console.log("\nPoints");
t("a win is three", FCW.outcomePoints("W") === 3);
t("a draw is one", FCW.outcomePoints("D") === 1);
t("a loss is none", FCW.outcomePoints("L") === 0);
t("a perfect season reaches the maximum score",
  38 * FCW.outcomePoints("W") === FCW.SCORING.MAX_SCORE,
  "38 x 3 = " + FCW.SCORING.MAX_SCORE);

console.log("\nThe play reference is per board, not per tab");
{
  /* Asked for by review: two consecutive fresh boards must not share a play id.
     They did — the reset block cleared eleven pieces of state and not playId,
     playNo or playSent, and playStart() only mints a new one when playId is
     null. So finishing the daily and opening an archive board ran the second
     board on the first board's row: /api/finish answered `already: true` with
     the wrong score, recordDaily rewrote the wrong record, and a challenge
     started afterwards was refused as a duplicate entry.

     Read from the source because the reset lives inside newPuzzle(), which
     needs a live puzzle and a server to run. What must hold is that the three
     are cleared alongside the rest of the per-board state. */
  const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  const reset = game.slice(game.indexOf("helpActions = []; consecutiveChecks = 0;"),
                           game.indexOf("helpActions = []; consecutiveChecks = 0;") + 1400);
  t("a fresh board clears the play id", /playId = null/.test(reset));
  t("and the play number", /playNo = null/.test(reset));
  t("and the sent flag, so the new row is posted", /playSent = false/.test(reset));
  t("while a restore still puts the saved one back",
    /playId = restore\.playId/.test(game),
    "or a refresh mid-puzzle would count as a second attempt");
}

console.log("\nOne board value, one writer");
{
  const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  t("openBoard exists", /function openBoard\(/.test(game));
  t("and is the only thing that assigns board", (() => {
    /* Six variables each held part of "which board is this" and were written
       from a dozen routes. Six faults came out of that, each found only after
       fixing the previous one moved the symptom. */
    const writes = (game.match(/(?<![.\w])board\s*=\s*\{/g) || []).length;
    return writes <= 2;   // the initial value, and openBoard's assignment
  })());
  t("the request always names the board",
    /api\("\/api\/daily\?no=" \+ \(board\.no \|\| today\(\)\)\)/.test(game),
    "no parameter would be a second definition of today");
  t("boot looks for an unfinished daily on any board, not only today's",
    /function unfinishedDailies\(/.test(game),
    "savedFor('daily') defaults to today, which is the landing screen's question");
  t("the date sync waits until a board is open",
    /if \(!board\.no \|\| today\(\) === board\.no\) return;/.test(game),
    "board.no is null on the landing screen, and null is not today");
  t("save slots are keyed per board",
    /"fcw\.v04\.daily\." \+/.test(game),
    "one shared slot meant an archive board overwrote today's");
}

console.log("\nEvery kind of board asks for its own");
{
  /* The gap that let a broken build pass 479 tests: no suite asserted the URL
     a theme or practice board requests. Seven routes set the old variables and
     never touched `board`, so requestPuzzle read a stale one and every
     non-daily board loaded today's daily.

     Source-read rather than driven, because requestPuzzle needs a live puzzle
     and a server. What must hold is that each kind has its own branch and that
     `board` is what they switch on. */
  const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  const fn = game.slice(game.indexOf("function requestPuzzle"),
                        game.indexOf("function requestPuzzle") + 2200);
  t("a daily asks /api/daily by number",
    /board\.kind === "daily"[\s\S]{0,400}\/api\/daily\?no=/.test(fn));
  t("a theme board asks /api/theme-board",
    /board\.kind === "theme"[\s\S]{0,400}\/api\/theme-board/.test(fn));
  t("a shared token asks /api/practice",
    /board\.token[\s\S]{0,200}\/api\/practice\?token=/.test(fn));
  t("the owner's preview asks the admin route",
    /board\.adminDay[\s\S]{0,200}\/api\/admin\/daily/.test(fn));
  t("and nothing switches on a variable other than board",
    !/(?<![.\w])themeWanted|(?<![.\w])sharedToken/.test(fn));
}

console.log("\nThe board is frozen, and has exactly two constructors");
{
  const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  t("openBoard freezes it", /function openBoard[\s\S]{0,600}Object\.freeze/.test(game),
    "so a stray board.x = throws rather than drifting");
  t("adoptServerBoard is the only other constructor",
    /function adoptServerBoard/.test(game) &&
    /* Three: the initial value, openBoard, adoptServerBoard. The initial one is
       frozen too, so the landing state cannot be mutated either. */
    (game.match(/(?<![.\w])board\s*=\s*Object\.freeze/g) || []).length === 3);
  t("nothing assigns a board field",
    !/(?<![.\w])board\.(kind|no|theme|token|adminDay|openedAsToday)\s*=[^=]/.test(game));
  t("openedAsToday is derived, never passed",
    !/asToday\s*:/.test(game.replace(/openedAsToday:/g, "")),
    "a caller could otherwise make a board that lies about itself");
}

console.log("\nResuming picks the right board");
{
  /* Slots are keyed per board, so several can be part-played at once and the
     scan has to choose. The first version of unfinishedTheme took whichever key
     came first, on the assumption that themed boards shared one slot: open a
     club board, type, refresh, and you landed on Board of the week because an
     earlier session had left that behind.

     Tested as arithmetic rather than through the page, because the page needs
     jsdom and this is the part that was wrong. */
  const byRecency = (saves) => {
    let best = null;
    Object.keys(saves).forEach((k) => {
      const raw = saves[k];
      if (!raw || raw.complete) return;
      if (!best || (raw.savedAt || 0) > (best.savedAt || 0)) best = raw;
    });
    return best;
  };
  const now = Date.now();
  const three = {
    a: { themeKey: "board-of-the-week-2", complete: false, savedAt: now - 86400000 },
    b: { themeKey: "arsenal-wenger-era-3", complete: false, savedAt: now - 60000 },
    c: { themeKey: "man-united-ferguson-1", complete: true, savedAt: now },
  };
  t("the most recently played unfinished board wins",
    byRecency(three).themeKey === "arsenal-wenger-era-3",
    byRecency(three).themeKey);
  t("a finished board is never resumed, however recent",
    byRecency({ c: three.c }) === null);
  t("and the code orders by savedAt, not by key order", (() => {
    const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = game.slice(game.indexOf("function unfinishedTheme"),
                          game.indexOf("function unfinishedDailies"));
    return /savedAt \|\| 0\) > \(best\.savedAt \|\| 0\)/.test(fn);
  })(), "key order is insertion order, not recency");
  t("every save carries the timestamp this depends on", (() => {
    const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /savedAt: Date\.now\(\)/.test(game);
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
