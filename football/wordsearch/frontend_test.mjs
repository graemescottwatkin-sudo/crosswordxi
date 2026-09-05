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
import { onRequestGet as daily } from "../../functions/api/wordsearch/daily.js";
import { onRequestGet as puzzleFn } from "../../functions/api/wordsearch/puzzle.js";
import { onRequestGet as catalogFn } from "../../functions/api/wordsearch/catalog.js";
import { onRequestGet as archiveFn } from "../../functions/api/wordsearch/archive.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, "..", "..");
let pass = 0, fail = 0, uncaught = [];
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* ---- serve the tree and the real API (sample dataset — no DB env) ----- */
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const plays = [];   /* every body the page posts to /api/play, in order */
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
  if (url.pathname === "/api/wordsearch/archive") return send(await archiveFn(ctx));
  /* The play counter, captured rather than served: what the page SENDS is the
     thing under test, and the real route is proven by play_test. */
  if (url.pathname === "/api/play") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    await new Promise((r) => req.on("end", r));
    try { plays.push(JSON.parse(raw)); } catch (e) { plays.push({ bad: raw }); }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, playNo: plays.length }));
  }
  let file = url.pathname === "/football/wordsearch/" ? "/football/wordsearch/index.html" : url.pathname;
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
const dom = await JSDOM.fromURL(`http://localhost:${PORT}/football/wordsearch/`, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  beforeParse: giveFetch,
});
const w = dom.window, d = w.document;
await new Promise((r) => w.addEventListener("load", r));
await new Promise((r) => setTimeout(r, 500)); // let both fetches land

/* THE COUNT MOVED ONTO THE CARD IT DESCRIBES. #bankLine sat under a Kick off
   button on the card this landing replaced; the board count is on the boards
   card now, next to the thing it counts. Read defensively so a missing element
   fails this check rather than killing the run — the suite died on a null
   here, which reports nothing about the eleven checks after it. */
t("the page loads with the sample bank behind the API", (() => {
  const el = d.getElementById("homeThemedState");
  return !!el && /board/i.test(el.textContent);
})(), (d.getElementById("homeThemedState") || {}).textContent);
/* Previous PUZZLES counts days, from the archive, which stops at yesterday:
   the sample schedule always has exactly one. */
t("the previous puzzles card counts days, not boards", (() => {
  const el = d.getElementById("homePreviousCount");
  return !!el && /^1 day so far$/.test(el.textContent);
})(), (d.getElementById("homePreviousCount") || {}).textContent);
t("clubs and themes is a link to its pages, not a drawer",
  d.getElementById("homeThemed").tagName === "A" &&
  d.getElementById("homeThemed").getAttribute("href") === "/football/wordsearch/themes/" &&
  !d.getElementById("catSelect"));
t("the build tag is on the page", d.getElementById("buildTag").textContent === w.WORDSEARCHXI_BUILD);
t("no schedule and no bank in the served page",
  !/DAILY_SCHEDULE|const PUZZLES/.test(d.documentElement.outerHTML));
t("one H1, and it is the game's name, not the board's",
  d.querySelectorAll("h1").length === 1 && /Wordsearch XI/.test(d.querySelector("h1").textContent));

/* ---- kick off the daily ----------------------------------------------- */
/* The hero, not the old Kick off button. #kickBtn belonged to a card with two
   mode tiles above it, where the button did different things depending on a
   selection made earlier; today is its own control now. */
d.getElementById("homeDaily").click();
await new Promise((r) => setTimeout(r, 250));
t("kick off opens the daily board", !d.getElementById("gameApp").classList.contains("hidden"));
/* HOW FAR PEOPLE GET, now counted here too: the page posts a start naming
   this game and today's board, through the family's helper. */
