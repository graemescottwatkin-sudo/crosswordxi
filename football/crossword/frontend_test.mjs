/* frontend_test.mjs — the game, served over HTTP, talking to the real API.
 *
 * This replaces the old dom_test.js harness. That one loaded a single self
 * contained file and let the browser answer its own questions; the game now
 * fetches its puzzle and asks the server about every answer, so the only
 * honest test is one that runs both halves together.
 *
 * A small static server stands in for Cloudflare Pages and routes /api/* to the
 * real Function modules — the same code that will be deployed.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import { onRequestGet as apiDaily } from "../../functions/api/daily.js";
import { onRequestGet as apiPractice } from "../../functions/api/practice.js";
import { onRequestGet as apiCategories } from "../../functions/api/categories.js";
import { onRequestPost as apiCheck } from "../../functions/api/check-answer.js";
/* The free background verification has its own endpoint now, so that the paid
   check can be paid by definition — the server had to be told which was which,
   and a browser that omitted the flag got its checks for nothing. */
import { onRequestPost as apiVerify } from "../../functions/api/verify.js";
import { onRequestPost as apiFinish } from "../../functions/api/finish.js";
import { onRequestPost as apiReveal } from "../../functions/api/reveal.js";
import { onRequestGet as apiStatus } from "../../functions/api/status.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain" };

const ROUTES = {
  "/api/daily": apiDaily, "/api/practice": apiPractice,
  "/api/categories": apiCategories, "/api/check-answer": apiCheck,
  "/api/verify": apiVerify, "/api/finish": apiFinish,
  "/api/reveal": apiReveal, "/api/status": apiStatus,
};

