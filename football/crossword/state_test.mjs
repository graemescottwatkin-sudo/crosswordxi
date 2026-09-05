/* state_test.mjs — a board in progress follows the player.
 *
 * The owner hit the blank iPad three times in two days: only FINISHED boards
 * synced, and the letters of a board mid-solve lived in the localStorage of
 * the device that typed them. This suite covers the machinery that retires
 * that design — the endpoint by EXECUTION against a stub D1 (a regex cannot
 * catch an arity bug or a rule bug; both shipped once), and the clients by
 * the rules that make two devices converge instead of fight.
 *
 *   node crossword/state_test.mjs        (from the repo root)
 */
import { onRequestGet, onRequestPost } from "../../functions/api/account/state.js";
import fs from "node:fs";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* A stub D1 that MODELS the primary key, because ON CONFLICT ... DO UPDATE is
   the behaviour under test. The auth_test stub that modelled a schema its
   endpoint had stopped using turned a passing suite into a statement about
   nothing; this one enforces exactly what migration 021 creates. */
function stubEnv(rows) {
  return { DB: { prepare: (sql) => ({ bind: (...b) => ({
    first: async () => {
      const r = rows.find((x) => x.user_id === b[0] && x.game === b[1] && x.entry_key === b[2]);
      return r ? { state: r.state, updated_at: r.updated_at } : null;
    },
    run: async () => {
      if (/DELETE FROM board_state/.test(sql)) {
        const i = rows.findIndex((x) => x.user_id === b[0] && x.game === b[1] && x.entry_key === b[2]);
        if (i > -1) rows.splice(i, 1);
        return;
      }
      if (/INSERT INTO board_state/.test(sql)) {
        /* Arity counted, not eyeballed — the 23/21 lesson. */
        const marks = (sql.match(/VALUES \(([^)]*)\)/) || [, ""])[1]
          .split(",").filter((v) => v.trim() === "?").length;
        if (marks !== b.length) throw new Error(`arity: ${marks} marks, ${b.length} binds`);
        const i = rows.findIndex((x) => x.user_id === b[0] && x.game === b[1] && x.entry_key === b[2]);
        const row = { user_id: b[0], game: b[1], entry_key: b[2], state: b[3], updated_at: b[4] };
        if (i > -1) rows[i] = row; else rows.push(row);   // ON CONFLICT DO UPDATE
      }
    },
  }) }) } };
}

/* currentUser reads the session from D1; these tests are about the state
   machinery, so the user is stubbed at the module boundary the same way the
   games suite stubs its env — by driving the handlers with a request the auth
   helper accepts. Simplest honest route: monkey-patch is not possible on an
   ESM import, so the handlers are exercised through a fake session row the
   stub serves. currentUser queries `sessions`; teach the stub to answer it. */
function envWithUser(rows) {
  const base = stubEnv(rows);
  const inner = base.DB.prepare;
  base.DB.prepare = (sql) => {
    if (/FROM sessions/.test(sql)) {
      return { bind: () => ({ first: async () => ({
        id: "u1", user_id: "u1", display_name: "T", expires_at: "9999-01-01",
      }) }) };
    }
    if (/FROM users/.test(sql)) {
      return { bind: () => ({ first: async () => ({ id: "u1", display_name: "T" }) }) };
    }
    return inner(sql);
  };
  return base;
}

