/* report_test.mjs — reporting bad content, from every game that has any.
 *
 * Only the crossword could report until now: clue_reports was clue-shaped and
 * the endpoint took { clueId }. The word search, Scrambled and QuickFire have
 * boards and questions, not clues, so a player spotting a wrong answer in any
 * of them had nowhere to put it.
 *
 * The check that matters is not "does it accept a game field". It is: does a
 * report from a game with NO row in `clues` actually get stored, with the game
 * recorded — because that is the case the old schema could not express and the
 * admin LEFT JOIN was never asked about.
 */
import { onRequestPost } from "../functions/api/report-clue.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A stub that records what was inserted, and models the per-game dedupe. */
function envWith(rows) {
  const inserted = [];
  const env = { DB: { prepare(sql) {
    return { bind(...b) { return {
      async first() {
        if (/SELECT id, reason FROM clue_reports/.test(sql)) {
          /* Read WHICH COLUMNS the query filters on, in the order it names
             them, and match on those. Assuming the bind order instead makes
             the stub agree with whatever the code does: drop "game = ?" from
             the WHERE and a positional stub reads the next value into the
             wrong variable, so the assertion written for that fault passes and
             an unrelated one fails.
             AND IT REFUSES AN EMPTY LIST. The first version of this parser had
             its backslashes eaten, matched nothing, and every() on no columns
             is true — so the stub matched every row and reported a duplicate
             for everything. A matcher that cannot read the query must stop,
             not agree. */
          const where = (sql.match(/WHERE\s+(.*)$/) || [, ""])[1];
          const cols = [...where.matchAll(/([a-z_]+)\s*=\s*\?/g)].map((m) => m[1]);
          if (!cols.length) throw new Error("stub could not read the WHERE clause: " + sql);
          return rows.find((r) => cols.every((c, i) => String(r[c]) === String(b[i]))) || null;
        }
        return null;
      },
      async run() {
        if (/INSERT INTO clue_reports/.test(sql)) {
          inserted.push({ id: b[0], game: b[1], clue_id: b[2], reported_by: b[3], reason: b[4], puzzle: b[5] });
          rows.push(inserted[inserted.length - 1]);
        }
        return {};
      },
    }; } };
  } } };
  return { env, inserted };
}
/* currentUser reads the session from D1; these tests are about what is stored,
   so the session lookup is satisfied by the same stub returning a user row. */
const CTX = (env, body) => ({
  request: new Request("https://x.test/api/report-clue", {
    method: "POST",
    headers: { "X-XI-Games": "1", "Content-Type": "application/json", "Cookie": "cxi_session=s1" },
    body: JSON.stringify(body),
  }),
  env,
});
function withUser(env) {
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    if (/FROM sessions s JOIN users u/.test(sql)) {
      return { bind: () => ({ first: async () => ({ id: "u1", display_name: "Tester" }) }) };
    }
    if (/rate_limits|INSERT INTO rate_limits|SELECT .* FROM rate_limits/i.test(sql)) {
      return { bind: () => ({ first: async () => null, run: async () => ({}), all: async () => ({ results: [] }) }) };
    }
    return real(sql);
  };
  return env;
}

console.log("A report from a game that has no clues");
{
  const { env, inserted } = envWith([]);
  const r = await onRequestPost(CTX(withUser(env), {
    game: "scrambled", itemId: "2", reason: "Ball was at Blackpool, not Everton", puzzle: "sc:2",
  }));
  t("a Scrambled board report is accepted", r.status === 200, "HTTP " + r.status);
  t("and it is stored against that game",
    inserted.length === 1 && inserted[0].game === "scrambled" && inserted[0].clue_id === "2",
    inserted.length ? `${inserted[0].game} / ${inserted[0].clue_id}` : "nothing stored");
  t("with the reason, which is the half that says what to fix",
    inserted[0] && /Blackpool/.test(inserted[0].reason || ""));
}

console.log("\nThe crossword's own call is unchanged");
{
  const { env, inserted } = envWith([]);
  const r = await onRequestPost(CTX(withUser(env), { clueId: "TRJ0202", puzzle: "daily:3", reason: "Answer looks wrong" }));
  t("{ clueId } with no game still works", r.status === 200, "HTTP " + r.status);
  t("and defaults to the crossword",
    inserted[0] && inserted[0].game === "crossword" && inserted[0].clue_id === "TRJ0202",
    inserted[0] ? inserted[0].game : "nothing stored");
}

console.log("\nThe rules that already applied, applied per game");
{
  /* Board 3 of Scrambled and clue 3 of the crossword are different things with
     the same id. Deduplicating on the id alone would silence the second. */
  const rows = [{ game: "crossword", clue_id: "3", reported_by: "u1", reason: "x" }];
  const { env, inserted } = envWith(rows);
  const r = await onRequestPost(CTX(withUser(env), { game: "scrambled", itemId: "3", reason: "wrong club" }));
  const body = await r.json();
  t("the same id in a different game is a different report",
    !body.already && inserted.length === 1, body.already ? "treated as a duplicate" : "stored");
}
{
  const rows = [{ game: "scrambled", clue_id: "3", reported_by: "u1", reason: "wrong club" }];
  const { env, inserted } = envWith(rows);
  const body = await (await onRequestPost(CTX(withUser(env), { game: "scrambled", itemId: "3", reason: "wrong club" }))).json();
  t("but the same id in the same game is still one report",
    body.already === true && inserted.length === 0);
}

console.log("\nA game that does not exist is refused");
{
  const { env, inserted } = envWith([]);
  const r = await onRequestPost(CTX(withUser(env), { game: "chess", itemId: "1", reason: "n/a" }));
  t("an unknown game is refused rather than stored",
    r.status === 400 && inserted.length === 0, "HTTP " + r.status);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
