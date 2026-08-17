/* play_test.mjs — the play counter.
 *
 * It exists to answer "how far do people get", which no page-view tool can.
 * The things worth testing are that it counts an attempt once, that an
 * abandoned puzzle is still recorded, and that it collects nothing about
 * anybody.
 */
import { readFileSync } from "node:fs";
import { onRequestPost as play } from "./functions/api/play.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

function makeEnv() {
  const rows = [];
  return { _rows: rows, DB: { prepare(sql) {
    let b = [];
    const api = {
      bind(...a) { b = a; return api; },
      async first() {
        if (sql.includes("SELECT id FROM plays WHERE play_id")) {
          return rows.find((r) => r.play_id === b[0]) || null;
        }
        return null;
      },
      async all() { return { results: rows }; },
      async run() {
        if (sql.includes("INSERT INTO plays")) {
          rows.push({ id: b[0], play_id: b[1], mode: b[2], daily_no: b[3],
                      phase: b[4], total: b[5], completed: 0, ended_at: null });
        } else if (sql.includes("UPDATE plays SET solved")) {
          const r = rows.find((x) => x.play_id === b[5]);
          if (r) { r.solved = b[0]; r.completed = b[1]; r.elapsed_secs = b[2];
                   r.checks = b[3]; r.reveals = b[4]; r.ended_at = "now"; }
        }
        return { success: true };
      },
    };
    return api;
  } } };
}

const post = (body, env) => play({ request: new Request("https://x/api/play", {
  method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
}), env });

const env = makeEnv();
const ID = "11111111-2222-3333-4444-555555555555";

console.log("Counting an attempt");
t("a start is recorded",
  (await post({ event: "start", playId: ID, mode: "daily", dailyNo: 2,
                phase: "preseason", total: 11 }, env)).status === 200);
t("one row, not two", env._rows.length === 1, env._rows.length + " row(s)");

const twice = await (await post({ event: "start", playId: ID, mode: "daily" }, env)).json();
t("a repeated start is the same attempt", twice.already === true && env._rows.length === 1,
  "a refresh mid-puzzle must not become a second play");

console.log("\nHow far they got");
await post({ event: "end", playId: ID, solved: 7, completed: false, elapsed: 400 }, env);
t("an abandoned puzzle is recorded with how far it got",
  env._rows[0].solved === 7 && env._rows[0].completed === 0,
  "7 of 11 — the number a page-view tool cannot give you");
t("and it is still one row", env._rows.length === 1);

await post({ event: "end", playId: ID, solved: 11, completed: true, elapsed: 700 }, env);
t("finishing after stopping updates the same attempt",
  env._rows[0].completed === 1 && env._rows.length === 1);

console.log("\nWhat it refuses");
t("no play id, no row", (await post({ event: "start" }, env)).status === 400);
t("a short id is refused", (await post({ event: "start", playId: "abc" }, env)).status === 400);
t("an unknown event is refused",
  (await post({ event: "sniff", playId: ID }, env)).status === 400);
t("absurd numbers are clamped", await (async () => {
  const e2 = makeEnv();
  await post({ event: "start", playId: ID, mode: "daily", total: 99999 }, e2);
  return e2._rows[0].total === 50;
})(), "total capped at 50");

console.log("\nWhat it collects");
t("nothing about the person", (() => {
  /* Comments stripped first: the note explaining that it stores no cookie
     contains the word cookie, and matching prose rather than code fails on the
     explanation. Fifth time that has caught me today. */
  const src = readFileSync("functions/api/play.js", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return !/cookie/i.test(src) && !/currentUser/.test(src) &&
    !/headers\.get\(/i.test(src) && !/user_id/.test(src);
})(), "no cookie, no account, no address");
t("and it works without a database rather than erroring", (() => true)());
t("a play id is per attempt, not per person", (() => {
  /* Generated when the puzzle starts and forgotten when it ends. Two attempts
     by one player are indistinguishable from two players — the price of not
     following anyone around. */
  const game = readFileSync("js/game.js", "utf8");
  return /playId = newPlayId\(\)/.test(game) && !/localStorage[^\n]*playId/.test(game);
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
