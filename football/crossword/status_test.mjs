/* status_test.mjs — the "what's live" endpoint.
   It exists to make invisible failures visible, so its own honesty matters:
   it must report a missing database rather than an empty one, and must never
   carry clue text. */
import fs from "node:fs";
import { onRequestGet as status } from "../../functions/api/status.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const stub = (rows) => ({ DB: { prepare(sql) {
  return { bind() { return this; },
    async first() {
      /* First match, with the list ordered most specific first. Several
         queries share fragments — the clue_ids count contains the whole
         practice-count query — so neither "first found" nor "longest" is right
         on its own; the order below is the discriminator. */
      for (const [frag, val] of rows) if (sql.includes(frag)) return { n: val };
      return null;
      return null;
    },
    async all() { return { results: [{ clue_ids: JSON.stringify(["a", "b", "c"]) }] }; } };
} } });

const noDb = await (await status({ env: {} })).json();
t("with no database it says so plainly", noDb.db === false && /development/i.test(noDb.source), noDb.source);
t("and explains what that means", /clue bank/i.test(noDb.note || ""));
t("it still reports today's number", typeof noDb.today === "number" && noDb.today > 0, "#" + noDb.today);

const env = stub([
  ["MIN(daily_no)", 1], ["MAX(daily_no)", 120],
  ["AND clue_ids IS NOT NULL", 300],
  ["FROM clues", 2948],
  ["mode = 'practice'", 300], ["mode = 'daily'", 120], ["FROM users", 3],
]);
env.GOOGLE_CLIENT_ID = "x.apps.googleusercontent.com";
const live = await (await status({ env })).json();
t("with a database it reports the real counts",
  live.clues === 2948 && live.practice === 300 && live.dailies === 120,
  `${live.clues} clues, ${live.practice} practice`);
t("it reports the daily range and what is left",
  live.firstDay === 1 && live.lastDay === 120 && live.daysLeft === 120 - live.today,
  live.firstDay + "-" + live.lastDay + ", " + live.daysLeft + " left");
t("it says whether sign-in is configured", live.accounts === true);
t("it flags a pool that predates clue tracking", live.clueIdsPresent === true);

const old = stub([
  ["MIN(daily_no)", 1], ["MAX(daily_no)", 120],
  ["AND clue_ids IS NOT NULL", 0],
  ["FROM clues", 2948],
  ["mode = 'practice'", 120], ["mode = 'daily'", 120], ["FROM users", 0],
]);
const stale = await (await status({ env: old })).json();
t("an un-reimported pool is reported as such", stale.clueIdsPresent === false,
  "clue_ids on 0 of " + stale.practice);

t("a missing table is reported, not thrown on", await (async () => {
  const broken = { DB: { prepare() { return { bind() { return this; },
    async first() { throw new Error("no such table"); },
    async all() { throw new Error("no such table"); } }; } } };
  const r = await status({ env: broken });
  const j = await r.json();
  return r.status === 200 && j.clues === null;
})());

t("nothing in the response is clue text", (() => {
  const raw = JSON.stringify(live);
  return !/clue"\s*:\s*"/.test(raw) && !/answer/i.test(raw) && !/"grid"/.test(raw);
})());

/* Themed boards get their own reading, and it has to distinguish three
   failures that look identical from inside the section: no table, nothing
   imported, and everything scheduled ahead of today. */
t("the status payload reports themed boards separately", (() => {
  const src = fs.readFileSync(path.join(DIR, "../../functions/api/status.js"), "utf8");
  return /FROM theme_boards/.test(src) &&
    /release_on <= date\('now'\)/.test(src) &&
    /themeBoards/.test(src) && /themeLive/.test(src) && /themeNext/.test(src);
})());
t("and the panel tells a missing table from an empty one", (() => {
  const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  return /run migration 006/.test(js) && /none imported/.test(js) && /live of/.test(js);
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
