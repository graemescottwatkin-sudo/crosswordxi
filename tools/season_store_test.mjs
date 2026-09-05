/* season_store_test.mjs — the season's rows, and the endpoint that reads them.
 *
 * season_test.mjs proves the RULE with no database in sight. This proves the
 * half that touches one: what a start and a finish write, what is written for
 * a player with no account (nothing), and what the endpoint answers in each of
 * its branches.
 *
 * THE CHECK THAT MATTERS MOST is that a signed-out player leaves no trace.
 * Their season is their device's, and the server is not supposed to learn they
 * played at all.
 *
 *   node tools/season_store_test.mjs        (from the repo root)
 */
import { noteStart, noteFinish, daysFor } from "../functions/_lib/season-store.js";
import { onRequestGet as seasonGet } from "../functions/api/season.js";
import { onRequestPost as playPost } from "../functions/api/play.js";
import { season } from "../functions/_lib/season.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A database of one table, following the statement it is given. The conflict
   rules are read out of the SQL rather than modelled here: a fake that is
   right while the code is wrong is worse than no fake. */
function memDB(user) {
  const rows = new Map();
  return {
    _rows: rows,
    prepare(sql) {
      return { bind: (...a) => ({
        first: async () => (/FROM sessions/.test(sql) ? user : null),
        all: async () => {
          if (!/FROM season_play/.test(sql)) return { results: [] };
          const mine = [...rows.values()].filter((r) => r.user_id === a[0]);
          const byDay = new Map();
          for (const r of mine) {
            const d = byDay.get(r.day) || { day: r.day, started: 0, finished: 0 };
            d.started++; if (r.finished_at) d.finished++;
            byDay.set(r.day, d);
          }
          return { results: [...byDay.values()].sort((x, y) => (x.day < y.day ? 1 : -1)) };
        },
        run: async () => {
          if (!/INTO season_play/.test(sql)) return {};
          const k = a[0] + "|" + a[1] + "|" + a[2];
          const finishing = /finished_at/.test(sql);
          const cur = rows.get(k);
          if (!cur) {
            rows.set(k, { user_id: a[0], day: a[1], game: a[2],
              started_at: "now", finished_at: finishing ? "now" : null });
          } else if (finishing && /DO UPDATE/i.test(sql)) {
            /* COALESCE: the first finish stands. */
            cur.finished_at = cur.finished_at || "now";
          }
          return {};
        },
      }) };
    },
  };
}

const USER = { id: "u-season-1", is_admin: 0 };

console.log("A start and a finish, written down");
{
  const env = { DB: memDB(USER) };
  await noteStart(env, USER, "crossword");
  await noteStart(env, USER, "wordsearch");
  await noteFinish(env, USER, "crossword");
  const rows = [...env.DB._rows.values()];
  t("one row per game per day", rows.length === 2, rows.length + " rows");
  t("the finished one is marked, the other is not",
    rows.filter((r) => r.finished_at).length === 1);
  const days = await daysFor(env, USER);
  t("and the day reads as two started, one finished",
    days.length === 1 && days[0].started === 2 && days[0].finished === 1,
    JSON.stringify(days[0]));
  /* WHICH IS A DRAW, and that is the clause that is easy to get wrong. */
  t("so the day is a draw, not a loss",
    season(days, "2099-01-01").drawn === 1, "one finished, one abandoned");
}

console.log("\nStarting twice is starting once");
{
  const env = { DB: memDB(USER) };
  for (let i = 0; i < 5; i++) await noteStart(env, USER, "hilo");
  t("a reload, a double tap and a resumed round are one start",
    [...env.DB._rows.values()].length === 1);
  await noteFinish(env, USER, "hilo");
  await noteFinish(env, USER, "hilo");
  const rows = [...env.DB._rows.values()];
  t("and finishing twice is one finish", rows.length === 1 && rows[0].finished_at === "now");
}