let apiCalls = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const fn = ROUTES[url.pathname];
  if (fn) {
    apiCalls++;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request("http://127.0.0.1" + req.url, {
      method: req.method,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      headers: { "Content-Type": "application/json" },
    });
    const out = await fn({ request, env: {} });      // no DB: development data
    const body = await out.text();
    res.writeHead(out.status, { "Content-Type": "application/json" });
    return res.end(body);
  }
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  /* The shared layer lives beside the game, not inside it: the page links
     ../shared/, which from the served root is /shared/. Served from the
     repository root, so the theme and play helpers load here as they do on
     the site — before this, every shared script 404ed in this suite and the
     page ran without them. */
  const ROOT = path.join(DIR, "..", "..");
  const file = rel.startsWith("/shared/") ? path.join(ROOT, rel.slice(1)) : path.join(DIR, rel);
  if (!(file.startsWith(DIR) || file.startsWith(path.join(ROOT, "shared"))) ||
      !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  console.log(`Serving ${DIR} at ${origin}\n`);

  const errors = [];
  const dom = await JSDOM.fromURL(origin + "/", {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: "usable",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.fetch = (u, o) => fetch(String(u).startsWith("http") ? u : origin + u, o);
      w.addEventListener("error", (e) => errors.push(e.message || String(e.error)));
    },
  });
  const w = dom.window, d = w.document;
  const $ = (id) => d.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(7000);

  /* The game now opens on a landing screen and loads nothing until a mode is
     chosen — the point of the change, since guessing was starting the daily's
     clock on a game nobody had picked. Everything below assumes a puzzle, so
     choose the daily first, the way a player would. */
  console.log("The landing screen");
  t("nothing is loaded until a choice is made", (() => {
    const home = $("homeOverlay");
    return !!home && home.classList.contains("show") &&
      d.querySelectorAll("#grid .cell").length === 0;
  })(), d.querySelectorAll("#grid .cell").length + " cells before choosing");
  t("a saved game is written before leaving for the menu", (() => {
    /* Saving is deferred 400ms, so letters typed just before pressing Menu were
       still in a pending timer and the landing screen read the file without
       them. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function showHome"), js.indexOf("function showHome") + 700);
    return /clearTimeout\(saveT\); save\(\)/.test(fn);
  })());
  t("the clock is saved while it runs, not only when something is typed", (() => {
    // Twenty-five seconds of thinking left elapsed at 0 in storage.
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function startClockSaves/.test(js) && /setInterval/.test(js);
  })());
  t("a rejected save is not overwritten by the empty board that replaced it", (() => {
    /* Discarding a save and then immediately saving an empty board destroys the
       letters that were only being questioned. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /suppressSaveUntilPlayed = true/.test(js) &&
      /if \(suppressSaveUntilPlayed && !Object\.keys\(letters\)\.length\) return;/.test(js);
  })());
  t("time on the clock counts as in progress, not just typed letters", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function inProgress/.test(js) && /\(rec\.elapsed \|\| 0\) > 0/.test(js);
  })());
  t("the club is chosen on the landing screen", (() => {
    /* It applies to both modes and does not change between them, so asking
       again on each kick-off card was asking twice for one answer. */
    const sel = $("homeClubSelect");
    return !!sel && sel.options.length > 20;
  })(), $("homeClubSelect") ? $("homeClubSelect").options.length + " options" : "missing");
  t("Football League clubs can be played as too", (() => {
    /* No new season data needed: the engine already displaces the bottom club
       when yours did not play that season, which is the right story anyway —
       you take last place and climb from there. */
    const opts = [...$("homeClubSelect").querySelectorAll("option")].map((o) => o.value);
    return opts.includes("Bolton Wanderers") && opts.includes("Wrexham") &&
      opts.includes("Notts County");
  })(), $("homeClubSelect").options.length + " clubs in total");
  t("and they are below the current twenty, not mixed in with them", (() => {
    /* They used to be their own group labelled "Football League clubs". That is
       a mark too, and the only distinction a player cares about is whether a
       club is in the current top flight — so they sit under "Other clubs" with
       everyone else who is not. What must hold is that they come after the
       twenty, not that they have a group of their own. */
    const groups = [...$("homeClubSelect").querySelectorAll("optgroup")];
    const first = [...groups[0].children].map((o) => o.value);
    const later = groups.slice(1).flatMap((g) => [...g.children].map((o) => o.value));
    return !first.includes("Wrexham") && later.includes("Wrexham");
  })(), [...$("homeClubSelect").querySelectorAll("optgroup")].map((g) => g.label).join(" | "));
  t("the newest season's clubs come first, not all 49 alphabetically", (() => {
    /* Forty-nine in one run means scrolling past Barnsley and Bradford to reach
       the side you support. Grouped from the data, so adding a season moves the
       list on by itself. */
    /* The label no longer names a season: the season you are scored against is
       drawn from the puzzle seed whichever club you pick, so naming one in a
       club list implied a link that does not exist. What matters is that the
       current twenty lead and that there are twenty of them. */
    const groups = [...$("homeClubSelect").querySelectorAll("optgroup")];
    return groups.length >= 2 && /top flight/i.test(groups[0].label) &&
      groups[0].children.length === 20;
  })(), [...$("homeClubSelect").querySelectorAll("optgroup")].map((g) => g.label).join(" | "));
  t("today and the archive are each their own target", (() => {
    /* Practice is gone: it was a separate pool of 300 puzzles nobody else ever
       played, and past dailies are better content with nothing to maintain.
       The card is now Previous puzzles.

       The property is unchanged — today and everything before it are separate
       things you can choose, not one control with a mode buried in it. */
    return !!$("homeDaily") && !!$("homePrevious");
  })());
  t("the daily tile agrees with the engine about the phase", (() => {
    /* Was: title must contain "friendly" or "matchday" — which was true on
       the two phases that existed when it was written, and turned red at
       midnight on 27 August when day two opened the THIRD phase, whose
       honest label is "Today's puzzle". A suite that is green one calendar
       day and red the next on unchanged code is reading the wall clock; the
       date-proof form asserts the property itself — the tile shows what the
       engine says the phase is, one source, whatever today happens to be. */
    const eng = w.FCW || w.window.FCW;
    const label = eng.dailyPhase(eng.dailyNumber()).label;
    const title = $("homeDailyTitle").textContent;
    return !!label && title.indexOf(label) !== -1;
  })(), $("homeDailyTitle").textContent);

  /* The daily tile is suspended, so it refuses the click. dailyBtn is the
     control underneath it — hidden in the flex layout, never removed — and it
     is what the tile and the menu item both drive when the mode is open. The
     suite needs a loaded puzzle to measure, not a particular way of asking for
     one. */
  ($("dailyBtn") || $("homeDaily")).dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(2500);

  console.log("\nLoading");
  t("the page loads its stylesheet and scripts as separate files", (() => {
    // Match the path, not the whole attribute: the URLs carry a ?v= build tag.
    return !!d.querySelector('link[href^="css/style.css"]') &&
      !!d.querySelector('script[src^="js/game.js"]') &&
      !!d.querySelector('script[src^="js/engine.js"]');
  })());
  t("every asset URL carries the build tag, so a deploy cannot serve stale CSS",
    [...d.querySelectorAll('link[href^="css/"], script[src^="js/"]')]
      .every((n) => /\?v=/.test(n.getAttribute("href") || n.getAttribute("src"))));
  t("the build tag is visible in the footer and on window", (() => {
    const tag = d.getElementById("buildTag");
    return !!tag && !!w.CROSSWORDXI_BUILD && tag.textContent === w.CROSSWORDXI_BUILD;
  })(), w.CROSSWORDXI_BUILD);
  t("the build badge is pinned, so it shows in any screenshot", (() => {
    const badge = d.getElementById("buildBadge");
    // `css` is declared further down; read the file directly here.
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return !!badge && badge.textContent === w.CROSSWORDXI_BUILD &&
      /\.build-badge\{position:fixed;top:0;right:0;z-index:40/.test(flat);
  })(), d.getElementById("buildBadge") && d.getElementById("buildBadge").textContent);
  t("the badge sits below the overlays, so it cannot cover Kick Off", (() => {
    /* It used to ignore pointer events; now it is a button that opens the
       status panel, so it must receive them. Overlays still cover it because
       they sit at a higher z-index. */
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return /\.build-badge\{[^}]*z-index:40/.test(flat) &&
      !/\.build-badge\{[^}]*pointer-events:none/.test(flat) &&
      /\.overlay\{[^}]*z-index:5[0-9]/.test(flat);
  })());
  t("the clue bank is not in the page", !/FCW_DATA/.test(d.documentElement.outerHTML));
  t("the engine loaded", !!w.FCW && typeof w.FCW.computeScore === "function");
  t("the game fetched its puzzle from the API", apiCalls > 0, apiCalls + " API calls");
  t("the grid rendered from the API payload",
    d.querySelectorAll("#grid .cell").length > 50,
    d.querySelectorAll("#grid .cell").length + " cells");
  t("clues rendered", d.querySelectorAll("#acrossList li").length +
    d.querySelectorAll("#downList li").length >= 10,
    (d.querySelectorAll("#acrossList li").length + d.querySelectorAll("#downList li").length) + " clues");
  t("no uncaught errors during boot", errors.length === 0, errors[0]);
  /* The collector keeps listening after this line; the whole-run assertion is
     at the end of the file. Scoped to boot alone, this suite reported 185
     passed while a TypeError from the pinch handler printed a stack trace in
     the middle of its own output — the same shape as the v146 bulkReveal
     fault, which also threw after boot and also shipped green. */

  console.log("\nNo answers in the browser");
  const html = d.documentElement.outerHTML;
  t("no solution letter reached any cell in the page payload",
    !/"ch"\s*:/.test(html));
  t("no answer or grid field reached the browser",
    !/"answer"\s*:/.test(html) && !/"grid"\s*:\s*"[A-Z]/.test(html));
  const daily = await (await fetch(origin + "/api/daily")).json();
  t("the API payload itself carries no answers", (() => {
    const raw = JSON.stringify(daily);
    return !/"ch":/.test(raw) && !/"answer":/.test(raw) && !/"hash":/.test(raw);
  })());
  t("but it carries the clues, so the puzzle is playable",
    daily.puzzle.entries.every((e) => e.row.clue && e.row.enum));

  console.log("\nPlaying");
  $("kickOffBtn").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(400);
  t("kick off starts the clock", !d.querySelector(".stage").classList.contains("prestart"));

  // Solve one entry using the reveal endpoint, the way a player would.
  const token = daily.token;
  const rv = await (await fetch(origin + "/api/reveal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, entry: 0 }),
  })).json();
  const e0 = daily.puzzle.entries[0];
  const before = apiCalls;
  for (let i = 0; i < e0.cells.length; i++) {
    const c = e0.cells[i];
    const el = d.querySelector(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`);
    // Cells listen for pointerdown, not mousedown.
    if (el) el.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: rv.answer[i], bubbles: true }));
  }
  await wait(1200);
  t("typing an entry asks the server to judge it", apiCalls > before,
    (apiCalls - before) + " calls while typing");
  t("the solved count came back from the server",
    /^[1-9]/.test($("progressChip").textContent), $("progressChip").textContent);

  /* A SOLVED WORD IS PAINTED AND LOCKED, the instant the counter moves. The
     server has just judged entry 0 correct; every square in it must now carry
     .correct, and a stray key on one of them must change nothing — not the
     letter, not the counter. Before this, a solved word stayed editable and a
     wrong key took 1/11 back to 0/11. Proven by typing, not by reading CSS. */
  const solvedCells = e0.cells.map((c) => d.querySelector(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`));
  t("the solved word is painted correct", solvedCells.every((el) => el && el.classList.contains("correct")),
    solvedCells.filter((el) => el && el.classList.contains("correct")).length + " of " + solvedCells.length);
  t("and the screen reader hears it as solved, not revealed",
    /solved/.test(solvedCells[0].getAttribute("aria-label") || "") &&
    !/revealed/.test(solvedCells[0].getAttribute("aria-label") || ""),
    solvedCells[0].getAttribute("aria-label"));
  const chipBefore = $("progressChip").textContent;
  const letterBefore = solvedCells[0].querySelector(".ltr").textContent;
  const stray = letterBefore === "Z" ? "Q" : "Z";
  solvedCells[0].dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: stray, bubbles: true }));
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
  await wait(600);
  t("a solved word cannot be typed over", solvedCells[0].querySelector(".ltr").textContent === letterBefore,
    letterBefore + " -> " + solvedCells[0].querySelector(".ltr").textContent);
  t("nor backspaced, so the counter holds", $("progressChip").textContent === chipBefore,
    chipBefore + " -> " + $("progressChip").textContent);

  console.log("\nScoring and season still work client-side");
  // Landmarks from the decay curve in headless_test.js, which is authoritative.
  // (The deleted dev panel asserted "0:59 clean = 114"; the curve gives 111 at
  // 59s and 114 only at zero, so that in-browser test had gone stale.)
  t("scoring is unchanged", w.FCW.computeScore(0, 0, 0, 0).score === 114 &&
    w.FCW.computeScore(600, 0, 0, 0).score === 78 &&
    w.FCW.computeScore(1800, 0, 0, 0).score === 36,
    w.FCW.computeScore(0, 0, 0, 0).score + "/" + w.FCW.computeScore(600, 0, 0, 0).score);
  t("the match clock is unchanged", w.FCW.matchClockLabel(1860) === "90+3'");
  t("the league table renders three rows", (() => {
    const rows = [...d.querySelectorAll("#tablePanel #leagueBody tr")];
    return rows.length === 20 && rows.filter((r) => !r.classList.contains("faroff")).length === 3;
  })(), [...d.querySelectorAll("#tablePanel #leagueBody tr")].filter((r) => !r.classList.contains("faroff")).length + " visible");
  /* THE 38-GAME STRIP IS GONE and must not come back: it factorised one
     board's score into an invented W/D/L record, and there is a real season on
     the hub now counting days across all five games. This asserts its absence
     rather than being deleted, because a check that is removed with the thing
     it watched leaves nothing to notice the thing returning. */
  t("no invented 38-game record anywhere in the page",
    !$("seasonGames") && !$("rSeasonGames") && !$("seasonPanel") &&
    d.querySelectorAll(".game, .season-strip").length === 0,
    "one board is a score out of 114, not a season");
  t("the pitch backdrop is present", !!$("pitchBg") && !!$("pitchBg").querySelector("svg"));
  t("the clue card still has a fixed height",
    /\.now-clue\{[^}]*height:96px/.test(fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "")));
  t("the brand is Crossword XI", /Crossword\s*XI/i.test(d.querySelector(".masthead").textContent));
  t("no Pitchword naming survives", !/pitchword/i.test(html));
  t("the strapline credits The XI Games", (() => {
    const line = d.querySelector(".brandline");
    return !!line && /The XI Games/.test(line.textContent);
  })(), d.querySelector(".brandline") && d.querySelector(".brandline").textContent.trim());
  /* MatchFitness is the fitness handle, not the games label. Asserted the same
     way the Pitchword rename was, so this one cannot rot half-done either. */
  t("no MatchFitness naming survives anywhere in the page",
    !/matchfitness/i.test(html), (html.match(/.{0,30}matchfitness.{0,30}/i) || [])[0]);

  console.log("\nLayout");
  const css = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
  t("the stage is a single column — no right-hand clue rail", (() => {
    return /\.stage\{[^}]*flex-direction:column/.test(css) &&
      !/\.stage\{[^}]*grid-template-columns:auto/.test(css) &&
      !d.querySelector(".side");
  })());
  t("the vertical flow is active clue, board, clues, table", (() => {
    const order = [...d.querySelectorAll("#toolbar, #nowClue, .grid-wrap, #clues, #tablePanel")]
      .map((n) => n.id || n.className.split(" ")[0]);
    /* Requested order: the clue you are answering, the board you answer it
       on, the controls, then the full lists. */
    /* The lists moved up to sit under Help, and are closed by default: the
       clue being answered is already on screen, so they are a reference. */
    /* It ended at #seasonPanel until the invented 38-game record came out.
       The LIVE TABLE is what sits at the foot of the column now — a real
       league season, entered through the player's club. */
    return order.join(">") === "nowClue>grid-wrap>clues>tablePanel";
  })(), [...d.querySelectorAll("#toolbar, #nowClue, .grid-wrap, #clues, #tablePanel")]
    .map((n) => n.id || n.className.split(" ")[0]).join(" > "));
  t("the active clue strip is still immediately above the board", (() => {
    const nc = $("nowClue"), wrap = d.querySelector(".grid-wrap");
    return nc && wrap && nc.parentNode === wrap.parentNode &&
      (nc.compareDocumentPosition(wrap) & 4) !== 0;
  })());
  t("previous and next clue arrows survived", !!$("prevClue") && !!$("nextClue"));
  t("Across and Down are below the board in two columns on desktop",
    /\.clues\{[^}]*grid-template-columns:1fr 1fr/.test(css) &&
    d.querySelectorAll("#clues .clue-col").length === 2);
  t("they stack rather than squeeze on narrow screens",
    /@media \(max-width:820px\)\s*\{\s*\.clues\{grid-template-columns:1fr/.test(css));
  t("the clue lists still hold every clue", (() => {
    const n = d.querySelectorAll("#acrossList li").length + d.querySelectorAll("#downList li").length;
    return n === daily.puzzle.entries.length;
  })(), d.querySelectorAll("#acrossList li").length + " across + " +
    d.querySelectorAll("#downList li").length + " down");
  t("the club selector travels with the league table, wherever it sits", (() => {
    const sel = $("clubSelect");
    return sel && $("tablePanel").contains(sel) && sel.options.length > 1;
  })(), $("clubSelect") && $("clubSelect").options.length + " clubs");
  t("the board publishes its width so the columns align to it",
    /--board-w/.test(fs.readFileSync(path.join(DIR, "js/game.js"), "utf8")) &&
    /\.clues\{[^}]*max-width:var\(--board-w/.test(css));
  t("cells stay within a sensible maximum on a wide monitor", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    // The width freed by removing the sidebar goes to the pitch, not the cells.
    return /Math\.min\(52, size\)/.test(js) && !/Math\.min\(6[0-9], size\)/.test(js);
  })());
  t("the pitch hugs the grid rather than spanning the content width", (() => {
    // Full width put a small crossword in the middle of a huge pitch on a real
    // iPad. The turf is a margin around the board, not a field it floats on.
    return /\.grid-wrap\{[^}]*align-self:center/.test(css) &&
      // `max-width:100%` contains "width:100%": match a bare declaration only.
      !/\.grid-wrap\{[^}]*[;{]width:100%/.test(css);
  })());
  t("landscape tablets get their chrome trimmed so the board has height", (() => {
    // Height binds on a landscape tablet, not width: header, toolbar, clue card
    // and keyboard together leave the grid only a few hundred pixels.
    return /@media \(orientation:landscape\) and \(max-height:1100px\)/.test(css) &&
      /@media \(orientation:landscape\) and \(max-height:820px\)/.test(css);
  })());
  t("no floor can force the board past the space available", (() => {
    /* The 30px tablet floor is gone. It only ever bit when the board did not
       fit, and at 820x1180 it forced 30px where 28px fitted — two pixels of
       cell for twenty-three of overflow, and a check that passed or failed on
       how many rows the day's puzzle happened to have. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return !/size < 30\) size = 30/.test(js) && /var portrait = vh >= vw/.test(js);
  })());
  t("the height budget has no floor that can force an overflow", (() => {
    // availH was floored at 200px: an instruction to overflow, not a safety net.
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return !/if \(availH < 200\) availH = 200/.test(js);
  })());
  t("the board is sized against the visual viewport, not innerHeight", (() => {
    /* iOS shrinks the visual viewport when the keyboard opens while
       innerHeight stays as it was — the measurement the whole overlap
       defect turns on. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /window\.visualViewport/.test(js) &&
      /vv && vv\.height/.test(js) &&
      /visualViewport\.addEventListener\("resize"/.test(js);
  })());
  t("clue columns follow the board's width, not the page's", (() => {
    // All three take their measure from the board box, so they line up as the
    // cell size changes rather than each aligning to the page.
    return /\.now-clue\{[^}]*width:100%/.test(css) &&
      /\.clues\{[^}]*max-width:var\(--board-w/.test(css) &&
      /\.grid-panel > \.tb-table\{[^}]*max-width:var\(--board-w/.test(css);
  })());
  t("the content is capped and centred on very wide screens",
    /\.stage\{[^}]*max-width:1140px[^}]*margin:0 auto/.test(css));
  t("the grid is not distorted — cells are square and gapless",
    /\.cell\{[^}]*width:var\(--cell\);height:var\(--cell\)/.test(css) &&
    /\.grid\{[^}]*gap:0/.test(css));
  t("nothing sets a fixed pixel position for layout",
    !/\.(stage|clues|grid-panel)\{[^}]*position:absolute/.test(css));

  console.log("\nTheme and phone header");
  /* THE THEME IS THE FAMILY'S, decided in shared/xi-theme.js: LIGHT unless the
     player chose otherwise, auto following the system, stamped on the root
     before first paint. This game's own resolver is gone; the toggle asks the
     shared script to move on and shows what it chose. */
  t("the shared theme script is on the page and light is the default with nothing stored",
    !!w.XITheme && w.localStorage.getItem("xi.theme") === null &&
    d.documentElement.getAttribute("data-theme") === "light",
    d.documentElement.getAttribute("data-theme"));
  t("the theme control cycles light, dark and auto, and persists to the family key", (() => {
    const btn = $("themeToggle");
    if (!btn) return false;
    const seen = [], attrs = [];
    for (let i = 0; i < 3; i++) {
      btn.dispatchEvent(new w.Event("click", { bubbles: true }));
      seen.push(btn.textContent.replace("theme: ", ""));
      attrs.push(d.documentElement.getAttribute("data-theme"));
    }
    /* xi.theme, the FAMILY key. The legacy fcw.theme is read as a fallback
       and never written, so this asserts both halves of the migration. Auto
       is RESOLVED to the attribute: jsdom's matchMedia stub says not dark,
       so auto lands as light. */
    const stored = w.localStorage.getItem("xi.theme");
    const legacyWritten = w.localStorage.getItem("fcw.theme");
    return seen.join(",") === "dark,auto,light" && attrs.join(",") === "dark,light,light" &&
      stored === "light" && legacyWritten === null;
  })(), $("themeToggle") && $("themeToggle").textContent);
  t("a stored choice beats the system, and a legacy key is honoured on read", (() => {
    /* Dark stored under the family key stamps dark whatever the system says;
       the crossword's old key alone still counts, so nobody's setting resets. */
    w.localStorage.setItem("xi.theme", "dark"); w.XITheme.apply();
    const dark = d.documentElement.getAttribute("data-theme");
    w.localStorage.removeItem("xi.theme"); w.localStorage.setItem("fcw.theme", "dark"); w.XITheme.apply();
    const legacy = d.documentElement.getAttribute("data-theme");
    w.localStorage.removeItem("fcw.theme"); w.XITheme.apply();
    const reset = d.documentElement.getAttribute("data-theme");
    return dark === "dark" && legacy === "dark" && reset === "light";
  })());
  /* The lists open and close, and the state survives a reload — same shape as
     the help toggle, which is the pattern already established here. */
  /* Nothing on this page hides behind a control any more. Help collapsed
     because it used to sit above the board, where five rows of 44px controls
     pushed the grid 70px down a phone screen. It is below the board now, so
     collapsing it costs the board nothing — and a crossword whose clue list is
     behind a button is a crossword people think has no clue list. */
  t("neither the help buttons nor the clue lists can be hidden", (() => {
    const help = d.querySelector(".tb-help");
    const clues = $("clues");
    return help && !help.classList.contains("collapsed") &&
      !$("helpToggle") && !$("cluesToggle") &&
      clues && clues.querySelectorAll("li").length > 0;
  })(), $("clues") ? $("clues").querySelectorAll("li").length + " clues listed" : "none");

  t("help reads as section plus target, not four loose buttons", (() => {
    /* "All" and "Answer" beside each other gave no clue which was a check and
       which a reveal. Section plus button now reads as one phrase. */
    const rows = [...d.querySelectorAll("#helpRow .tb-row")];
    const label = (r) => r.querySelector(".tb-sub").textContent.trim();
    /* Strips the cost, whatever form it takes. It used to expect a minus and a
       number, because costs were points; they are match minutes now — "+14'" —
       so the old pattern left the cost attached and the label stopped matching.

       Matching either shape keeps the assertion about what it is for: that the
       row reads as "Check: Answer / Grid" rather than four loose buttons. */
    const btns = (r) => [...r.querySelectorAll("button")].map(
      (b) => b.textContent.replace(/[+\u2212-].*/, "").trim());
    return rows.length === 3 &&
      label(rows[0]) === "Check" && btns(rows[0]).join("/") === "Answer/Grid" &&
      label(rows[1]) === "Reveal" && btns(rows[1]).join("/") === "Letter/Answer";
  })(), [...d.querySelectorAll("#helpRow .tb-row")].map(
    (r) => r.querySelector(".tb-sub").textContent + ": " +
      [...r.querySelectorAll("button")].map((b) => b.id).join(",")).join(" | "));
  /* And nothing left over describing a state nothing sets: rules for a
     collapsed help box outlived the collapsing, which is how a stylesheet
     accumulates instructions for a design that no longer exists. */
  t("no rules remain for a collapsed state nothing can enter",
    !/\.tb-help\.collapsed/.test(css));

  /* The free check and the paid check are different doors now. They were one
     endpoint serving identical requests, so the server could not tell them
     apart and had to be told — and a browser that omitted the flag got its
     checks for nothing. */
  t("the free verification and the paid check are separate endpoints", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const verify = fs.existsSync(path.join(DIR, "../../functions/api/verify.js"));
    return verify && /api\/verify/.test(js) && !/paid: 1/.test(js);
  })());
  t("and the free one cannot buy what the paid one sells", (() => {
    /* Which letters are wrong is what three points buys. If the free endpoint
       answered that too, the paid one would be decorative. */
    const src = fs.readFileSync(path.join(DIR, "../../functions/api/verify.js"), "utf8");
    return !/detail/.test(src.replace(/\/\*[\s\S]*?\*\//g, ""));
  })());
  t("the paid check counts itself, without being told whether it was paid", (() => {
    /* checkGrid says which KIND of press it was — a grid check is one press
       that takes eleven requests — but nothing tells the server whether to
       charge at all. Anything arriving here is paid by virtue of the door it
       came through. */
    const src = fs.readFileSync(path.join(DIR, "../../functions/api/check-answer.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return /await tally\(env, playId, checkGrid \? "srv_check_alls" : "srv_checks"\)/.test(src) &&
      !/\bpaid\b/.test(src);
  })());

  /* The score on screen is the server's. Everything it uses is beyond the
     browser's reach: the answers to mark the grid, the server's own count of
     the help it served, and a clock started when the board was pulled. */
  t("Full Time asks the server to score it", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* Tested on what the call carries, not on its exact shape. It gained a
       `floor` argument &mdash; the drawn season's bottom club &mdash; because
       the server was scoring every daily against the fixed curve while the
       browser used the season floor, so the verified number came back up to 26
       points HIGHER and the screen jumped upward on verification.

       What must hold: the finish endpoint is asked, and it is given the token,
       the play and the letters. */
    const call = js.slice(js.indexOf('api("/api/finish"'), js.indexOf('api("/api/finish"') + 260);
    return /function verifyScore\(\)/.test(js) &&
      /token: puzzleToken/.test(call) && /playId: playId/.test(call) &&
      /letters: letters/.test(call);
  })());
  t("and shows the verified number rather than its own when it arrives", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function verifyScore"), js.indexOf("on(\"viewGridBtn\""));
    /* rScore is gone: the result line carried the score twice — "20TH — 15
       PTS" over "15 / 114 pts" — and the second said nothing the first did not
       except the ceiling, which is now folded into it. setResultLine() writes
       the one that remains.

       The property is unchanged: when the server's number arrives it replaces
       the browser's on screen and in the variable. */
    return /setResultLine\(pos, r\.score\)/.test(fn) &&
      /verifiedScore = r\.score/.test(fn);
  })());
  /* A verified score has to reconcile with the sum printed under it. Updating
     the headline and leaving the penalty rows showing the browser's working
     printed 114 minus 26 minus 12 minus 18 under a heading saying 60. */
  /* The device's own record has to hold the verified number too. recordDaily
     and recordThemed run when the puzzle finishes, before the server has
     answered, so the board badge showed 81 for a game whose Full Time said 82.
     One game, one score, wherever it appears. */
  /* One game, one score, wherever it appears. The share text recomputed
     locally, so a shared result carried the browser's arithmetic while the card
     above it showed the server's — the same number, off by one, sent to
     everybody the player knows. */
  t("what gets shared is the verified score, not a fresh calculation", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function shareResult"), js.indexOf("function shareLink"));
    return /verifiedScore !== null && verifiedBreakdown/.test(fn) &&
      /return verifiedBreakdown;/.test(fn);
  })());
  t("and last game's verified score cannot leak into the next one", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /verifiedScore = null; verifiedBreakdown = null;/.test(js);
  })());

  t("the device's record is rewritten with the verified score", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function verifyScore"), js.indexOf("on(\"viewGridBtn\""));
    return /recordThemed\(lastPosition, r\.score\)/.test(fn) &&
      /recordDaily\(lastPosition, r\.score/.test(fn);
  })());
  t("and a verified score may lower a recorded one", (() => {
    /* The best-of-several-attempts guard must not also prefer an unverified
       figure to the server's, or the badge keeps a number the game no longer
       stands behind. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function recordThemed"), js.indexOf("function themeResults"));
    return /prev\.playId === playId/.test(fn);
  })());

  t("the breakdown is replaced along with the score, so the sum still adds up", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function verifyScore"), js.indexOf("on(\"viewGridBtn\""));
    /* The penalties are still set by id. The total is not: it appears twice now
       — on the collapsed summary and inside the panel — so it goes through
       setFinalScore(), which writes both. Two elements and three code paths is
       how a total drifts from the rows that explain it.

       The property under test is unchanged: the breakdown and the total are
       replaced together. Only the way the total is written has moved. */
    const pens = ["bTimePen", "bCheckPen", "bCheckAllPen", "bLetterPen", "bAnswerPen"]
      .every((id) => fn.includes('$("' + id + '")'));
    return pens && /setFinalScore\(/.test(fn);
  })());
  t("and the times shown are the server's, not the paused local clock", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function verifyScore"), js.indexOf("on(\"viewGridBtn\""));
    return /fmt\(r\.elapsedSeconds\)/.test(fn) && /matchClockLabel\(r\.elapsedSeconds\)/.test(fn);
  })());

  t("an unreachable server leaves the local figure, marked as unverified", (() => {
    /* A finished puzzle must always say how you did. What it must not do is
       pass off a number the browser worked out as one the server confirmed. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function verifyScore"), js.indexOf("on(\"viewGridBtn\""));
    return /catch\(/.test(fn) && (fn.match(/unverified/g) || []).length >= 2;
  })());
  t("the server refuses to score the same finish twice", (() => {
    /* Otherwise a finished board could be resubmitted until the clock suited. */
    const src = fs.readFileSync(path.join(DIR, "../../functions/api/finish.js"), "utf8");
    return /srv_score !== null/.test(src) && /already: true/.test(src);
  })());

  /* "Clear everything" has to clear everything it claims to. The themed results
     key was added months after the reset was written and never added to it, so
     clearing everything left themed boards still marked as played — a record of
     nothing that still refused to let you play it. */
  t("the reset clears every key that records what somebody did", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const list = /var WIPE_KEYS = \[([\s\S]*?)\];/.exec(js);
    if (!list) return false;
    return ["fcw.results.v1", "fcw.themeResults.v1", "fcw.streak", "fcw.pre",
            "fcw.recent", "fcw.usedClues.v1", "fcw.v04.daily", "fcw.v04.practice",
            "fcw.v04.theme"].every((k) => list[1].includes(k));
  })());
  t("and leaves preferences alone, which it does not claim to touch", (() => {
    /* Wiping a record is not resetting a device: the club you play as and the
       pitch you play on are not history. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const list = /var WIPE_KEYS = \[([\s\S]*?)\];/.exec(js);
    if (!list) return false;
    /* Quoted entries only. The block now carries a comment naming each excluded
       key and why, so a regex over the whole thing could not tell a key that is
       wiped from one explained as not being wiped — and failed on the
       explanation. */
    const wiped = [...list[1].matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
    return !["fcw.clubPref", "fcw.pitch", "fcw.bank", "fcw.clueStyle",
             "fcw.theme", "fcw.skip", "fcw.fxmode", "fcw.deviceCode"]
      .some((k) => wiped.includes(k));
  })());
  t("the reset uses that list rather than keeping its own", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* To a real boundary. indexOf finds the FIRST location.reload() in the
       file, which is earlier than this handler — so the window came out empty
       and the check passed or failed for the wrong reason. */
    const start = js.indexOf('on("adminReset"');
    const h = js.slice(start, js.indexOf("function loadReports", start))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return /WIPE_KEYS\.forEach/.test(h) && !/removeItem\("fcw\./.test(h);
  })());

  /* The board takes every letter and calls preventDefault, so any text field on
     the page could not be typed into: the keystroke went to the crossword and
     never reached the input. Invisible until Full Time grew fields of its own. */
  t("typing into a field is not stolen by the board", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const h = js.slice(js.indexOf('document.addEventListener("keydown"'), js.indexOf("typeLetter(ev.key"));
    return /el\.tagName === "INPUT"/.test(h) && /isContentEditable/.test(h);
  })());
  t("and the guard comes before the letter is consumed", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const start = js.indexOf('document.addEventListener("keydown"');
    return js.indexOf('el.tagName === "INPUT"', start) < js.indexOf("typeLetter(ev.key", start);
  })());

  /* Typing over crossings. With "_ _ _ A _ E _" for SHEARER, every crossing
     makes you retype a letter the board already knows, and one mistyped repeat
     overwrites a letter that was right. */
  t("typing can be set to step over squares already filled", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /var skipFilled = false;/.test(js) && /function passOver\(e, i\)/.test(js) &&
      /localStorage\.setItem\("fcw\.skip"/.test(js);
  })());
  t("it is off unless asked for", (() => {
    /* It changes what the keyboard does, and somebody who has played a
       crossword expects a letter to go where the cursor is. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /skipFilled = localStorage\.getItem\("fcw\.skip"\) === "on"/.test(js);
  })());
  t("and it never leaves an entry that cannot be typed into", (() => {
    /* With no empty square left, skipping would mean the keys did nothing and a
       wrong answer could never be corrected. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function passOver"), js.indexOf("function typeLetter"));
    return /return false;\s*\/\/ nothing empty left/.test(fn) &&
      /if \(!locked\(kk\) && !letters\[kk\]\)/.test(fn);
  })());
  t("revealed squares are still never typed over", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function passOver"), js.indexOf("function typeLetter"));
    return /if \(locked\(k\)\) return true;/.test(fn);
  })());

  console.log("\nMeasured-defect fixes");
  t("no control sets a fixed height below 44px", (() => {
    /* height beats min-height, so four rules were quietly overriding the touch
       target sizes — the stylesheet said 44 while the buttons measured 30. */
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "");
    const hits = [...flat.matchAll(/\.(btn|nc-arrow|toolbar[^{]*)\{[^}]*[^-]height:(\d+)px/g)]
      .filter((m) => Number(m[2]) < 44);
    return hits.length === 0;
  })(), "checked .btn, .nc-arrow, .toolbar");
  t("the clue arrows are reachable too", (() => {
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return /\.nc-arrow\{min-height:44px;min-width:44px/.test(flat);
  })());

  t("the scroll reset survives the keyboard appearing", (() => {
    /* One reset at kick off was not enough: focusing a cell and the keyboard
       opening both scroll the page afterwards, and the measured scrollY was
       still 86 on a 320x568 screen. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* A fixed character window is brittle: adding a comment above the code
       under test pushed it out of range and failed a check about scrolling. */
    const at = js.indexOf("function revealBoard");
    const rb = js.slice(at, js.indexOf("\n  }", at));
    return /requestAnimationFrame/.test(rb) && /setTimeout\(resetViewScroll/.test(rb);
  })());
  t("on the shortest screens the toolbar moves below the board", (() => {
    /* Measured live at 320x568: header, clue card and toolbar took ~335px
       before the board started, so a 15-row grid finished 37px past the fold.
       The real puzzles run taller than the development samples, which is why
       this passed locally and failed against the live site. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function toolbarBelow/.test(js) && /vh <= 600/.test(js) &&
      /panel\.parentNode\.insertBefore\(bar, panel\.nextSibling\)/.test(js);
  })());
  t("every element in the column is counted against the board's height", (() => {
    /* There is no toolbar above the board any more — the controls are in the
       column beneath it — so nothing between the header and the board can be
       counted against the space the board has. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* Everything in the column that is not the board, measured by name. The
       answer boxes and the message row were added above and below it and
       neither was counted, so the board was sized for space two other elements
       had already taken — 31px past the bottom of a 1366x768 laptop. */
    /* barAbove is gone with the toolbar it described. What replaced it is the
       list itself: measured by name, so adding an element to the column and
       forgetting this line is the fault that shows up as a board 31px past the
       bottom of the screen. */
    return /h\("\.bank-strip"\)/.test(js) && /h\("\.nudge-row"\)/.test(js) &&
      !/barAbove/.test(js);
  })());

  t("signing in during pre-season explains why nothing carried over", (() => {
    /* Friendlies are played and scored but not recorded, so there is genuinely
       nothing to migrate. Saying nothing reads as a failure to a player who has
       just finished a puzzle. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /pre-season friendlies/.test(js) && /Matchday 1/.test(js) &&
      /No results on this device to carry over/.test(js);
  })());
  t("the provider is named properly, not in lower case", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /provider\.charAt\(0\)\.toUpperCase\(\)/.test(js);
  })());

  t("a squeezed board on a portrait tablet drops the toolbar below it", (() => {
    /* Removing the 30px floor made the board fit honestly, but at 820x1180 that
       meant 18px cells while 1024x1366 managed 49. The chrome was the problem,
       not the floor. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /TIGHT_CELL = 26/.test(js) && /size < TIGHT_CELL/.test(js);
  })());
  /* Rotating an iPad left a correctly sized board inside the wrong chrome, and
     a refresh healed it. The resize handler redid four things; orientationchange
     redid one. iOS fires resize DURING the rotation with the dimensions of
     neither orientation, and droppedBelow is sticky by design, so a toolbar
     decision taken mid-rotation stayed taken while the late correction only
     re-sized the board. Boot ran the full list, hence the refresh.

     Asserted as "one function, every caller" rather than by counting steps in
     two places — the fault was the two lists drifting, so the fix is that there
     is only one. */
  {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    t("a viewport change has one relayout, not a list per listener",
      /function relayout\(\)/.test(js));
    t("and resize uses it", /addEventListener\("resize", relayout\)/.test(js));
    t("and so does orientationchange",
      /setTimeout\(relayout,/.test(js),
      "this ran fitCells() alone, so the toolbar kept its mid-rotation decision");
    t("relayout retakes the sticky toolbar decision",
      /function relayout\(\)[\s\S]{0,200}droppedBelow = false/.test(js));
    t("and places the league table too",
      /function relayout\(\)[\s\S]{0,200}placeTable\(\)/.test(js),
      "registered on its own resize listener before, so it could run alone");
    t("nothing re-registers placeTable on its own",
      !/addEventListener\("resize", placeTable\)/.test(js));

    /* v153's version of the fix bet on event timing — relayout at 250ms and
       600ms after orientationchange — and iPad still came up wrong, because
       iPadOS presents as desktop Safari, orientationchange there is
       deprecated and unreliable, and Apple does not publish the rotation
       animation's length. The v155 shape: the layout records which viewport
       it was computed FOR, staleness is a checkable fact, and the clock tick
       is a watchdog — a rotation whose every event is missed still heals
       within a second. Wrong-until-refresh is structurally gone. */
    t("the layout records the viewport it was computed for",
      /layoutFor = window\.innerWidth \+ "x" \+ window\.innerHeight/.test(js));
    t("staleness is a checkable fact, not a caught event",
      /function layoutStale\(\)/.test(js));
    /* The watchdog's first home was tick(), which runs only mid-game — so
       rotating on Kick Off, Full Time or a hidden board had no watchdog at
       all, in the screens a player sits still longest. It runs on its own
       interval from boot now, and the assertion FORBIDS it inside tick so
       it cannot quietly move back to the narrower home. */
    t("the watchdog runs on its own clock, from boot",
      /setInterval\(function \(\) \{ if \(layoutStale\(\)\) relayout\(\); \}, 1000\)/.test(js),
      "worst case one wrong second on ANY screen, never wrong-until-refresh");
    t("and not inside the game clock, whose ticks stop",
      !/function tick\(\)[\s\S]{0,700}layoutStale/.test(
        js.replace(/\/\*[\s\S]*?\*\//g, "")),
      "tick runs only mid-game; Kick Off and Full Time had no watchdog");
    t("and returning to a backgrounded tab checks immediately",
      /visibilitychange[\s\S]{0,120}layoutStale\(\)\) relayout\(\)/.test(js));
    t("the modern rotation signals call the one relayout",
      /screen\.orientation\.addEventListener\("change"/.test(js) &&
      /visualViewport\.addEventListener\("resize", relayout\)/.test(js));
    t("no listener responds to resize with a subset of relayout",
      !/addEventListener\("resize", function \(\) \{ if \(puzzle\) fitCells\(\); scaleClue\(\); \}\)/.test(js),
      "the partial healer was WHY rotation looked half-fixed");

    /* v001b: the watchdog got relayout RUNNING on rotation and the board was
       still wrong — the stage is height:var(--vh), setVh() ran at boot only,
       and relayout fitted the board into a frame read from the stale
       variable. Boot's list and relayout's list differed by one member for
       the third time. The cure and its guard, both pinned: relayout owns
       setVh (on a real window change; the keyboard must not move the
       stage), and boot's deferred pass IS relayout — one list, literally. */
    t("relayout refreshes the stage height variable",
      /function relayout\(\)[\s\S]{0,200}if \(layoutStale\(\)\) setVh\(\)/.test(js),
      "the stage is height:var(--vh); a stale --vh is a wrong frame however often relayout runs");
    t("but only on a real window change, so the keyboard cannot move the stage",
      !/function relayout\(\)[\s\S]{0,120}^\s*setVh\(\);/m.test(js));
    t("boot's deferred layout pass IS relayout, not a hand-picked subset",
      /requestAnimationFrame\(relayout\)/.test(js),
      "one list is the only arrangement under which boot and rotation cannot drift");
  }

  t("and the decision is sticky, so it cannot oscillate", (() => {
    /* Once below, the board is no longer squeezed — a rule that only asked
       "is it squeezed now" would move it back up, squeeze it, and flip forever.
       Decided once per layout, cleared on resize. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /var droppedBelow = false/.test(js) &&
      /!droppedBelow &&/.test(js) &&
      /droppedBelow = false;\s*\/\/ decide again/.test(js);
  })());

  t("the flag is there whether or not you are signed in", (() => {
    /* Hiding it meant the one affordance for reporting a bad clue was invisible
       to anyone who had not already signed in — which is most people the first
       time they meet one. */
    const btn = d.getElementById("flagClue");
    return !!btn && btn.style.display !== "none";
  })(), d.getElementById("flagClue") ? "visible" : "missing");
  t("a guest tapping it is told what it needs", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /Sign in to flag a clue/.test(js);
  })());

  t("flagging asks why, rather than only which", (() => {
    /* Recording only the clue id is half the job: a fortnight later "0412" says
       nothing, and the reason is what tells you whether to reword it or bin it. */
    const sheet = d.getElementById("flagSheet");
    const reasons = d.querySelectorAll("#flagReasons .btn").length;
    return !!sheet && reasons >= 4 && !!d.getElementById("flagNote");
  })(), `${d.querySelectorAll("#flagReasons .btn").length} quick reasons plus free text`);
  t("the reasons are multi-select, since a clue can be two things at once", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /flagPicked\.splice\(at, 1\)/.test(js) && /flagPicked\.push\(reason\)/.test(js);
  })());
  t("it will not send an empty report", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /Pick a reason or write one/.test(js);
  })());

  t("clearing the record clears the saved games with it", (() => {
    /* Wiping the history while leaving today marked complete produces a state
       that contradicts itself: the record says nothing was played and the game
       still refuses to let you play it. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* To a real boundary, not a character count: a comment added above the
       code under test used to push it out of a fixed window. */
    const fn = js.slice(js.indexOf('on("adminReset"'), js.indexOf('function loadReports'));
    /* The handler clears WIPE_KEYS rather than naming keys itself, so this
       checks the list is used and the list carries the saved games. Naming them
       here as well would mean two lists to keep in step, which is the fault
       this replaced. */
    const list = /var WIPE_KEYS = \[([\s\S]*?)\];/.exec(js);
    return /WIPE_KEYS\.forEach/.test(fn) && list &&
      ["fcw.results.v1", "fcw.v04.daily", "fcw.v04.practice", "fcw.v04.theme"]
        .every((k) => list[1].includes(k));
  })());
  t("and replay still touches only the one day", (() => {
    // The two must stay distinct, or there is no way to redo a single day.
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    // Boundary, not character count — see the note on adminReset above.
    const fn = js.slice(js.indexOf('on("adminReplay"'), js.indexOf('on("adminReset"'));
    return /r\.dailyNo !== no/.test(fn) && !/removeItem\(RESULTS_KEY\)/.test(fn);
  })());

  t("a server refusal is not reported as a lost connection", (() => {
    /* Previewing another day returns 403 from check-answer, and the verify path
       used to treat any failure as offline — so the game claimed there was no
       connection while the network was perfectly fine. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* Anchor on the catch, not on "delete verifySent" — there is an earlier
       one in the same function and the slice landed on the wrong occurrence. */
    const at = js.indexOf("delete verifySent[i];       // so it is asked again");
    const fn = js.slice(at, at + 500);
    return at !== -1 && /if \(err && err\.offline\)/.test(fn);
  })());

  t("the analytics beacon is present and does not block the page", (() => {
    /* Checked in the source, not the DOM. It is injected rather than declared,
       and only on the production hostname: a <script src> tag runs wherever the
       page is opened, and in jsdom the incomplete Performance API made the
       beacon throw during boot — indistinguishable, to the suite, from one of
       our own errors.
       defer still, so it never delays the board appearing. */
    return /static\.cloudflareinsights\.com\/beacon\.min\.js/.test(html) &&
      /s\.defer = true;/.test(html);
  })());
  t("and it does not run anywhere but the real site", (() => {
    /* Not in the test DOM, and not from 127.0.0.1 during the browser checks,
       where the request is cross-origin and fails noisily for no benefit. */
    /* The guard is a list of production hosts, not one host: when the game
       moved under www.thexigames.com the single-host guard stopped being
       true anywhere a visitor lands and the beacon went quiet unnoticed. */
    return /HOSTS\.indexOf\(location\.hostname\) === -1\) return;/.test(html) &&
      /"www\.thexigames\.com"/.test(html) &&
      !d.querySelector('script[src*="cloudflareinsights"]');
  })());
  t("it carries no cookie and no identifier of ours", (() => {
    // Nothing to consent to, and nothing to put in a privacy policy.
    return !html.includes("gtag") && !html.includes("google-analytics") &&
      !/document\.cookie/.test(fs.readFileSync(path.join(DIR, "js/game.js"), "utf8"));
  })());

  t("the word separator is visible in both themes", (() => {
    /* It was 2.23:1 in light and 1.14:1 in dark — no line at all on a dark
       screen. It carries information: AFC | BOURNEMOUTH is a different answer
       from AFCBOURNEMOUTH, and the enumeration only says so if you read it. */
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "");
    /* Light is the brand green by reference now — var(--pitch) is #1E6B45 in
       shared/xi-tokens.css — and dark keeps its own pale value, because the
       shared --pitch in dark is a surface and would vanish as a hairline. */
    return /--wordbreak:var\(--pitch\)/.test(flat) && /--wordbreak:#9DB3A6/.test(flat) &&
      /\.cell\.brk-r\{border-right:3px/.test(flat);
  })());

  console.log("\nSharing a result");
  t("a practice result links to that exact puzzle, so it can be beaten", (() => {
    /* Each practice puzzle has a token and the API can serve that one, so
       "beat this" is a real invitation. The daily needs no link — everybody
       gets the same puzzle. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function shareLink/.test(js) && /SHARE_URL \+ "\/\?p=" \+ m\[1\]/.test(js) &&
      /Beat it: /.test(js);
  })());
  t("and following that link opens the puzzle, not a menu", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* sharedToken is gone: one `board` value carries the token now, and
       openBoard is the only writer. The property is the same — a ?p= link
       opens the puzzle it names rather than falling through to the menu. */
    return /\[\?&\]p=\(\\d\+\)/.test(js) &&
      /openBoard\(\{ kind: "practice", token: "practice:"/.test(js);
  })());
  t("the shared line claims nothing untrue about football", (() => {
    /* "Arsenal finished 3rd in 2020/21" reads as a statement about a real
       season, and it is not one — the table is history with your score dropped
       into it. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function shareText"), js.indexOf("function shareFallback"));
    return !/season\.season/.test(fn) && !/finished " \+/.test(fn);
  })());
  t("the share carries a link, which is the point of sharing", (() => {
    /* The old text had none: somebody read "Arsenal finished 1st, 106/114" and
       had no way to reach the game. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /SHARE_URL = "https:\/\/crossword\.thexigames\.com"/.test(js) &&
      /var invite = board\.kind === "daily" \? SHARE_URL/.test(js) &&
      /name \+ "\\n" \+ line \+ "\\n" \+ invite/.test(js);
  })());
  t("and a picture that gives nothing away", (() => {
    /* Ten squares: how much of the 114 was kept. Recognisable at a glance,
       spoils no answer, and claims nothing.
       It was drawn from seasonRecord() — the invented 38-game split — until
       that came out. This asserts the picture is built from the SCORE and its
       one published maximum, so a share cannot go back to describing a season
       that was never played. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function shareStrip"), js.indexOf("function shareResult"))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    /* Comments stripped: the function's own comment explains what the season
       strip WAS, and this check refuses the word "season" in it. Third time
       today that a grep was satisfied — or failed — by prose rather than code.
       See the note beside the same fix in play_test.mjs. */
    return fn.length > 100 &&
      /FCW\.SCORING\.MAX_SCORE/.test(fn) &&
      !/season/i.test(fn);
  })());
  /* STILL THIS GAME'S, because the TEXT is: a crossword result is written
     here and must be safe to read before playing. The slice used to end at
     "function shareFallback", which moved to the shared row — and indexOf
     returning -1 does not fail, it slices to one character from the end and
     scans most of the file. Anchored on the next function declaration
     instead, so it reads shareText and only shareText. */
  t("no answer or clue text can reach the clipboard", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const at = js.indexOf("function shareText");
    const end = js.indexOf("\n  function ", at + 10);
    const fn = js.slice(at, end > -1 ? end : undefined);
    return at > -1 && end > at && fn.length < 4000 &&
      !/\.grid|\.answer|clueText|entries\[/.test(fn);
  })(), "a shared result must be safe to read before playing");
  /* THE SHEET AND THE NAMED BUTTONS MOVED WITH THE ROW. They were this
     game's alone while the other three had share text and nowhere to send
     it; shared/xi-share.js owns them now and tools/share_test.mjs checks
     them for all four. What is left to check HERE is that this game asks for
     the shared row and keeps no second copy of it. */
  t("it mounts the family's share row rather than keeping its own", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
    return /XIShare\.mount\(/.test(js) && /id="shareRow"/.test(html) &&
      !/wa\.me|twitter\.com\/intent|reddit\.com\/submit/.test(js);
  })(), "see tools/share_test.mjs for what the row itself must do");

  console.log("\nThe new home");
  t("no active code path names the old hostname", (() => {
    /* crosswordxi.com 301s to the subdomain. A redirected fetch carrying a CORS
       preflight fails in a way that is hard to diagnose — the URL looks right in
       the network tab — so an absolute self-reference must not survive. */
    /* seasons.js moved to shared/xi-seasons.js on 5 Sep when four more games
       wanted the league table. The sweep follows it rather than being
       deleted with the path, and takes in the shared table with it. */
    const files = ["index.html", "js/game.js", "js/engine.js",
      "../../shared/xi-seasons.js", "../../shared/xi-table.js"];
    return files.every((f) => {
      const src = fs.readFileSync(path.join(DIR, f), "utf8")
        .replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      return !/crosswordxi\.com/.test(src);
    });
  })());
  /* HOME is one constant for both of the checks below.

     They asserted crossword.thexigames.com, which was right while the game
     lived on a subdomain and became wrong the moment it moved to a path — the
     two failed on correct behaviour, which is the least useful way for a test
     to fail. The address is one fact; it belongs in one place, so the next
     move changes a line rather than hunting assertions. */
  const HOME = "https://www.thexigames.com/football/crossword/";
  t("the page says which address is canonical", (() => {
    const link = d.querySelector('link[rel="canonical"]');
    return !!link && link.getAttribute("href") === HOME;
  })(), d.querySelector('link[rel="canonical"]') &&
        d.querySelector('link[rel="canonical"]').getAttribute("href"));
  t("a shared link previews as something other than a grey box", (() => {
    const need = ["og:type", "og:url", "og:title", "og:description", "og:site_name"];
    return need.every((prop) => !!d.querySelector(`meta[property="${prop}"]`)) &&
      !!d.querySelector('meta[name="twitter:card"]');
  })());
  t("the preview points at the same address the page claims", (() => {
    const url = d.querySelector('meta[property="og:url"]');
    return !!url && url.getAttribute("content") === HOME;
  })(), HOME);

  console.log("\nPre-season");
  t("pre-season runs to the boundary, then the season starts", (() => {
    /* Read from PRESEASON_DAYS rather than restating it. This hardcoded 28 in
       three places and broke the moment pre-season was shortened to ten — the
       failure read as "the season starts in the wrong place" when the code was
       right and the fixture was stale, which is the same shape as the epoch
       copy in save_test.mjs.

       The property being tested is the boundary, not the number: the last
       pre-season day does not count, the next one is Matchday 1, and the
       numbering restarts there. */
    const n = w.FCW.PRESEASON_DAYS;
    const a = w.FCW.dailyPhase(1), b = w.FCW.dailyPhase(n), c = w.FCW.dailyPhase(n + 1);
    /* Three phases now, not two. The day after pre-season used to be Matchday
       1 automatically, which committed to a season before there was any
       evidence anyone would play thirty-eight — so the daily runs on its own
       until SEASON_START is set, and only then does a matchday exist.

       What is tested is still the boundary: pre-season ends where it says it
       does, and the next day is a fresh run that does not count toward a
       season. Whether that day is "Daily #1" or "Matchday 1" depends on
       SEASON_START, so both are accepted. */
    const started = w.FCW.SEASON_START !== null && w.FCW.SEASON_START <= n + 1;
    /* Tested on phase and number, not on the words.

       The labels have now changed twice — once when the third phase arrived,
       and again when the numbers came out of them, because a count that only
       goes up tells a newcomer they are late. Both times the boundary was
       right and the assertion was quoting a string.

       What has to hold: pre-season ends where PRESEASON_DAYS says, neither
       side of it counts toward a season until SEASON_START, and the day after
       pre-season is the first of a fresh run. */
    return a.phase === "preseason" && a.number === 1 && a.counts === false &&
      b.phase === "preseason" && b.number === n && b.counts === false &&
      c.phase !== "preseason" && c.number === 1 &&
      c.counts === started;
  })(), w.FCW.PRESEASON_DAYS + " friendlies, then " + w.FCW.dailyPhase(w.FCW.PRESEASON_DAYS + 1).label);
  t("a friendly is recorded, but to its own record", (() => {
    /* Was: friendlies were discarded. A friendly is still a match, and a
       pre-season streak is a real thing to build — what matters is that the
       season table starts empty for everyone on Matchday 1, not that August
       is thrown away. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const rec = js.slice(js.indexOf("function recordDaily"), js.indexOf("function recordDaily") + 900);
    return /phase: phase\.phase/.test(js) && !/return loadResults\(\);/.test(rec);
  })());
  t("the two records never mix", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /FCW\.splitByPhase/.test(js) && /function phaseResults/.test(js);
  })());
  t("older results without a phase are still placed correctly", (() => {
    /* Records written before the field existed fall back to their daily number.

       Asserted as "not pre-season" rather than "season": there are three phases
       now and a daily played before a season starts reports "daily". What has
       to hold is that an old record lands on the right side of the friendly
       boundary, which is the line splitByPhase actually uses.

       Read off PRESEASON_DAYS rather than a literal. This asked about board 5
       and passed only while pre-season ran to ten; with one friendly day, board
       5 is a daily and the assertion failed on correct behaviour. The boundary
       is a constant and the test should ask the constant. */
    const late = w.FCW.resultPhase({ dailyNo: w.FCW.PRESEASON_DAYS + 30 });
    return w.FCW.resultPhase({ dailyNo: 1 }) === "preseason" &&
      late !== "preseason" &&
      w.FCW.resultPhase({ dailyNo: 5, phase: "season" }) === "season";
  })());
  t("the friendlies stay visible once the season starts", (() => {
    /* A run built through August vanishing on Matchday 1 would read as a bug,
       however correct the season table is. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return !!d.getElementById("statsPreNote") && /Pre-season: /.test(js);
  })());
  t("the header says which phase it is, not a raw number", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* `dailyNo` is no longer a variable — it survives only as a record field.
       Six functions each held their own idea of which board was in play; there
       is one `board` value and one writer now, so the header asks
       dailyPhase(board.no).

       The property is unchanged: the header names the phase rather than
       printing a number, because a count that only goes up tells a newcomer
       they are late. */
    return !/"Daily #" \+ /.test(js) &&
      /FCW\.dailyPhase\(board\.no\)\.label/.test(js);
  })());
  t("the stored sequence is unbroken, so nothing about generation changes", (() => {
    /* Pre-season uses stored days 1..PRESEASON_DAYS, not a second set — so
       matchday numbering is an offset from the boundary and the stored day
       keeps counting through it. Written from the constant, because the numbers
       29 and 148 were only ever true while pre-season was 28 days. */
    const n = w.FCW.PRESEASON_DAYS;
    return w.FCW.dailyPhase(n + 1).number === 1 &&
      w.FCW.dailyPhase(n + 120).number === 120;
  })(), "boundary at " + w.FCW.PRESEASON_DAYS);

  console.log("\nA save belongs to a puzzle, not an address");
  t("the save records what the puzzle actually is", (() => {
    /* A daily number or a practice token names a slot. The contents of that
       slot change — a regenerated daily, a re-imported pool — and letters are
       stored by cell position, so they land on unrelated squares. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function puzzleFingerprint/.test(js) &&
      /fingerprint: puzzleFingerprint\(puzzle\)/.test(js);
  })());
  t("a save from a changed puzzle is discarded, not applied", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /restore\.fingerprint !== puzzleFingerprint\(puzzle\)/.test(js) &&
      /restore = null/.test(js);
  })());
  t("and the player is told rather than left with a half-filled grid", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /This puzzle has changed/.test(js);
  })());
  t("the fingerprint distinguishes a rebuilt puzzle at the same address", (() => {
    const fp = (p) => p.width + "x" + p.height + ":" + p.entries.map((e) => e.row.id).join(",");
    const a = { width: 11, height: 13, entries: [{ row: { id: "001" } }, { row: { id: "042" } }] };
    const b = { width: 11, height: 13, entries: [{ row: { id: "001" } }, { row: { id: "099" } }] };
    return fp(a) !== fp(b);
  })());

  console.log("\nThe clue card");
  t("empty answer slots are visible against the page", (() => {
    /* They were dashed in --line, a divider colour at 1.26:1 against paper —
       present but invisible, so the enumeration read as blank space. */
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return /--slot:#A9B4A4/.test(flat) && /--slot:#6B7A66/.test(flat) &&
      /\.bank-cell\.empty\{[^}]*border-color:var\(--slot\)/.test(flat);
  })());
  t("a long clue is scaled to fit rather than clipped", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return /classList\.toggle\("long"/.test(js) && /classList\.toggle\("xlong"/.test(js) &&
      /\.nc-text\.long\{font-size/.test(flat) && /\.nc-text\.xlong\{font-size/.test(flat);
  })());
  t("scaling is by lines at this width, not by a fixed character count", (() => {
    /* A 76-character clue is one line on a desktop card and three on a 390px
       phone. A character threshold therefore protects the wrong screen — it let
       exactly that clue push the answer boxes out of the card on an iPhone
       while scaling nothing.
       Four steps now, not three: capping the strip to the board width made four
       lines reachable on a desktop, and a clue that reached them was sliced in
       half by the bottom of the fixed-height card. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /Math\.ceil\(text\.length \/ Math\.max\(12, Math\.floor\(cardW \/ 8\)\)\)/.test(js) &&
      /lines === 2/.test(js) && /lines === 3/.test(js) && /lines >= 4/.test(js);
  })());
  /* Scaled once at selection and never again: the size was chosen for the width
     the card had at that moment. Zoom, rotate or open the keyboard and the card
     changes width while the text keeps its old size — and the card is a fixed
     height with nowhere to put the difference. Zoomed in, four lines spilled
     over the answer boxes; zoomed out, the last line was sliced in half. */
  /* fitCells sets --cell, the grid gets taller, and an observer watching the
     panel fires again — "ResizeObserver loop completed with undelivered
     notifications", which is what rotating a tablet produced. Width is an input
     to the fit; height is its output and must not feed back in. */
  t("the fit observer cannot feed its own output back into itself", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const blk = js.slice(js.indexOf("fitObserver = new ResizeObserver"),
                         js.indexOf("fitObserver.observe(panel)"));
    return /contentRect\.width/.test(blk) &&
      /if \(w === lastPanelW\) return;/.test(blk) &&
      /requestAnimationFrame/.test(blk);
  })());

  t("the clue is re-scaled when the viewport changes, not only when selected", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* Matched loosely on purpose: the point is that every handler which
       re-fits the board also re-fits the words, not that they are written in
       any particular way. */
    if (!/function scaleClue\(\)/.test(js)) return false;
    const handlers = js.match(/addEventListener\("(resize|scroll)"[\s\S]{0,120}?\}\)/g) || [];
    const fitters = handlers.filter((h) => /fitCells\(\)/.test(h));
    return fitters.length > 0 && fitters.every((h) => /scaleClue\(\)/.test(h));
  })());
  /* The keyboard changes the visual viewport without firing resize on iOS,
     which is the case the board already handles and the words did not. */
  t("including the visual viewport, which the keyboard moves", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* Two shapes are acceptable: a handler that calls scaleClue itself, or
       one that passes relayout — which includes it. The old version demanded
       the literal call in every handler's text, which is testing the shape
       of the code rather than the property; the resize path now routes
       through relayout by reference and is MORE complete, not less. */
    /* Comments stripped before matching: the character-window test was
       tripped by a comment growing inside relayout, which is testing prose
       length, not the property. */
    const bare = js.replace(/\/\*[\s\S]*?\*\//g, "");
    const scroll = /visualViewport\.addEventListener\("scroll"[\s\S]{0,120}?scaleClue\(\)/.test(bare);
    const resize = /visualViewport\.addEventListener\("resize", relayout\)/.test(bare) &&
      /function relayout\(\)[\s\S]{0,300}scaleClue\(\)/.test(bare);
    return scroll && resize;
  })());
  t("button labels cannot be drawn on top of each other", (() => {
    /* min-width:0 let a button shrink below its own label while the label
       stayed put: "MENUODAY'S PULEW PUZZLE". */
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "");
    return /\.grid-panel > \.tb-game \.tb-controls \.btn\{[^}]*min-width:74px/.test(flat) &&
      /\.grid-panel > \.tb-game \.tb-controls \.btn\{[^}]*overflow:hidden/.test(flat) &&
      /\.grid-panel > \.tb-game \.tb-controls \.lbl-short\{display:inline\}/.test(flat);
  })());

  t("and still never measures the text itself", (() => {
    /* The width read is the card's, which does not depend on the clue — so the
       same clue at the same width always renders the same way. Measuring the
       text would make it depend on what came before. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const at = js.indexOf("el.textContent = text");
    return !/scrollHeight|getBoundingClientRect/.test(js.slice(at, at + 500));
  })());
  t("the card height still never changes between clues", (() => {
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return /\.now-clue\{[^}]*height:96px/.test(flat) && !/\.now-clue\{[^}]*height:auto/.test(flat);
  })());

  console.log("\nA clamped board keeps its life");
  t("an adopted board reloads its own save, not a blank second copy", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return /adoptServerBoard\(res\.dailyNo\);\s*if \(!restore\) restore = readSlot\("daily"\)/.test(js);
  })(), "finish at 11pm, return past midnight, get your finished board back");
  t("and the trusted clock counts the server's day, so the ask is right to begin with", (() => {
    const eng = fs.readFileSync(path.join(DIR, "js/engine.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return /timeSource === "server"[\s\S]{0,300}getUTCFullYear/.test(eng);
  })());

  console.log("\nThe answers window reaches the client from the payload");
  t("game.js holds no copy of the seven — it reads the payload field", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const stripped = js.replace(/\/\*[\s\S]*?\*\//g, "");
    return /res\.answersAfter/.test(stripped) &&
           !/answersAfterDays\s*=\s*7/.test(stripped);
  })(), "the constant lives in _lib/daily.js and rides in on /api/daily");
  t("a seen payload is remembered for next boot", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /localStorage\.setItem\(ANSWERS_AFTER_KEY/.test(js) &&
           /localStorage\.getItem\(ANSWERS_AFTER_KEY\)/.test(js);
  })());
  t("until one has been seen, nothing is badged", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function answersPublished"), js.indexOf("function adoptServerBoard"));
    return /answersAfterDays != null/.test(fn);
  })(), "no payload, no guessing");
  t("the strap links a published board's answers", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /answersPublished\(board\.no\)/.test(js) && /strap-ans/.test(js) &&
           /href="answers\//.test(js);
  })());
  t("and the calendar badges them", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const cal = js.slice(js.indexOf("function renderCalendar"));
    return /answersPublished\(no\)/.test(cal) && /cal-ans/.test(cal);
  })());

  console.log("\nPausing is recorded, not forbidden");
  t("hiding blurs the puzzle, so it buys no thinking time", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function pauseGame"), js.indexOf("function resumeGame"));
    return /classList\.add\("prestart"\)/.test(fn);
  })());
  /* This used to require stopTimer() inside pauseGame — the local clock
     freeze. That freeze was one of three contradictory statements about
     pausing: the page said the clock never pauses, the button said pressing
     it stops the clock, and the server scored wall time regardless, so a
     paused player watched a score that verification then took back with no
     explanation anywhere. The rule is now the one the page always stated:
     the clock does not stop, for anything. Hiding remains, and is recorded. */
  t("and the clock genuinely does not stop for it", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function pauseGame"), js.indexOf("function resumeGame"));
    return !/stopTimer\(\)/.test(fn);
  })(), "how-to-play, the button and the verified score now agree");
  t("a pause is counted and its duration measured", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /pauseCount\+\+/.test(js) && /pausedMs \+= Date\.now\(\) - pauseStartedAt/.test(js);
  })());
  t("both survive a refresh, including a pause still open", (() => {
    /* Without the open-pause term, refreshing mid-pause would erase it — the
       one moment a player is most likely to reload. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /pausedMs \+ \(pauseStartedAt \? Date\.now\(\) - pauseStartedAt : 0\)/.test(js) &&
      /pauseCount = restore\.pauseCount/.test(js);
  })());
  t("they reach the stored result", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const rec = js.slice(js.indexOf("function recordDaily"), js.indexOf("function showPauseNote"));
    return /pauses: pauseCount/.test(rec) && /pausedSeconds:/.test(rec);
  })());
  t("and are stated on the Full Time card rather than recorded silently", (() => {
    const el = d.getElementById("rPauseNote");
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return !!el && /Clock stopped /.test(js);
  })());
  t("a run with no pauses says nothing at all", (() => {
    const el = d.getElementById("rPauseNote");
    return el.style.display === "none";
  })());

  console.log("\nLosing the connection");
  /* Actually cut the connection rather than assert on source. */
  const realFetch = w.fetch;
  /* Check refuses on an unstarted game or an empty entry, so set both up
     before cutting the connection. */
  if (d.querySelector(".stage").classList.contains("prestart")) {
    $("kickOffBtn").dispatchEvent(new w.Event("click", { bubbles: true }));
    await wait(300);
  }
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "A", bubbles: true }));
  await wait(300);
  w.fetch = () => Promise.reject(new Error("network down"));
  $("checkBtn").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(900);
  t("a dropped request marks the game offline and tells the player", (() => {
    return d.body.classList.contains("offline") &&
      /connection/i.test(d.getElementById("netStrip").textContent);
  })(), d.getElementById("netStrip").textContent);
  w.fetch = realFetch;
  w.dispatchEvent(new w.Event("online"));
  await wait(900);
  t("reconnecting clears the notice and re-checks what was missed",
    !d.body.classList.contains("offline"),
    d.getElementById("netStrip").textContent || "(cleared)");
  t("the offline notice exists and is hidden until needed", (() => {
    const strip = d.getElementById("netStrip");
    return !!strip && !d.body.classList.contains("offline");
  })());
  t("verification retries by itself rather than waiting for a keystroke", (() => {
    /* The failure path used to clear the retry marker and stop. If the grid was
       finished while offline, nothing re-checked on reconnect and the puzzle
       never completed. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /addEventListener\("online"/.test(js) &&
      /function scheduleRetry/.test(js) &&
      /setInterval/.test(js.slice(js.indexOf("function scheduleRetry"), js.indexOf("var verifyTimer")));
  })());
  t("coming back online triggers a catch-up, not just a cleared flag", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const setOff = js.slice(js.indexOf("function setOffline"), js.indexOf("window.addEventListener(\"online\""));
    return /if \(!state\) verifyNow\(\)/.test(setOff);
  })());
  t("a dropped request is trusted over the browser's own online flag", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    // navigator.onLine reports a connected wifi with no route out as online.
    return /setOffline\(true\)/.test(js) && !/navigator\.onLine/.test(js);
  })());
  t("the notice cannot shift the board", (() => {
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return /\.net-strip\{display:none;position:fixed/.test(flat);
  })());

  console.log("\nA failed action costs nothing");
  t("every paid action charges inside the success path, not beside it", (() => {
    /* Reveals and checks are server calls. The penalty used to be applied
       outside the promise, so a request that failed — a stale token after the
       practice pool was rebuilt, a dropped connection — still cost the points
       and filled in nothing. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* Sliced to the next handler, not to a fixed character count.

       This took js.slice(start, start + 1600), which worked until a comment
       was added inside the handler and pushed .catch( past the 1600th
       character. The test then failed while the code was correct — a window
       measured in characters is a window that closes when anyone writes
       anything.

       subBtn appears earlier in the file than revealBtn, which is why the
       original could not simply slice between the two. Slicing to whichever
       on(...) comes next avoids both problems. */
    const start = js.indexOf('on("revealBtn"');
    const nextOn = js.indexOf('\n  on("', start + 10);
    const reveal = js.slice(start, nextOn > start ? nextOn : start + 4000);
    // The charge must appear after .then( and before the .catch(
    const then = reveal.indexOf(".then(");
    const cat = reveal.indexOf(".catch(");
    const charge = reveal.indexOf('helpActions.push("revealAnswer")');
    return then > -1 && cat > then && charge > then && charge < cat;
  })());
  t("a failed reveal explains itself instead of silently costing points", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function revealFailed/.test(js) &&
      /nothing charged/.test(js) && /has expired/.test(js);
  })());
  t("a spent substitution is only spent when a letter arrives", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const subStart = js.indexOf('on("subBtn"');
    const sub = js.slice(subStart, subStart + 1400);
    return sub.indexOf("subsUsed++") > sub.indexOf("}, function ()");
  })());

  console.log("\nRefreshing does not change what you are playing");
  t("boot chooses nothing at all", (() => {
    /* Both older rules are gone. The first resumed practice only if letters
       existed and the daily was finished; the second remembered the last mode.
       Both were guesses, and a wrong guess started the daily's clock on a game
       the player had not chosen. Now it asks. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    /* To the end of the function, not a character count. This window has now
       been widened twice by things added above the code under test — a shared
       practice link, then a themed one — and each time the check failed on
       code that had not changed. boot() is the last thing before the server
       date sync, so that is the boundary. */
    const at = js.indexOf("function boot()");
    const boot = js.slice(at, js.indexOf("syncServerDate(function", at));
    /* The rule has changed and the reason it existed has not.

       Boot still chooses no MODE. What it now does is reopen a PUZZLE that is
       already under way — unfinished, and for the daily, today's. The letters
       are on disk and the clock has been running against it, so that is not a
       guess about what somebody wants.

       Both old guesses stay banned: bootDaily() started the daily outright,
       and remembering a mode alone would start a fresh puzzle. The guard for
       the second is now the inProgress + dailyNo test rather than the absence
       of the string, because the string is legitimately back. */
    /* Boot still chooses no MODE. What it reopens is a PUZZLE already under
       way — and since the archive opened, that includes a board from an
       earlier day. The old rule required saved.dailyNo === dailyNumber(),
       which meant an unfinished archive board could never resume: boot refused
       it, showed the menu, and the menu set fcw.athome, so the next reload
       refused it for a second reason.

       The worry behind the old rule stands and is handled: chooseMode("daily")
       starts a FRESH puzzle when the save is not today's, which would put the
       clock on a board nobody picked. dailyWanted names the board in the save,
       so it reopens that one. */
    /* Boot still chooses no MODE, and still reopens only a puzzle already
       under way. What changed is how it names the board: dailyWanted is gone,
       and every route now goes through chooseMode(kind, target) with the board
       stated explicitly rather than left in a variable for somebody else to
       read. */
    return /renderHome\(\)/.test(boot) && !/bootDaily\(\)/.test(boot) &&
      /inProgress\(saved\)/.test(boot) &&
      /chooseMode\("daily", \{ kind: "daily", no: no/.test(boot);
  })());
  t("choosing a mode is what starts anything", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function chooseMode/.test(js) &&
      /on\("homeDaily", "click"/.test(js) && /on\("homePrevious", "click"/.test(js);
  })());
  t("leaving a daily for the menu stops its clock", (() => {
    /* Otherwise the timer runs on a puzzle nobody can see, which is the same
       fault as before wearing different clothes. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf('on("menuBtn"'), js.indexOf('on("menuBtn"') + 500);
    return /pauseGame\(\)/.test(fn);
  })());
  t("and there is a way back to the choice from inside a game", (() => {
    return !!d.getElementById("menuBtn") && !!d.getElementById("kickBack");
  })());

  console.log("\nWhat's live");
  t("the build badge is a button that opens the status panel", (() => {
    const badge = d.getElementById("buildBadge");
    return !!badge && badge.tagName === "BUTTON" && badge.textContent === w.CROSSWORDXI_BUILD;
  })(), d.getElementById("buildBadge") && d.getElementById("buildBadge").textContent);
  t("the panel opens and closes", (() => {
    const sheet = d.getElementById("statusSheet");
    $("buildBadge").dispatchEvent(new w.Event("click", { bubbles: true }));
    const opened = sheet.classList.contains("show");
    $("statusClose").dispatchEvent(new w.Event("click", { bubbles: true }));
    return opened && !sheet.classList.contains("show");
  })());
  $("buildBadge").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(500);   // the panel fills from /api/status
  t("it reports the build and where the puzzles came from", (() => {
    const rows = d.getElementById("statusBody").textContent;
    return rows.indexOf(w.CROSSWORDXI_BUILD) !== -1 && /D1|development/i.test(rows);
  })(), d.getElementById("statusBody").textContent.replace(/\s+/g, " ").slice(0, 80));
  $("statusClose").dispatchEvent(new w.Event("click", { bubbles: true }));

  console.log("\nLayout does not drift when the clue changes");
  /* Nothing may size the stage from a value fitCells publishes. fitCells
     measures .grid-panel, which takes its width from .stage — so a stage sized
     from --board-w means the board is sized from itself. The browser reported
     it as "ResizeObserver loop completed with undelivered notifications",
     seven times, on a tablet in landscape. */
  t("no rule sizes the stage from the width the board publishes", (() => {
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "");
    return !/\.stage\{[^}]*var\(--board-w/.test(flat);
  })());

  t("the board width is calculated, never measured", (() => {
    /* offsetWidth reads the board as currently painted, and the read happened
       immediately after --cell changed — so it returned the previous size and
       the block landed a step behind. Selecting a clue re-ran it and the whole
       rail and board slid sideways inside a clue strip that had not moved.
       The width is built from frameCols, which is MAX_COLS on a wide screen —
       so the pitch is the same size whichever board is loaded, and everything
       below lines up with it. Below 900px it is the puzzle's own width again:
       sizing a ten-column board for fourteen on a phone cost a third of the
       cell size for turf there was no room to show. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    // Strip comments first: the comment explaining this fix mentions
    // offsetWidth, and matching prose rather than code fails on its own note.
    const fit = js.slice(js.indexOf("function fitCells"), js.indexOf("var lastCellSize"))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    return !/offsetWidth/.test(fit) &&
      /frameCols \* size \+ wrapPadX/.test(fit);
      /* --block-w is gone with the rail: it was the rail plus the board, the
         width the clue strip had to span to finish level with the pair. One
         column, so the board's own width is the only measure there is. */
  })());
  t("the same puzzle at the same size gives the same widths every time", (() => {
    const root = d.documentElement;
    const before = [root.style.getPropertyValue("--board-w"), root.style.getPropertyValue("--block-w")];
    // Change clue several times: none of it should touch the geometry.
    for (const id of ["nextClue", "prevClue", "nextClue"]) {
      $(id).dispatchEvent(new w.Event("click", { bubbles: true }));
    }
    const after = [root.style.getPropertyValue("--board-w"), root.style.getPropertyValue("--block-w")];
    return before[0] === after[0] && before[1] === after[1];
  })(), d.documentElement.style.getPropertyValue("--board-w") || "(unset in jsdom)");

  console.log("\nNothing moves the page when a button is pressed");
  /* It used to sit inside the board, positioned over it — which put the message
     on top of the squares it was describing whenever the grid reached the
     bottom of the pitch. It is below the board now, in a row whose height is
     always reserved: the reason it was moved out of the flow in the first place
     was that it grew from nothing to 35px and shifted the page under a moving
     finger, and a permanent row prevents both faults at once. */
  t("the nudge is below the board, in a row of its own", (() => {
    const nudge = $("gridNudge");
    return !!nudge && nudge.parentNode.className.indexOf("nudge-row") !== -1 &&
      !$("grid").contains(nudge);
  })());
  t("the nudge is taken out of the flow, so showing it shifts nothing", (() => {
    /* It used to toggle display none/block — no height to ~35px — on every
       Check, every Check All, and twice per New Puzzle. On touch that can move
       a control out from under a finger between press and release. */
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "");
    /* The row holds the space whether or not there is a message in it, so only
       the contents change and nothing below can move. */
    return /\.nudge-row\{[^}]*min-height:\d+px/.test(flat) &&
      /\.nudge\{[^}]*visibility:hidden/.test(flat) &&
      !/\.nudge\{[^}]*display:none/.test(flat) &&
      /\.nudge\.show\{opacity:1;visibility:visible\}/.test(flat);
  })());
  t("it cannot swallow a tap aimed at the board",
    /\.nudge\{[^}]*pointer-events:none/.test(
      fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "")));
  t("showing and hiding it leaves everything else where it was", (() => {
    /* jsdom has no layout, so this checks the structural precondition: the row
       is always present with its height reserved, and only the message inside
       it is shown or hidden. Nothing is added to or removed from the flow. */
    const row = d.querySelector(".nudge-row");
    const nudge = $("gridNudge");
    const before = row.childElementCount;
    nudge.classList.add("show");
    nudge.textContent = "Six letters are wrong";
    const during = row.childElementCount;
    nudge.classList.remove("show");
    return before === during && row.contains(nudge) && row.childElementCount === before;
  })());

  console.log("\nAccounts stay out of the way");
  t("no sign-in wall: the board is playable without an account", (() => {
    // The whole point of Phase 1 — a guest must reach the puzzle untouched.
    return d.querySelectorAll("#grid .cell").length > 50 &&
      !d.querySelector(".xic-sheet:not([hidden])");
  })());
  t("the account sheet only opens when asked for, and it is the chrome's", (() => {
    /* The chrome builds it on the first ask; pressing the footer control
       asks. It used to be this page's own sheet, opened four ways. */
    if (d.querySelector(".xic-sheet")) return false;
    $("accountToggle").dispatchEvent(new w.Event("click", { bubbles: true }));
    const sheet = d.querySelector(".xic-sheet");
    const opened = !!sheet && !sheet.hidden;
    d.getElementById("xicAcctClose").dispatchEvent(new w.Event("click", { bubbles: true }));
    return opened && sheet.hidden;
  })());
  t("a guest sees the reason to sign up, not a form", (() => {
    const sheet = d.querySelector(".xic-sheet");
    return !sheet.querySelector(".xic-out").hidden && sheet.querySelector(".xic-in").hidden &&
      /streak|form|results/i.test(sheet.querySelector(".xic-why").textContent);
  })());
  t("no password field exists anywhere",
    d.querySelectorAll('input[type=password]').length === 0);
  t("account requests carry the anti-CSRF header", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /"X-Crossword-XI": "1"/.test(js) && /credentials: "same-origin"/.test(js);
  })());
  t("signing out never clears the local results", (() => {
    /* Two places now: the chrome's sign-out, and this game's answer to it. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const on = js.slice(js.indexOf('document.addEventListener("xi:account"'), js.indexOf("function sayAccount"));
    const chrome = fs.readFileSync(path.join(DIR, "..", "..", "shared", "xi-chrome.js"), "utf8");
    const out = chrome.slice(chrome.indexOf("function signOut()"), chrome.indexOf("function saveName()"));
    return !/removeItem|clear\(/.test(on) && !/removeItem|clear\(/.test(out);
  })());

  console.log("\nLandscape tablet: the rail");
  /* The toolbar is gone: its three boxes now sit in the board column in the order
     they are read. Nothing is relocated at runtime, so there is nothing to
     assert about where it moves to — only that it is not there. */
  t("there is no toolbar to relocate; the blocks sit in the column in order", (() => {
    const panel = d.querySelector(".grid-panel");
    const ids = [...panel.children].map((n) => n.id || n.className.split(" ").pop());
    /* The answer boxes sit between the clue and the board now, in a strip of
       their own: inside the clue card they shared a fixed height with the
       sentence, and a long clue spilled over them. */
    return !$("toolbar") &&
      ids.indexOf("nowClue") === 0 &&
      ids.indexOf("bank-strip") === 1 &&
      ids.indexOf("grid-wrap") === 2 &&
      ids.indexOf("tb-game") > ids.indexOf("grid-wrap") &&
      ids.indexOf("tb-help") > ids.indexOf("tb-game") &&
      /* The live table closes the column. It was #seasonPanel until the
         invented 38-game record came out from under it. */
      ids.indexOf("tablePanel") > ids.indexOf("tb-help");
  })(), [...d.querySelector(".grid-panel").children]
    .map((n) => n.id || n.className.split(" ").pop()).join(" > "));

  t("the board is sized from the panel it sits in, which always has a box", (() => {
    /* .grid-panel used to be display:contents in the rail, so it had no box
       and clientWidth was 0 — which is why the board was sized from the
       viewport and a fixed rail width instead. The rail is gone and the panel
       is an ordinary block again, so measuring it is both possible and
       correct: it is the column the board actually lives in. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /availW = panel\.clientWidth - pp\.x - wp\.x/.test(js) &&
      !/pairCap - railW/.test(js);
  })());
  t("the board and its clue strip survive the move", (() => {
    return !!$("nowClue") && !!d.querySelector(".grid-wrap") &&
      d.querySelectorAll("#grid .cell").length > 50 &&
      d.querySelectorAll("#nowClue").length === 1;
  })());

  console.log("\nThe league table lives under the board");
  /* It used to be a banner panel that script relocated below the board on
     phones, so its position was a runtime decision and two sets of CSS had to
     describe it. It is now under the board in the markup at every width — no
     move, nothing to get wrong on resize. */
  t("the league table is inside the board column, after the board", (() => {
    const panel = $("tablePanel");
    const wrap = d.querySelector(".grid-wrap");
    return d.querySelector(".grid-panel").contains(panel) &&
      !$("toolbar") &&
      (wrap.compareDocumentPosition(panel) & 4) !== 0;   // board precedes it
  })());
  /* Every block below the clue strip is capped to the same published width, so
     the column has one edge rather than each element finding its own. */
  /* One measure for the whole column, the clue strip included — it was the
     last block sizing itself to the panel rather than the board, and overhung
     the column on both sides. */
  t("every block in the column is capped to the board's width, clue strip included",
    /\.grid-panel > \.now-clue,[\s\S]{0,160}max-width:var\(--board-w,100%\)/.test(css));
  t("narrowing leaves it exactly where it was", (() => {
    Object.defineProperty(w, "innerWidth", { value: 390, writable: true, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    const panel = $("tablePanel");
    return d.querySelector(".grid-panel").contains(panel) &&
      panel.classList.contains("below-board");
  })());
  t("the table still renders three rows after the move", (() => {
    const rows = [...d.querySelectorAll("#tablePanel #leagueBody tr")];
    return rows.length === 20 && rows.filter((r) => !r.classList.contains("faroff")).length === 3;
  })(), [...d.querySelectorAll("#tablePanel #leagueBody tr")].filter((r) => !r.classList.contains("faroff")).length + " visible");
  /* The table no longer moves at any width: it sits in the board column with
     everything else, so there is nothing to relocate and nothing to get wrong
     on resize. */
  t("and widening leaves it exactly where it is", (() => {
    Object.defineProperty(w, "innerWidth", { value: 1400, writable: true, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    const panel = $("tablePanel");
    return d.querySelector(".grid-panel").contains(panel);
  })());

  console.log("\nSelection still works from the lists below");
  const downNum = d.querySelector("#downList li .cl-num").textContent.trim();
  // Clue list items bind "click"; grid cells bind "pointerdown". Different
  // events for different elements, so the test has to send the right one.
  d.querySelector("#downList li").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(200);
  // Re-query: selecting re-renders the list, so the original element is stale.
  t("clicking a Down clue selects it and updates the active strip", (() => {
    const active = d.querySelector("#downList li.active");
    return !!active && active.querySelector(".cl-num").textContent.trim() === downNum &&
      $("ncMeta").textContent.indexOf(downNum + "D") === 0;
  })(), "meta=" + $("ncMeta").textContent + " clicked=" + downNum);
  $("nextClue").dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(200);
  t("the next-clue arrow still moves the selection",
    !!d.querySelector("#acrossList li.active, #downList li.active"));

  /* Everything above ran with the error collector still attached. An
     exception anywhere in the session — a click handler, a pointer event, a
     timer — lands here, so a fault that throws after boot can no longer hide
     inside a passing suite. This is the check that would have caught v146's
     dead reveals and the pinch handler's drifted pointer count, both of which
     threw after boot and shipped green under the boot-only assertion. */
  t("and no uncaught errors across the whole run", errors.length === 0,
    errors.length ? errors.length + " thrown; first: " + errors[0] : "");

  console.log(`\n${pass} passed, ${fail} failed`);
  dom.window.close();
  server.close();
  process.exit(fail ? 1 : 0);
});