t("kick off posts a play start naming the game and today's board",
  plays.length === 1 && plays[0].event === "start" && plays[0].game === "wordsearch" &&
  plays[0].mode === "daily" && /^ws:\d{4}-\d{2}-\d{2}$/.test(plays[0].boardKey) &&
  plays[0].total === 11 && typeof plays[0].playId === "string" && plays[0].playId.length >= 8,
  JSON.stringify(plays[0] || null));
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
/* THE BONUS HAS A CLUE, and it is shown. The bank has always carried one and
   the server always sent it; the box read "Undiscovered" and threw it away.
   The clue and the length are on the card from kick-off; the word is not. */
t("the bonus box shows the clue and the length before the bonus is found",
  d.getElementById("bonusState").textContent === puzzle.bonus.clue &&
  d.getElementById("bonusSub").textContent.indexOf(puzzle.bonus.grid.length + " letters") === 0 &&
  d.getElementById("bonusBox").textContent.indexOf(puzzle.bonus.display) === -1,
  d.getElementById("bonusState").textContent + " / " + d.getElementById("bonusSub").textContent);
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
/* The end: the same attempt, finished, with the eleven and the bonus in it.
   Sent by fetch here — the beacon path is the page-leaving one. */
{
  const end = plays.find((p) => p.event === "end");
  t("full time posts the play's end: finished, eleven of eleven, bonus in detail",
    !!end && end.playId === plays[0].playId && end.game === "wordsearch" && end.completed === true &&
    end.solved === 11 && end.detail && end.detail.bonusFound === true && typeof end.elapsed === "number",
    JSON.stringify(end || null));
}
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

/* ---- the board is sized by the width it is given, and by nothing else ----

   Both halves of this were reported from an iPad on the day the fit shipped.

   The board grew and shrank while it was being read: Safari hides its
   toolbars as you scroll and fires a resize for it, the fit read the
   window's height, and so the board moved. And in landscape the height was
   the tighter of the two, so the cell took the height's answer and left a
   third of the card empty down the right — the white space the fit existed
   to remove.

   jsdom measures every box as zero, so the shell is given a width here.
   That is the whole input: fit it, then move the height and prove nothing
   happens, then move the width and prove it follows. */
{
  const grid = d.getElementById("grid");
  const shell = d.getElementById("gridShell");
  const COLS = 12, PAD = 16;
  const widthIs = (px) => Object.defineProperty(shell, "clientWidth",
    { value: px, configurable: true });

  widthIs(700);
  w.dispatchEvent(new w.Event("resize"));
  const fitted = grid.style.getPropertyValue("--cell");
  t("the board is fitted to the width of its card",
    fitted === Math.floor((700 - PAD) / COLS) + "px", fitted);

  /* The toolbar case: a resize the layout did not move for.

     Watched through a value the fit would never choose. Comparing --cell to
     the fitted size instead would pass whether or not the guard exists —
     the fit reads the width and the width has not moved, so recomputing
     lands on the same number. That check would have been describing the
     fit, not the guard it is named for. */
  grid.style.setProperty("--cell", "11px");
  w.dispatchEvent(new w.Event("resize"));
  w.dispatchEvent(new w.Event("resize"));
  t("a resize that did not change the width does not touch the board at all",
    grid.style.getPropertyValue("--cell") === "11px",
    grid.style.getPropertyValue("--cell"));
  grid.style.setProperty("--cell", fitted);

  widthIs(500);
  w.dispatchEvent(new w.Event("resize"));
  t("a resize that DID change the width refits it",
    grid.style.getPropertyValue("--cell") === Math.floor((500 - PAD) / COLS) + "px",
    grid.style.getPropertyValue("--cell"));

  /* The card is as wide as the board wants to be, so what is left over is a
     rounding remainder rather than a margin. */
  const cell = parseInt(grid.style.getPropertyValue("--cell"), 10);
  t("what is left of the card's width is less than one cell",
    (500 - PAD) - cell * COLS < cell, `${(500 - PAD) - cell * COLS}px over`);

  /* A card that is not on screen measures zero. Fitting a board to that
     would size it for a card it has not been given, and recording it would
     make the first real measurement look like no change at all. */
  widthIs(0);
  grid.style.setProperty("--cell", "12px");
  w.dispatchEvent(new w.Event("resize"));
  t("a card that measures zero is not a size to fit to",
    grid.style.getPropertyValue("--cell") === "12px",
    grid.style.getPropertyValue("--cell"));
  widthIs(620);
  w.dispatchEvent(new w.Event("resize"));
  t("and the first real measurement after it is taken",
    grid.style.getPropertyValue("--cell") === Math.floor((620 - PAD) / COLS) + "px",
    grid.style.getPropertyValue("--cell"));

  /* A player who has zoomed has said what size they want. */
  d.getElementById("zoomBtn").click();
  d.querySelector('#zoomMenu [data-zoom="in"]').click();
  const zoomed = grid.style.getPropertyValue("--cell");
  widthIs(900);
  w.dispatchEvent(new w.Event("resize"));
  t("a resize does not argue with a player who has zoomed",
    grid.style.getPropertyValue("--cell") === zoomed, grid.style.getPropertyValue("--cell"));
  d.querySelector('#zoomMenu [data-zoom="reset"]').click();
  t("and reset hands the board back to the fit, not to a fixed size",
    grid.style.getPropertyValue("--cell") === Math.floor((900 - PAD) / COLS) + "px",
    grid.style.getPropertyValue("--cell"));
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

  const dom2 = await JSDOM.fromURL(`http://localhost:${PORT}/football/wordsearch/`, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse: giveFetch,
  });
  const w2 = dom2.window, d2 = w2.document;
  await new Promise((r) => w2.addEventListener("load", r));
  w2.localStorage.setItem("xiws.daily." + day, stash);
  w2.localStorage.setItem("xiws.results", "[]");
  await new Promise((r) => setTimeout(r, 500));
  d2.getElementById("homeDaily").click();
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

