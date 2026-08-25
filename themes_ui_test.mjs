/* themes_ui_test.mjs — the Themed section in a browser.
 *
 * themes_test.mjs proves the boards and the API. This proves the part a player
 * touches: the three panels, the request marker, the readable share link and
 * — the one that worries me most — the third save slot. A themed board is a
 * real game with a real clock, and until this build there were two slots for
 * three modes, which is how a themed board would have quietly destroyed a
 * practice game in progress.
 *
 * /api/themes and /api/theme-board are served from fixtures here rather than
 * from the real Functions, because those need a database and what is under
 * test is the browser's half. The API's own half is themes_test.mjs.
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
import { onRequestGet as apiStatus } from "./functions/api/status.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain" };

/* Two themes, one of them requested by this player, plus something scheduled. */
const THEMES_FIXTURE = {
  configured: true, today: "2026-08-17",
  mine: ["aston-villa"],
  themes: [
    { id: "man-united", name: "Manchester United", kind: "club",
      boards: [{ no: 1, boardId: 101, releasedOn: "2026-08-17" },
               { no: 2, boardId: 102, releasedOn: "2026-08-17" }] },
    { id: "aston-villa", name: "Aston Villa", kind: "club",
      boards: [{ no: 1, boardId: 201, releasedOn: "2026-08-17" }] },
  ],
  upcoming: [{ name: "Newcastle United", no: 1, releaseOn: "2026-08-21" }],
  options: [{ key: "man-united", label: "Manchester United" },
            { key: "aston-villa", label: "Aston Villa" }],
};

/* A real board, borrowed from the practice endpoint's own sample data. A
   hand-made stub was the first attempt and it drove the grid straight into a
   TypeError — the payload has more shape to it than a list of cells, and a
   fixture that cannot be played proves nothing about a client that plays it. */
let REAL_PUZZLE = null;
async function realPuzzle() {
  if (REAL_PUZZLE) return REAL_PUZZLE;
  const res = await apiPractice({ request: new Request("http://127.0.0.1/api/practice"), env: {} });
  REAL_PUZZLE = JSON.parse(await res.text()).puzzle;
  return REAL_PUZZLE;
}
async function boardFixture(themeId, no, boardId) {
  const name = themeId === "man-united" ? "Manchester United" : "Aston Villa";
  return {
    mode: "theme", themeId, themeName: name, boardNo: no, releasedOn: "2026-08-17",
    label: name + " #" + no,
    token: "theme:" + boardId,
    puzzle: await realPuzzle(),
  };
}

