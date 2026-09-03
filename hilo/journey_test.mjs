/* hilo/journey_test.mjs — one round, played from the landing to full time,
 * through the real page, the real engine and the real endpoint handlers.
 *
 *   npm install -D jsdom --no-save
 *   node hilo/journey_test.mjs        (from the repo root)
 *
 * No stub engine, no reimplemented judging. The page's own markup, its own
 * scripts, and the handlers Cloudflare would invoke; only the network hop is
 * routed straight into them. The suite plays every call RIGHT by reading the
 * truth from the sample bank the handlers also read — the page never sees a
 * value it has not called for, and this proves it as it goes.
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { onRequestGet as dailyGet } from "../functions/api/hilo/daily.js";
import { onRequestGet as boardGet } from "../functions/api/hilo/board.js";
import { onRequestPost as callPost } from "../functions/api/hilo/call.js";
import { onRequestGet as catalogGet } from "../functions/api/hilo/catalog.js";
import { onRequestGet as archiveGet } from "../functions/api/hilo/archive.js";
import { HL_SAMPLE_BOARDS, HL_SAMPLE_SCHEDULE } from "../functions/_lib/hl-sample.js";
import { todayKey } from "../functions/_lib/hl-board.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/* Today's board, by the same calendar the handler reads. The sample carries
   two days; if today is neither, the suite pins the first by playing it as a
   past day — the handler's own rule — rather than failing on the date. */
const today = todayKey();
const days = Object.keys(HL_SAMPLE_SCHEDULE).sort();
const playDay = HL_SAMPLE_SCHEDULE[today] ? today : days[0];
const board = HL_SAMPLE_BOARDS.find((b) => String(b.id) === HL_SAMPLE_SCHEDULE[playDay]);
if (!board) throw new Error("no sample board for " + playDay);
const truth = (i) => (board.chain[i].value > board.chain[i - 1].value ? "higher" : "lower");

const ORIGIN = "http://localhost";
const plays = [];
const ROUTES = {
  "/api/hilo/daily": (req) => dailyGet({ request: req, env: {} }),
  "/api/hilo/board": (req) => boardGet({ request: req, env: {} }),
  "/api/hilo/call": (req) => callPost({ request: req, env: {} }),
  "/api/hilo/catalog": () => catalogGet({ env: {} }),
  "/api/hilo/archive": () => archiveGet({ env: {} }),
  "/api/auth/session": () => new Response(JSON.stringify({ user: null }), { headers: { "Content-Type": "application/json" } }),
  "/api/play": async (req) => {
    let body = null; try { body = await req.json(); } catch (e) { body = { bad: true }; }
    plays.push(body);
    return new Response(JSON.stringify({ ok: true, playNo: plays.length }), { headers: { "Content-Type": "application/json" } });
  },
};
const calls = [];
async function routedFetch(input, init) {
  const url = new URL(String(input), ORIGIN);
  const handler = ROUTES[url.pathname];
  calls.push(url.pathname);
  if (!handler) throw new Error("no route for " + url.pathname);
  return handler(new Request(url.href, init));
}

const dom = new JSDOM(fs.readFileSync("hilo/index.html", "utf8"), {
  url: ORIGIN + "/hilo/", runScripts: "outside-only", pretendToBeVisual: true,
});
const { window } = dom;
const doc = window.document;
window.fetch = routedFetch;
window.Request = Request; window.Response = Response;
window.scrollTo = () => {};
for (const f of ["shared/xi-plays.js", "hilo/js/scoring.js", "hilo/js/game.js"]) window.eval(fs.readFileSync(f, "utf8"));
const $ = (id) => doc.getElementById(id);
const shown = (id) => !$(id).hidden;

await settle(20);

console.log("=== The landing ===");
t("the page asked the server for today, the clubs and the archive",
  calls.includes("/api/hilo/daily") && calls.includes("/api/hilo/catalog") && calls.includes("/api/hilo/archive"));
t("the build tag is on the page", $("buildTag").textContent === window.HILOXI_BUILD);
t("one H1, and it is the game's name", doc.querySelectorAll("h1").length === 1 && /HiLo XI/.test(doc.querySelector("h1").textContent));
t("clubs and themes is a link to its pages", $("homeThemed").tagName === "A" && $("homeThemed").getAttribute("href") === "/hilo/clubs/");
t("the board of the week is a club board", /\S/.test($("homeFeaturedName").textContent) && $("homeFeaturedName").textContent !== "—");

/* Kick off. If today is on the sample calendar the hero is today's board;
   otherwise the same board is opened as a past day through the archive door
   the page already has, which is the free-play path. */
if (playDay === today) {
  $("homeDaily").dispatchEvent(new window.Event("click"));
} else {
  window.__hilo_openDay = true;
  $("homePrevious").dispatchEvent(new window.Event("click"));
  await settle();
  const row = doc.querySelector(`.arch-row[data-day="${playDay}"]`);
  if (!row) throw new Error("the archive did not list " + playDay);
  row.dispatchEvent(new window.Event("click", { bubbles: true }));
  await settle(10);
  $("kickBtn").dispatchEvent(new window.Event("click"));
}
await settle(10);

console.log("\n=== Kick off ===");
t("the ladder is up", shown("screenGame") && !shown("screenStart"));
t("it names the category and the subtitle", $("cat").textContent.includes(board.category) && $("cat").textContent.includes(board.subtitle));
t("the first pair shows the known value on the left and a question mark on the right",
  $("left").querySelector(".val").textContent === String(board.chain[0].value) && $("right").querySelector(".val").textContent === "?");
t("the question names the subject and the reference",
  $("ask").textContent.includes(board.chain[1].name) && $("ask").textContent.includes(String(board.chain[0].value)));