console.log("\nA finish with no start is still a finish");
{
  /* Somebody who signed in mid-puzzle, or whose start never reached the
     server. A day with a finish in it is not a loss. */
  const env = { DB: memDB(USER) };
  await noteFinish(env, USER, "scrambled");
  const days = await daysFor(env, USER);
  t("it records both, so the day counts as played",
    days.length === 1 && days[0].started === 1 && days[0].finished === 1,
    JSON.stringify(days[0]));
}

console.log("\nA player with no account leaves no trace");
{
  const env = { DB: memDB(null) };
  t("no start is recorded", (await noteStart(env, null, "crossword")) === false);
  t("no finish is recorded", (await noteFinish(env, null, "crossword")) === false);
  t("and nothing at all is written",
    [...env.DB._rows.values()].length === 0,
    "their season is their device's; the server does not learn they played");
  t("nor for a game nobody has heard of",
    (await noteStart(env, USER, "solitaire")) === false);
}

console.log("\nThe play endpoint records it, and only when signed in");
{
  const post = (env, body) => playPost({
    request: new Request("https://x/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XI-Games": "1", Cookie: "cxi_session=s1" },
      body: JSON.stringify(body),
    }), env,
  });
  /* A play id is required by the endpoint — the first version of this check
     omitted it and failed on "No play id." before reaching any season code at
     all, which looked exactly like the season write being broken. */
  const START = { event: "start", playId: "pl-season-0001", game: "hilo",
    boardKey: "hl:2026-09-05", mode: "daily", total: 11 };
  const env = { DB: memDB(USER) };
  const started = await post(env, START);
  t("a start answers, and writes a season row",
    started.status === 200 && [...env.DB._rows.values()].length === 1,
    started.status + ", " + [...env.DB._rows.values()].length + " season rows");

  const out = { DB: memDB(null) };
  const outRes = await post(out, START);
  t("and a signed-out start writes none",
    outRes.status === 200 && [...out.DB._rows.values()].length === 0,
    outRes.status + ", " + [...out.DB._rows.values()].length + " season rows");

  /* AND AN UNFINISHED END WRITES NO FINISH, which is the loss condition:
     the season reads the ABSENCE of finished_at, so there is nothing to
     write for a board somebody walked away from. */
  const ended = await post(env, { event: "end", playId: "pl-season-0001",
    game: "hilo", completed: false, solved: 3, elapsed: 90 });
  const row = [...env.DB._rows.values()][0];
  t("an attempt that ends unfinished leaves no finish",
    ended.status === 200 && !!row && row.finished_at === null,
    "the absence IS the loss");
  await post(env, { event: "end", playId: "pl-season-0001", game: "hilo",
    completed: true, solved: 11, elapsed: 120 });
  t("and one that ends finished marks it",
    [...env.DB._rows.values()][0].finished_at === "now");
}

console.log("\nWhat the endpoint answers");
{
  const ask = (env) => seasonGet({
    request: new Request("https://x/api/season", { headers: { Cookie: "cxi_session=s1" } }), env,
  });
  const env = { DB: memDB(USER) };
  await noteFinish(env, USER, "crossword");
  await noteFinish(env, USER, "wordsearch");
  const r = await (await ask(env)).json();
  t("a signed-in player gets a season", r.account === true && !!r.season);
  t("and today is in flight rather than counted",
    r.season.played === 0 && !!r.inFlight && r.inFlight.provisional === "W",
    JSON.stringify(r.inFlight));
  t("so there is no invitation — they have started one",
    r.message === null, "the invitation is for a player with no PLAY");

  const fresh = { DB: memDB(USER) };
  const empty = await (await ask(fresh)).json();
  t("a signed-in player with nothing played is invited to start",
    empty.account === true && /first game/i.test(empty.message || ""), empty.message);

  const out = await (await ask({ DB: memDB(null) })).json();
  t("a signed-out player is told there is no account, and invited",
    out.account === false && /first game/i.test(out.message || ""));
  const none = await (await ask({})).json();
  t("and a site with no database says it cannot answer, rather than 'no season'",
    none.account === false && none.reason === "no-store" && none.message === undefined,
    "telling a signed-in player their record was gone would be a lie");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
