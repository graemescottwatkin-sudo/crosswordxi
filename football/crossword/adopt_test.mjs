/* adopt_test.mjs — the account's journey reaches the SCREEN, on a normal open.
 *
 * This suite exists because three faults stacked in one feature and 994 green
 * assertions covered all three.
 *
 *   1. The pull sat inside the clock-clamp branch (server daily number !==
 *      ours). On a normal open the numbers agree, the branch is skipped, and
 *      the pull never ran at all. Nothing ever reached the device.
 *   2. Adoption called adoptServerBoard(), which only re-freezes the board
 *      identity object. Even had the pull run, nothing repainted.
 *   3. The push had no letters-or-time floor, so a device showing a blank
 *      board could overwrite another device's journey with nothing.
 *
 * state_test asserts the RULES by reading the source: the debounce is wired,
 * Date.now is absent from the comparison, the floor exists. Every one of those
 * passed throughout. None of them opens a board and looks at it.
 *
 * So this file drives the real page in jsdom, on the NORMAL path — the server's
 * number agreeing with ours, no clamp — and asserts the account's letters are
 * in the rendered grid. A suite that only exercised the clamp path would pass
 * on fault 1 for ever.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import { onRequestGet as apiDaily } from "../../functions/api/daily.js";
import { onRequestGet as apiCategories } from "../../functions/api/categories.js";
import { onRequestGet as apiStatus } from "../../functions/api/status.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
/* The repository, two levels up: this suite lives at football/<game>/. */
const ROOT = path.join(DIR, "..", "..");
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain" };
const REAL = { "/api/daily": apiDaily, "/api/categories": apiCategories, "/api/status": apiStatus };

/* Today's number from the ONE epoch, never restated here. */
const EPOCH_SRC = fs.readFileSync(path.join(DIR, "../../functions/_lib/daily.js"), "utf8");
const EM = EPOCH_SRC.match(/const EPOCH = Date\.UTC\((\d+), (\d+), (\d+)\)/);
if (!EM) throw new Error("Could not read EPOCH from functions/_lib/daily.js");
const DAILY_EPOCH = Date.UTC(+EM[1], +EM[2], +EM[3]);
const TODAY_NO = Math.max(1, Math.floor((Date.now() - DAILY_EPOCH) / 86400000) + 1);
const DAILY_SLOT = "fcw.v04.daily." + TODAY_NO;

