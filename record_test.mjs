/* The record the game actually stores.
 *
 * outcome_test.mjs builds its records by hand — `{ complete: true, ... }` — so
 * it tests the rule against a hypothetical row. recordDaily() builds them
 * through FCW.makeResultRecord(), which assembles an explicit shape and drops
 * anything not named in it, in silence. The two had drifted: `mode`, `phase`
 * and `complete` were all passed at the call site and none of them survived.
 *
 * Consequences, all of them live before this suite existed:
 *   FCW.outcome() returned "L" for every stored result, a 114 included
 *   the Season tile's `r.phase === "season"` filter was never true
 *   eight readers filtering `mode === "daily"` matched no local row
 *   the same daily arrived twice after signing in
 *
 * So this suite tests the seam rather than either side of it: what recordDaily
 * hands over, what comes back, and whether the readers can use it.
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
const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");

/* Assertions about what the code does must read code, not prose. This suite
   failed on its first run because the comments explaining why `r.phase` and
   the score bands were removed quote both of them, and a plain search found
   the explanation and called it the thing.

   Block comments go, and so do whole lines that are only a line comment.
   Trailing `//` is left alone deliberately: stripping it would truncate any
   line holding a URL, which is a worse failure than the one being avoided. */
const code = game
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A record exactly as recordDaily builds one: a clean solve, no help. */
const built = FCW.makeResultRecord({
  date: "2026-08-26", dailyNo: 3, seed: 1, playId: "p1",
  mode: "daily", complete: true,
  bankVersion: FCW.QUESTION_BANK_VERSION,
  club: "Bolton", season: null, score: 114, position: 1,
  elapsedSeconds: 300, matchMinute: FCW.matchMinute(300),
  checks: 0, revealedLetters: 0, revealedAnswers: 0,
  pauses: 0, pausedSeconds: 0,
});

console.log("\nNothing recordDaily passes is dropped");
/* Read the call site out of the source. A field added there and forgotten in
   the shape is the exact fault this exists to catch, so the list of fields
   cannot be written out here by hand — it has to come from the code. */
const call = game.slice(game.indexOf("list.push(FCW.makeResultRecord({"));
const body = call.slice(0, call.indexOf("}));"));
const stripped = body
  .replace(/\/\*[\s\S]*?\*\//g, "")          // block comments
  .replace(/\/\/[^\n]*/g, "");               // line comments
const passedKeys = [...stripped.matchAll(/(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*:/gm)]
  .map((m) => m[1]);
t("the call site was found and parsed", passedKeys.length > 10,
  passedKeys.length + " fields passed");
const dropped = passedKeys.filter((k) => !(k in built));
t("every field recordDaily passes survives makeResultRecord",
  dropped.length === 0,
  dropped.length ? "dropped: " + dropped.join(", ") : "none dropped");

console.log("\nWhat outcome() needs");
t("the stored record carries `complete`", "complete" in built);
t("a clean solve resolves to a win, not a loss",
  FCW.outcome(built) === "W", "was \"L\" for every record before this");
t("and it agrees with the hand-built record outcome_test uses",
  FCW.outcome(built) ===
  FCW.outcome({ complete: true, elapsedSeconds: 300,
                revealedLetters: 0, revealedAnswers: 0 }));
t("an unfinished record is still a loss",
  FCW.outcome(FCW.makeResultRecord({ dailyNo: 4, complete: false,
    elapsedSeconds: 300, revealedLetters: 0, revealedAnswers: 0 })) === "L",
  "complete is stored, not assumed, so a banked loss can say so");

console.log("\nWhat the eight mode readers need");
t("the stored record carries `mode`", built.mode === "daily");
/* keyOf, copied from mergeResults. A local row and the same daily coming back
   from the account must land on one key or the row is duplicated. */
const keyOf = (r) =>
  r && r.mode === "daily" && r.dailyNo != null
    ? "daily:" + r.dailyNo
    : [r && r.mode, r && r.date, r && r.completedAt, r && r.score].join("|");
const remote = { mode: "daily", dailyNo: 3, date: "2026-08-26", score: 114,
                 completedAt: built.completedAt, complete: true };
t("a local row and the account's copy of it share one key",
  keyOf(built) === keyOf(remote), keyOf(built));
t("so one daily stays one row after a merge",
  new Set([keyOf(built), keyOf(remote)]).size === 1);
t("the calendar can see a locally-played board",
  built.mode === "daily" && built.dailyNo != null,
  "renderPreviousCount and nextUnplayedDaily both filter on this");

console.log("\nLegacy rows are repaired rather than abandoned");
t("loadResults upgrades what it reads", /function upgradeResults/.test(code));
t("and writes the repair back", /upgradeResults\(r\)/.test(code));
t("a row that already says complete:false is left alone",
  /r\.complete == null/.test(code),
  "or a banked loss would be overwritten with true on the next read");
/* loadResults() had never been a writer. standDown() promises no writes
   between it and the reload, and location.reload() does not halt the page. */
t("the backfill honours the multi-tab stand-down",
  /if \(changed && !saveBlocked\)/.test(code),
  "a stood-down tab must not write the list back");
t("but still repairs in memory, so a stood-down tab renders correctly",
  code.indexOf("return list;", code.indexOf("function upgradeResults")) >
  code.indexOf("if (changed && !saveBlocked)"));

console.log("\nPhase is derived, not stored");
t("recordDaily no longer passes a phase it cannot store",
  !passedKeys.includes("phase"));
t("and no reader filters results on a stored phase",
  !/r\.phase === "season"/.test(code),
  "that filter was never true for any row");

console.log("\nOne rule for W/D/L");
t("the Season tile reads FCW.outcome",
  /FCW\.outcomePoints\(FCW\.outcome\(r\)\)/.test(code));
t("and the score bands are gone",
  !/score >= 76 \? 3 : /.test(code),
  "seven of nine ordinary finishes resolved differently");

/* The disagreement, kept as a regression: if anyone reintroduces a score band,
   these are the finishes it will get wrong. */
const SEC = 1800 / 90;
const band = (s) => (s >= 76 ? "W" : s >= 38 ? "D" : "L");
const rec = (mins, letters) => ({
  complete: true, elapsedSeconds: mins * SEC,
  revealedLetters: letters, revealedAnswers: 0,
});
const at = (mins, letters) =>
  FCW.computeScore(mins * SEC, 0, letters, 0, 0).score;
t("solved at 45' with no help is a win",
  FCW.outcome(rec(45, 0)) === "W" && band(at(45, 0)) === "D",
  "the band called it a draw");
t("solved at 20' having revealed five letters is a draw",
  FCW.outcome(rec(20, 5)) === "D" && band(at(20, 5)) === "W",
  "over the three-substitution allowance; the band called it a win");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
