/* admin_test.mjs — the owner's tools, and who can reach them.
 *
 * The panel is hidden from non-admins, but hiding a button is not access
 * control: anyone can call the endpoint directly. Every check here is about the
 * server refusing, not the browser not asking.
 */
import { onRequest as admin } from "../../functions/api/admin/[[route]].js";
import { onRequestPost as report } from "../../functions/api/report-clue.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

function makeEnv({ admin: isAdmin = 0, signedIn = true } = {}) {
  const users = [{ id: "u1", provider: "google", provider_id: "g1",
                   display_name: "Owner", is_admin: isAdmin }];
  const sessions = [{ id: "sess", user_id: "u1", expires_at: "2099-01-01T00:00:00.000Z" }];
  const reports = [];
  const puzzles = [{ mode: "daily", daily_no: 29,
    payload: JSON.stringify({ puzzle: { width: 5, height: 5, cells: {}, stats: {},
      entries: [{ num: 1, dir: "A", x: 0, y: 0, len: 3, cells: [],
                  row: { id: "c1", clue: "x", enum: "(3)", grid: "ABC" } }] } }) }];
  return { _reports: reports, DB: { prepare(sql) {
    let b = [];
    const api = {
      bind(...a) { b = a; return api; },
      async first() {
        if (sql.includes("FROM sessions s JOIN users u")) {
          return signedIn ? users[0] : null;
        }
        if (sql.includes("FROM puzzles WHERE mode = 'daily'")) {
          return puzzles.find((p) => p.daily_no === b[0]) || null;
        }
        /* Migration 024 added `game`, so the dedupe is per game and the INSERT
           carries one more column. Matched by NAME rather than bind position:
           a positional stub silently reads the next value into the wrong field
           the day a column is added, and then agrees with whatever the code
           does. */
        if (sql.includes("FROM clue_reports WHERE")) {
          const cols = [...sql.matchAll(/([a-z_]+)\s*=\s*\?/g)].map((m) => m[1]);
          if (!cols.length) throw new Error("stub could not read the WHERE clause");
          return reports.find((r) => cols.every((c, i) => String(r[c]) === String(b[i]))) || null;
        }
        if (sql.includes("COUNT(*)")) return { n: 7 };
        return null;
      },
      async all() { return { results: reports }; },
      async run() {
        if (sql.includes("INSERT INTO clue_reports")) {
          reports.push({ id: b[0], game: b[1], clue_id: b[2], reported_by: b[3], reason: b[4], puzzle: b[5] });
        } else if (sql.includes("UPDATE clue_reports SET reason")) {
          const r = reports.find((x) => x.id === b[1]);
          if (r) r.reason = b[0];
        }
        return { success: true };
      },
    };
    return api;
  } } };
}

