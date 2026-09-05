/* d1_test.mjs — the boards come from D1, and the module is only the fallback.
 *
 * Scrambled XI began with its boards generated into functions/_lib/sc-boards.js
 * and read from there, which makes changing a board a DEPLOY. The other three
 * games keep their content in the database for that reason — "changing a
 * question is an import, not a deploy" — and this game now does too.
 *
 * The check that matters is not "does the code mention D1". It is: when a
 * database IS bound, is the board the player gets the one in the database? So
 * the stub below holds a board that exists NOWHERE ELSE. If the handler is
 * quietly still reading the module, the title comes back wrong and this fails.
 * A suite that seeded D1 with the same boards the module holds would pass
 * against a handler that ignored D1 entirely.
 */
import { onRequestGet } from "../../functions/api/scrambled/daily.js";
import { SC_BOARDS } from "../../functions/_lib/sc-boards.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const stub = (rows) => ({ DB: { prepare: () => ({ all: async () => ({ results: rows }) }) } });
const ask = async (env) => (await onRequestGet({
  request: new Request("https://x.test/api/scrambled/daily?no=1"), env,
})).json();

/* A board only the database has. */
const only = JSON.parse(JSON.stringify(SC_BOARDS[0]));
only.title = "ONLY-IN-D1";

console.log("Where the board comes from");
const bound = await ask(stub([{ payload: JSON.stringify(only) }]));
t("a bound database is preferred over the module", bound.source === "d1", `source ${bound.source}`);
t("and the board served is the one IN the database",
  bound.title === "ONLY-IN-D1", bound.title);

const unbound = await ask({});
t("with no binding it falls back to the generated module",
  unbound.source === "module", `source ${unbound.source}`);
t("and that fallback is the real board, not sample data",
  unbound.title === SC_BOARDS[0].title, unbound.title);

/* An un-imported table is the state between migration and import. Serving
   nothing there would take the game down for a missing import. */
const empty = await ask(stub([]));
t("an empty table falls back rather than serving no board",
  empty.source === "module" && !!empty.title, `source ${empty.source}`);

/* A table that does not exist yet — the state before the migration is applied.
   The query throws; the game must not. */
const broken = { DB: { prepare: () => ({ all: async () => { throw new Error("no such table: sc_board"); } }) } };
const survived = await ask(broken);
t("a missing table falls back rather than throwing",
  survived.source === "module" && !!survived.title, `source ${survived.source}`);

console.log("\nThe redaction rule holds on the D1 path too");
/* The module path is covered by board_test; this is the same rule asked of the
   route the database feeds, because a second source of boards is a second
   chance to leak the names. */
const names = (SC_BOARDS[0].slots || []).map((s) => s.name).filter(Boolean);
t("no name from the board is in the D1-served payload",
  names.length > 0 && !names.some((n) => JSON.stringify(bound).toUpperCase().includes(String(n).toUpperCase())),
  `${names.length} names checked`);

console.log("\nThe last-two boards are their own table, never the bank");
/* A set that goes stale every round lives apart from boards that never
   change, has no module to fall back to, and never reaches the daily ring.
   The stub answers every query with whatever rows it holds, so the filter on
   type is what keeps a bank row out of the last-two list and vice versa. */
const { loadLast2 } = await import("../../functions/_lib/sc-board.js");
const fixture = JSON.parse(JSON.stringify(SC_BOARDS[0]));
fixture.type = "prem-last2"; fixture.club = "Sampleton"; fixture.gameweek = 2; fixture.daily = false;
const l2 = await loadLast2(stub([{ payload: JSON.stringify(fixture) }, { payload: JSON.stringify(only) }]));
t("a bound database serves the last-two set, and only boards of that type",
  l2.source === "d1" && l2.boards.length === 1 && l2.boards[0].club === "Sampleton",
  `${l2.boards.length} board(s), source ${l2.source}`);
const l2none = await loadLast2({});
t("with no binding there is no fallback — an empty set, said so",
  l2none.source === "none" && l2none.boards.length === 0);
const l2broken = await loadLast2(broken);
t("a missing table is an empty set rather than a throw",
  l2broken.source === "none" && l2broken.boards.length === 0);
const ringWithFixture = await ask(stub([{ payload: JSON.stringify(fixture) }, { payload: JSON.stringify(only) }]));
t("and a last-two board in the bank's own table would still be kept out of the daily ring",
  ringWithFixture.title === "ONLY-IN-D1", ringWithFixture.title);

console.log("\nA board that sells nothing refuses the purchase");
/* The bench hides the button; this is the rule holding when something asks
   anyway. An empty answer at 200 would be billed by the client as a hint. */
const { onRequestPost: revealPost } = await import("../../functions/api/scrambled/reveal.js");
const silent = JSON.parse(JSON.stringify(SC_BOARDS[0]));
silent.hintField = "none";
const askReveal = async (env, body) => {
  const r = await revealPost({
    request: new Request("https://x.test/api/scrambled/reveal", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), env,
  });
  return { status: r.status, body: await r.json() };
};
const refusedHint = await askReveal(stub([{ payload: JSON.stringify(silent) }]), { token: "sc:1", kind: "hint" });
t("a hint on a board declaring none is refused, not sold empty",
  refusedHint.status === 409 && !refusedHint.body.hints, `HTTP ${refusedHint.status}`);
const soldHint = await askReveal(stub([{ payload: JSON.stringify(only) }]), { token: "sc:1", kind: "hint" });
t("while a board that sells one still answers",
  soldHint.status === 200 && !!soldHint.body.hints && !!soldHint.body.label, `HTTP ${soldHint.status}`);
const letterStill = await askReveal(stub([{ payload: JSON.stringify(silent) }]),
  { token: "sc:1", kind: "letter", slotId: silent.slots[0].id, known: 0 });
t("and a letter is still for sale on the silent board", letterStill.status === 200 && !!letterStill.body.letter,
  `HTTP ${letterStill.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
