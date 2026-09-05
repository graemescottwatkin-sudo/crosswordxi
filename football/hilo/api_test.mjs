/* hilo/api_test.mjs — the API, executed against a stub D1 shaped like the
 * production schema, and against the sample with no database bound.
 *
 * The release guard is the part worth proving: without it, /board would hand
 * out any board in the calendar to anyone holding an id, and /call would
 * judge against tomorrow's board.
 */
import { onRequestGet as daily, onRequestHead as dailyHead } from "../../functions/api/hilo/daily.js";
import { onRequestGet as board } from "../../functions/api/hilo/board.js";
import { onRequestPost as call } from "../../functions/api/hilo/call.js";
import { onRequestGet as catalog } from "../../functions/api/hilo/catalog.js";
import { onRequestGet as archive } from "../../functions/api/hilo/archive.js";
import { HL_SAMPLE_BOARDS } from "../../functions/_lib/hl-sample.js";
import { todayKey } from "../../functions/_lib/hl-board.js";
import { isClub } from "../../tools/import_hilo.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A stub bank: yesterday's, today's and tomorrow's daily, one club board.
   The rows are real sample boards re-labelled, so the judge has real values
   to judge, and TOMORROW is the one the routes must never serve. */
const today = todayKey();
const shift = (n) => new Date(Date.parse(today + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dailyBoards = HL_SAMPLE_BOARDS.filter((b) => !isClub(b));
const clubBoard = HL_SAMPLE_BOARDS.find((b) => isClub(b));
const Y = { ...dailyBoards[0], id: "Y1", category: "Yesterday's category" };
const T = { ...dailyBoards[1] || dailyBoards[0], id: "T1", category: "Today's category" };
const TOMORROW = { ...dailyBoards[0], id: "Z1", category: "Tomorrow's Secret Category" };
const C = { ...clubBoard, id: "C1" };
const rows = [Y, T, TOMORROW, C].map((b) => ({ payload: JSON.stringify(b) }));
const sched = [{ day: shift(-1), board_id: "Y1" }, { day: today, board_id: "T1" }, { day: shift(1), board_id: "Z1" }];
const env = { DB: { prepare: (sql) => ({
  bind: () => ({ all: async () => ({ results: sql.includes("FROM hl_board") ? rows : sched }) }),
  all: async () => ({ results: sql.includes("FROM hl_board") ? rows : sched }),
}) } };
const req = (url, init) => ({ request: new Request(url, init), env });
const json = async (r) => ({ status: r.status, body: await r.json(), headers: r.headers });
const post = (body, hdr) => call(req("https://x/api/hilo/call", {
  method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, hdr || { "X-XI-Games": "1" }),
  body: JSON.stringify(body),
}));

console.log("=== The daily ===");
{
  const r = await json(await daily(req("https://x/api/hilo/daily")));
  t("today's board, from D1, on the server's day", r.status === 200 && r.body.day === today && r.body.board.id === "T1" && r.body.source === "d1");
  t("twelve rows, the first value only, no source", r.body.board.rows.length === 12 &&
    (JSON.stringify(r.body).match(/"value"/g) || []).length === 1 && !/quote|publisher/.test(JSON.stringify(r.body)));
  t("a hidden row is its name and nothing else", r.body.board.rows.slice(1).every((x) => Object.keys(x).join() === "name"));
  t("the token names the day", r.body.board.token === "hl:" + today);
  const y = await json(await daily(req("https://x/api/hilo/daily?day=" + shift(-1))));
  t("yesterday's board is open, as free play", y.status === 200 && y.body.board.id === "Y1");
  const z = await daily(req("https://x/api/hilo/daily?day=" + shift(1)));
  t("tomorrow's is refused", z.status === 403);
  t("and the refusal names nothing of it", !(await z.text()).includes("Secret"));
  t("a day that is not a day is refused", (await daily(req("https://x/api/hilo/daily?day=soon"))).status === 400);
  const h = await dailyHead(req("https://x/api/hilo/daily", { method: "HEAD" }));
  t("HEAD answers like GET, with no body", h.status === 200 && (await h.text()) === "");
}

console.log("\n=== A board by id ===");
{
  const c = await json(await board(req("https://x/api/hilo/board?id=C1")));
  t("a club board is served whenever it is asked for", c.status === 200 && c.body.board.club !== null && c.body.board.token === "hlb:C1");
  const y = await json(await board(req("https://x/api/hilo/board?id=Y1")));
  t("a past daily is served by id", y.status === 200);
  const z = await board(req("https://x/api/hilo/board?id=Z1"));
  const zBody = await z.text();
  const u = await board(req("https://x/api/hilo/board?id=NOPE"));
  t("tomorrow's daily and an unknown id get the same refusal", z.status === 404 && u.status === 404 && zBody === (await u.text()));
  t("and it names nothing", !zBody.includes("Secret"));
  t("a malformed id is refused", (await board(req("https://x/api/hilo/board?id=DROP%20TABLE"))).status === 404);
}

console.log("\n=== A call ===");
{
  const t1 = (await json(await daily(req("https://x/api/hilo/daily")))).body.board.token;
  const truth = T.chain[1].value > T.chain[0].value ? "higher" : "lower";
  const r = await json(await post({ token: t1, index: 1, call: truth }));
  t("a right call comes back right, with the value and the source",
    r.status === 200 && r.body.right === true && r.body.value === T.chain[1].value && !!r.body.source.quote && !!r.body.source.url);
  t("and the row's context, released with its value", r.body.context === (T.chain[1].context || ""));
  const w = await json(await post({ token: t1, index: 1, call: truth === "higher" ? "lower" : "higher" }));
  t("a wrong call comes back wrong, with the value all the same", w.body.right === false && w.body.value === T.chain[1].value);
  const n = await json(await post({ token: t1, index: 3, call: "none" }));
  t("a call that ran out is wrong and still reveals", n.body.right === false && n.body.value === T.chain[3].value);
  t("a call against tomorrow's token is refused", (await post({ token: "hl:" + shift(1), index: 1, call: "higher" })).status === 404);
  t("a call against a club board's token is judged", (await post({ token: "hlb:C1", index: 1, call: "higher" })).status === 200);
  t("call twelve is not a call", (await post({ token: t1, index: 12, call: "higher" })).status === 400);
  t("without the family's header it is refused", (await post({ token: t1, index: 1, call: "higher" }, {})).status === 403);
}

console.log("\n=== The catalogue and the archive ===");
{
  const c = await json(await catalog({ env }));
  t("the catalogue lists the club, identity only", c.body.clubs.length === 1 && c.body.clubs[0].boards[0].id === "C1" &&
    !JSON.stringify(c.body).includes("chain"));
  const a = await json(await archive({ env }));
  t("the archive is yesterday and nothing after", a.body.days.length === 1 && a.body.days[0].day === shift(-1) && a.body.today === today);
  t("and names no board of tomorrow", !JSON.stringify(a.body).includes("Secret"));
}

console.log("\n=== Without a database ===");
{
  const r = await json(await daily({ request: new Request("https://x/api/hilo/daily"), env: {} }));
  t("the sample answers, and says it is the sample", r.status === 200 && r.body.source === "sample");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
