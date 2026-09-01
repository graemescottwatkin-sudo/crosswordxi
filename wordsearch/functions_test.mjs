/* functions_test.mjs — the API contract, run against the real Functions with
 * a stub D1 that reproduces the production schema. The release guard is the
 * part worth proving: without it, /puzzle would hand out any daily in the
 * two-year schedule to anyone holding an id.
 */
import { onRequestGet as daily } from "../functions/api/wordsearch/daily.js";
import { onRequestGet as puzzleFn } from "../functions/api/wordsearch/puzzle.js";
import { onRequestGet as catalogFn } from "../functions/api/wordsearch/catalog.js";
import { onRequestGet as archiveFn } from "../functions/api/wordsearch/archive.js";
import { utcDayKey } from "../functions/_lib/wsdata.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* ---- a stub D1: three boards, one released yesterday, one today, one
   tomorrow. Insert order matches production (schedule after puzzles). ---- */
const board = (id, theme) => ({
  id, theme, category: "Test XI", status: "ready", hash: "h" + id, version: 2,
  share_key: id + "-v2", payload: JSON.stringify({
    grid: Array.from({ length: 14 }, () => "ABCDEFGHIJKL"),
    answers: Array.from({ length: 11 }, (_, i) => ({
      display: "Name" + i, grid: "NAME" + i,
      placement: { direction: "E", start_row: i, start_col: 0, end_row: i, end_col: 4 },
    })),
    bonus: { display: "Secret", grid: "SECRET",
      placement: { direction: "E", start_row: 12, start_col: 0, end_row: 12, end_col: 5 } },
  }),
});
const today = utcDayKey();
const shift = (days) => new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const PUZZ = { "XIWS-0001": board("XIWS-0001", "Yesterday"), "XIWS-0002": board("XIWS-0002", "Today"), "XIWS-0003": board("XIWS-0003", "Tomorrow") };
const SCHED = { [shift(-1)]: "XIWS-0001", [today]: "XIWS-0002", [shift(1)]: "XIWS-0003" };

const env = { DB: { prepare: (sql) => ({ bind: (...args) => ({
  first: async () => {
    if (/FROM ws_schedule s JOIN/.test(sql)) {
      const id = SCHED[args[0]]; return id ? PUZZ[id] : null;
    }
    if (/MIN\(day\)/.test(sql)) {
      const days = Object.entries(SCHED).filter(([, id]) => id === args[0]).map(([d]) => d).sort();
      return { d: days[0] || null };
    }
    if (/FROM ws_puzzles WHERE id/.test(sql)) return PUZZ[args[0]] || null;
    return null;
  },
  all: async () => {
    if (/SELECT p\.id, p\.theme/.test(sql)) {
      const results = Object.values(PUZZ).filter((p) => {
        const first = Object.entries(SCHED).filter(([, id]) => id === p.id).map(([d]) => d).sort()[0];
        return !first || first <= args[0];
      }).map((p) => ({ id: p.id, theme: p.theme, category: p.category, status: p.status }));
      return { results };
    }
    /* The archive: days strictly before the bound day, newest first, with
       the board that stood each day. The stub applies the rule itself so a
       route that asked for everything would still be caught by the check
       on what came back, not by luck. */
    if (/SELECT s\.day AS day, p\.id AS id/.test(sql)) {
      /* The stub reads the operator off the SQL rather than assuming it: a
         route that asked "<= today" would otherwise be filtered by the stub
         to the right answer, and the check would pass a query that lists
         today. Watched failing with the operator loosened. */
      const strict = /s\.day < \?/.test(sql);
      const results = Object.entries(SCHED)
        .filter(([day]) => (strict ? day < args[0] : day <= args[0]))
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([day, id]) => ({ day, id, theme: PUZZ[id].theme, category: PUZZ[id].category }));
      return { results };
    }
    return { results: [] };
  },
}) }) } };

const req = (url) => ({ request: new Request(url), env });
const jsonOf = async (r) => ({ status: r.status, body: await r.json(), headers: r.headers });

