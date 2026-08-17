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

import { onRequestGet as apiDaily } from "./functions/api/daily.js";
import { onRequestGet as apiPractice } from "./functions/api/practice.js";
import { onRequestGet as apiCategories } from "./functions/api/categories.js";
import { onRequestPost as apiCheck } from "./functions/api/check-answer.js";
import { onRequestPost as apiReveal } from "./functions/api/reveal.js";
import { onRequestGet as apiStatus } from "./functions/api/status.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain" };

const ROUTES = {
  "/api/daily": apiDaily, "/api/practice": apiPractice,
  "/api/categories": apiCategories, "/api/check-answer": apiCheck,
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
  const file = path.join(DIR, rel);
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
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
  t("the club is chosen on the landing screen", (() => {
    /* It applies to both modes and does not change between them, so asking
       again on each kick-off card was asking twice for one answer. */
    const sel = $("homeClubSelect");
    return !!sel && sel.options.length > 20;
  })(), $("homeClubSelect") ? $("homeClubSelect").options.length + " options" : "missing");
  t("the newest season's clubs come first, not all 49 alphabetically", (() => {
    /* Forty-nine in one run means scrolling past Barnsley and Bradford to reach
       the side you support. Grouped from the data, so adding a season moves the
       list on by itself. */
    const groups = [...$("homeClubSelect").querySelectorAll("optgroup")];
    return groups.length === 2 && /Premier League \d{4}\/\d{2}/.test(groups[0].label) &&
      groups[0].children.length === 20;
  })(), [...$("homeClubSelect").querySelectorAll("optgroup")].map((g) => g.label).join(" | "));
  t("both modes are offered as their own target", (() => {
    return !!$("homeDaily") && !!$("homePractice");
  })());
  t("the daily says which phase it is", (() => {
    const title = $("homeDailyTitle").textContent;
    return /friendly|matchday/i.test(title);
  })(), $("homeDailyTitle").textContent);

  $("homeDaily").dispatchEvent(new w.Event("click", { bubbles: true }));
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
  t("the season strip shows all 38 games",
    d.querySelectorAll("#seasonGames .game").length === 38);
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
  t("the vertical flow is header, active clue, board, clues, season", (() => {
    const order = [...d.querySelectorAll("#toolbar, #nowClue, .grid-wrap, #clues, #seasonPanel")]
      .map((n) => n.id || n.className.split(" ")[0]);
    return order.join(">") === "toolbar>nowClue>grid-wrap>clues>seasonPanel";
  })(), [...d.querySelectorAll("#toolbar, #nowClue, .grid-wrap, #clues, #seasonPanel")]
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
  t("the club selector moved into the header beside the league table", (() => {
    const sel = $("clubSelect");
    return sel && $("toolbar").contains(sel) && $("tablePanel").contains(sel) &&
      sel.options.length > 1;
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
      /#seasonPanel\{[^}]*max-width:var\(--board-w/.test(css);
  })());
  t("the content is capped and centred on very wide screens",
    /\.stage\{[^}]*max-width:1140px[^}]*margin:0 auto/.test(css));
  t("the grid is not distorted — cells are square and gapless",
    /\.cell\{[^}]*width:var\(--cell\);height:var\(--cell\)/.test(css) &&
    /\.grid\{[^}]*gap:0/.test(css));
  t("nothing sets a fixed pixel position for layout",
    !/\.(stage|clues|grid-panel)\{[^}]*position:absolute/.test(css));

  console.log("\nTheme and phone header");
  t("theme follows the OS by default and can be overridden", (() => {
    const flat = css.replace(/\s*\n\s*/g, "");
    return /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)/.test(flat) &&
      /:root\[data-theme="dark"\]\{/.test(flat);
  })());
  t("the theme control cycles auto, light and dark, and persists", (() => {
    const btn = $("themeToggle");
    if (!btn) return false;
    const seen = [];
    for (let i = 0; i < 3; i++) {
      btn.dispatchEvent(new w.Event("click", { bubbles: true }));
      seen.push(btn.textContent.replace("theme: ", ""));
    }
    const stored = w.localStorage.getItem("fcw.theme");
    return seen.join(",") === "light,dark,auto" && stored === "auto" &&
      !d.documentElement.hasAttribute("data-theme");
  })(), $("themeToggle") && $("themeToggle").textContent);
  t("forcing light beats the OS dark setting", (() => {
    const btn = $("themeToggle");
    btn.dispatchEvent(new w.Event("click", { bubbles: true }));       // -> light
    const forced = d.documentElement.getAttribute("data-theme");
    for (let i = 0; i < 2; i++) btn.dispatchEvent(new w.Event("click", { bubbles: true }));
    return forced === "light";
  })());
  t("help is a real button, so it stays keyboard reachable", (() => {
    const b = $("helpToggle");
    return !!b && b.tagName === "BUTTON" && b.hasAttribute("aria-expanded") &&
      b.getAttribute("aria-controls") === "helpRow";
  })());
  t("help reads as section plus target, not four loose buttons", (() => {
    /* "All" and "Answer" beside each other gave no clue which was a check and
       which a reveal. Section plus button now reads as one phrase. */
    const rows = [...d.querySelectorAll("#helpRow .tb-row")];
    const label = (r) => r.querySelector(".tb-sub").textContent.trim();
    const btns = (r) => [...r.querySelectorAll("button")].map(
      (b) => b.textContent.replace(/[\u2212-]\d+.*/, "").trim());
    return rows.length === 3 &&
      label(rows[0]) === "Check" && btns(rows[0]).join("/") === "Answer/Grid" &&
      label(rows[1]) === "Reveal" && btns(rows[1]).join("/") === "Letter/Answer";
  })(), [...d.querySelectorAll("#helpRow .tb-row")].map(
    (r) => r.querySelector(".tb-sub").textContent + ": " +
      [...r.querySelectorAll("button")].map((b) => b.id).join(",")).join(" | "));
  t("help collapses on phones only, and is open where there is room",
    /\.tb-help\.collapsed \.tb-row\{display:none\}/.test(css.replace(/\s*\n\s*/g, "")) &&
    !d.querySelector(".tb-help").classList.contains("collapsed"));

  console.log("\nMeasured-defect fixes");
  t("help starts closed on a phone, so the board keeps its height", (() => {
    /* 44px controls added 14px to each of five toolbar rows — 70px, which is
       exactly how far the grid moved down between builds. Cells shrank and the
       board still ended lower, because it started lower. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /var helpOpen = helpFits\(\)/.test(js) && /fcw\.helpOpen/.test(js);
  })());
  t("reopening help re-fits the board rather than waiting for a resize", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const h = js.slice(js.indexOf('on("helpToggle"'), js.indexOf('on("helpToggle"') + 420);
    return /fitCells\(\)/.test(h);
  })());
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
  t("help collapses on narrow tablets too, not just phones", (() => {
    // 744x1133 overflowed its viewport by 6px with three 44px help rows open.
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const css = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8");
    return /innerWidth \|\| 360\) > 760/.test(js) &&
      /@media \(max-width:760px\)/.test(css);
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
  t("and stops being counted as chrome above it", (() => {
    // Counting a toolbar that sits below the board sizes the board for space
    // it actually has.
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /var barAbove = !railMode && !toolbarBelow\(\)/.test(js) &&
      /barAbove \? h\("\.toolbar"\) : 0/.test(js);
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
    const fn = js.slice(js.indexOf('on("adminReset"'), js.indexOf('on("adminReset"') + 700);
    return /removeItem\(RESULTS_KEY\)/.test(fn) &&
      /removeItem\("fcw\.v04\.daily"\)/.test(fn) &&
      /removeItem\("fcw\.v04\.practice"\)/.test(fn);
  })());
  t("and replay still touches only the one day", (() => {
    // The two must stay distinct, or there is no way to redo a single day.
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf('on("adminReplay"'), js.indexOf('on("adminReplay"') + 700);
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
    /* defer, so it never delays the board appearing — a puzzle that loads a
       tenth of a second later to count a visit is a bad trade. */
    const tag = d.querySelector('script[src*="cloudflareinsights"]');
    return !!tag && tag.hasAttribute("defer");
  })());
  t("it carries no cookie and no identifier of ours", (() => {
    // Nothing to consent to, and nothing to put in a privacy policy.
    return !html.includes("gtag") && !html.includes("google-analytics") &&
      !/document\.cookie/.test(fs.readFileSync(path.join(DIR, "js/game.js"), "utf8"));
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
    return /\[\?&\]p=\(\\d\+\)/.test(js) && /sharedToken = "practice:"/.test(js);
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
      /var invite = mode === "daily" \? SHARE_URL/.test(js) &&
      /name \+ "\\n" \+ line \+ "\\n" \+ invite/.test(js);
  })());
  t("and a picture that gives nothing away", (() => {
    // A season of W/D/L. Recognisable at a glance, spoils no answer.
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function shareStrip/.test(js) && /FCW\.seasonRecord/.test(js);
  })());
  t("no answer or clue text can reach the clipboard", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function shareText"), js.indexOf("function shareFallback"));
    return !/\.grid|\.answer|clueText|entries\[/.test(fn);
  })(), "a shared result must be safe to read before playing");
  t("the phone's own share sheet is used where there is one", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /navigator\.share/.test(js) && /shareFallback\(text\)/.test(js);
  })());
  t("with named buttons for desktop, where there is not", (() => {
    return !!d.getElementById("shareWhatsApp") && !!d.getElementById("shareX") &&
      !!d.getElementById("shareReddit");
  })());

  console.log("\nThe new home");
  t("no active code path names the old hostname", (() => {
    /* crosswordxi.com 301s to the subdomain. A redirected fetch carrying a CORS
       preflight fails in a way that is hard to diagnose — the URL looks right in
       the network tab — so an absolute self-reference must not survive. */
    const files = ["index.html", "js/game.js", "js/engine.js", "js/seasons.js"];
    return files.every((f) => {
      const src = fs.readFileSync(path.join(DIR, f), "utf8")
        .replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      return !/crosswordxi\.com/.test(src);
    });
  })());
  t("the page says which address is canonical", (() => {
    const link = d.querySelector('link[rel="canonical"]');
    return !!link && /crossword\.thexigames\.com/.test(link.getAttribute("href"));
  })(), d.querySelector('link[rel="canonical"]') &&
        d.querySelector('link[rel="canonical"]').getAttribute("href"));
  t("a shared link previews as something other than a grey box", (() => {
    const need = ["og:type", "og:url", "og:title", "og:description", "og:site_name"];
    return need.every((prop) => !!d.querySelector(`meta[property="${prop}"]`)) &&
      !!d.querySelector('meta[name="twitter:card"]');
  })());
  t("the preview points at the new hostname, not the old", (() => {
    const url = d.querySelector('meta[property="og:url"]');
    return !!url && /crossword\.thexigames\.com/.test(url.getAttribute("content"));
  })());

  console.log("\nPre-season");
  t("the first four weeks are friendlies, then the season starts", (() => {
    const a = w.FCW.dailyPhase(1), b = w.FCW.dailyPhase(28), c = w.FCW.dailyPhase(29);
    return a.label === "Pre-season friendly #1" && a.counts === false &&
      b.label === "Pre-season friendly #28" && b.counts === false &&
      c.label === "Matchday 1" && c.counts === true;
  })(), w.FCW.dailyPhase(29).label);
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
    // Records written before the field existed fall back to their daily number.
    return w.FCW.resultPhase({ dailyNo: 5 }) === "preseason" &&
      w.FCW.resultPhase({ dailyNo: 40 }) === "season" &&
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
    return !/"Daily #" \+ dailyNo/.test(js) && /FCW\.dailyPhase\(dailyNo\)\.label/.test(js);
  })());
  t("the stored sequence is unbroken, so nothing about generation changes", (() => {
    // Day 29 is Matchday 1: pre-season uses stored days 1-28, not a second set.
    return w.FCW.dailyPhase(29).number === 1 && w.FCW.dailyPhase(148).number === 120;
  })());

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
       while scaling nothing. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /Math\.ceil\(text\.length \/ Math\.max\(12, Math\.floor\(cardW \/ 8\)\)\)/.test(js) &&
      /lines === 2/.test(js) && /lines >= 3/.test(js);
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

  console.log("\nPausing is recorded, not forbidden");
  t("pausing hides the puzzle, so it buys no thinking time", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const fn = js.slice(js.indexOf("function pauseGame"), js.indexOf("function resumeGame"));
    return /classList\.add\("prestart"\)/.test(fn) && /stopTimer\(\)/.test(fn);
  })());
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
    // subBtn is defined earlier in the file than revealBtn, so slicing between
    // them ran backwards. Take a fixed window from the handler instead.
    const start = js.indexOf('on("revealBtn"');
    const reveal = js.slice(start, start + 1600);
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
    /* A wider window: a shared practice link is handled first, so the choice
       now sits further down the function. */
    const at = js.indexOf("function boot()");
    const boot = js.slice(at, at + 1400);
    return /renderHome\(\)/.test(boot) && !/bootDaily\(\)/.test(boot) &&
      !/last === "practice"/.test(boot);
  })());
  t("choosing a mode is what starts anything", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /function chooseMode/.test(js) &&
      /on\("homeDaily", "click"/.test(js) && /on\("homePractice", "click"/.test(js);
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
  t("board and block widths are calculated, never measured", (() => {
    /* offsetWidth reads the board as currently painted, and the read happened
       immediately after --cell changed — so it returned the previous size and
       the block landed a step behind. Selecting a clue re-ran it and the whole
       rail and board slid sideways inside a clue strip that had not moved. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    // Strip comments first: the comment explaining this fix mentions
    // offsetWidth, and matching prose rather than code fails on its own note.
    const fit = js.slice(js.indexOf("function fitCells"), js.indexOf("var lastCellSize"))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    return !/offsetWidth/.test(fit) &&
      /puzzle\.width \* size \+ wrapPadX/.test(fit) &&
      /railW \+ pairGap \+ boardW/.test(fit);
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
  t("the nudge is inside the board, not between it and the clue lists", (() => {
    const nudge = $("gridNudge");
    return !!nudge && nudge.parentNode.className.indexOf("grid-wrap") !== -1;
  })());
  t("the nudge is taken out of the flow, so showing it shifts nothing", (() => {
    /* It used to toggle display none/block — no height to ~35px — on every
       Check, every Check All, and twice per New Puzzle. On touch that can move
       a control out from under a finger between press and release. */
    const flat = fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "");
    return /\.nudge\{[^}]*position:absolute/.test(flat) &&
      /\.nudge\{[^}]*visibility:hidden/.test(flat) &&
      !/\.nudge\{[^}]*display:none/.test(flat) &&
      /\.nudge\.show\{opacity:1;visibility:visible\}/.test(flat);
  })());
  t("it cannot swallow a tap aimed at the board",
    /\.nudge\{[^}]*pointer-events:none/.test(
      fs.readFileSync(path.join(DIR, "css/style.css"), "utf8").replace(/\s*\n\s*/g, "")));
  t("showing and hiding it leaves the board where it was", (() => {
    const wrap = d.querySelector(".grid-wrap");
    const nudge = $("gridNudge");
    const before = wrap.childElementCount;
    nudge.classList.add("show");
    nudge.textContent = "Six letters are wrong";
    const during = wrap.childElementCount;
    nudge.classList.remove("show");
    // jsdom has no layout, so this checks the structural precondition: the
    // nudge is a child of the board box and never added or removed from flow.
    return before === during && wrap.contains(nudge);
  })());

  console.log("\nAccounts stay out of the way");
  t("no sign-in wall: the board is playable without an account", (() => {
    // The whole point of Phase 1 — a guest must reach the puzzle untouched.
    return d.querySelectorAll("#grid .cell").length > 50 &&
      !d.querySelector("#accountSheet").classList.contains("show");
  })());
  t("the account sheet only opens when asked for", (() => {
    const sheet = d.getElementById("accountSheet");
    $("accountToggle").dispatchEvent(new w.Event("click", { bubbles: true }));
    const opened = sheet.classList.contains("show");
    $("acctClose").dispatchEvent(new w.Event("click", { bubbles: true }));
    return !!sheet && opened && !sheet.classList.contains("show");
  })());
  t("a guest sees the reason to sign up, not a form", (() => {
    return d.getElementById("acctSignedOut").style.display !== "none" &&
      d.getElementById("acctSignedIn").style.display === "none" &&
      /streak|stats/i.test(d.querySelector(".acct-why").textContent);
  })());
  t("no password field exists anywhere",
    d.querySelectorAll('input[type=password]').length === 0);
  t("account requests carry the anti-CSRF header", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /"X-Crossword-XI": "1"/.test(js) && /credentials: "same-origin"/.test(js);
  })());
  t("signing out never clears the local results", (() => {
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    const out = js.slice(js.indexOf('on("acctSignOut"'), js.indexOf('on("acctSave"'));
    return !/removeItem|clear\(/.test(out);
  })());

  console.log("\nLandscape tablet: the rail");
  t("the toolbar moves into the stage so it can be a column of the board", (() => {
    // matchMedia is stubbed false in this harness, so drive placeToolbar()
    // through a real media-query result rather than a viewport guess.
    const real = w.matchMedia;
    w.matchMedia = (q) => ({ matches: /min-width:1000px/.test(q), addListener() {}, removeListener() {} });
    w.dispatchEvent(new w.Event("resize"));
    const stage = d.querySelector(".stage");
    const moved = stage.contains($("toolbar")) && stage.firstElementChild === $("toolbar");
    w.matchMedia = real;
    w.dispatchEvent(new w.Event("resize"));
    const back = !stage.contains($("toolbar"));
    return moved && back;
  })());
  t("the board still gets a sensible width when the panel has no box", (() => {
    /* .grid-panel is display:contents in the rail, so it has no box and
       clientWidth is 0. Measuring the stage instead worked but was circular —
       the stage's width derives from the board — so v07h sizes the board from
       the viewport and a fixed rail width. Either way the requirement is the
       same: the rail must not be counted as space the board can use. */
    const js = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
    return /railMode/.test(js) && /pairCap - railW - pairGap/.test(js);
  })());
  t("the board and its clue strip survive the move", (() => {
    return !!$("nowClue") && !!d.querySelector(".grid-wrap") &&
      d.querySelectorAll("#grid .cell").length > 50 &&
      d.querySelectorAll("#nowClue").length === 1;
  })());

  console.log("\nPhone: the league table moves below the board");
  t("on a wide viewport the table is in the header", (() => {
    const panel = $("tablePanel");
    return $("toolbar").contains(panel) && !panel.classList.contains("below-board");
  })());
  t("narrowing moves the node below the board, not just its styling", (() => {
    // CSS cannot reorder across containers, so the element itself relocates.
    Object.defineProperty(w, "innerWidth", { value: 390, writable: true, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    const panel = $("tablePanel");
    const board = d.querySelector(".grid-panel");
    return panel.parentNode === d.querySelector(".stage") &&
      panel.classList.contains("below-board") &&
      (board.compareDocumentPosition(panel) & 4) !== 0;   // board precedes table
  })());
  t("the table still renders three rows after the move", (() => {
    const rows = [...d.querySelectorAll("#tablePanel #leagueBody tr")];
    return rows.length === 20 && rows.filter((r) => !r.classList.contains("faroff")).length === 3;
  })(), [...d.querySelectorAll("#tablePanel #leagueBody tr")].filter((r) => !r.classList.contains("faroff")).length + " visible");
  t("widening puts it back in the header", (() => {
    Object.defineProperty(w, "innerWidth", { value: 1400, writable: true, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    const panel = $("tablePanel");
    return $("toolbar").contains(panel) && !panel.classList.contains("below-board");
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

  console.log(`\n${pass} passed, ${fail} failed`);
  dom.window.close();
  server.close();
  process.exit(fail ? 1 : 0);
});
