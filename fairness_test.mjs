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

console.log("\nThe score does not depend on the club");
t("there are clubs to test against", clubs.length > 20, clubs.length + " clubs");
[0, 300, 900, 1800].forEach((secs) => {
  /* Drawing a season per club and scoring is what the game does. If the score
     can see the season at all, this set has more than one member. */
  const scores = new Set(clubs.map((club) => {
    const s = FCW.pickSeason(club, FCW.dailySeed(1), 2);
    return FCW.computeScore(secs, 0, 0, 0, 0).score;
  }));
  t(`at ${secs}s, every club scores the same`, scores.size === 1,
    [...scores].join(", "));
});

console.log("\nNor on anything passed as options");
[undefined, {}, { floor: 0 }, { floor: 40 }, { floor: NaN }, { floor: -99 }].forEach((o) => {
  t("browser ignores " + JSON.stringify(o),
    FCW.computeScore(900, 0, 0, 0, 0, o).score === FCW.computeScore(900, 0, 0, 0, 0).score);
  t("server ignores " + JSON.stringify(o),
    srv.computeScore(900, 0, 0, 0, 0, o).score === srv.computeScore(900, 0, 0, 0, 0).score);
});

console.log("\nBrowser and server agree, with and without help");
const per = FCW.SCORING.MATCH_CLOCK_REAL_SECONDS / FCW.SCORING.MATCH_CLOCK_MAX_MINUTES;
[[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 3], [2, 1, 1]].forEach(([checks, answers, letters]) => {
  const help = Math.round(per * (checks * FCW.SCORING.HELP_MINUTES.check +
    answers * FCW.SCORING.HELP_MINUTES.revealAnswer +
    letters * FCW.SCORING.HELP_MINUTES.revealLetter));
  const b = FCW.computeScore(300 + help, checks, letters, answers, 0).score;
  const s = srv.computeScore(300 + help, checks, letters, answers, 0).score;
  t(`${checks} check(s), ${answers} answer(s), ${letters} letter(s)`, b === s, `${b} vs ${s}`);
});

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