/* ---- daily ------------------------------------------------------------ */
{
  const r = await jsonOf(await daily(req("https://x/api/wordsearch/daily")));
  t("daily returns today's board with the server's day", r.status === 200 && r.body.day === today && r.body.puzzle?.id === "XIWS-0002");
  t("daily board is whole — grid, 11 answers, bonus",
    r.body.puzzle.grid.length === 14 && r.body.puzzle.answers.length === 11 && !!r.body.puzzle.bonus);
  t("daily is no-store", r.headers.get("Cache-Control") === "no-store");
}
{
  /* No schedule row: puzzle null, status 200 — the schedule running out must
     degrade to Free Play, not to an error page. */
  const bare = { DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) } };
  const r = await jsonOf(await daily({ request: new Request("https://x/"), env: bare }));
  t("a day with no schedule row is { puzzle: null }, 200", r.status === 200 && r.body.puzzle === null);
}

/* ---- the release guard ------------------------------------------------ */
{
  const y = await jsonOf(await puzzleFn(req("https://x/api/wordsearch/puzzle?id=XIWS-0001")));
  t("yesterday's board is released", y.status === 200 && y.body.puzzle.id === "XIWS-0001");
  const td = await jsonOf(await puzzleFn(req("https://x/api/wordsearch/puzzle?id=XIWS-0002")));
  t("today's board is released", td.status === 200);
  const tm = await puzzleFn(req("https://x/api/wordsearch/puzzle?id=XIWS-0003"));
  const tmB = await jsonOf(tm);
  t("tomorrow's board is refused", tmB.status === 404);
  const refusal = JSON.stringify(tmB.body);
  t("the refusal names nothing of the board",
    !refusal.includes("Tomorrow") && !refusal.includes("NAME") && !refusal.includes("SECRET"));
  const unknown = await jsonOf(await puzzleFn(req("https://x/api/wordsearch/puzzle?id=XIWS-9999")));
  t("unknown id and unreleased id are the same answer", unknown.status === 404 &&
    JSON.stringify(unknown.body) === refusal);
  const malformed = await jsonOf(await puzzleFn(req("https://x/api/wordsearch/puzzle?id=DROP TABLE")));
  t("a malformed id is refused before any query", malformed.status === 404);
}

/* ---- catalog ---------------------------------------------------------- */
{
  const r = await jsonOf(await catalogFn(req("https://x/api/wordsearch/catalog")));
  const ids = r.body.boards.map((b) => b.id);
  t("catalog lists released boards only", ids.includes("XIWS-0001") && ids.includes("XIWS-0002") && !ids.includes("XIWS-0003"), ids.join(","));
  t("catalog rows carry no grids and no answers",
    r.body.boards.every((b) => !b.grid && !b.answers && !b.payload));
}

/* ---- archive: the days already played, and nothing after them --------- */
{
  const r = await jsonOf(await archiveFn(req("https://x/api/wordsearch/archive")));
  const days = r.body.days.map((d) => d.day);
  t("archive answers with the server's day and the days before it",
    r.status === 200 && r.body.today === today && days.length === 1 && days[0] === shift(-1),
    days.join(","));
  t("it stops at yesterday: today is the hero and tomorrow is the secret",
    !days.includes(today) && !days.includes(shift(1)));
  t("each day names its board and theme, and no more",
    r.body.days.every((d) => d.id === "XIWS-0001" && d.theme === "Yesterday" &&
      !d.grid && !d.answers && !d.bonus && !d.payload));
  t("archive is no-store, because midnight moves it", r.headers.get("Cache-Control") === "no-store");
  const s = await jsonOf(await archiveFn({ request: new Request("https://x/"), env: {} }));
  t("without a database the sample path lists yesterday only",
    s.status === 200 && s.body.days.length === 1 && s.body.days[0].day === shift(-1) && !!s.body.days[0].theme);
}

/* ---- the sample path (no DB bound) ------------------------------------ */
{
  const r = await jsonOf(await daily({ request: new Request("https://x/"), env: {} }));
  t("no DB bound falls back to the sample dataset", r.status === 200 && r.body.source === "sample" && !!r.body.puzzle);
  const cat = await jsonOf(await catalogFn({ request: new Request("https://x/"), env: {} }));
  t("sample catalog exists and excludes at least one unreleased board", cat.body.boards.length >= 1 && cat.body.boards.length < 3,
    cat.body.boards.length + " of 3 released");
  const unreleasedId = ["XIWS-0001", "XIWS-0057", "XIWS-0239"].find((id) => !cat.body.boards.some((b) => b.id === id));
  const ref = await jsonOf(await puzzleFn({ request: new Request("https://x/api/wordsearch/puzzle?id=" + unreleasedId), env: {} }));
  t("the sample release guard refuses the future sample board", ref.status === 404, unreleasedId);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