/* What the account is holding. Set between page loads. */
let STATE_BODY = { state: null };
let servedDailyNo = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const send = (obj, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  /* The account endpoints, stubbed: this suite is about the client's journey,
     not the server's — state_test executes the real endpoint. */
  if (url.pathname === "/api/auth/session") {
    return send({ user: { id: "adopt-test-user", displayName: "Tester" }, googleClientId: null });
  }
  if (url.pathname === "/api/account/state") {
    if (req.method === "POST") { for await (const c of req) void c; return send({ updatedAt: "2026-01-01T00:00:00.000Z" }); }
    return send(STATE_BODY);
  }
  if (url.pathname.startsWith("/api/account/")) return send({ results: [], user: null });
  const fn = REAL[url.pathname];
  if (fn) {
    const request = new Request("http://127.0.0.1" + req.url, { method: req.method });
    const out = await fn({ request, env: {} });
    const body = await out.text();
    if (url.pathname === "/api/daily") {
      try { servedDailyNo = JSON.parse(body).dailyNo; } catch (e) {}
    }
    res.writeHead(out.status, { "Content-Type": "application/json" });
    return res.end(body);
  }
  if (url.pathname.startsWith("/api/")) return send({}, 200);
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  /* THE SHARED LAYER IS SERVED FROM THE REPOSITORY. The page asks for it
     absolutely — /shared/xi-chrome.js — since the theme move made a relative
     hop depth arithmetic that breaks whenever the tree changes. This shim
     served everything from the game's folder, so the chrome 404'd and the page
     under test ran without it: the menu never rendered and the failure looked
     like a game bug rather than a missing file. */
  const file = rel.startsWith("/shared/") ? path.join(ROOT, rel.slice(1)) : path.join(DIR, rel);
  /* THE TRAVERSAL GUARD HAS TO ALLOW THE SHARED LAYER, and only that. It
     read "inside this game's folder", which was every file the page could ask
     for until /shared/ became an absolute address — after which the guard
     404'd the chrome and the page under test ran without it. Widened to the
     one directory that is legitimately outside, not to the repository. */
  const SHARED = path.join(ROOT, "shared");
  if ((!file.startsWith(DIR) && !file.startsWith(SHARED)) ||
      !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, "127.0.0.1", async () => {
  const origin = "http://127.0.0.1:" + server.address().port;
  console.log("Serving " + DIR + " at " + origin + "\n");

  async function openDaily(seed) {
    const dom = await JSDOM.fromURL(origin + "/", {
      runScripts: "dangerously", pretendToBeVisual: true, resources: "usable",
      beforeParse(w) {
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.scrollTo = () => {}; w.scrollBy = () => {};
        w.fetch = (u, o) => fetch(String(u).startsWith("http") ? u : origin + u, o);
        w.confirm = () => true;
        /* jsdom shares a storage area per ORIGIN across windows, so without
           this a later open inherits an earlier one's save and a "cold" open
           is quietly a restored one. The first version of the season check
           passed against the very bug it was written for because of it. */
        w.localStorage.clear();
        for (const k in seed || {}) if (seed[k] != null) w.localStorage.setItem(k, seed[k]);
      },
    });
    await wait(4000);
    const btn = dom.window.document.getElementById("homeDaily");
    if (btn) btn.click();
    await wait(6000);
    return dom;
  }
  const cells = (w) => [...w.document.querySelectorAll(".cell[data-x]")];
  const painted = (w) => {
    const out = {};
    for (const el of cells(w)) {
      const ltr = el.querySelector(".ltr");
      const v = ltr ? ltr.textContent : "";
      if (v) out[el.dataset.x + "," + el.dataset.y] = v;
    }
    return out;
  };

  /* ---- 1. a normal open: the numbers agree, so the clamp branch is skipped */
  console.log("A daily opened the normal way");
  STATE_BODY = { state: null };
  let dom = await openDaily();
  let w = dom.window;
  const grid = cells(w);
  t("the board renders", grid.length > 0, grid.length + " cells");
  t("the server's daily number agrees with ours, so no clamp is involved",
    servedDailyNo === TODAY_NO, "served " + servedDailyNo + ", today " + TODAY_NO);
  t("and nothing is painted when the account holds no journey",
    Object.keys(painted(w)).length === 0);

  /* Three real cells from the board that just rendered — no geometry guessed. */
  const targets = grid.slice(0, 3).map((el) => el.dataset.x + "," + el.dataset.y);
  dom.window.close();

  /* ---- 2. the account holds a journey: it must reach the GRID ---- */
  console.log("\nThe account's journey, on that same normal open");
  const letters = {};
  const WORD = ["X", "Y", "Z"];
  targets.forEach((k, i) => { letters[k] = WORD[i]; });
  /* No fingerprint: finishBuild drops a restore whose fingerprint disagrees
     with the fetched puzzle, and this fixture is about adoption, not staleness.
     No seed either — the rebuild falls back to FCW.dailySeed(no), the daily's
     own. */
  STATE_BODY = {
    state: JSON.stringify({
      mode: "daily", dailyNo: TODAY_NO, letters: letters, elapsed: 120,
      complete: false, revealedCells: [], revealAnswerCells: [],
      revealedEntries: [], subbedCells: [], subs: 0, checks: 0, checkAlls: 0,
      helpActions: [], pauseCount: 0, pausedMs: 0,
    }),
    updatedAt: "2099-01-01T00:00:00.000Z",
  };
  dom = await openDaily();
  w = dom.window;
  const shown = painted(w);
  t("the account's letters reach the rendered grid",
    targets.every((k) => shown[k] === letters[k]),
    targets.map((k) => k + "=" + (shown[k] || "-")).join(" "));
  t("and the adopted snapshot is in this board's own slot",
    (() => {
      try { return Object.keys(JSON.parse(w.localStorage.getItem(DAILY_SLOT)).letters || {}).length === 3; }
      catch (e) { return false; }
    })());
  dom.window.close();


  /* ---- 3. the season is the board's, not the device's ---- */
  /* Two devices, one daily, two seasons: the PC showed 2001/02 and the iPad
     2008/09. The season was derived at the TOP of finishBuild, before the
     restore had put clubMode and club back — so it read the PRE-restore club,
     which at boot is fcw.clubPref, a device-local value. Random is the same
     for everybody, so the ONLY thing varied between these two opens is that
     device-local preference. If it can move the season, the rule is broken.

     Written first as cold-open vs restored-open, which passed against the very
     bug it was for: on the old code both opens took the same wrong path. The
     sabotage is what exposed that, not the reading. */
  console.log("\nThe season is the board's, not the device's");
  STATE_BODY = { state: null };
  const inProgress = JSON.stringify({
    mode: "daily", dailyNo: TODAY_NO, letters: {}, elapsed: 90, complete: false,
    club: "Everton", clubMode: "random", revealedCells: [], revealAnswerCells: [],
    revealedEntries: [], subbedCells: [], subs: 0, checks: 0, checkAlls: 0,
    helpActions: [], pauseCount: 0, pausedMs: 0,
  });
  const seasonWith = async (clubPref) => {
    const d = await openDaily({ [DAILY_SLOT]: inProgress, "fcw.clubPref": clubPref });
    const v = d.window.document.getElementById("tableSeason").textContent.trim();
    d.window.close();
    return v;
  };
  /* Two prefs that DO reach different seasons through the club-keyed pool —
     Everton 2008/09, Sunderland 2011/12 — so a pass cannot be an accident of
     two clubs that happen to agree. */
  const seasonA = await seasonWith("Everton");
  const seasonB = await seasonWith("Sunderland");
  t("a board in random mode names a season", !!seasonA, seasonA);
  t("the device's club preference cannot move the season",
    !!seasonA && seasonA === seasonB,
    "clubPref Everton -> " + seasonA + ", clubPref Sunderland -> " + seasonB);
  console.log("\n" + pass + " passed, " + fail + " failed");
  server.close();
  process.exit(fail ? 1 : 0);
});
