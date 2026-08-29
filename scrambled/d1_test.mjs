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
import { onRequestGet } from "../functions/api/scrambled/daily.js";
import { SC_BOARDS } from "../functions/_lib/sc-boards.js";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
