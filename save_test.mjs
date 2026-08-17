/* save_test.mjs — the saved game, and what is allowed to overwrite it.
 *
 * Every check here exists because of a real loss. A daily in progress was
 * replaced by a well-formed empty record, and the menu carried on displaying
 * the old time because nothing re-rendered — so the damage only surfaced at
 * the next reload, which made the reload look like the culprit.
 *
 * The other suites boot one page and drive it. These need a save already in
 * storage *before* any script runs, and several need a second page load, so
 * this file opens a fresh window per case and seeds localStorage in
 * beforeParse. Storage is carried from one window to the next by hand, which
 * is what a reload does.
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const fn = ROUTES[url.pathname];
  if (fn) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request("http://127.0.0.1" + req.url, {
      method: req.method,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      headers: { "Content-Type": "application/json" },
    });
    const out = await fn({ request, env: {} });
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = ["fcw.v04.daily", "fcw.v04.practice", "fcw.mode", "fcw.results.v1",
  "fcw.usedClues.v1", "fcw.clubPref", "fcw.recent", "fcw.bank", "fcw.filter"];

/* A daily part way through: three letters down and getting on for three
   minutes gone. The shape is whatever save() writes; only the fields the
   guards read have to be right. */
const IN_PROGRESS = JSON.stringify({
  mode: "daily", dailyNo: 2, seed: 1463034884,
  letters: { "3,4": "B", "3,5": "U", "3,6": "R" },
  elapsed: 163, complete: false,
  revealedCells: [], revealAnswerCells: [], revealedEntries: [],
  subbedCells: [], subs: 0, checks: 0, checkAlls: 0, helpActions: [],
  pauseCount: 0, pausedMs: 0, club: "Manchester City", clubMode: "chosen",
});

