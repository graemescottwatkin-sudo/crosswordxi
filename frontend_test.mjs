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

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain" };

const ROUTES = {
  "/api/daily": apiDaily, "/api/practice": apiPractice,
  "/api/categories": apiCategories, "/api/check-answer": apiCheck,
  "/api/reveal": apiReveal,
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

  console.log("Loading");
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
  t("the board never shrinks to a token size on tablet and up",
    /window\.innerWidth \|\| 360\) >= 700 \? 30 : 20/.test(
      fs.readFileSync(path.join(DIR, "js/game.js"), "utf8")));
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
  t("help collapses on phones only, and is open where there is room",
    /\.tb-help\.collapsed \.tb-row\{display:none\}/.test(css.replace(/\s*\n\s*/g, "")) &&
    !d.querySelector(".tb-help").classList.contains("collapsed"));

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
