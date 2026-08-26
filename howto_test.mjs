/* The how-to-play page must describe the rules the game actually has.
 *
 * It drifted a whole scoring model behind — documenting point costs, free
 * per-difficulty substitutions and "not available on the daily" long after help
 * moved to the clock and substitutions became universal. Nothing read the page,
 * so nothing noticed.
 *
 * These assertions read SCORING and check the page agrees. A number changed in
 * engine.js and not here will now fail rather than mislead.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, "js/engine.js"), "utf8"), ctx);
const S = (ctx.FCW || ctx.window.FCW).SCORING;
const page = fs.readFileSync(path.join(DIR, "how-to-play.html"), "utf8");

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

console.log("\nThe numbers it quotes are the numbers in force");
t("the maximum score", page.includes(">" + S.MAX_SCORE + "<"), String(S.MAX_SCORE));
t("substitutions per board", page.includes(">" + S.SUBS_PER_BOARD + "<"), String(S.SUBS_PER_BOARD));
Object.keys(S.HELP_MINUTES).forEach((k) => {
  t("help cost: " + k, page.includes("+" + S.HELP_MINUTES[k] + "&prime;"),
    "+" + S.HELP_MINUTES[k] + "'");
});
[0, 30, 45, 90].forEach((m) => {
  const at = S.DECAY_CURVE.find((p) => p.minute === m);
  if (at) t("the curve at " + m + "'", page.includes(">" + at.score + "<"), String(at.score));
});
t("the real length of a match",
  page.includes("half an hour") && S.MATCH_CLOCK_REAL_SECONDS === 1800);

console.log("\nIt describes the model in force, not the one before it");
t("says help costs time", /They cost time|cost time/i.test(page));
t("says the score is what the clock has left", /clock has left/i.test(page));
t("explains spending all three is not a draw", /Spending all three/i.test(page));
t("explains going past them is", /becomes a draw/i.test(page));
t("names win, draw and loss", /<b>Win<\/b>/.test(page) && /<b>Draw<\/b>/.test(page) && /<b>Loss<\/b>/.test(page));
t("says a missed day is not a loss", /not a loss/i.test(page));
t("points at the archive", /Previous puzzles/i.test(page));

console.log("\nAnd not the old one");
t("no point costs for help",
  !/&minus;(2|3|9|12)\b/.test(page));
t("no per-difficulty substitution table",
  !/Easy/.test(page) && !/Medium/.test(page));
t("does not claim substitutions are unavailable on the daily",
  !/not available on the daily/i.test(page));
t("does not say the cost is shown before you confirm as a points figure",
  !/at \d+ points each/i.test(page));

console.log("\nStructure");
t("links are relative, so the site can move", !/href="\//.test(page));
t("divs balance",
  (page.match(/<div/g) || []).length === (page.match(/<\/div>/g) || []).length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