server.listen(0, "127.0.0.1", async () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Serving ${DIR} at ${origin}\n`);

  async function open(seed) {
    const dom = await JSDOM.fromURL(origin + "/", {
      runScripts: "dangerously", pretendToBeVisual: true, resources: "usable",
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.scrollTo = () => {}; w.scrollBy = () => {};
        w.fetch = (u, o) => fetch(String(u).startsWith("http") ? u : origin + u, o);
        w.confirm = () => true;
        for (const k in seed || {}) if (seed[k] != null) w.localStorage.setItem(k, seed[k]);
        /* Count every change listener the page binds to a club control.
           Counting handlers the test added itself proves nothing — the
           duplicates were the page's own, one per repopulate. */
        w.__clubBinds = {};
        const add = w.EventTarget.prototype.addEventListener;
        w.EventTarget.prototype.addEventListener = function (type, fn, opts) {
          if (type === "change" && this.id &&
              /^(clubSelect|kickClubSelect|homeClubSelect)$/.test(this.id)) {
            w.__clubBinds[this.id] = (w.__clubBinds[this.id] || 0) + 1;
          }
          return add.call(this, type, fn, opts);
        };
      },
    });
    await wait(5500);
    return dom;
  }
  const daily = (w) => {
    try { return JSON.parse(w.localStorage.getItem("fcw.v04.daily")); } catch (e) { return null; }
  };
  const played = (r) => !!r && (Object.keys(r.letters || {}).length > 0 || !!r.elapsed);
  const snap = (w) => { const o = {}; for (const k of KEYS) o[k] = w.localStorage.getItem(k); return o; };
  const type = (w, s) => {
    for (const ch of s) w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true }));
  };

  /* ---- 1. the landing screen's club control ----
     The loss that started this. On the landing screen nothing is built, so
     letters is {} and elapsed is 0 — and applyClubChoice() ends in saveSoon().
     Before the fix this wrote an empty record straight over a game in play. */
  console.log("The landing screen");
  let dom = await open({ "fcw.v04.daily": IN_PROGRESS });
  let w = dom.window, $ = (id) => w.document.getElementById(id);

  t("a seeded game in progress is there to begin with", played(daily(w)),
    `${Object.keys(daily(w).letters).length} letters, ${daily(w).elapsed}s`);

  const sel = $("homeClubSelect");
  t("the landing screen has a club control", !!sel);
  sel.value = "Everton";
  sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(1200);
  t("changing club on the landing screen does not touch the saved game",
    played(daily(w)),
    daily(w) ? `${Object.keys(daily(w).letters || {}).length} letters, ${daily(w).elapsed}s` : "record gone");
  t("the club choice was still applied", w.localStorage.getItem("fcw.clubPref") === "Everton",
    String(w.localStorage.getItem("fcw.clubPref")));

  /* The menu is what the player reads. It has to still say so. */
  t("the menu still shows the game as in progress",
    /in progress/i.test($("homeDailyState").textContent), $("homeDailyState").textContent);

  let state = snap(w);
  w.close();

  /* ---- 2. and it survives the reload that used to reveal the damage ---- */
  console.log("\nAfter a reload");
  dom = await open(state);
  w = dom.window; $ = (id) => w.document.getElementById(id);
  t("the saved game is still there after a refresh", played(daily(w)),
    daily(w) ? `${Object.keys(daily(w).letters || {}).length} letters` : "record gone");
  t("and the menu says so on a fresh render",
    /in progress/i.test($("homeDailyState").textContent), $("homeDailyState").textContent);

  /* ---- 3. the guard is not mode-specific ----
     mode resets to "daily" on every load, so the landing screen always wrote
     to the daily slot whatever you were last playing. Check the practice slot
     is equally safe. */
  const pr = JSON.parse(IN_PROGRESS);
  delete pr.dailyNo; pr.mode = "practice";
  dom.window.close();

  console.log("\nThe practice slot");
  dom = await open({ "fcw.v04.practice": JSON.stringify(pr) });
  w = dom.window; $ = (id) => w.document.getElementById(id);
  const sel2 = w.document.getElementById("homeClubSelect");
  sel2.value = "Arsenal";
  sel2.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(1200);
  let p = null;
  try { p = JSON.parse(w.localStorage.getItem("fcw.v04.practice")); } catch (e) {}
  t("changing club on the landing screen does not touch a practice game",
    played(p), p ? `${Object.keys(p.letters || {}).length} letters` : "record gone");
  w.close();

  /* ---- 4. a real game still saves ----
     A guard that protects the save by never writing it would pass everything
     above and be useless. Play, and check the letters land. */
  console.log("\nPlaying still saves");
  dom = await open(null);
  w = dom.window; $ = (id) => w.document.getElementById(id);
  $("homeDaily").click();
  await wait(2500);
  if ($("kickOffBtn")) { $("kickOffBtn").click(); await wait(500); }
  type(w, "BURN");
  await wait(1500);
  const after = daily(w);
  t("letters typed into the daily are written to storage",
    !!after && Object.keys(after.letters || {}).length >= 4,
    after ? `${Object.keys(after.letters || {}).length} letters` : "nothing saved");
  t("the clock is recorded with them", !!after && after.elapsed > 0, after ? after.elapsed + "s" : "-");

  /* And changing club mid-game — where a puzzle does exist — must still save,
     because the club is part of the record. */
  const before = Object.keys(after.letters || {}).length;
  const mid = $("clubSelect");
  mid.value = "Liverpool";
  mid.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(1200);
  const now = daily(w);
  t("changing club mid-game keeps the letters and records the club",
    !!now && Object.keys(now.letters || {}).length === before && now.club === "Liverpool",
    now ? `${Object.keys(now.letters || {}).length} letters, club ${now.club}` : "record gone");

  /* ---- 5. one listener, not a growing pile ----
     populateClubSelect() is called from syncClubSelect() and syncKickSelect(),
     which run on every build, every club change and every render of the
     landing screen. It returns early when the list already has options, so the
     binding happens once — and applyClubChoice() writes to storage, so if that
     early return were ever removed a single change would fire several saves.
     This holds the invariant rather than fixing anything. */
  console.log("\nThe change listener");
  $("menuBtn").click(); await wait(600);
  $("homeDaily").click(); await wait(2500);
  const binds = w.__clubBinds || {};
  console.log("      bindings per control: " + JSON.stringify(binds));
  const most = Math.max(0, ...Object.values(binds));
  t("the club lists were rebuilt several times over", Object.keys(binds).length >= 2,
    Object.keys(binds).join(", "));
  t("each club control has exactly one change listener", most === 1,
    "highest count " + most);

  w.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