let requested = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const send = (obj, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === "/api/themes") {
    return send(Object.assign({}, THEMES_FIXTURE,
      { mine: THEMES_FIXTURE.mine.concat(requested) }));
  }
  if (url.pathname === "/api/theme-board") {
    const id = url.searchParams.get("id");
    const theme = url.searchParams.get("theme");
    const no = Number(url.searchParams.get("no") || 0);
    if (id === "101" || (theme === "man-united" && no === 1)) return send(await boardFixture("man-united", 1, 101));
    if (id === "102" || (theme === "man-united" && no === 2)) return send(await boardFixture("man-united", 2, 102));
    if (id === "201" || (theme === "aston-villa" && no === 1)) return send(await boardFixture("aston-villa", 1, 201));
    return send({ error: "No such board." }, 404);
  }
  if (url.pathname === "/api/theme-request" && req.method === "DELETE") {
    const k = url.searchParams.get("key");
    requested = requested.filter((x) => x !== k);
    THEMES_FIXTURE.mine = THEMES_FIXTURE.mine.filter((x) => x !== k);
    return send({ ok: true, removed: 1 });
  }
  if (url.pathname === "/api/theme-request") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) {}
    requested.push(body.key);
    return send({ ok: true });
  }
  const routes = { "/api/daily": apiDaily, "/api/practice": apiPractice,
                   "/api/categories": apiCategories, "/api/check-answer": apiCheck,
                   "/api/status": apiStatus };
  const fn = routes[url.pathname];
  if (fn) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request("http://127.0.0.1" + req.url, {
      method: req.method, body: chunks.length ? Buffer.concat(chunks) : undefined,
      headers: { "Content-Type": "application/json" } });
    const out = await fn({ request, env: {} });
    res.writeHead(out.status, { "Content-Type": "application/json" });
    return res.end(await out.text());
  }
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(DIR, rel);
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, "127.0.0.1", async () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Serving ${DIR} at ${origin}\n`);

  async function open(search, seed) {
    const dom = await JSDOM.fromURL(origin + "/" + (search || ""), {
      runScripts: "dangerously", pretendToBeVisual: true, resources: "usable",
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.scrollTo = () => {}; w.scrollBy = () => {};
        w.fetch = (u, o) => fetch(String(u).startsWith("http") ? u : origin + u, o);
        w.confirm = () => true;
        for (const k in seed || {}) if (seed[k] != null) w.localStorage.setItem(k, seed[k]);
      },
    });
    await wait(5500);
    return dom;
  }

  /* ---- the three panels ---- */
  console.log("The Themed section");
  let dom = await open();
  let w = dom.window, $ = (id) => w.document.getElementById(id);

  t("the landing screen offers themed boards", !!$("homeThemed"));
  t("and says how many are out", /3 boards available/.test($("homeThemedState").textContent),
    $("homeThemedState").textContent);

  $("homeThemed").click();
  await wait(1200);
  t("the section opens", $("themeSheet").className.includes("show"));

  const avail = $("themeAvailable").textContent;
  t("released boards are listed, grouped by theme",
    /Manchester United/.test(avail) && /Aston Villa/.test(avail));
  t("a theme with two boards shows both",
    $("themeAvailable").querySelectorAll('[data-theme="man-united"]').length === 2);
  t("the schedule shows what is coming, with a readable date",
    /Newcastle United/.test($("themeUpcoming").textContent) &&
    /Fri 21 Aug/.test($("themeUpcoming").textContent), $("themeUpcoming").textContent.trim());
  t("the schedule carries no board", !/data-theme="newcastle/.test($("themeUpcoming").innerHTML));

  /* The marker that stands in for an email. */
  const villa = [...$("themeAvailable").querySelectorAll(".theme-group")]
    .find((g) => /Aston Villa/.test(g.textContent));
  t("a theme this player asked for is marked", /You asked for this/.test(villa.textContent));
  const united = [...$("themeAvailable").querySelectorAll(".theme-group")]
    .find((g) => /Manchester United/.test(g.textContent));
  t("and one they did not ask for is not", !/You asked for this/.test(united.textContent));

  t("the request picklist is filled, not a free text box",
    $("themeRequestKey").tagName === "SELECT" && $("themeRequestKey").options.length > 5,
    $("themeRequestKey").options.length + " options");
  t("clubs with no board yet can still be asked for",
    [...$("themeRequestKey").options].some((o) => /Everton/.test(o.textContent)));

  /* The one moment asking for a theme matters most is when there are none —
     and that was the one moment the list was empty, because it was filled
     inside the branch that only runs when boards exist. */
  console.log("\nWith no boards imported yet");
  w.close();
  const emptyServer = THEMES_FIXTURE.themes;
  const emptyOptions = THEMES_FIXTURE.options;
  THEMES_FIXTURE.themes = [];
  THEMES_FIXTURE.options = [];
  dom = await open();
  w = dom.window; $ = (id) => w.document.getElementById(id);
  $("homeThemed").click();
  await wait(1200);
  t("the section says so plainly", /No themed boards yet/.test($("themeAvailable").textContent));
  t("and the request list is still filled, so a club can be asked for",
    $("themeRequestKey").options.length > 5,
    $("themeRequestKey").options.length + " options");
  t("including clubs that have no board", (() => {
    const labels = [...$("themeRequestKey").options].map((o) => o.textContent);
    return labels.some((l) => /Everton/.test(l)) && labels.some((l) => /Sunderland/.test(l));
  })());
  THEMES_FIXTURE.themes = emptyServer;
  THEMES_FIXTURE.options = emptyOptions;      // restored too, or later checks
                                              // see a server with no labels
  w.close();
  dom = await open();
  w = dom.window; $ = (id) => w.document.getElementById(id);
  $("homeThemed").click();
  await wait(1200);

  /* Several themes each, each of them once. The schema says so — UNIQUE
     (theme_key, requested_by) — and the list has to say so too, or the rule is
     something you find out by pressing the button and being refused. */
  console.log("\nRequesting themes");
  const pick = (key) => {
    const sel = $("themeRequestKey");
    sel.value = key;
    $("themeRequestBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  };
  t("the control says request, not ask", (() => {
    const sheet = $("themeSheet").textContent;
    return /Request a theme/.test(sheet) && /one request each/i.test(sheet) &&
      $("themeRequestBtn").textContent.trim() === "Request";
  })(), $("themeRequestBtn").textContent.trim());

  pick("everton");
  await wait(900);
  t("a request is accepted", /on the list|Noted/i.test($("themeRequestMsg").textContent),
    $("themeRequestMsg").textContent.trim());
  t("and the choice is cleared, ready for another", $("themeRequestKey").value === "");

  pick("leeds-united");
  await wait(900);
  t("a second, different theme is accepted too",
    /on the list|Noted/i.test($("themeRequestMsg").textContent),
    $("themeRequestMsg").textContent.trim());

  await wait(300);
  t("themes already requested are struck off the list", (() => {
    const opts = [...$("themeRequestKey").options];
    const villa = opts.find((o) => o.value === "aston-villa");   // seeded as requested
    return !!villa && villa.disabled && / requested$/.test(villa.textContent);
  })(), [...$("themeRequestKey").options].filter((o) => o.disabled).length + " struck off");

  /* Asking was one tap and undoing it was impossible — and the list then struck
     the theme off, so a mis-tap was permanent and visibly so. */
  console.log("\nTaking a request back");
  t("what you have asked for is listed", (() => {
    const box = $("themeMine");
    return !!box && /Aston Villa/.test(box.textContent);
  })(), $("themeMine") && $("themeMine").textContent.trim().slice(0, 40));
  t("each one has a control to remove it",
    !!$("themeMine").querySelector('.mine-drop[data-key="aston-villa"]'));
  $("themeMine").querySelector('.mine-drop[data-key="aston-villa"]')
    .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(1200);
  t("removing it says so", /removed/i.test($("themeRequestMsg").textContent),
    $("themeRequestMsg").textContent.trim());
  t("and the theme goes back on the list to be asked for again", (() => {
    const villa = [...$("themeRequestKey").options].find((o) => o.value === "aston-villa");
    return !!villa && !villa.disabled;
  })());

  /* ---- opening a board ---- */
  console.log("\nPlaying a themed board");
  $("themeAvailable").querySelector('[data-theme="man-united"][data-no="2"]').click();
  await wait(2500);
  t("the board opens and names itself on the strap",
    /Manchester United #2/.test($("strapText").textContent), $("strapText").textContent);
  t("the page title names it too", /Manchester United #2/.test(w.document.title), w.document.title);

  /* The slot. Three modes, three slots — sharing the practice key would mean
     opening a themed board destroyed a practice game in progress. */
  if ($("kickOffBtn")) { $("kickOffBtn").click(); await wait(500); }
  for (const ch of "ABC") w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true }));
  await wait(1500);
  const themeSlot = w.localStorage.getItem("fcw.v04.theme");
  t("a themed board saves to its own slot", !!themeSlot, themeSlot ? "written" : "nothing saved");
  t("and not over the practice slot", !w.localStorage.getItem("fcw.v04.practice"));
  t("the save records which board it is, so it can be resumed",
    !!themeSlot && JSON.parse(themeSlot).themeKey === "man-united-2",
    themeSlot ? JSON.parse(themeSlot).themeKey : "-");
  w.close();

  /* ---- the readable share link ---- */
  console.log("\nA shared themed board");
  dom = await open("?t=aston-villa-1");
  w = dom.window; $ = (id) => w.document.getElementById(id);
  t("a /?t= link opens that board directly, not the menu",
    !$("homeOverlay").className.includes("show"));
  t("and it is the board that was named",
    /Aston Villa #1/.test($("strapText").textContent), $("strapText").textContent);
  w.close();

  /* A link to a board that is not out must not fall through to something else. */
  dom = await open("?t=man-united-9");
  w = dom.window; $ = (id) => w.document.getElementById(id);
  t("a link to an unreleased board returns to the menu rather than opening another",
    $("homeOverlay").className.includes("show"));
  w.close();

  server.close();
  /* The section is called Clubs and themes. The ids, classes and the "theme" mode
   keep their old names on purpose: those are what the database calls it, and
   renaming a column to match a heading is a migration in exchange for nothing.
   What matters is that nothing a player reads still says "Themed boards". */
{
  const html = fs.readFileSync("index.html", "utf8");
  const visible = html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sid="[^"]*"/g, "").replace(/\sclass="[^"]*"/g, "");
  t("the section is named Clubs and themes", /Clubs and themes/.test(visible));
  t("and nothing a player reads still says Themed boards",
    !/Themed boards?/.test(visible), (/Themed boards?/.exec(visible) || [""])[0] || "clean");
}

console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
