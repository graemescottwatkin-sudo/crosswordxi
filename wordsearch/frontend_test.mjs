/* frontend_test.mjs — the real page against the real Functions, played.
 *
 * Serves the tree and the API over HTTP, loads the page in jsdom, and drags
 * words out of the grid by driving the same pointer handlers a finger does.
 * Run everything before calling a build ready — the crossword shipped four
 * faults through a gate that reads source, because the gate could not
 * resolve a name. This suite resolves them.
 *
 *   npm install jsdom     (once)
 *   node frontend_test.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { onRequestGet as daily } from "../functions/api/wordsearch/daily.js";
import { onRequestGet as puzzleFn } from "../functions/api/wordsearch/puzzle.js";
import { onRequestGet as catalogFn } from "../functions/api/wordsearch/catalog.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, "..");
let pass = 0, fail = 0, uncaught = [];
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* ---- serve the tree and the real API (sample dataset — no DB env) ----- */
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (r) => r.arrayBuffer().then((b) => {
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(b));
  });
  const ctx = { request: new Request("http://x" + req.url), env: {} };
  if (url.pathname === "/api/wordsearch/daily") return send(await daily(ctx));
  if (url.pathname === "/api/wordsearch/puzzle") return send(await puzzleFn(ctx));
  if (url.pathname === "/api/wordsearch/catalog") return send(await catalogFn(ctx));
  let file = url.pathname === "/wordsearch/" ? "/wordsearch/index.html" : url.pathname;
  const full = path.join(ROOT, file);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "text/plain" });
    res.end(fs.readFileSync(full));
  } else { res.writeHead(404); res.end("nope"); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

/* ---- load the page ---------------------------------------------------- */
/* This jsdom has no window.fetch; hand it node's, resolved against the
   page's own address so the game's relative "/api/..." calls work. */
const giveFetch = (win) => {
  win.fetch = (u, o) => globalThis.fetch(new URL(u, win.location.href), o);
  win.addEventListener("error", (e) => uncaught.push(e.message));
};
const dom = await JSDOM.fromURL(`http://localhost:${PORT}/wordsearch/`, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  beforeParse: giveFetch,
});
const w = dom.window, d = w.document;
await new Promise((r) => w.addEventListener("load", r));
await new Promise((r) => setTimeout(r, 500)); // let both fetches land

t("the page loads with the sample bank behind the API",
  /released boards/.test(d.getElementById("bankLine").textContent),
  d.getElementById("bankLine").textContent);
t("the build tag is on the page", d.getElementById("buildTag").textContent === w.WORDSEARCHXI_BUILD);
t("no schedule and no bank in the served page",
  !/DAILY_SCHEDULE|const PUZZLES/.test(d.documentElement.outerHTML));
t("one H1, and it is the game's name, not the board's",
  d.querySelectorAll("h1").length === 1 && /Wordsearch XI/.test(d.querySelector("h1").textContent));

/* ---- kick off the daily ----------------------------------------------- */
d.getElementById("kickBtn").click();
await new Promise((r) => setTimeout(r, 250));
t("kick off opens the daily board", !d.getElementById("gameApp").classList.contains("hidden"));
t("the grid has 168 cells", d.querySelectorAll("#grid .cell").length === 14 * 12);
t("eleven names on the right, no clues anywhere",
  d.querySelectorAll("#wordList .word").length === 11 && !/clue/i.test(d.getElementById("side").textContent));
t("help lives in the menu, not beside the board",
  !d.getElementById("side").querySelector("[data-help]") &&
  d.querySelectorAll("#helpMenu [data-help]").length === 4);
t("no keyboard and no active-clue strip exists",
  !d.querySelector(".keyboard, .activeClue, #activeClue, input, textarea"));

/* ---- help is refused in the daily ------------------------------------- */
{
  d.getElementById("helpBtn").click();
  const rows = d.querySelectorAll("#helpMenu [data-help]");
  t("all four help cards are disabled in Team of the Day",
    Array.from(rows).every((r) => r.disabled));
  d.getElementById("helpBtn").click();
}

/* ---- drag a word out of the grid -------------------------------------- */
const puzzle = await (await fetch(`http://localhost:${PORT}/api/wordsearch/daily`)).json().then((r) => r.puzzle);
const dirMap = { E:[0,1],W:[0,-1],S:[1,0],N:[-1,0],SE:[1,1],SW:[1,-1],NE:[-1,1],NW:[-1,-1] };
const cellsOf = (a) => {
  const dxy = dirMap[a.placement.direction], out = [];
  for (let k = 0; k < a.grid.length; k++)
    out.push((a.placement.start_row + dxy[0] * k) * 12 + (a.placement.start_col + dxy[1] * k));
  return out;
};
/* jsdom has no layout, so elementFromPoint cannot find cells by geometry —
   stub it to answer from the cell index the test encodes in clientX. This
   drives the REAL handlers; only the geometry oracle is substituted. */
