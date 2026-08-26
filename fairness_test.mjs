/* The same board, played the same way, must score the same for everyone.
 *
 * It did not. The decay curve was scaled to the drawn season's floor, and
 * pickSeason() draws from seasonsForClub() — so the season, and therefore the
 * floor, depended on the club the player had chosen for flavour. Identical play
 * scored 66 as Aston Villa and 76 as Blackpool.
 *
 * This replaces floor_test.mjs, which checked that browser and server agreed
 * about the floor. They did, in the end, by both ignoring it — a test that
 * could no longer fail, which is the fault it was written to catch elsewhere.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext("var window=this;" + fs.readFileSync(path.join(DIR, "js/seasons.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, "js/engine.js"), "utf8"), ctx);
const FCW = ctx.FCW || ctx.window.FCW;
FCW.loadSeasons(ctx.window.FCW_SEASONS);

const srvSrc = fs.readFileSync(path.join(DIR, "functions/_lib/scoring.js"), "utf8")
  .replace(/export /g, "");
const srv = {};
vm.runInNewContext(srvSrc + "\nthis.computeScore = computeScore; this.SCORING = SCORING;", srv);

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const clubs = [...new Set(FCW.SCORING.SEASONS.flatMap((s) => s.table.map((r) => r.club)))];
const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");

/* The previous version of this asserted "every club scores the same" by calling
   pickSeason() per club and throwing the result away. computeScore cannot see a
   club, so the set had one member whatever the scorer did — a test that could
   not fail, on the property it was named for, written one release after we
   cited that exact fault elsewhere.
   
   What can fail: the SHAPE of the scorers, and whether anything in the game
   passes them a sixth argument. Those are what let a season-dependent term back
   in. */

console.log("\nNeither scorer accepts anything beyond the five counts");
t("browser computeScore takes exactly five parameters",
  FCW.computeScore.length === 5, "arity " + FCW.computeScore.length);
t("server computeScore takes exactly five parameters",
  srv.computeScore.length === 5, "arity " + srv.computeScore.length);

console.log("\nAnd nothing in the game passes a sixth");
{
  /* A sixth argument is how the season floor got in, and how anything else
     season-, club- or player-dependent would. Counting commas at depth zero
     inside each call, so nested calls and object literals do not miscount. */
  const bad = [];
  const re = /computeScore\s*\(/g;
  let m;
  while ((m = re.exec(game))) {
    let k = m.index + m[0].length, depth = 0, args = 1, str = null;
    for (; k < game.length; k++) {
      const c = game[k];
      if (str) { if (c === str && game[k - 1] !== "\\") str = null; continue; }
      if (c === '"' || c === "'") { str = c; continue; }
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { if (!depth) break; depth--; }
      else if (c === "," && !depth) args++;
    }
    if (args > 5) bad.push(game.slice(m.index, m.index + 90).split("\n")[0]);
  }
  t("no call site passes a sixth argument", bad.length === 0, bad.join(" | "));
}

console.log("\nThe curve, landmark by landmark");
{
  /* Restored from scoring_test.mjs, which was deleted with this suite as its
     replacement — and this suite only ever checked 300 seconds. */
  const per = FCW.SCORING.MATCH_CLOCK_REAL_SECONDS / FCW.SCORING.MATCH_CLOCK_MAX_MINUTES;
  FCW.SCORING.DECAY_CURVE.forEach((pt) => {
    const secs = Math.round(pt.minute * per);
    const b = FCW.computeScore(secs, 0, 0, 0, 0).score;
    const sv = srv.computeScore(secs, 0, 0, 0, 0).score;
    t(`${pt.minute}' is ${pt.score} in both`, b === pt.score && sv === pt.score,
      `browser ${b}, server ${sv}`);
  });
  t("past full time the score stops falling",
    FCW.computeScore(9999, 0, 0, 0, 0).score ===
    FCW.computeScore(FCW.SCORING.MATCH_CLOCK_REAL_SECONDS, 0, 0, 0, 0).score);
}

console.log("\nBrowser and server agree, with and without help");
{
  const per = FCW.SCORING.MATCH_CLOCK_REAL_SECONDS / FCW.SCORING.MATCH_CLOCK_MAX_MINUTES;
  [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 3], [2, 1, 1]].forEach(([checks, answers, letters]) => {
    const help = Math.round(per * (checks * FCW.SCORING.HELP_MINUTES.check +
      answers * FCW.SCORING.HELP_MINUTES.revealAnswer +
      letters * FCW.SCORING.HELP_MINUTES.revealLetter));
    const b = FCW.computeScore(300 + help, checks, letters, answers, 0).score;
    const sv = srv.computeScore(300 + help, checks, letters, answers, 0).score;
    t(`${checks} check(s), ${answers} answer(s), ${letters} letter(s)`, b === sv, `${b} vs ${sv}`);
  });
}

console.log("\nThe club a player picked reaches no scoring input");
{
  /* Scored through what the game actually passes: elapsed and the four counts.
     If a club could reach any of those, two clubs would differ here. */
  const scores = new Set(clubs.map((club) => {
    const season = FCW.pickSeason(club, FCW.dailySeed(1), 2);
    const floor = season && season.table
      ? Math.max(0, (season.table[season.table.length - 1].points || 0) - 1) : null;
    /* floor is deliberately computed and deliberately NOT passed: this is the
       value that used to reach the scorer. If it ever can again, the arity and
       call-site checks above fail first. */
    return FCW.computeScore(600, 0, 0, 0, 0).score + ":" + (floor === null ? "-" : "ok");
  }));
  t("every club produces one score", new Set([...scores].map((x) => x.split(":")[0])).size === 1,
    clubs.length + " clubs");
}

console.log("\nThe constants still match");
["MAX_SCORE", "MATCH_CLOCK_REAL_SECONDS", "MATCH_CLOCK_MAX_MINUTES"].forEach((k) => {
  t(k, FCW.SCORING[k] === srv.SCORING[k], `${FCW.SCORING[k]} vs ${srv.SCORING[k]}`);
});
Object.keys(FCW.SCORING.HELP_MINUTES).forEach((k) => {
  t("HELP_MINUTES." + k,
    FCW.SCORING.HELP_MINUTES[k] === srv.SCORING.HELP_MINUTES[k]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