const req = (path, { method = "GET", body, csrf = true, cookie = "cxi_session=sess" } = {}) =>
  new Request("https://x/api/admin/" + path, {
    method,
    headers: Object.assign(csrf ? { "X-Crossword-XI": "1" } : {}, cookie ? { Cookie: cookie } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });

const call = (path, opts = {}, env) =>
  admin({ request: req(path, opts), env, params: { route: path.split("?")[0].split("/") } });

console.log("Who can reach the tools");
{
  const guest = makeEnv({ signedIn: false });
  t("a signed-out visitor is refused", (await call("summary", {}, guest)).status === 401);
}
{
  const player = makeEnv({ admin: 0 });
  const r = await call("summary", {}, player);
  t("a signed-in player is refused", r.status === 404, "status " + r.status);
  t("and told nothing about what exists", (await r.json()).error === "Not found.",
    "a 403 would confirm the route is there");
}
{
  const owner = makeEnv({ admin: 1 });
  const r = await call("summary", {}, owner);
  t("the owner gets through", r.status === 200);
  const j = await r.json();
  t("and sees the counts", typeof j.users === "number" && typeof j.today === "number",
    `today #${j.today}`);
}

console.log("\nThe flag cannot be self-granted");
{
  const player = makeEnv({ admin: 0 });
  const j = await (await call("whoami", {}, player)).json();
  t("whoami answers everyone, and says no", j.admin === false);
  const owner = makeEnv({ admin: 1 });
  t("and yes for the owner", (await (await call("whoami", {}, owner)).json()).admin === true);
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(path.join(DIR, "../../functions/api/admin/[[route]].js"), "utf8"));
  t("no route anywhere writes the admin flag",
    !/UPDATE users SET[^"]*is_admin/i.test(src) && !/is_admin\s*=\s*1/.test(src));
}

console.log("\nPreviewing another day");
{
  const owner = makeEnv({ admin: 1 });
  const r = await call("daily?n=29", {}, owner);
  const j = await r.json();
  t("the owner can open a future day", r.status === 200 && j.dailyNo === 29,
    "day " + j.dailyNo);
  t("and it comes back stripped of answers",
    !JSON.stringify(j).includes('"ch"') && !JSON.stringify(j).includes('"grid"'));
  const player = makeEnv({ admin: 0 });
  t("a player cannot", (await call("daily?n=29", {}, player)).status === 404);
  t("a day with no stored puzzle says so",
    (await call("daily?n=999", {}, owner)).status === 404);
}

console.log("\nFlagging a clue");
{
  const env = makeEnv({ admin: 0 });
  const post = (body, csrf = true) => report({ request: new Request("https://x/api/report-clue", {
    method: "POST", body: JSON.stringify(body),
    headers: Object.assign(csrf ? { "X-Crossword-XI": "1" } : {}, { Cookie: "cxi_session=sess" }),
  }), env });
  t("any signed-in player can flag a clue", (await post({ clueId: "c1" })).status === 200,
    "not admin-only: whoever spots it is whoever is looking");
  const again = await (await post({ clueId: "c1" })).json();
  t("flagging the same clue twice is not two reports", again.already === true);
  /* But a second look with a clearer idea of what is wrong should not be
     thrown away — that is what a second look is for. */
  const better = await (await post({ clueId: "c1", reason: "Two answers fit" })).json();
  t("a repeat report with a better reason replaces the first",
    better.already === true && better.updated === true);
  t("it still needs the anti-CSRF header", (await post({ clueId: "c2" }, false)).status === 403);
  const out = makeEnv({ admin: 0, signedIn: false });
  t("a signed-out visitor cannot flag", (await report({
    request: new Request("https://x/api/report-clue", { method: "POST",
      body: JSON.stringify({ clueId: "c1" }), headers: { "X-Crossword-XI": "1" } }),
    env: out }).then((r) => r.status)) === 401);
}

console.log("\nExporting and closing reports");
{
  const owner = makeEnv({ admin: 1 });
  /* Seed two reports through the public endpoint, so the export is tested
     against data the game actually writes. */
  const post = (body) => report({ request: new Request("https://x/api/report-clue", {
    method: "POST", body: JSON.stringify(body),
    headers: { "X-Crossword-XI": "1", Cookie: "cxi_session=sess" },
  }), env: owner });
  await post({ clueId: "V30463", reason: 'Two answers fit, and it says "Queens"' });

  const r = await call("reports.csv", {}, owner);
  t("the export comes back as a downloadable file",
    r.headers.get("Content-Type").indexOf("text/csv") === 0 &&
    /attachment; filename="crosswordxi-flagged-\d{4}-\d{2}-\d{2}\.csv"/.test(
      r.headers.get("Content-Disposition")),
    r.headers.get("Content-Disposition"));

  const csv = await r.text();
  const lines = csv.split("\r\n");
  t("with a header row and one row per report", lines.length === 2, `${lines.length} lines`);
  t("every field is quoted, since clue text is full of commas",
    lines[1].startsWith('"') && lines[1].endsWith('"'));
  t("and a quote inside a reason does not break the row", (() => {
    /* 'says "Queens"' must survive as doubled quotes, or the file falls apart
       at exactly the row you most wanted to read. */
    return lines[1].includes('""Queens""');
  })(), lines[1].slice(-46));

  t("a player cannot download it", (await call("reports.csv", {}, makeEnv({ admin: 0 }))).status === 404);

  const closed = await (await call("reports/reviewed", { method: "POST", body: {} }, owner)).json();
  t("marking everything reviewed reports how many it closed", closed.ok === true);
  t("a player cannot close reports",
    (await call("reports/reviewed", { method: "POST", body: {} }, makeEnv({ admin: 0 }))).status === 404);
  t("closing still needs the anti-CSRF header",
    (await call("reports/reviewed", { method: "POST", body: {}, csrf: false }, owner)).status === 403);
}

console.log("\nReplaying a day");
{
  const owner = makeEnv({ admin: 1 });
  const r = await (await call("replay-day", { method: "POST", body: { dailyNo: 2 } }, owner)).json();
  t("the owner can forget one day", r.ok === true && r.dailyNo === 2);
  t("a day number is required",
    (await call("replay-day", { method: "POST", body: {} }, owner)).status === 400);
  t("a player cannot",
    (await call("replay-day", { method: "POST", body: { dailyNo: 2 } },
      makeEnv({ admin: 0 }))).status === 404);
  /* Replay and clear-my-record must stay distinct: one forgets a day so it can
     be played again, the other wipes the history and leaves the game alone. */
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(path.join(DIR, "../../functions/api/admin/[[route]].js"), "utf8"));
  /* Qualified by game since 020. This route takes a DAY NUMBER, which is a
     crossword idea; unqualified it would reach any row whose daily_no matched. */
  t("replay only ever touches one day, and only the crossword's",
    /DELETE FROM results WHERE user_id = \? AND game = 'crossword' AND daily_no = \?/.test(src));
  t("and clearing the record never touches the saved game",
    /DELETE FROM results WHERE user_id = \?"/.test(src));
}

/* EVERY GAME, ONE FUNNEL. The three attempt reports take ?game=, refuse a
   name the server does not list, and the CSV carries the game and the
   board's key on every row whichever way it is asked for. */
console.log("\nThe attempt reports cover every game");
{
  const owner = makeEnv({ admin: 1 });
  t("a game the server does not list is refused, not reported as empty",
    (await call("plays?game=tiddlywinks", {}, owner)).status === 400 &&
    (await call("sources?game=tiddlywinks", {}, owner)).status === 400 &&
    (await call("plays.csv?game=tiddlywinks", {}, owner)).status === 400);
  t("one game or the family both answer",
    (await call("plays?game=wordsearch", {}, owner)).status === 200 &&
    (await call("plays", {}, owner)).status === 200 &&
    (await call("sources?game=scrambled", {}, owner)).status === 200);
  const all = await call("plays.csv", {}, owner);
  const head = (await all.text()).split(/\r?\n/)[0];
  t("the CSV names the game and the board's key on every row",
    all.status === 200 && /"Started","Ended","Game","Board key","Mode"/.test(head), head);
  t("and the file is the site's, one game or all",
    /filename="thexigames-plays-\d{4}-\d{2}-\d{2}\.csv"/.test(all.headers.get("Content-Disposition") || "") &&
    /filename="thexigames-plays-scrambled-\d{4}-\d{2}-\d{2}\.csv"/.test(
      (await call("plays.csv?game=scrambled", {}, owner)).headers.get("Content-Disposition") || ""));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