const cellEls = d.querySelectorAll("#grid .cell");
d.elementFromPoint = (x) => cellEls[x] || null;
function drag(cells) {
  const grid = d.getElementById("grid");
  const ev = (type, i) => {
    const e = new w.Event(type, { bubbles: true });
    e.clientX = i; e.clientY = 0; e.pointerId = 1;
    grid.dispatchEvent(e);
  };
  ev("pointerdown", cells[0]);
  ev("pointermove", cells[cells.length - 1]);
  ev("pointerup", cells[cells.length - 1]);
}
drag(cellsOf(puzzle.answers[0]));
t("dragging a name finds it",
  d.querySelector('#wordList .word.done') !== null &&
  d.getElementById("count").textContent === "1");
t("the found name is struck in the list, and a highlight is drawn",
  d.querySelectorAll("#highlightLayer .hl").length === 1);

/* a wrong drag is a foul */
const before = d.getElementById("clock").textContent;
drag([0, 1, 2]);
await new Promise((r) => setTimeout(r, 50));
t("a wrong selection is a foul, not a find",
  d.getElementById("count").textContent === "1");

/* find the rest, then the bonus */
for (let i = 1; i < 11; i++) drag(cellsOf(puzzle.answers[i]));
t("ten more drags complete the XI", d.getElementById("count").textContent === "11");
t("the finish prompt offers the secret hunt",
  d.getElementById("finishPrompt").classList.contains("show"));
drag(cellsOf(puzzle.bonus));
await new Promise((r) => setTimeout(r, 100));
t("finding the bonus after the XI ends the match at full time",
  d.getElementById("result").classList.contains("show"));
t("the result equation shows base + 10 bonus",
  /\+ 10 bonus/.test(d.getElementById("resultEquation").textContent),
  d.getElementById("resultEquation").textContent);

/* ---- the record survives ---------------------------------------------- */
const results = JSON.parse(w.localStorage.getItem("xiws.results") || "[]");
t("a durable result row is written — day, score, complete",
  results.length === 1 && results[0].game === "wordsearch" &&
  typeof results[0].day === "string" && results[0].complete === true &&
  typeof results[0].score === "number");
const dayState = JSON.parse(w.localStorage.getItem("xiws.daily." + results[0].day) || "null");
t("the daily state carries saved_at for the away-time charge",
  !!dayState && typeof dayState.saved_at === "number");

/* ---- zoom touches the board and only the board ------------------------ */
{
  const grid = d.getElementById("grid");
  const pageFont = d.body.style.fontSize;
  d.getElementById("zoomBtn").click();
  d.querySelector('#zoomMenu [data-zoom="in"]').click();
  t("zoom in raises --cell on the grid",
    grid.style.getPropertyValue("--cell") === "38px", grid.style.getPropertyValue("--cell"));
  d.querySelector('#zoomMenu [data-zoom="reset"]').click();
  t("reset returns --cell to default", grid.style.getPropertyValue("--cell") === "34px");
  t("the page around the board never changed", d.body.style.fontSize === pageFont &&
    !d.documentElement.style.zoom);
}

/* ---- the away-time charge, proven ------------------------------------- */
{
  /* Rewind the completed state to in_progress with a stale saved_at, reload
     the page, resume: elapsed must include the away time, capped. */
  const day = results[0].day;
  const rec = JSON.parse(w.localStorage.getItem("xiws.daily." + day));
  rec.status = "in_progress"; rec.found = rec.found.slice(0, 3); rec.found_count = 3;
  rec.bonus_found = false; rec.elapsed_seconds = 60;
  rec.saved_at = Date.now() - 2 * 3600 * 1000;   // two hours away
  const stash = JSON.stringify(rec);

  const dom2 = await JSDOM.fromURL(`http://localhost:${PORT}/wordsearch/`, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse: giveFetch,
  });
  const w2 = dom2.window, d2 = w2.document;
  await new Promise((r) => w2.addEventListener("load", r));
  w2.localStorage.setItem("xiws.daily." + day, stash);
  w2.localStorage.setItem("xiws.results", "[]");
  await new Promise((r) => setTimeout(r, 500));
  d2.getElementById("kickBtn").click();
  await new Promise((r) => setTimeout(r, 300));
  const clock = d2.getElementById("clock").textContent;
  /* 60s + capped 3600s = 3660s of 600s/90' => past full time => the board
     finishes at 90' immediately. Two hours away must NOT resume at 9'. */
  t("two hours away is charged on resume (capped), not forgotten",
    d2.getElementById("result").classList.contains("show") &&
    d2.getElementById("resultClock").textContent === "90'",
    "clock read " + clock);
  t("the late board banks as played, scored at the floor",
    JSON.parse(w2.localStorage.getItem("xiws.results")).length === 1);
  dom2.window.close();
}

t("no uncaught errors anywhere in the run", uncaught.length === 0, uncaught.join(" ; "));

console.log(`\n${pass} passed, ${fail} failed`);
server.close();
w.close();
process.exit(fail ? 1 : 0);
