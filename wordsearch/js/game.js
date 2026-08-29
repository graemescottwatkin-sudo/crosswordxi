/* Wordsearch XI — game.js (v500, the ground-up rebuild)
 *
 * Crossword XI's architecture, applied where it fits and not where it
 * doesn't. The bank and the schedule live in D1 behind /api/wordsearch/;
 * the browser asks for one board at a time and never learns tomorrow's.
 * There is no check-answer and no reveal endpoint on purpose — a word
 * search's answers are readable off its own grid by construction, so
 * server-side validation would add a round-trip per drag and protect
 * nothing. What the server guards is the schedule.
 */
(function () {
  "use strict";

  /* Which build is live. Three ways to check, because this question has cost
     the family more time than any layout question: the footer line, the
     console, and the named window variable. If this is not the build just
     deployed, the deploy has not landed — do not start debugging the game. */
  var BUILD = "v001m";
  window.WORDSEARCHXI_BUILD = BUILD;
  try { console.log("Wordsearch XI build " + BUILD); } catch (e) {}

  var $ = function (id) { return document.getElementById(id); };

  /* ---- scoring — XI_SCORING_CORE-compatible curve ---------------------- */
  /* 600 real seconds is 90 match minutes: a word search is a ten-minute
     game where the crossword is a thirty-minute one. The curve itself is
     the family's. */
  var REAL_SECONDS = 600, ROWS = 14, COLS = 12;
  var CURVE = [[0,104],[10,99],[20,91],[30,83],[45,71],[60,57],[70,44],[80,26],[85,13],[90,0]];
  function scoreForMinute(m) {
    if (m <= 0) return 104; if (m >= 90) return 0;
    for (var i = 1; i < CURVE.length; i++) if (m <= CURVE[i][0]) {
      var a = CURVE[i - 1], b = CURVE[i], t = (m - a[0]) / (b[0] - a[0]);
      return Math.round(a[1] + (b[1] - a[1]) * t);
    }
    return 0;
  }

  /* ---- state ----------------------------------------------------------- */
  var mode = "daily";           // daily | free
  var puzzle = null, serverDay = null, catalogBoards = [];
  var found = new Set(), bonusFound = false;
  /* One palette. It was declared inside renderWords AND inside drawHighlight —
     two copies of eleven hex strings that agreed only because nobody had
     edited one of them yet. The name in the list and the line through the
     grid are the same word, so they read the same array. */
  var WORD_COLOURS = ["#61dda1","#63c6ff","#f1bf61","#d991ff","#ff9975",
                      "#78ded2","#b5dc70","#a79cff","#f0a0c5","#8bd3a4","#d6b276"];
  var startedAt = null, elapsed = 0, penaltyMinutes = 0, wrongRun = 0;
  var timer = null, wrongResetTimer = null, finishTimeout = null, toastTimer = null;
  var helpUsed = new Set(), assisted = false;
  var varPauseStart = 0, varPauseUntil = 0, varFrozenScore = 114;
  var dragging = false, startIndex = null, preview = [], cellEls = [];
  var grid = null, hlayer = null;

  function footballMinute() { return Math.min(90, Math.floor((elapsed / REAL_SECONDS) * 90) + penaltyMinutes); }
  function liveScore() { return scoreForMinute(footballMinute()); }
  function finalScore() { return Math.min(114, liveScore() + (bonusFound ? 10 : 0)); }

  /* ---- theme — the family vocabulary, all three values ----------------- */
  /* The theme is a FAMILY preference — set dark mode once, every game keeps
     it — and it speaks auto | light | dark. Writing only two of the three is
     how one theme tap here destroyed a crossword player's "auto", so the
     cycle keeps all three.

     xi.theme is its home. It lived at fcw.theme, the crossword's prefix,
     because the crossword named it first and this game borrowed the key — a
     family-wide fact under one game's namespace, which the cross-game
     contract now forbids. The legacy key stays as a read fallback so nobody's
     setting resets; writes go only to the family key, so the fallback retires
     itself one tap at a time. */
  function themeRead() {
    try {
      return localStorage.getItem("xi.theme") ||
             localStorage.getItem("fcw.theme") || "auto";
    } catch (e) { return "auto"; }
  }
  function themeApply() {
    var v = themeRead();
    if (v === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    var lab = $("mTheme"); if (lab) lab.textContent = v;
    return v;
  }
  function themeCycle() {
    var next = { auto: "dark", dark: "light", light: "auto" }[themeRead()] || "auto";
    try { localStorage.setItem("xi.theme", next); } catch (e) {}
    themeApply();
  }
  themeApply();

  /* ---- the daily record and the durable results ------------------------ */
  /* Two stores with two jobs. xiws.daily.<day> is today's board state and is
     pruned; xiws.results is the durable per-day record the shared cabinet
     will read — it is never pruned, because a streak cannot be computed from
     a record that deletes itself (the v4.3 fault this rebuild retires). */
  var RESULTS_KEY = "xiws.results", SCORING_VERSION = 3;
  function dayKey() { return serverDay; }   // the server's day, never the device's
  function dailyStorageKey() { return "xiws.daily." + dayKey(); }
  function readResults() {
    try { var r = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]"); return Array.isArray(r) ? r : []; }
    catch (e) { return []; }
  }
  function recordResult(rec) {
    try {
      var all = readResults().filter(function (r) { return r.day !== rec.day; });
      all.push(rec);
      localStorage.setItem(RESULTS_KEY, JSON.stringify(all.slice(-800)));
    } catch (e) {}
    /* The device keeps the record whatever happens next. Pushing it to the
       account is a best effort on top: a failed push leaves the row exactly
       where it was, and the next sync carries it. */
    pushResults();
  }

  /* ---- the account ------------------------------------------------------
     The session cookie is scoped to .thexigames.com, so a player signed in on
     the crossword is already signed in here — there was simply nothing for it
     to carry until migration 020 gave results a game column. Same two calls
     the crossword makes, in the same order: push this device's rows, then pull
     everything the account has from anywhere. The other way round fetches,
     merges, and then pushes rows the account already had. */
  var account = null;
  /* A caught account failure is LOGGED, never re-thrown and never surfaced as
     an error to the player — the device's copy is intact and the next sync
     carries it, so the game must not degrade. But silence is how migration 002
     sat unapplied for months while every write threw, and how an INSERT with
     the wrong number of placeholders reached production behind a green suite.
     The console line is for the person with devtools open asking exactly the
     question these catches used to eat. */
  function accountNote(what, err) {
    try { console.warn("[account] " + what + " failed:", err && err.message ? err.message : err); } catch (e) {}
  }
  function apiAuth(path, body) {
    var opts = {
      method: body ? "POST" : "GET",
      headers: { "X-XI-Games": "1" },     // the CSRF check on the server
      credentials: "same-origin",
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }
  function pushResults() {
    if (!account) return Promise.resolve(null);
    return apiAuth("/api/account/migrate",
      { game: "wordsearch", results: readResults() }).catch(function (e) { accountNote("push", e); return null; });
  }
  function pullResults() {
    if (!account) return Promise.resolve(null);
    return apiAuth("/api/account/results?game=wordsearch").then(function (r) {
      var remote = (r && r.results) || [];
      if (!remote.length) return null;
      /* Merge by day, which is what a row is unique by — the same key the
         server dedupes on, so the two sides cannot disagree about what counts
         as the same board.

         FIRST BANKED WINS, and the account holds it. This used to let the
         device's own row win, on the reasoning that it was the one actually
         played here. With two devices that produced a PC showing 1/11 and an
         iPad showing 4/11 of the same board forever: each pull threw away the
         account's answer, and each push was ignored server-side because
         INSERT OR IGNORE keeps the row banked first. Neither device was wrong
         by its own rule, and they never reconciled.

         The account's row wins outright. A local row the account has never
         seen survives — that is a row not yet pushed, not a row in conflict.
         Local is applied FIRST and remote second, so remote overwrites. */
      var byDay = {};
      readResults().forEach(function (r2) { if (r2 && r2.day) byDay[r2.day] = r2; });
      remote.forEach(function (r2) { if (r2 && r2.day) byDay[r2.day] = r2; });
      var merged = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
      try { localStorage.setItem(RESULTS_KEY, JSON.stringify(merged.slice(-800))); } catch (e) {}
      return merged.length;
    }).catch(function (e) { accountNote("pull", e); return null; });
  }
  function syncAccount() {
    return apiAuth("/api/auth/session").then(function (r) {
      account = (r && r.user) || null;
      if (!account) return null;
      return pushResults().then(pullResults);
    }).catch(function (e) {
      /* A TRANSIENT failure is not a sign-out. This used to null the account,
         so one flaky /api/auth/session call silently disabled sync for the
         whole page load — every later push and pull short-circuited on
         if (!account), with nothing shown. External review, finding 8. The
         signed-OUT case is the .then above resolving with no user; a network
         failure leaves whatever we knew in place. */
      accountNote("session", e);
      return null;
    });
  }
  function pruneDailyState() {
    try {
      var cutoff = Date.now() - 3 * 86400000;
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k || k.indexOf("xiws.daily.") !== 0) continue;
        var t = Date.parse(k.slice(11) + "T00:00:00Z");
        if (isFinite(t) && t < cutoff) localStorage.removeItem(k);
      }
    } catch (e) {}
  }
  function dailySnapshot(status) {
    return {
      day: dayKey(), puzzle_id: puzzle.id, grid_hash: puzzle.hash,
      scoring_version: SCORING_VERSION, status: status,
      final_score: status === "complete" ? finalScore() : null,
      match_score: liveScore(), minute: footballMinute(),
      elapsed_seconds: elapsed, penalty_minutes: penaltyMinutes,
      found_count: found.size, found: Array.from(found), bonus_found: bonusFound,
      saved_at: Date.now(),
      completed_at: status === "complete" ? new Date().toISOString() : null,
    };
  }
  function saveDailyProgress() {
    if (mode !== "daily" || !puzzle || !startedAt || !serverDay) return;
    if (!varActive()) elapsed = (Date.now() - startedAt) / 1000;
    try { localStorage.setItem(dailyStorageKey(), JSON.stringify(dailySnapshot("in_progress"))); } catch (e) {}
  }

  /* ---- the board follows the player ------------------------------------ */
  var statePushT = null, stateSyncedAt = "", statePushArmedAt = 0;
  function stateEntryKey() { return serverDay ? "ws:" + serverDay : null; }
  function pushStateSoon() {
    if (!account || !stateEntryKey()) return;
    if (!statePushArmedAt) statePushArmedAt = Date.now();
    if (Date.now() - statePushArmedAt > 8000) { pushStateNow(); return; }
    clearTimeout(statePushT);
    statePushT = setTimeout(pushStateNow, 2500);
  }
  function pushStateNow() {
    clearTimeout(statePushT);
    statePushArmedAt = 0;
    var k = stateEntryKey();
    if (!account || !k) return;
    var snap = null;
    try { snap = localStorage.getItem(dailyStorageKey()); } catch (e) {}
    if (!snap) return;
    apiAuth("/api/account/state", { game: "wordsearch", key: k, state: snap })
      .then(function (r) { if (r && r.updatedAt) stateSyncedAt = r.updatedAt; })
      .catch(function (e) { accountNote("state push", e); });
  }
  function clearRemoteState() {
    var k = stateEntryKey();
    if (!account || !k) return;
    apiAuth("/api/account/state", { game: "wordsearch", key: k, state: null })
      .catch(function (e) { accountNote("state clear", e); });
  }
  function pullState(then) {
    var k = stateEntryKey();
    if (!account || !k) { then(null); return; }
    apiAuth("/api/account/state?game=wordsearch&key=" + k)
      .then(function (r) {
        if (r && r.state && String(r.updatedAt || "") > String(stateSyncedAt || "")) {
          stateSyncedAt = r.updatedAt;
          then(r.state);
        } else then(null);
      })
      .catch(function (e) { accountNote("state pull", e); then(null); });
  }
  function saveDailyComplete(reason) {
    if (mode !== "daily" || !puzzle || !serverDay) return;
    var snap = dailySnapshot("complete"); snap.reason = reason;
    try { localStorage.setItem(dailyStorageKey(), JSON.stringify(snap)); } catch (e) {}
    recordResult({
      game: "wordsearch", day: snap.day, puzzle_id: snap.puzzle_id,
      score: snap.final_score, minute: snap.minute, found_count: snap.found_count,
      bonus_found: snap.bonus_found, complete: snap.found_count >= 11,
      at: Date.now(),
    });
    /* The journey ends when the result banks. */
    clearRemoteState();
  }
  function getDailyRecord() {
    try {
      var r = JSON.parse(localStorage.getItem(dailyStorageKey()) || "null");
      if (!r || r.scoring_version !== SCORING_VERSION) return null;
      if (r.puzzle_id !== puzzle.id || r.grid_hash !== puzzle.hash) return null;
      return r;
    } catch (e) { return null; }
  }

  /* The last save is not the last moment played. Closing the tab used to
     stop the clock for as long as the tab stayed closed — an unlimited free
     pause reachable by accident. Two halves of the fix: the gap since
     saved_at is charged on restore (capped at an hour, the crossword's cap —
     past full time the score has stopped falling anyway), and pagehide saves
     so the gap is measured from when the player actually left. */
  function chargeAwayTime(rec) {
    if (!rec || rec.status === "complete" || !rec.saved_at) return rec.elapsed_seconds || 0;
    var away = Math.round((Date.now() - rec.saved_at) / 1000);
    return (rec.elapsed_seconds || 0) + Math.min(Math.max(away, 0), 3600);
  }
  window.addEventListener("pagehide", function () {
    saveDailyProgress(); pushStateNow();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { saveDailyProgress(); pushStateNow(); }
  });

  /* ---- clock ----------------------------------------------------------- */
  function varActive() { return varPauseUntil > 0 && Date.now() < varPauseUntil; }
  function renderScore(v) {
    $("score").textContent = v === undefined ? finalScore() : v;
    $("scoreStar").textContent = bonusFound ? "★" : "☆";
    $("scoreStar").classList.toggle("found", bonusFound);
  }
  function updateClock() {
    if (varActive()) {
      $("clock").textContent = "VAR";
      renderScore(varFrozenScore);
      $("varBanner").classList.remove("hidden");
      $("varCountdown").textContent = Math.max(1, Math.ceil((varPauseUntil - Date.now()) / 1000)) + "s";
      return;
    }
    $("varBanner").classList.add("hidden");
    $("clock").textContent = footballMinute() + "'";
    renderScore();
  }
  function timerTick() {
    var now = Date.now();
    if (varPauseUntil) {
      if (now < varPauseUntil) { updateClock(); return; }
      /* Add back exactly the pause, however late the tick fires. */
      if (startedAt) startedAt += (varPauseUntil - varPauseStart);
      varPauseStart = 0; varPauseUntil = 0;
      toast("VAR complete · clock restarted");
    }
    elapsed = startedAt ? (now - startedAt) / 1000 : elapsed;
    updateClock();
    if (footballMinute() >= 90) finish("time");
  }
  function startTimer() {
    if (timer) clearInterval(timer);
    startedAt = Date.now() - elapsed * 1000;
    timer = setInterval(timerTick, 250);
  }

  /* ---- API ------------------------------------------------------------- */
  function api(path) {
    return fetch("/api/wordsearch/" + path, { headers: { "Accept": "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  /* ---- board rendering and geometry ------------------------------------ */
  function renderGrid() {
    Array.prototype.forEach.call(grid.querySelectorAll(".cell"), function (x) { x.remove(); });
    hlayer.innerHTML = ""; cellEls = [];
    var letters = puzzle.grid.join("").split("");
    letters.forEach(function (ch, i) {
      var d = document.createElement("div");
      d.className = "cell"; d.dataset.i = i; d.textContent = ch;
      d.setAttribute("role", "gridcell");
      grid.appendChild(d); cellEls.push(d);
    });
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", puzzle.theme + " word search grid");
    syncPanelHeight();
  }
  /* THE LIST ORDER. The DOM order is the payload order and never changes:
     the colour index, the highlight lookup and dataset.word all key off it,
     and rebuilding the list mid-play would lose the scroll position. What
     changes is the ORDER property — alphabetical while a name is unfound,
     pushed below every unfound name once it is found. One rank per word,
     computed once, read in two places. */
  function renderWords() {
    var list = $("wordList"); list.innerHTML = "";
    var rank = {};
    puzzle.answers.map(function (a) { return a.display; })
      .slice().sort(function (x, y) { return x.localeCompare(y, "en"); })
      .forEach(function (name, r) { rank[name] = r; });
    puzzle.answers.forEach(function (a, i) {
      var d = document.createElement("div");
      d.className = "word"; d.dataset.word = a.grid; d.textContent = a.display;
      d.dataset.rank = rank[a.display];
      d.style.order = rank[a.display];
      d.style.setProperty("--c", WORD_COLOURS[i % WORD_COLOURS.length]);
      list.appendChild(d);
    });
  }
  /* THE LAYOUT RULE: the board is the bottom of the used space. The panel's
     ceiling is the board's measured height, so the names list scrolls inside
     it and nothing on the right ever reaches below the grid. Re-measured on
     resize and on every zoom, because zoom changes the board's height and
     the panel must follow. */
  function syncPanelHeight() {
    var shell = $("gridShell"), side = $("side");
    if (!shell || !side) return;
    var h = shell.getBoundingClientRect().height;
    if (h > 100) side.style.setProperty("--board-h", Math.round(h) + "px");
  }
  window.addEventListener("resize", function () { syncPanelHeight(); redrawHighlights(); });

  /* ---- board zoom — the board and only the board ----------------------- */
  /* One CSS variable, --cell, scales the grid. The page, the panel and the
     toolbar never move; the shell scrolls if the board outgrows it. Buttons
     in the Board menu, and pinch on the grid, both end at the same setter. */
  var ZOOM_MIN = 22, ZOOM_MAX = 64, ZOOM_STEP = 4, ZOOM_DEFAULT = 34;
  function cellPx() { return parseFloat(getComputedStyle(grid).getPropertyValue("--cell")) || ZOOM_DEFAULT; }
  function setZoom(px) {
    px = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(px)));
    grid.style.setProperty("--cell", px + "px");
    redrawHighlights(); syncPanelHeight();
  }
  /* Pinch. The pointer count is DERIVED from the map — never kept in a
     separate counter. Crossword's pinch kept its own count, the two drifted,
     and every frontend run since v148 threw for it. One source. */
  var pts = new Map(), pinchStartDist = 0, pinchStartCell = 0;
  function pinchDist() {
    var a = Array.from(pts.values());
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  }
  function onPointerDown(e) {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      dragging = false; setPreview([]);
      pinchStartDist = pinchDist(); pinchStartCell = cellPx();
      return;
    }
    pointerDown(e);
  }
  function onPointerMove(e) {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      if (pinchStartDist > 0) setZoom(pinchStartCell * (pinchDist() / pinchStartDist));
      return;
    }
    pointerMove(e);
  }
  function onPointerEnd(e) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchStartDist = 0;
    if (pts.size === 0) pointerUp(e);
  }

  /* ---- selection ------------------------------------------------------- */
  var dirMap = { E:[0,1], W:[0,-1], S:[1,0], N:[-1,0], SE:[1,1], SW:[1,-1], NE:[-1,1], NW:[-1,-1] };
  function idxToRC(i) { return [Math.floor(i / COLS), i % COLS]; }
  function lineCells(a, b) {
    var A = idxToRC(a), B = idxToRC(b);
    var dr = B[0] - A[0], dc = B[1] - A[1];
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return [a];
    var n = Math.max(Math.abs(dr), Math.abs(dc));
    var sr = Math.sign(dr), sc = Math.sign(dc), out = [];
    for (var k = 0; k <= n; k++) out.push((A[0] + sr * k) * COLS + (A[1] + sc * k));
    return out;
  }
  function placementCells(pl, len) {
    var d = dirMap[pl.direction], out = [];
    for (var k = 0; k < len; k++) out.push((pl.start_row + d[0] * k) * COLS + (pl.start_col + d[1] * k));
    return out;
  }
  function sameCells(a, b) {
    if (a.length !== b.length) return false;
    var s = new Set(a); return b.every(function (x) { return s.has(x); });
  }
  function hitForSelection(cells) {
    var pool = puzzle.answers.map(function (a) { return { type: "answer", item: a }; })
      .concat([{ type: "bonus", item: puzzle.bonus }]);
    for (var i = 0; i < pool.length; i++) {
      var it = pool[i].item;
      if (pool[i].type === "answer" && found.has(it.grid)) continue;
      if (pool[i].type === "bonus" && bonusFound) continue;
      var pc = placementCells(it.placement, it.grid.length);
      if (sameCells(cells, pc)) return { type: pool[i].type, item: it, cells: pc };
    }
    return null;
  }
  function eventCell(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    return el && el.classList && el.classList.contains("cell") ? +el.dataset.i : null;
  }
  function setPreview(c) {
    preview.forEach(function (i) { if (cellEls[i]) cellEls[i].classList.remove("preview"); });
    preview = c;
    c.forEach(function (i) { if (cellEls[i]) cellEls[i].classList.add("preview"); });
  }
  function pointerDown(e) {
    var i = eventCell(e); if (i == null) return;
    e.preventDefault(); dragging = true; startIndex = i; setPreview([i]);
    if (grid.setPointerCapture) try { grid.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function pointerMove(e) {
    if (!dragging) return;
    var i = eventCell(e); if (i == null) return;
    setPreview(lineCells(startIndex, i));
  }
  function pointerUp() {
    if (!dragging) return;
    dragging = false;
    var cells = preview.slice(); setPreview([]);
    if (cells.length < 2) return;
    var hit = hitForSelection(cells);
    if (hit) {
      wrongRun = 0; clearTimeout(wrongResetTimer);
      if (hit.type === "answer") {
        found.add(hit.item.grid); drawHighlight(hit.item, false);
        toast("Found · " + hit.item.display.toUpperCase());
      } else {
        bonusFound = true; drawHighlight(hit.item, true);
        toast("★ Secret found · +10 at full time");
      }
      if (navigator.vibrate) navigator.vibrate(18);
      updateUI(); saveDailyProgress();
      /* Mirror the snapshot to the account HERE — a found word is the change
         worth carrying. The first wiring rode saveDailyProgress, which the
         clock calls every second, so the 2.5s debounce was re-armed forever
         and never fired — the exact starvation the crossword's tick comment
         records, rebuilt in a second game the same evening. Change-driven,
         never clock-driven. */
      pushStateSoon();
      return;
    }
    /* The foul. Escalates +1' to +4' for consecutive wrongs, capped at 15'
       total, resetting after seven quiet seconds. It feeds the 90' test, so
       fifteen minutes of fouls can turn a win into a draw — that is the rule,
       and how-to-play must say it in the same words. */
    wrongRun++;
    var add = Math.min(4, wrongRun), before = penaltyMinutes;
    penaltyMinutes = Math.min(15, penaltyMinutes + add);
    var applied = penaltyMinutes - before;
    clearTimeout(wrongResetTimer);
    wrongResetTimer = setTimeout(function () { wrongRun = 0; }, 7000);
    if (applied > 0) { showPenalty(applied); } else { toast("Penalty limit reached"); }
    updateClock(); saveDailyProgress();
    /* A foul is a change worth carrying too: penalties move the score. */
    pushStateSoon();
    cells.forEach(function (i) {
      var c = cellEls[i]; if (!c) return;
      c.classList.add("bad"); setTimeout(function () { c.classList.remove("bad"); }, 300);
    });
  }
  function showPenalty(mins) {
    var p = $("penaltyPop"); if (!p) return;
    p.textContent = "FOUL +" + mins + "'";
    p.classList.remove("show"); void p.offsetWidth; p.classList.add("show");
  }

  /* ---- highlights ------------------------------------------------------ */
  function drawHighlight(item, isBonus) {
    var cells = placementCells(item.placement, item.grid.length);
    var a = cellEls[cells[0]], b = cellEls[cells[cells.length - 1]];
    if (!a || !b) return;
    var g = grid.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    var x1 = ra.left - g.left + ra.width / 2, y1 = ra.top - g.top + ra.height / 2;
    var x2 = rb.left - g.left + rb.width / 2, y2 = rb.top - g.top + rb.height / 2;
    var len = Math.hypot(x2 - x1, y2 - y1), th = ra.width * 0.82;
    var el = document.createElement("div");
    el.className = "hl" + (isBonus ? " bonus" : "");
    el.dataset.word = item.grid; el.dataset.bonus = isBonus ? "1" : "";
    el.style.width = (len + th) + "px"; el.style.height = th + "px";
    el.style.left = (x1 - th / 2) + "px"; el.style.top = (y1 - th / 2) + "px";
    el.style.transformOrigin = (th / 2) + "px " + (th / 2) + "px";
    el.style.transform = "rotate(" + Math.atan2(y2 - y1, x2 - x1) + "rad)";
    var idx = puzzle.answers.findIndex(function (x) { return x.grid === item.grid; });
    el.style.background = isBonus ? "var(--gold)" : WORD_COLOURS[idx % WORD_COLOURS.length];
    hlayer.appendChild(el);
  }
  function redrawHighlights() {
    if (!puzzle || !hlayer) return;
    hlayer.innerHTML = "";
    puzzle.answers.forEach(function (a) { if (found.has(a.grid)) drawHighlight(a, false); });
    if (bonusFound) drawHighlight(puzzle.bonus, true);
  }

  /* ---- help — four cards, in the menu, Free Play only ------------------ */
  function competitive() { return mode === "daily"; }
  function useHelp(name) {
    if (competitive()) { toast("Help is unavailable in Team of the Day"); return false; }
    if (helpUsed.has(name)) { toast("That card has been used"); return false; }
    if (found.size >= 11) return false;
    helpUsed.add(name); assisted = true;
    refreshMenus();
    return true;
  }
  function remaining() { return puzzle.answers.filter(function (a) { return !found.has(a.grid); }); }
  var HELP = {
    auto: function () {
      if (found.size === 10 && !bonusFound) { toast("Find the secret before Auto-fill completes the XI"); return; }
      if (!useHelp("auto")) return;
      var rem = remaining(); if (!rem.length) return;
      var t = rem[Math.floor(Math.random() * rem.length)];
      found.add(t.grid); drawHighlight(t, false);
      toast("Auto-fill · " + t.display.toUpperCase()); updateUI();
    },
    first: function () {
      if (!useHelp("first")) return;
      var rem = remaining(); if (!rem.length) return;
      var t = rem[Math.floor(Math.random() * rem.length)];
      var i = placementCells(t.placement, t.grid.length)[0];
      flash(i, "first-hint", 2200); toast("First letter · starting square flashed");
    },
    live: function () {
      if (!useHelp("live")) return;
      var rem = remaining(); if (!rem.length) return;
      var t = rem[Math.floor(Math.random() * rem.length)];
      var cs = placementCells(t.placement, t.grid.length);
      var mid = cs.filter(function (_, i) { return i > 0 && i < cs.length - 1; });
      var pick = (mid.length ? mid : cs)[Math.floor(Math.random() * (mid.length || cs.length))];
      flash(pick, "live-hint", 6200); toast("Live letter · useful square highlighted");
    },
    var: function () {
      if (!useHelp("var")) return;
      varPauseStart = Date.now(); varPauseUntil = varPauseStart + 30000;
      varFrozenScore = finalScore();
      updateClock(); toast("VAR review · 30 seconds");
    },
  };
  function flash(i, cls, ms) {
    var c = cellEls[i]; if (!c) return;
    c.classList.remove(cls); void c.offsetWidth; c.classList.add(cls);
    setTimeout(function () { c.classList.remove(cls); }, ms);
  }

  /* ---- UI -------------------------------------------------------------- */
  function updateUI() {
    $("count").textContent = found.size;
    $("progress").style.width = (found.size / 11 * 100) + "%";
    Array.prototype.forEach.call($("wordList").children, function (x) {
      var done = found.has(x.dataset.word);
      x.classList.toggle("done", done);
      /* +100 clears the eleven unfound ranks, so every found name sits below
         every unfound one while both groups stay alphabetical inside. */
      x.style.order = (done ? 100 : 0) + Number(x.dataset.rank || 0);
    });
    $("bonusState").textContent = bonusFound ? "★ " + puzzle.bonus.display : "Undiscovered";
    $("bonusSub").textContent = bonusFound ? "A full +10 points at full time." : "Hidden in the grid · +10 points";
    if (found.size >= 11) {
      if (bonusFound) { finish("complete"); return; }
      $("finishPrompt").classList.add("show");
      clearTimeout(finishTimeout);
      finishTimeout = setTimeout(function () { finish("complete"); }, 30000);
    }
  }
  function toast(t) {
    clearTimeout(toastTimer);
    $("toast").textContent = t; $("toast").classList.add("show");
    toastTimer = setTimeout(function () { $("toast").classList.remove("show"); }, 1600);
  }

  /* ---- finishing ------------------------------------------------------- */
  function finish(reason) {
    if ($("result").classList.contains("show")) return;
    clearInterval(timer); timer = null;
    clearTimeout(finishTimeout);
    dragging = false; setPreview([]);
    $("finishPrompt").classList.remove("show");
    var m = footballMinute(), matchScore = liveScore(), sc = finalScore();
    $("resultScore").textContent = sc;
    $("resultEquation").textContent = bonusFound
      ? matchScore + " base + 10 bonus = " + sc
      : sc + " pts · bonus missed";
    $("resultClock").textContent = m + "'";
    $("resultFound").textContent = found.size + "/11";
    $("resultBonus").textContent = bonusFound ? "FOUND +10" : "MISSED";
    var missed = puzzle.answers.filter(function (a) { return !found.has(a.grid); })
      .map(function (a) { return a.display; });
    var pieces = [];
    if (reason === "time") {
      $("resultLine").textContent = "Full time — " + found.size + "/11 found." + (assisted ? " · Assisted" : "");
      if (missed.length) pieces.push("Missed: " + missed.join(", "));
      if (!bonusFound) pieces.push("Bonus: " + puzzle.bonus.display);
    } else {
      $("resultLine").textContent = (bonusFound ? "XI complete — secret bonus found too."
        : "XI complete. Bonus missed: " + puzzle.bonus.display + ".") + (assisted ? " · Assisted" : "");
    }
    $("resultMissed").textContent = pieces.join(" · ");
    $("resultMissed").classList.toggle("hidden", !pieces.length);
    saveDailyComplete(reason);
    $("result").classList.add("show");
  }

  /* ---- share — no squares until there is a season to draw -------------- */
  /* v4.3 factorised one board's score into a fake 38-game strip; that is the
     fault Crossword's season rules retire, not a convention to keep. Until a
     real W/D/L record exists the share carries the true numbers and nothing
     invented. Nothing names an answer, so a reader can still play it cold. */
  function shareText() {
    var label = mode === "daily" ? "Team of the day" : puzzle.theme;
    var total = finalScore();
    var scorePart = bonusFound ? liveScore() + " + 10 bonus = " + total + " pts"
                               : total + " pts · bonus missed";
    var line = scorePart + " · " + found.size + "/11 · " + footballMinute() + "'" + (assisted ? " · assisted" : "");
    var url = "https://www.thexigames.com/wordsearch/";
    var invite = mode === "daily" ? url : "Beat it: " + url + "#p=" + puzzle.id;
    return "Wordsearch XI · " + label + "\n" + line + "\n" + invite;
  }
  function doShare() {
    var text = shareText();
    if (navigator.share) { navigator.share({ text: text }).catch(function () { copy(text); }); return; }
    copy(text);
  }
  function copy(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast("Result copied"); },
        function () { toast("Copy failed"); });
    } else toast("Copy failed");
  }

  /* ---- loading and restoring boards ------------------------------------ */
  function enterBoard(p, label) {
    puzzle = p;
    found = new Set(); bonusFound = false;
    elapsed = 0; penaltyMinutes = 0; wrongRun = 0; assisted = false;
    helpUsed = new Set(); varPauseStart = 0; varPauseUntil = 0; varFrozenScore = 114;
    $("prematch").classList.add("hidden");
    $("gameApp").classList.remove("hidden");
    $("result").classList.remove("show");
    $("finishPrompt").classList.remove("show");
    $("themeTitle").textContent = p.theme;
    $("modeLabel").textContent = label;
    renderGrid(); renderWords(); updateUI(); refreshMenus();
  }
  var stateAdopted = false;   /* one adoption per page: the re-entry guard */
  function startDaily(p) {
    mode = "daily";
    enterBoard(p, "Team of the day");
    /* The account may hold a NEWER journey, pushed by another device. Async:
       the board opens from the local record immediately and upgrades if the
       account knows better — first paint never waits on a network call. The
       adopted snapshot goes through the SAME localStorage slot and the same
       getDailyRecord() guards (scoring version, puzzle id, grid hash), so a
       stale or foreign snapshot is dropped by the checks that already police
       local saves rather than by a second copy of them here. */
    if (!stateAdopted) pullState(function (remote) {
      if (!remote || stateAdopted) return;
      try {
        var snap = JSON.parse(remote);
        var local = getDailyRecord();
        /* A completed local record is settled; and a snapshot with fewer
           found words than this device already has is history, not news. */
        if (local && local.status === "complete") return;
        if (local && (local.found_count || 0) >= (snap.found_count || 0)) return;
        stateAdopted = true;
        localStorage.setItem(dailyStorageKey(), remote);
        if (mode === "daily") startDaily(puzzle);
      } catch (e) { accountNote("state adopt", e); }
    });
    var rec = getDailyRecord();
    if (rec && rec.status === "complete") { showStoredResult(rec); return; }
    if (rec) {
      found = new Set(rec.found || []); bonusFound = !!rec.bonus_found;
      penaltyMinutes = rec.penalty_minutes || 0;
      elapsed = chargeAwayTime(rec);
      $("modeLabel").textContent = "Team of the day · resumed";
      redrawHighlights(); updateUI();
    }
    startTimer(); updateClock(); saveDailyProgress();
  }
  function showStoredResult(rec) {
    clearInterval(timer); timer = null; startedAt = null;
    found = new Set(rec.found || []); bonusFound = !!rec.bonus_found;
    elapsed = rec.elapsed_seconds || 0; penaltyMinutes = rec.penalty_minutes || 0;
    redrawHighlights(); updateUI();
    $("modeLabel").textContent = "Team of the day · completed";
    $("clock").textContent = (rec.minute || 0) + "'";
    renderScore(rec.final_score);
    $("resultScore").textContent = rec.final_score;
    $("resultEquation").textContent = rec.bonus_found
      ? rec.match_score + " base + 10 bonus = " + rec.final_score
      : rec.final_score + " pts · bonus missed";
    $("resultClock").textContent = (rec.minute || 0) + "'";
    $("resultFound").textContent = rec.found_count + "/11";
    $("resultBonus").textContent = rec.bonus_found ? "FOUND +10" : "MISSED";
    $("resultLine").textContent = "Today's result · the Daily is one attempt.";
    $("resultMissed").classList.add("hidden");
    $("result").classList.add("show");
  }
  function startFree(p) {
    mode = "free";
    enterBoard(p, "Free play");
    startTimer(); updateClock();
  }

  /* ---- pre-match ------------------------------------------------------- */
  function fillBrowser() {
    var cats = {};
    catalogBoards.forEach(function (b) { (cats[b.category] = cats[b.category] || []).push(b); });
    var catSel = $("catSelect"), boardSel = $("boardSelect");
    catSel.innerHTML = "";
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c + " (" + cats[c].length + ")";
      catSel.appendChild(o);
    });
    function fillBoards() {
      boardSel.innerHTML = "";
      (cats[catSel.value] || []).forEach(function (b) {
        var o = document.createElement("option"); o.value = b.id; o.textContent = b.theme;
        boardSel.appendChild(o);
      });
    }
    catSel.onchange = fillBoards; fillBoards();
  }
  function setPrematchMode(next) {
    mode = next;
    document.querySelectorAll(".mode").forEach(function (x) {
      x.classList.toggle("active", x.dataset.mode === next);
    });
    $("freeBrowser").classList.toggle("hidden", next !== "free");
    $("kickBtn").textContent = next === "free" ? "Play selected board" : "Kick off";
  }
  function goToMenu() {
    if (mode === "daily" && startedAt && found.size < 11) saveDailyProgress();
    clearInterval(timer); timer = null; startedAt = null;
    varPauseUntil = 0;
    $("result").classList.remove("show");
    $("gameApp").classList.add("hidden");
    $("prematch").classList.remove("hidden");
    location.hash = "";
  }

  /* ---- menus ----------------------------------------------------------- */
  var MENUS = [["gameMenu","gameBtn"],["helpMenu","helpBtn"],["zoomMenu","zoomBtn"],["setMenu","setBtn"]];
  function closeMenus(except) {
    MENUS.forEach(function (pair) {
      var m = $(pair[0]), b = $(pair[1]);
      if (!m || !b) return;
      if (pair[0] !== except) m.classList.add("hidden");
      b.setAttribute("aria-expanded", m.classList.contains("hidden") ? "false" : "true");
    });
  }
  function toggleMenu(menuId, btnId) {
    var m = $(menuId); if (!m) return;
    var willOpen = m.classList.contains("hidden");
    closeMenus(willOpen ? menuId : null);
    m.classList.toggle("hidden", !willOpen);
    $(btnId).setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) refreshMenus();
  }
  function refreshMenus() {
    document.querySelectorAll("#helpMenu .menuRow[data-help]").forEach(function (r) {
      var used = helpUsed.has(r.dataset.help);
      r.disabled = competitive() || used;
      var meta = r.querySelector(".menuMeta");
      if (meta) meta.textContent = competitive() ? "daily" : used ? "used" : meta.dataset.base;
    });
    var note = $("helpNote");
    if (note) note.textContent = competitive()
      ? "Help is unavailable in Team of the Day."
      : "Each card can be used once per board. Using help marks the result as assisted.";
    var ver = $("menuVer"); if (ver) ver.textContent = "build " + BUILD;
  }

  /* ---- boot ------------------------------------------------------------ */
  function boot() {
    grid = $("grid"); hlayer = $("highlightLayer");
    $("buildTag").textContent = BUILD;
    pruneDailyState();
    /* Fire and forget: nothing on this page waits for an account. A signed-out
       player, an offline device and a failed request all reach the board at
       the same speed. */
    syncAccount();

    grid.addEventListener("pointerdown", onPointerDown);
    grid.addEventListener("pointermove", onPointerMove);
    grid.addEventListener("pointerup", onPointerEnd);
    grid.addEventListener("pointercancel", onPointerEnd);

    document.querySelectorAll(".mode").forEach(function (b) {
      b.onclick = function () { setPrematchMode(b.dataset.mode); };
    });
    $("kickBtn").onclick = function () {
      if (mode === "daily") {
        if (!window.__daily) { toast("No Daily today — try Free play"); setPrematchMode("free"); return; }
        startDaily(window.__daily);
      } else {
        var id = $("boardSelect").value;
        if (!id) { toast("Pick a board"); return; }
        api("puzzle?id=" + encodeURIComponent(id)).then(function (r) { startFree(r.puzzle); },
          function () { toast("Board unavailable"); });
      }
    };
    $("gameBtn").onclick = function () { toggleMenu("gameMenu", "gameBtn"); };
    $("helpBtn").onclick = function () { toggleMenu("helpMenu", "helpBtn"); };
    $("zoomBtn").onclick = function () { toggleMenu("zoomMenu", "zoomBtn"); };
    $("setBtn").onclick = function () { toggleMenu("setMenu", "setBtn"); };
    document.querySelectorAll("#gameMenu .menuRow").forEach(function (r) {
      r.onclick = function () {
        closeMenus();
        if (r.dataset.act === "menu") { goToMenu(); return; }
        if (r.dataset.act === "daily") { goToMenu(); setPrematchMode("daily"); return; }
        if (r.dataset.act === "free") { goToMenu(); setPrematchMode("free"); return; }
      };
    });
    document.querySelectorAll("#helpMenu .menuRow[data-help]").forEach(function (r) {
      r.onclick = function () { closeMenus(); HELP[r.dataset.help](); };
    });
    document.querySelectorAll("#zoomMenu .menuRow[data-zoom]").forEach(function (r) {
      r.onclick = function () {
        var z = r.dataset.zoom;
        if (z === "in") setZoom(cellPx() + ZOOM_STEP);
        else if (z === "out") setZoom(cellPx() - ZOOM_STEP);
        else setZoom(ZOOM_DEFAULT);
      };
    });
    document.querySelectorAll("#setMenu .menuRow").forEach(function (r) {
      r.onclick = function () {
        if (r.dataset.set === "theme") { themeCycle(); return; }
        closeMenus(); goToMenu();
      };
    });
    document.addEventListener("pointerdown", function (e) {
      if (!e.target.closest(".menuWrap")) closeMenus();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenus(); });
    $("keepBtn").onclick = function () {
      $("finishPrompt").classList.remove("show"); clearTimeout(finishTimeout);
    };
    $("finishBtn").onclick = function () { finish("complete"); };
    $("shareBtn").onclick = doShare;
    $("copyResult").onclick = doShare;
    $("againBtn").onclick = function () { goToMenu(); setPrematchMode("free"); };
    $("resultMenuBtn").onclick = goToMenu;

    /* The server decides the day and hands over the board; the catalog fills
       the browser. Neither response contains a schedule. */
    api("daily").then(function (r) {
      serverDay = r.day; window.__daily = r.puzzle;
      var sub = $("dailyModeSub");
      if (sub) sub.textContent = r.puzzle
        ? "One fixed board for everyone today."
        : "No Daily scheduled today — Free play is open.";
    }, function () {
      $("bankLine").textContent = "Could not reach the server — check your connection.";
    });
    api("catalog").then(function (r) {
      catalogBoards = r.boards || [];
      $("bankLine").textContent = catalogBoards.length + " released boards · a new Daily every day";
      fillBrowser();
      /* #p= is a Free Play invitation and nothing more: the endpoint refuses
         unreleased ids, so the link cannot be a door to a future daily. */
      var m = location.hash.match(/p=(XIWS-\d{4})/);
      if (m) {
        api("puzzle?id=" + m[1]).then(function (r2) { startFree(r2.puzzle); },
          function () { toast("That board is not available"); });
      }
    }, function () {
      $("bankLine").textContent = "Could not load the board list.";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