t("the button faces carry the reference", $("higher").textContent.includes("than " + board.chain[0].value));
t("a play was started under this game's name", plays.length === 1 && plays[0].event === "start" && plays[0].game === "hilo" && plays[0].total === 11,
  JSON.stringify(plays[0] || null));
t("no value beyond the first is anywhere on the page",
  board.chain.slice(1).every((r) => !doc.body.textContent.includes(String(r.value))));

console.log("\n=== The calls ===");
/* Ten right calls, then one timed out: the engine's clock cannot be waited on
   in a suite, so the time-out is reached by its hook. */
for (let i = 1; i <= 10; i++) {
  $(truth(i)).dispatchEvent(new window.Event("click"));
  await settle(10);
}
t("ten right calls have settled into ten stamped rows",
  doc.querySelectorAll(".duel.settled.ok").length === 10 && doc.querySelectorAll(".duel.settled.bad").length === 0);
t("each settled row shows both values", (() => {
  const rows = doc.querySelectorAll(".duel.settled");
  return rows[0].querySelectorAll(".val")[1].textContent === String(board.chain[1].value) &&
    rows[9].querySelectorAll(".val")[1].textContent === String(board.chain[10].value);
})());
t("the answers list fills as calls settle, with the source quote",
  doc.querySelectorAll("#sheet li.ok").length === 10 && !!doc.querySelector("#sheet li.ok .src") &&
  doc.querySelector("#sheet li.ok .src").textContent.includes(board.chain[1].source.quote.slice(0, 12)));
t("the live pair has moved on to the eleventh call", $("right").querySelector(".who").textContent === board.chain[11].name);
t("the ladder shows ten filled and the eleventh current",
  doc.querySelectorAll("#ladder i.ok").length === 10 && doc.querySelectorAll("#ladder i.cur").length === 1);
t("no substitution spent", doc.querySelectorAll("#subs i.spent").length === 0);
t("ten right have banked ten each, plus the runs",
  Number($("banked").textContent) === 100 + window.HL_SCORING.runBonus(Array(10).fill(true)));

window.__hilo.timeOut();
await settle(10);
t("a timed-out call is a wrong call: a stamp, a substitution, the value revealed, and it waits for Next",
  doc.querySelectorAll(".duel.settled.bad").length === 1 && doc.querySelectorAll("#subs i.spent").length === 1 &&
  doc.querySelector(".duel.settled.bad").textContent.includes(String(board.chain[11].value)) &&
  doc.querySelector(".duel.settled.bad .stamp").textContent.includes("out of time"));
/* The eleventh was the last call, so full time follows without a Next. */

console.log("\n=== Full time ===");
t("the round ends on the eleventh call", shown("screenResults"));
const S = window.HL_SCORING;
const expected = S.score([...Array(10).fill(true), false], [...Array(10).fill(10), 0]);
t("the score is ten right at full value plus the run bonus, out of 114",
  Number($("ftScore").textContent) === expected && expected === 100 + 4, $("ftScore").textContent);
t("one wrong is still a win", $("ftRes").textContent === "Win");
const share = $("shareText").value;
t("the share is eleven outcome squares — ten green, one red — then right, score and result",
  (share.match(/🟩/g) || []).length === 10 && (share.match(/🟥/g) || []).length === 1 &&
  share.includes("10/11 right") && share.includes(expected + "/114") && share.includes("Win") && !/\d{4}/.test(share.split("\n")[1] || ""));
t("the share names no value from the board", board.chain.every((r) => !share.includes(String(r.value))));
t("the play ended as finished, with ten right and the wrong count in detail",
  plays.some((p) => p.event === "end" && p.completed === true && p.solved === 10 && p.detail && p.detail.wrong === 1));
if (playDay === today) {
  const rec = JSON.parse(window.localStorage.getItem("xihl.results") || "[]");
  t("a durable result row is written under this game's prefix — day, board, score, result",
    rec.length === 1 && rec[0].day === today && rec[0].boardId === String(board.id) && rec[0].score === expected && rec[0].result === "W" && rec[0].game === "hilo");
} else {
  t("a past day played as free play banks no row", (window.localStorage.getItem("xihl.results") || "[]") === "[]");
}
/* ---- a subtitle leads with the answer, not the small print ------------- */
/* "The year he first took charge, caretaker spells included. A man with more
   than one spell is dated by his first." is 111 characters and the first half
   is the only part most people need before pressing Kick off. The rule that
   settles the awkward cases still decides real boards, so it is kept and said
   quietly rather than shortened away. */
{
  const parts = window.__hilo.subtitleParts;
  const two = parts("The year he first took charge, caretaker spells included. A man with more than one spell is dated by his first.");
  t("a two-sentence subtitle leads with what the number means",
    two.lead === "The year he first took charge, caretaker spells included.", two.lead);
  t("and keeps the rule that settles the awkward cases",
    two.note === "A man with more than one spell is dated by his first.", two.note);
  const one = parts("The year the club was founded, under whatever name it started with.");
  t("a one-sentence subtitle is left whole, with nothing under it",
    one.lead === "The year the club was founded, under whatever name it started with." && one.note === "");
  /* A question mark is not a full stop: "Older or younger? The value is the
     year he was born" is one thought and splitting it would strand the half
     that answers the question. */
  const q = parts("Older or younger? The value is the year he was born, and the reveal shows his age today.");
  t("a question inside a subtitle does not split it", q.note === "", q.note);
}

t("no other game's keys were written", Object.keys(window.localStorage).every((k) => k.indexOf("xihl.") === 0 || k.indexOf("xi.") === 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