/* ---- the doors: a themes page hands over a board, previous puzzles lists
   the days — and in both cases the clock waits for Kick off ------------- */
{
  const cat = await (await fetch(`http://localhost:${PORT}/api/wordsearch/catalog`)).json();
  const released = cat.boards[0];
  const dom3 = await JSDOM.fromURL(`http://localhost:${PORT}/football/wordsearch/?b=${released.id}`, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse: giveFetch,
  });
  const w3 = dom3.window, d3 = w3.document;
  await new Promise((r) => w3.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 500));
  const app3 = d3.getElementById("gameApp"), cover = d3.getElementById("kickCover");
  /* ON THE BOARD, not on a card back on the landing: the grid is drawn at
     its real size, the letters and the eleven are covered, the clock has
     not started, and the card over the grid names the board. */
  t("?b= from a themes page opens on the board, covered, with the clock waiting",
    !app3.classList.contains("hidden") && app3.classList.contains("covered") &&
    !cover.classList.contains("hidden") &&
    d3.getElementById("kickTitle").textContent === released.theme &&
    d3.getElementById("themeTitle").textContent === released.theme &&
    d3.getElementById("clock").textContent === "0'" &&
    d3.querySelectorAll("#grid .cell").length === 14 * 12 &&
    d3.getElementById("prematch").classList.contains("hidden"),
    d3.getElementById("kickTitle").textContent);
  t("the cover names where the board came from",
    /FROM THE THEMES/.test(d3.getElementById("kickKicker").textContent));
  /* A swipe under the cover must find nothing: the letters are unreadable
     and the clock is stopped, so a find here would be a free one. */
  const rel = await (await fetch(`http://localhost:${PORT}/api/wordsearch/puzzle?id=${released.id}`)).json().then((r) => r.puzzle);
  const cells3 = d3.querySelectorAll("#grid .cell");
  d3.elementFromPoint = (x) => cells3[x] || null;
  const drag3 = (cells) => {
    const grid = d3.getElementById("grid");
    const ev = (type, i) => {
      const e = new w3.Event(type, { bubbles: true });
      e.clientX = i; e.clientY = 0; e.pointerId = 1;
      grid.dispatchEvent(e);
    };
    ev("pointerdown", cells[0]); ev("pointermove", cells[cells.length - 1]); ev("pointerup", cells[cells.length - 1]);
  };
  drag3(cellsOf(rel.answers[0]));
  t("a drag under the cover finds nothing", d3.getElementById("count").textContent === "0");
  d3.getElementById("kickBtn").click();
  await new Promise((r) => setTimeout(r, 100));
  t("kick off takes the cover off and starts free play on that board",
    !app3.classList.contains("covered") && cover.classList.contains("hidden") &&
    d3.getElementById("modeLabel").textContent === "Free play" &&
    d3.getElementById("themeTitle").textContent === released.theme);
  drag3(cellsOf(rel.answers[0]));
  t("and the same drag now finds the name", d3.getElementById("count").textContent === "1");
  t("the in-game menu offers the themes pages and no drawer",
    !!d3.querySelector('#gameMenu [data-act="themes"]') && !d3.querySelector('#gameMenu [data-act="free"]'));

  /* Back to the landing, then Previous puzzles: the list by day, from the
     archive. The sample schedule has one day behind today, so one row, and
     it is there to play. */
  d3.querySelector('#gameMenu [data-act="menu"]').click();
  await new Promise((r) => setTimeout(r, 100));
  t("back to menu returns to the landing", !d3.getElementById("prematch").classList.contains("hidden"));
  d3.getElementById("homePrevious").click();
  await new Promise((r) => setTimeout(r, 300));
  const panel = d3.getElementById("archivePanel");
  const rows = d3.querySelectorAll("#archiveList .arch-row");
  t("previous puzzles opens a list by day",
    !panel.classList.contains("hidden") &&
    d3.getElementById("homePrevious").getAttribute("aria-expanded") === "true");
  const archive = await (await fetch(`http://localhost:${PORT}/api/wordsearch/archive`)).json();
  t("one row per day the schedule has played, newest first, named",
    rows.length === archive.days.length && rows.length === 1 &&
    rows[0].querySelector(".arch-theme").textContent === archive.days[0].theme &&
    rows[0].querySelector(".arch-state").textContent === "To play",
    rows.length + " rows");
  t("the day is a date, not a board number",
    /[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}/.test(rows[0].querySelector(".arch-day").textContent),
    rows[0].querySelector(".arch-day").textContent);
  t("and the count on the card says how many days are left to play",
    /1 day to play/.test(d3.getElementById("archiveSub").textContent),
    d3.getElementById("archiveSub").textContent);
  rows[0].click();
  await new Promise((r) => setTimeout(r, 400));
  t("a day opens on its board, covered, named by its date, and the list closes",
    !app3.classList.contains("hidden") && app3.classList.contains("covered") &&
    panel.classList.contains("hidden") &&
    /PREVIOUS PUZZLE/.test(d3.getElementById("kickKicker").textContent) &&
    d3.getElementById("kickTitle").textContent === archive.days[0].theme &&
    d3.getElementById("clock").textContent === "0'",
    d3.getElementById("kickKicker").textContent);
  d3.getElementById("kickBtn").click();
  await new Promise((r) => setTimeout(r, 100));
  t("kick off starts that day's board as free play",
    !app3.classList.contains("covered") &&
    d3.getElementById("themeTitle").textContent === archive.days[0].theme &&
    d3.getElementById("modeLabel").textContent === "Free play");
  dom3.window.close();
}

t("no uncaught errors anywhere in the run", uncaught.length === 0, uncaught.join(" ; "));

console.log(`\n${pass} passed, ${fail} failed`);
server.close();
w.close();
process.exit(fail ? 1 : 0);