const req = (method, urlTail, body) => new Request("https://x.test" + urlTail, {
  method,
  headers: {
    "X-XI-Games": "1",
    "Cookie": "cxi_session=abc",
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const rows = [];
const env = envWithUser(rows);

console.log("The endpoint, executed");
{
  const r = await onRequestPost({ request: req("POST", "/api/account/state",
    { game: "crossword", key: "daily:3", state: { letters: { "1,1": "A" }, elapsed: 40 } }), env });
  const j = await r.json();
  t("a save is accepted and server-stamped", r.status === 200 && !!j.updatedAt, j.updatedAt);
  t("and stored under the one key scheme",
    rows.length === 1 && rows[0].entry_key === "daily:3" && rows[0].game === "crossword");
}
{
  const first = rows[0].updated_at;
  await new Promise((res) => setTimeout(res, 5));
  await onRequestPost({ request: req("POST", "/api/account/state",
    { game: "crossword", key: "daily:3", state: { letters: { "1,1": "A", "1,2": "B" }, elapsed: 55 } }), env });
  t("a second save UPDATES the row rather than adding one",
    rows.length === 1 && JSON.parse(rows[0].state).elapsed === 55);
  t("and the server's stamp moved", rows[0].updated_at > first,
    "newest-wins has something to compare");
}
{
  const r = await onRequestGet({ request: req("GET",
    "/api/account/state?game=crossword&key=daily:3"), env });
  const j = await r.json();
  t("the journey comes back verbatim",
    r.status === 200 && JSON.parse(j.state).elapsed === 55 && !!j.updatedAt);
  const r2 = await onRequestGet({ request: req("GET",
    "/api/account/state?game=crossword&key=daily:999"), env });
  const j2 = await r2.json();
  t("no journey is a normal answer, not an error",
    r2.status === 200 && j2.state === null);
}
{
  const r = await onRequestPost({ request: req("POST", "/api/account/state",
    { game: "crossword", key: "daily:3", state: null }), env });
  const j = await r.json();
  t("state: null clears the row — the journey ends when the result banks",
    j.cleared === true && rows.length === 0);
}

console.log("\nWhat the endpoint refuses");
{
  const cases = [
    ["an unknown game", { game: "scrabble", key: "sc:1", state: {} }],
    ["a key in another game's format", { game: "crossword", key: "ws:2026-08-28", state: {} }],
    ["a malformed key", { game: "crossword", key: "daily:DROP TABLE", state: {} }],
    ["state that is not JSON", { game: "crossword", key: "daily:3", state: "{oops" }],
    ["state that is not an object", { game: "crossword", key: "daily:3", state: [1, 2] }],
  ];
  for (const [name, body] of cases) {
    const r = await onRequestPost({ request: req("POST", "/api/account/state", body), env });
    t(name + " is refused", r.status === 400, "HTTP " + r.status);
  }
  const big = await onRequestPost({ request: req("POST", "/api/account/state",
    { game: "crossword", key: "daily:3", state: { pad: "x".repeat(70 * 1024) } }), env });
  t("an oversized snapshot is refused", big.status === 400,
    "64KB cap; a save is ~2KB");
  t("and nothing refused ever reached the table", rows.length === 0);
  const noCsrf = await onRequestPost({ request: new Request("https://x.test/api/account/state",
    { method: "POST", headers: { "Cookie": "cxi_session=abc" }, body: "{}" }), env });
  t("a post without the family header is refused", noCsrf.status === 403);
}

console.log("\nThe clients play by the convergence rules");
const cw = fs.readFileSync("football/crossword/js/game.js", "utf8");
const ws = fs.readFileSync("football/wordsearch/js/game.js", "utf8");
for (const [name, js] of [["crossword", cw], ["wordsearch", ws]]) {
  /* Newest wins BY THE SERVER'S CLOCK: the comparison must be between two
     server-issued stamps, so Date.now() must appear nowhere in it. Device
     clocks meeting across a sync is the midnight bug wearing a new shirt. */
  t(`${name}: adoption compares server stamps only`, (() => {
    const m = js.match(/function pullState[\s\S]{0,700}?\n  \}/);
    return !!m && /updatedAt[^\n]*stateSyncedAt/.test(m[0]) && !/Date\.now/.test(m[0]);
  })());
  t(`${name}: the push is debounced and flushed, not per-keystroke`,
    /statePushT = setTimeout\(pushStateNow, 2500\)/.test(js));
  t(`${name}: a failed sync logs and never degrades the game`,
    /accountNote\("state push"/.test(js) && /accountNote\("state pull"/.test(js));
  t(`${name}: finishing clears the remote journey`,
    /clearRemoteState\(/.test(js));
  t(`${name}: the snapshot is the game's own save, verbatim — no second format`,
    js.indexOf("localStorage.getItem(" +
      (name === "crossword" ? 'slotKey("daily")' : "dailyStorageKey()")) > -1);
}
/* THE TRIGGER RULES — added after the owner's live test failed. The push was
   first armed from the once-per-second tick, whose own comment records that a
   debounce re-armed every second never fires; letters on the PC, blank iPad.
   The rules: pushes are CHANGE-driven (typing, found words, fouls), never
   clock-driven; a max-wait bounds continuous play; hidden AND pagehide flush. */
t("the crossword's tick does not arm the push", (() => {
  const tick = cw.match(/if \(elapsed % 5 === 0\)[^\n]*\n/);
  return !!tick && tick[0].indexOf("pushStateSoon") === -1;
})(), "a debounce the clock re-arms every second never fires");
t("the crossword's push is armed by the change path (saveSoon)",
  /function saveSoon\(\) \{[\s\S]{0,700}?pushStateSoon\(\);[\s\S]{0,100}?\}/.test(cw));
t("the word search's push is armed by found words and fouls, not the save the clock calls", (() => {
  const save = ws.match(/function saveDailyProgress\(\) \{[\s\S]{0,500}?\n  \}/);
  return !!save && save[0].indexOf("pushStateSoon") === -1 &&
    (ws.match(/pushStateSoon\(\);/g) || []).length >= 2;
})());
for (const [name, js] of [["crossword", cw], ["wordsearch", ws]]) {
  t(`${name}: continuous play cannot postpone the push forever`,
    /statePushArmedAt > 8000/.test(js) || /- statePushArmedAt > 8000/.test(js),
    "max-wait 8s");
  t(`${name}: pagehide flushes as well as visibilitychange`,
    /pagehide[\s\S]{0,200}?pushStateNow\(\)/.test(js));
}
t("the crossword flushes the pending push when the tab hides",
  /if \(document\.hidden\) pushStateNow\(\);/.test(cw));
t("the crossword adoption keeps the letters-or-time floor",
  /Object\.keys\(snap\.letters \|\| \{\}\)\.length \|\| snap\.elapsed/.test(cw),
  "a snapshot holding neither never replaces one holding either");
t("the wordsearch adoption is guarded against re-entry",
  /stateAdopted = true;/.test(ws));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
