/* tabs_test.mjs — more than one window open on the same game.
 *
 * localStorage is shared by every tab on an origin. Three windows open meant
 * three clocks and three ten-second saves writing the same two keys, last
 * write winning — so a tab left open since the morning could overwrite the
 * board being typed into now, and an admin reset came back to life within ten
 * seconds because another window still held a copy in memory.
 *
 * HONESTY ABOUT WHAT THIS PROVES. jsdom gives each window its own storage and
 * does not deliver storage events between instances, so this harness bridges
 * them by hand: window A's writes are copied into window B and a StorageEvent
 * is dispatched there, which is what a browser does. That tests the handler
 * and the stand-down, NOT the browser's event delivery. The real thing needs
 * two tabs and a person; render_test.mjs territory. Written down because a
 * test that quietly stands in for something it cannot reach is worse than no
 * test at all.
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
/* Saves are keyed by board: fcw.v04.daily.<no>. See save_test.mjs. */
/* Read from the source, like save_test.mjs — a hardcoded epoch here would be a
   fourth copy of a value that already exists twice. */
const EPOCH_SRC = fs.readFileSync(path.join(DIR, "functions/_lib/daily.js"), "utf8");
const EM = EPOCH_SRC.match(/const EPOCH = Date\.UTC\((\d+), (\d+), (\d+)\)/);
const TODAY_NO = Math.max(1, Math.floor(
  (Date.now() - Date.UTC(+EM[1], +EM[2], +EM[3])) / 86400000) + 1);
const SLOT = "fcw.v04.daily." + TODAY_NO;

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
      },
    });
    await wait(5500);
    return dom;
  }
  const rec = (w, k = SLOT) => {
    try { return JSON.parse(w.localStorage.getItem(k)); } catch (e) { return null; }
  };
  const letters = (r) => Object.keys((r && r.letters) || {}).length;
  const type = (w, s) => {
    for (const ch of s) w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true }));
  };
  /* What a browser does when another document writes: the value lands, and an
     event describing the change is delivered to every *other* document. */
  const asAnotherTab = (w, key, newValue) => {
    if (newValue === null) w.localStorage.removeItem(key);
    else w.localStorage.setItem(key, newValue);
    w.dispatchEvent(new w.StorageEvent("storage", {
      key: key, newValue: newValue, storageArea: w.localStorage,
    }));
  };

  /* ---- 1. the reset that came back to life ----
     Another window clears the slot. This one is mid-game with a clock running
     and a ten-second save interval that nothing used to cancel. */
  console.log("A reset in another window");
  let dom = await open(null);
  let w = dom.window, $ = (id) => w.document.getElementById(id);
  ($("dailyBtn") || $("homeDaily")).click(); await wait(2500);
  if ($("kickOffBtn")) { $("kickOffBtn").click(); await wait(500); }
  type(w, "BURN"); await wait(1200);
  t("this window has a game in progress", letters(rec(w)) >= 4, letters(rec(w)) + " letters");

  asAnotherTab(w, SLOT, null);
  await wait(600);
  t("the cleared record is not written straight back", rec(w) === null,
    rec(w) ? letters(rec(w)) + " letters reappeared" : "still gone");
  const told = /another window/i.test(w.document.body.textContent || "");
  t("the player is told rather than left with a dead clock", told,
    told ? "notice shown" : "no notice anywhere on the page");

  /* Typing must not resurrect it either — the stand-down is the whole page,
     not one code path. */
  type(w, "XYZ"); await wait(1200);
  t("typing afterwards does not resurrect it", rec(w) === null,
    rec(w) ? letters(rec(w)) + " letters" : "still gone");

  /* The ten-second interval is the one that actually bit. Wait it out. */
  console.log("      waiting out the ten-second clock save…");
  await wait(11000);
  t("the ten-second clock save does not resurrect it either", rec(w) === null,
    rec(w) ? letters(rec(w)) + " letters came back" : "still gone");
  w.close();

  /* ---- 2. a stale window must not overwrite a newer one ----
     The player-facing version: an older tab holding a thinner board. */
  console.log("\nA newer game written by another window");
  dom = await open(null);
  w = dom.window; $ = (id) => w.document.getElementById(id);
  ($("dailyBtn") || $("homeDaily")).click(); await wait(2500);
  if ($("kickOffBtn")) { $("kickOffBtn").click(); await wait(500); }
  type(w, "BUR"); await wait(1200);
  const mine = rec(w);
  t("this window has its own copy", letters(mine) >= 3, letters(mine) + " letters");

  const theirs = JSON.stringify(Object.assign({}, mine, {
    letters: { "3,4": "B", "3,5": "U", "3,6": "R", "3,7": "N", "3,8": "D" },
    elapsed: 900,
  }));
  asAnotherTab(w, SLOT, theirs);
  await wait(600);
  type(w, "ZZZ"); await wait(1500);
  const after = rec(w);
  t("the other window's fuller board survives", letters(after) === 5 && after.elapsed === 900,
    letters(after) + " letters, " + after.elapsed + "s");
  w.close();

  /* ---- 3. it must not fire on the tab doing the writing ----
     A guard that stands a lone tab down would stop every save on the site. */
  console.log("\nOne window on its own");
  dom = await open(null);
  w = dom.window; $ = (id) => w.document.getElementById(id);
  ($("dailyBtn") || $("homeDaily")).click(); await wait(2500);
  if ($("kickOffBtn")) { $("kickOffBtn").click(); await wait(500); }
  type(w, "BURND"); await wait(1200);
  const first = letters(rec(w));
  type(w, "EN"); await wait(1200);
  t("a single window keeps saving normally", letters(rec(w)) > first,
    first + " then " + letters(rec(w)) + " letters");

  /* A change to a key this window is not playing is none of its business. */
  asAnotherTab(w, "fcw.v04.practice", null);
  await wait(500);
  type(w, "P"); await wait(1200);
  t("a change to the other mode's slot is ignored", letters(rec(w)) > first,
    letters(rec(w)) + " letters");
  w.close();

  /* ---- 4. the reload window in the admin tools ----
     location.reload() does not halt the page, so both admin buttons have to
     stop writing before they clear. Source check, comments stripped — a
     comment mentioning standDown would otherwise pass this on its own. */
  console.log("\nThe admin reload window");
  const src = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const between = (from, to) => {
    const a = src.indexOf(from);
    return a === -1 ? "" : src.slice(a, src.indexOf(to, a) + to.length);
  };
  const replay = between('on("adminReplay"', "location.reload();");
  const reset = between('on("adminReset"', "location.reload();");
  t("Replay day stops writing before it clears and reloads",
    /standDown\(\)/.test(replay) && replay.indexOf("standDown()") < replay.indexOf("removeItem"),
    replay ? "found" : "handler not located");
  t("Clear my record stops writing before it clears and reloads",
    /standDown\(\)/.test(reset) && reset.indexOf("standDown()") < reset.indexOf("removeItem"),
    reset ? "found" : "handler not located");
  t("standing down cancels the clock-save interval, which stopTimer does not",
    /function standDown\(\)[\s\S]{0,200}stopClockSaves\(\)/.test(src) &&
    /function stopClockSaves\(\)[^}]*clearInterval\(clockSaveT\)/.test(src));
  t("save\\(\\) honours the stand-down", /function save\(\)\s*\{[\s\S]{0,120}if \(saveBlocked\) return;/.test(src));

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
