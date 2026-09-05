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
  var BUILD = "v002j";
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
  /* WHERE EACH FOUND WORD SITS, learned one word at a time.
     The daily's board no longer travels with its placements — the server
     judges a selection and hands back the placement of whatever it hit, which
     is the only moment a player is entitled to know where a word is. So the
     lines drawn through the grid are drawn from here rather than from the
     board, and a resumed round asks the server what it already found.
     Free Play is unchanged: it keeps the whole board, because it is unscored,
     it has help cards that reveal squares outright, and it is not the board
     anybody is competing on. */
  var placements = Object.create(null);
  /* THE SECRET WORD, learned the same way: from the server when it is found,
     or from full time when the round is over and naming it is the point. The
     daily's board arrives with the clue and the length and not the word. */
  var secretWord = null;
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
  /* Decided in shared/xi-theme.js now, and stamped before first paint: light
     unless the player chose otherwise, auto following the system, one
     resolver for every page of the family. This only shows the choice and
     asks the shared script to move on. */
  /* THE THEME IS THE FAMILY'S AND THIS GAME DOES NOT TOUCH IT. There was a
     reader, an applier and a cycler here, feeding a label in a menu of this
     game's own — a second control for a setting the bar already carries. The
     menu is gone and so is all of this: shared/xi-theme.js decides the theme
     and the chrome's Settings row is where it is changed, in every game. */

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
  /* THE CHROME OWNS THE IDENTITY. Its account sheet announces a sign-in, a
     sign-out or a rename on document as xi:account; this game answers by
     syncing its own results, which is the one part that is still its own. */
  document.addEventListener("xi:account", function (ev) {
    var d = ev.detail || {};
    if (d.type === "signout") { account = null; return; }
    syncAccount();
  });
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
  /* ---- the live league table ------------------------------------------
     Your score IS your club's points in a real historical season, and it moves
     you up and down a real ladder while you play. Built by shared/xi-table.js;
     this file only says which board it is and what the score is now.

     The SEED IS THE SERVER'S DAY, so everybody on today's board sees the same
     season. A device clock, or a random pick, would give two players different
     ladders for one board and make comparing anything meaningless. */
  var leagueTable = null;
  function mountTable() {
    if (leagueTable || !window.XITable) return;
    var el = $("tablePanel");
    if (!el) return;
    leagueTable = window.XITable.mount(el, { seed: dayKey(), score: liveScore() });
  }

  function renderScore(v) {
    var shown = v === undefined ? finalScore() : v;
    $("score").textContent = shown;
    $("scoreStar").textContent = bonusFound ? "★" : "☆";
    $("scoreStar").classList.toggle("found", bonusFound);
    /* The table follows the same number the scoreboard shows — read from one
       place rather than recomputed, so the ladder can never disagree with the
       score printed above it. */
    if (leagueTable) leagueTable.update(shown);
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
        if (r.ok) return r.json();
        /* THE SERVER'S OWN WORDS, AND ITS STATUS. This threw "HTTP 401" and
           dropped the body, so a refusal that explains itself — an old board
           asking the player to register — arrived as a number the page could
           only report. Both are carried now: the status is what the page
           branches on, the message is what a person reads. */
        return r.json().then(function (j) {
          var e = new Error((j && j.error) || ("HTTP " + r.status));
          e.status = r.status;
          throw e;
        }, function () {
          var e = new Error("HTTP " + r.status);
          e.status = r.status;
          throw e;
        });
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
    fitBoard(true);
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
  /* THE CARD IS WHAT IS WATCHED, not the window.
     A window resize is the wrong signal twice over. It fires when iOS hides
     its toolbar, which moves nothing that matters, and it does NOT fire when
     the card itself changes width — which happens when the panel moves above
     the grid at the narrow breakpoint, and when the game view replaces the
     landing. That second case is how a phone ended up with a board sized for
     a card it was no longer in, half the width of the one it was drawn in,
     with the rest of the card empty beside it. A ResizeObserver on the card
     fires for exactly the thing the fit depends on, and for nothing else. */
  if (typeof ResizeObserver === "function") {
    try {
      new ResizeObserver(function () { fitBoard(); redrawHighlights(); })
        .observe($("gridShell"));
    } catch (e) { /* an old browser keeps the window listener below */ }
  }
  /* Kept for a browser with no ResizeObserver, and for the suites, where
     every box measures zero and only this path runs. */
  window.addEventListener("resize", function () { fitBoard(); redrawHighlights(); });
  window.addEventListener("orientationchange", function () { setTimeout(function () { fitBoard(); }, 250); });

  /* ---- board zoom — the board and only the board ----------------------- */
  /* One CSS variable, --cell, scales the grid. The page, the panel and the
     toolbar never move; the shell scrolls if the board outgrows it. Buttons
     in the Board menu, and pinch on the grid, both end at the same setter. */
  /* ZOOM_MAX was 64, which the fit reached on any card wider than about 780px
   and then stopped, leaving the strip of white space the fit exists to
   remove. It is a ceiling for a board nobody wants to read, not a size the
   layout should run into: twelve columns at 96px is 1152px, wider than any
   card the layout builds. */
  var ZOOM_MIN = 22, ZOOM_MAX = 96, ZOOM_STEP = 4, ZOOM_DEFAULT = 34;
  function cellPx() { return parseFloat(getComputedStyle(grid).getPropertyValue("--cell")) || ZOOM_DEFAULT; }
  function setZoom(px) {
    px = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(px)));
    grid.style.setProperty("--cell", px + "px");
    redrawHighlights(); syncPanelHeight();
  }

  /* THE BOARD FILLS THE CARD IT SITS IN.
     --cell was a flat 34px whatever the screen, and the grid was centred in
     a card that stretches. On an iPad that put a 424px board in a 680px card
     with 128px of nothing down each side, and the board was the one thing on
     the page that could have used the room. The cell is now the largest that
     fits the card's width, and the board's height is held inside the window
     so filling the width never pushes the last rows out of sight.
     ZOOM_DEFAULT survives as the fallback for a page with no layout yet — a
     suite in jsdom measures every box as zero, and a board of ZOOM_MIN tiles
     there would be a measurement artefact, not a fit. */
  var userZoomed = false, fittedAt = 0;
  /* WIDTH, AND NOTHING ELSE.
     The first version of this took the window's height into account so the
     whole board would fit without scrolling. Two things went wrong on a real
     iPad, both reported.

     Scrolling changed the size. Safari hides its toolbars as you scroll and
     fires a resize for it, so the height moved, the fit moved with it, and
     the board grew and shrank under the reader's hands.

     And in landscape the height is the tighter of the two, so the cell came
     out at the height's answer and left a third of the card empty down the
     right — the very white space this was meant to remove.

     So the board is sized by the width it has been given, which does not
     change when a toolbar hides, and a board taller than the window is
     scrolled to like any other long page. */
  function fitCell() {
    if (!grid) return ZOOM_DEFAULT;
    var shell = $("gridShell");
    if (!shell) return ZOOM_DEFAULT;
    var w = shell.clientWidth - 16;                 /* .grid padding, both sides */
    if (!(w > 0)) return ZOOM_DEFAULT;              /* no layout: jsdom, or pre-paint */
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(w / COLS)));
  }
  /* Refitted only when the WIDTH has actually changed. A resize on iOS is
     usually the toolbar, not the layout; refitting on every one of them is
     what made the board move while it was being read. */
  function fitBoard(force) {
    var shell = $("gridShell");
    var w = shell ? shell.clientWidth : 0;
    /* A card that is not on screen yet measures zero, and zero is not an
       answer — recording it would make the next real measurement look like
       no change at all if it also came back zero, and would fit the board to
       a card it has not been given. The board keeps whatever it has and the
       next call, from the observer or from the next resize, does the fit. */
    if (w <= 0) return;
    if (!force && w === fittedAt) { syncPanelHeight(); return; }
    fittedAt = w;
    /* Someone who has zoomed has said what size they want; a rotation must
       not argue with it. */
    if (userZoomed) { redrawHighlights(); syncPanelHeight(); return; }
    setZoom(fitCell());
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
    /* Under the cover nothing is a drag: the letters are not readable and
       the clock has not started, so a swipe must not find a word for free. */
    if (pending) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* NO PINCH ON A PHONE. The board is already the width of the screen
       there, so pinching can only make it worse, and a second finger landing
       during a drag is far more likely to be a hand resting on the glass
       than a request to resize. Reported as the board zooming in and out on
       a phone for no reason the player asked for. The Board menu still has
       its controls on every screen. */
    if (pts.size === 2 && window.innerWidth < 760) { pts.delete(e.pointerId); return; }
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
      if (pinchStartDist > 0) { userZoomed = true; setZoom(pinchStartCell * (pinchDist() / pinchStartDist)); }
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
  /* THE DAILY IS JUDGED BY THE SERVER, and Free Play by the page.
     This function IS the old game: it compared a drag against placements the
     browser had been given, which is why the browser had to be given them,
     which is why the answers travelled and no score could mean anything. It
     survives for Free Play, where the whole board is served on purpose. */
  function judgedHere() { return mode !== "daily"; }

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
  /* WHAT A FOUND WORD DOES, wherever the verdict came from. Lifted out of
     pointerUp so the server's answer and Free Play's own take the same path:
     two ways to be told, one thing that happens. */
  function acceptHit(item, isBonus) {
    wrongRun = 0; clearTimeout(wrongResetTimer);
    if (item.placement) placements[item.grid] = item.placement;
    if (isBonus) {
      bonusFound = true;
      if (item.display) secretWord = item.display;
      drawHighlight(item, true);
      toast("★ Secret found · +10 at full time");
    } else {
      found.add(item.grid);
      drawHighlight(item, false);
      toast("Found · " + String(item.display).toUpperCase());
    }
    if (navigator.vibrate) navigator.vibrate(18);
    updateUI(); saveDailyProgress();
    pushStateSoon();
  }

  /* AND WHAT A MISS DOES. The escalation is the page's to show — the server
     keeps its own rows and re-derives the same penalty at full time from the
     times it recorded, so the number on screen and the number in the score
     come from one rule applied twice rather than from two rules. */
  function acceptFoul() {
    wrongRun++;
    var add = Math.min(S.FOUL_STEP_MAX, wrongRun), before = penaltyMinutes;
    penaltyMinutes = Math.min(S.FOUL_CAP, penaltyMinutes + add);
    var applied = penaltyMinutes - before;
    clearTimeout(wrongResetTimer);
    wrongResetTimer = setTimeout(function () { wrongRun = 0; }, S.FOUL_RESET_MS);
    if (applied > 0) { showPenalty(applied); } else { toast("Penalty limit reached"); }
    updateClock(); saveDailyProgress();
    pushStateSoon();
  }

  /* The selection, sent up. Two squares — the ends of the drag — because the
     line between them is the server's to work out, and a page that sent the
     whole path could send a path the game does not allow.

     Best effort: a request that never lands leaves the drag unjudged and the
     player tries again. Nothing is marked on a promise. */
  function sendSelection(cells) {
    var id = playIdOf();
    var from = [Math.floor(cells[0] / COLS), cells[0] % COLS];
    var last = cells[cells.length - 1];
    var to = [Math.floor(last / COLS), last % COLS];
    fetch("/api/wordsearch/find", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ playId: id, from: from, to: to }),
    })
      .then(function (r) { return r.json(); })
      .then(function (v) {
        if (v && v.hit) acceptHit(v.hit, !!v.hit.bonus);
        else if (v && v.foul) { acceptFoul(); flashWrong(cells); }
      })
      .catch(function () { /* unjudged: the drag simply did not happen */ });
  }

  /* The red flash a wrong selection gets, which used to live inline at the
     bottom of pointerUp and is now wanted from two places. */
  function flashWrong(cells) {
    cells.forEach(function (i) {
      var c = cellEls[i]; if (!c) return;
      c.classList.add("bad");
      setTimeout(function () { c.classList.remove("bad"); }, 300);
    });
  }

  function pointerUp() {
    if (!dragging) return;
    dragging = false;
    var cells = preview.slice(); setPreview([]);
    if (cells.length < 2) return;

    /* THE DAILY ASKS. Free Play still judges here, because it holds the whole
       board on purpose; the daily does not hold it and must not, so the two
       squares go up and the server says what they hit. The answer comes back
       with the word's placement — earned, one word at a time — and the page
       draws it exactly as it always did. */
    if (!judgedHere()) { sendSelection(cells); return; }

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
       and how-to-play must say it in the same words.
       Written out here once, and then again in acceptFoul when the judging
       moved: two copies of an escalation, in one file, four lines apart. This
       is the call. */
    acceptFoul();
    flashWrong(cells);
  }
  function showPenalty(mins) {
    var p = $("penaltyPop"); if (!p) return;
    p.textContent = "FOUL +" + mins + "'";
    p.classList.remove("show"); void p.offsetWidth; p.classList.add("show");
  }

  /* ---- highlights ------------------------------------------------------ */
  /* THE PLACEMENT, WHEREVER IT CAME FROM. Free Play has it on the board;
     the daily learns it from the server as each word is found. Asked for
     here so every caller draws the same way and none of them has to know
     which game it is in. */
  function placementOf(item) { return item.placement || placements[item.grid] || null; }

  function drawHighlight(item, isBonus) {
    var pl = placementOf(item);
    if (!pl) return;
    var cells = placementCells(pl, item.grid.length);
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
    /* A found word with no placement cannot be drawn, and that is not an
       error: on the daily a resumed round asks the server for both together,
       and until it answers the word is ticked in the list without a line
       through the grid. Better a missing line than a guessed one. */
    puzzle.answers.forEach(function (a) { if (found.has(a.grid)) drawHighlight(a, false); });
    if (bonusFound && puzzle.bonus) drawHighlight(puzzle.bonus, true);
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
    /* THE CLUE IS SHOWN. Every board carries one for its bonus, and the
       server has always sent it; the box said "Undiscovered" and threw it
       away, so a player had no idea what they were hunting for. The clue and
       the length are the hunt; the word itself stays hidden until found. */
    var bonusClue = puzzle.bonus && puzzle.bonus.clue;
    /* The length comes down with the clue now — it is part of the hunt, not
       part of the answer — and Free Play still has the whole word. */
    var bonusLen = (puzzle.bonus && (puzzle.bonus.len ||
      (puzzle.bonus.grid ? puzzle.bonus.grid.length : 0))) || 0;
    var known = secretWord || (puzzle.bonus && puzzle.bonus.display) || null;
    $("bonusState").textContent = bonusFound && known ? "★ " + known
      : bonusFound ? "★ Found"
      : (bonusClue || "Undiscovered");
    $("bonusSub").textContent = bonusFound ? "A full +10 points at full time."
      : (bonusLen ? bonusLen + " letters · " : "") + "Hidden in the grid · +10 points";
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
  /* What the server makes of the round, once the page has drawn its own card.
     Best effort throughout: a round it cannot verify keeps the number the card
     has always called the device's own. */
  function askServerScore(reason, localScore) {
    var id = playIdOf();
    if (!id || mode !== "daily") return;
    fetch("/api/wordsearch/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ playId: id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (v) {
        if (!v) return;
        /* The secret, if the round is over. Redraw whichever lines name it. */
        if (v.secret && !secretWord) { secretWord = v.secret; updateUI(); }
        if (!v.verified) return;
        $("resultScore").textContent = v.score;
        $("resultEquation").textContent = v.bonusFound
          ? v.base + " base + " + v.bonus + " bonus = " + v.score
          : v.score + " pts · bonus missed";
        var note = $("resultVerified");
        if (note) {
          note.textContent = v.score === localScore
            ? "Verified by the server."
            : "Verified by the server — " + v.score + " rather than " + localScore +
              ", timed from when the board was opened.";
        }
      })
      .catch(function () { /* the card keeps its own number */ });
  }


  function finish(reason) {
    if ($("result").classList.contains("show")) return;
    clearInterval(timer); timer = null;
    clearTimeout(finishTimeout);
    /* The attempt ends here, finished if the XI is complete, else at time. */
    playsEnd(found.size >= 11);
    dragging = false; setPreview([]);
    $("finishPrompt").classList.remove("show");
    var m = footballMinute(), matchScore = liveScore(), sc = finalScore();
    $("resultScore").textContent = sc;
    /* AND THE SERVER'S OWN NUMBER, ASKED FOR AFTER THE CARD IS DRAWN. It
       judged every selection, timed the board from a clock it started, and
       kept every foul in order — so it can work the score out without being
       told any of it, and it writes plays.srv_score, which is what a challenge
       table reads. The card keeps the device's number until the answer comes
       back, and keeps it for good on a round nothing could verify.
       The same request is what reveals a missed secret: the server decides the
       round is over from its own rows, and only then says the word. */
    askServerScore(reason, sc);
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
      /* Named only if it is known: on the daily that means full time has
         been reached and the server has said it. */
      var missedSecret = secretWord || (puzzle.bonus && puzzle.bonus.display);
      if (!bonusFound && missedSecret) pieces.push("Bonus: " + missedSecret);
    } else {
      var theSecret = secretWord || (puzzle.bonus && puzzle.bonus.display);
      $("resultLine").textContent = (bonusFound ? "XI complete — secret bonus found too."
        : theSecret ? "XI complete. Bonus missed: " + theSecret + "."
        : "XI complete. The secret stayed hidden.") + (assisted ? " · Assisted" : "");
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
    var url = "https://www.thexigames.com/football/wordsearch/";
    var invite = mode === "daily" ? url : "Beat it: " + url + "#p=" + puzzle.id;
    return "Wordsearch XI · " + label + "\n" + line + "\n" + invite;
  }
  function doShare() {
    var text = shareText();
    if (navigator.share) { navigator.share({ text: text }).catch(function () { copy(text); }); return; }
    copy(text);
  }

  /* THE SHARE ROW, THE FAMILY'S. This game hands over its own text and the
     address of the board it was scored on; shared/xi-share.js owns the
     buttons, the platforms and the copy fallback, so every game offers the
     same way out. Mounted once — the text is read when a button is pressed,
     not when it is built. */
  if (window.XIShare && document.getElementById("shareRow")) {
    window.XIShare.mount(document.getElementById("shareRow"), {
      text: shareText,
      url: function () { return location.href; },
    });
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
    playsStart("daily", "ws:" + serverDay);
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
    playsStart("free", p.id);
  }

  /* HOW FAR PEOPLE GET, counted through the family's helper: a start when a
     board opens, an end when it is finished or left. progress() is read at
     the end — by the finish, or by the helper on the way out of the page —
     so an abandoned board still says how many of the eleven it had. Nothing
     about the person; see shared/xi-plays.js. */
  function playsProgress() {
    return {
      solved: found.size, elapsed: Math.round(elapsed || 0),
      detail: { bonusFound: bonusFound, assisted: assisted, penaltyMinutes: penaltyMinutes },
    };
  }
  /* The attempt this round belongs to. Every selection names it, so the
     server can count the find against the clock it started. */
  function playIdOf() {
    var cur = window.XIPlays && window.XIPlays.current ? window.XIPlays.current() : null;
    return (cur && cur.playId) || null;
  }

  /* THE SERVER'S CLOCK, told once at kick off. From then on it has everything
     a score is made of, because it judges every selection: which words, when,
     and every miss in between.
     It answers with what this round has ALREADY found, which is how a resumed
     board gets its lines back — the page cannot draw them from a board that no
     longer carries placements, and asking the page what it thinks it found
     would be trusting the thing this whole change stopped trusting. */
  function startServerRound() {
    var id = playIdOf();
    if (!id || mode !== "daily") return;
    fetch("/api/wordsearch/round", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ playId: id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (v) {
        if (!v || !v.verified || !Array.isArray(v.found) || !v.found.length) return;
        /* Ticked in the list straight away; the lines follow as the placements
           arrive, and a word whose placement is unknown is simply not drawn. */
        v.found.forEach(function (f) {
          if (f.bonus) bonusFound = true; else found.add(f.word);
        });
        updateUI(); redrawHighlights();
      })
      .catch(function () { /* unverified, and the board plays on */ });
  }

  function playsStart(kind, boardKey) {
    if (!window.XIPlays) return;
    window.XIPlays.start({ game: "wordsearch", mode: kind, boardKey: boardKey, total: 11 }, playsProgress);
    /* After start, which is what mints the play id this names. */
    startServerRound();
  }
  function playsEnd(completed) {
    if (window.XIPlays && window.XIPlays.active()) window.XIPlays.end(!!completed);
  }

  /* Said on the hero, where the player is already looking. Guarded because
     two of its callers are the failure paths for the board list, and an error
     path that throws on a missing element reports nothing at all. */
  function setDailyState(text) {
    var el = $("homeDailyState");
    if (el) el.textContent = text || "";
  }

  /* ---- the landing --------------------------------------------------- */

  var featuredId = null;

  /* THE BOARD OF THE WEEK, picked by the week rather than chosen by anyone.
     Derived from the ISO week number so every player sees the same board and
     it changes on Monday without anything being scheduled or stored. The list
     is stable and sorted, so the same week always lands on the same board. */
  function weekIndex() {
    var d = new Date();
    var utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.floor(utc / 604800000);
  }
  function pickFeatured() {
    if (!catalogBoards.length) return null;
    var ordered = catalogBoards.slice().sort(function (x, y) {
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
    return ordered[weekIndex() % ordered.length];
  }
  /* A CHOSEN BOARD OPENS ON THE BOARD. Board of the week, a board arriving
     from its themes page, a previous day: each one opens the game with its
     letters and its eleven covered, named on a card over the grid, and the
     clock waiting for Kick off. Nothing starts because a link was followed;
     and nobody is sent back to the landing to choose again. */
  var pending = null;   /* the board opened and not yet kicked off */
  /* Guarded: jsdom, which the suites run in, has no scrollIntoView. */
  function nudge(el) {
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }
  function openBoard(board, kicker, note) {
    if (!board) return;
    hideArchive();
    api("puzzle?id=" + encodeURIComponent(board.id)).then(function (r) {
      pending = { puzzle: r.puzzle, kicker: kicker, note: note };
      mode = "free";
      enterBoard(r.puzzle, "Free play");
      $("kickKicker").textContent = kicker || "BOARD";
      $("kickTitle").textContent = r.puzzle.theme;
      $("kickNote").textContent = note ||
        (r.puzzle.category ? r.puzzle.category + " · free play, no run at stake" : "Free play, no run at stake");
      $("gameApp").classList.add("covered");
      $("kickCover").classList.remove("hidden");
    }, function (err) {
      /* A BOARD THAT NEEDS AN ACCOUNT IS NOT A FAILURE. The archive marks the
         locked days and asks before fetching, so this is the other door: a
         link to an old day. The sheet carries the reason and is a thing to
         act on, where a toast is a thing to miss. */
      if (err && err.status === 401 && window.XIChrome && window.XIChrome.archive) {
        window.XIChrome.archive.askToRegister(err.message);
        if (window.XIChrome.permalink) window.XIChrome.permalink.clear("wordsearch");
        return;
      }
      toast("Board unavailable");
    });
  }
  function uncover() {
    pending = null;
    $("gameApp").classList.remove("covered");
    $("kickCover").classList.add("hidden");
  }
  /* The permalink is read from the path by the shared chrome, which states
     its shape once for the family — see shared/xi-chrome.js, and
     functions/_lib/permalink.js for the server's half. */
  function permalinkKey() {
    return window.XIChrome && window.XIChrome.permalink ? window.XIChrome.permalink.read() : null;
  }

  /* HELD UNTIL BOTH FACTS ARE IN: which day the SERVER says it is, and what
     the archive holds. Either alone gets it wrong — the archive stops at
     yesterday by design, so a permalink for today is not in it, and deciding
     before the day is known would call today's board missing. Both fetches
     call this, and whichever lands second does the work. */
  var permaWaiting = null;
  function openPermalink() {
    var key = permalinkKey();
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    permaWaiting = key;
    tryPermalink();
  }
  function tryPermalink() {
    if (!permaWaiting || !serverDay || !archiveDays) return;
    var key = permaWaiting;
    permaWaiting = null;
    /* Today's permalink is today's board, which this page is already
       opening. Nothing to do, and nothing to say. */
    if (key === serverDay) {
      if (window.XIChrome && window.XIChrome.permalink) window.XIChrome.permalink.clear("wordsearch");
      return;
    }
    var entry = archiveDays.find(function (e) { return e.day === key; });
    if (!entry) { toast("That board is not available"); return; }
    if (window.XIChrome && window.XIChrome.permalink) {
      window.XIChrome.permalink.show("wordsearch", key);
      window.XIChrome.permalink.aged("wordsearch",
        Math.round((Date.parse(serverDay) - Date.parse(key)) / 86400000));
    }
    openBoard(entry, "PREVIOUS PUZZLE \u00b7 " + dayLabel(key).toUpperCase(),
      "Free play — only today's board keeps a run going.");
  }

  function selectBoard(id, kicker, note) {
    if (!id) return false;
    var b = catalogBoards.find(function (x) { return x.id === id; });
    if (!b) return false;
    openBoard(b, kicker, note);
    return true;
  }

  /* FORM, drawn by the shared chrome so a win looks the same in every game.
     This game owns what a RESULT is — a dated day rather than a numbered one
     — and hands over only the scores. */
  function renderForm() {
    var el = $("homeRun"), title = $("homeRunTitle");
    if (!el || !window.XIChrome) return;
    var done = readResults()
      .filter(function (r) { return r && r.status === "complete" && r.day; })
      .sort(function (x, y) { return x.day < y.day ? -1 : 1; });
    if (!done.length) {
      title.textContent = "No run yet";
      el.innerHTML = window.XIChrome.formChips([]) +
        '<span class="run-none">Play today to start one.</span>';
      return;
    }
    /* A run is consecutive DAYS ending today or yesterday. Ending earlier it
       is a run that was, and saying otherwise would be the streak lying. */
    var days = done.map(function (r) { return r.day; });
    var last = days[days.length - 1];
    var today = dayKey();
    var yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    var run = 0;
    if (last === today || last === yest) {
      run = 1;
      for (var i = days.length - 1; i > 0; i--) {
        var prev = new Date(Date.parse(days[i]) - 86400000).toISOString().slice(0, 10);
        if (days[i - 1] === prev) run++; else break;
      }
    }
    var best = 1, walk = 1;
    for (var k = 1; k < days.length; k++) {
      var back = new Date(Date.parse(days[k]) - 86400000).toISOString().slice(0, 10);
      walk = days[k - 1] === back ? walk + 1 : 1;
      if (walk > best) best = walk;
    }
    title.textContent = run + (run === 1 ? " day run" : " day run");
    el.innerHTML = window.XIChrome.formChips(
      done.map(function (r) { return r.final_score; })) +
      '<span class="run-best">best ' + best + "</span>";
  }

  /* PLAY AS, from the family's club list rather than a copy of it. */
  function fillClubs() {
    var sel = $("homeClubSelect");
    if (!sel || !window.XI_CLUBS) return;
    var chosen = "";
    try { chosen = localStorage.getItem("xi.club") || ""; } catch (e) {}
    sel.innerHTML = '<option value="">Random club</option>';
    window.XI_CLUBS.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
    sel.value = chosen;
    sel.onchange = function () {
      /* xi. because the club is the player, not the game: chosen here it is
         chosen in all of them. */
      try { localStorage.setItem("xi.club", sel.value); } catch (e) {}
    };
  }

  function renderLanding() {
    var f = pickFeatured();
    featuredId = f ? f.id : null;
    if (f) {
      $("homeFeaturedName").textContent = f.theme;
      $("homeFeaturedState").textContent = f.category;
    }
    $("homeThemedState").textContent = catalogBoards.length
      ? catalogBoards.length + " boards available" : "";
    /* Days, not boards: the card is Previous PUZZLES, and a day is what you
       missed. Counted from the archive, which stops at yesterday. */
    $("homePreviousCount").textContent = archiveDays
      ? (archiveDays.length
          ? archiveDays.length + (archiveDays.length === 1 ? " day so far" : " days so far")
          : "The first day is today")
      : "Every day so far";
    renderForm();
    fillClubs();
  }

  /* ---- previous puzzles ------------------------------------------------ */
  /* A LIST BY DAY, newest first, from /api/wordsearch/archive. A day played
     as the daily shows its score; the rest are there to play. Not a
     calendar, unlike the crossword: a word search has a name, and the name is
     the reason to pick a day. */
  var archiveDays = null;
  function hideArchive() {
    $("archivePanel").classList.add("hidden");
    $("homePrevious").setAttribute("aria-expanded", "false");
  }
  function toggleArchive() {
    var panel = $("archivePanel");
    if (!panel.classList.contains("hidden")) { hideArchive(); return; }
    panel.classList.remove("hidden");
    $("homePrevious").setAttribute("aria-expanded", "true");
    if (archiveDays) {
      renderArchive();
      nudge(panel);
      return;
    }
    $("archiveSub").textContent = "Loading…";
    loadArchive(function () { nudge(panel); });
  }
  function loadArchive(then) {
    api("archive").then(function (r) {
      archiveDays = r.days || [];
      tryPermalink();
      renderArchive();
      if ($("homePreviousCount")) renderLanding();
      if (then) then();
    }, function () {
      $("archiveSub").textContent = "Could not load the list.";
    });
  }
  /* The day as a date, in UTC because that is the day the server named. */
  function dayLabel(day) {
    var d = new Date(day + "T00:00:00Z");
    if (isNaN(d.getTime())) return day;
    return d.toLocaleDateString("en-GB",
      { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }
  /* HOW FAR BACK THE ARCHIVE IS OPEN WITHOUT AN ACCOUNT. Carried down with
     the daily — the server owns the rule, the page only draws it — and no
     locks at all until a payload has said so: padlocks over a rule the page
     has not heard of would be a rule this page invented. */
  var freeArchiveDays = null;
  function archiveLocked(day) {
    if (freeArchiveDays == null || !serverDay) return false;
    var chrome = window.XIChrome && window.XIChrome.account;
    if (!chrome) return false;
    if (chrome.user()) return false;
    if (chrome.available && !chrome.available()) return false;
    var back = Math.round(
      (Date.parse(serverDay + "T00:00:00Z") - Date.parse(day + "T00:00:00Z")) / 86400000);
    return back > freeArchiveDays;
  }

  function renderArchive() {
    var list = $("archiveList");
    if (!list || !archiveDays) return;
    var played = {};
    readResults().forEach(function (r) { if (r && r.day) played[r.day] = r; });
    list.innerHTML = "";
    if (!archiveDays.length) {
      var empty = document.createElement("li");
      empty.className = "arch-empty";
      empty.textContent = "The first day is today — come back tomorrow.";
      list.appendChild(empty);
      $("archiveSub").textContent = "";
      return;
    }
    var left = 0;
    archiveDays.forEach(function (e) {
      var rec = played[e.day];
      if (!rec) left++;
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "arch-row" + (rec ? " done" : "") +
        (archiveLocked(e.day) ? " locked" : "");
      b.setAttribute("data-id", e.id);
      b.setAttribute("data-day", e.day);
      var day = document.createElement("span"); day.className = "arch-day";
      var theme = document.createElement("span"); theme.className = "arch-theme";
      var state = document.createElement("span"); state.className = "arch-state";
      day.textContent = dayLabel(e.day);
      theme.textContent = e.theme;
      state.textContent = rec ? (rec.score != null ? rec.score + " pts" : "Played") : "To play";
      b.appendChild(day); b.appendChild(theme); b.appendChild(state);
      li.appendChild(b); list.appendChild(li);
    });
    $("archiveSub").textContent = left === 0
      ? "You have played every day so far."
      : left + (left === 1 ? " day" : " days") + " to play";
  }

  /* ---- pre-match ------------------------------------------------------- */
  /* THE MODE IS CHOSEN BY WHICH CARD YOU PRESS, not by a tile that stays lit.
     Free play without a board named yet shows the board of the week's card,
     which is the one board this page can offer without leaving it. */
  function setPrematchMode(next) {
    mode = next;
    if (next === "free" && !pending) selectBoard(featuredId, "BOARD OF THE WEEK");
  }
  function goToMenu() {
    if (mode === "daily" && startedAt && found.size < 11) saveDailyProgress();
    /* Leaving a board mid-way is an abandon; after a finish this is nothing. */
    playsEnd(false);
    clearInterval(timer); timer = null; startedAt = null;
    varPauseUntil = 0;
    uncover();
    $("result").classList.remove("show");
    $("gameApp").classList.add("hidden");
    $("prematch").classList.remove("hidden");
    location.hash = "";
  }

  /* ---- menus ----------------------------------------------------------- */
  var MENUS = [["gameMenu","gameBtn"],["helpMenu","helpBtn"],["zoomMenu","zoomBtn"]];
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

    /* Today, from the hero. */
    $("homeDaily").onclick = function () {
      if (!window.__daily) { toast("No Daily today — try the themes"); setPrematchMode("free"); return; }
      setPrematchMode("daily");
      startDaily(window.__daily);
    };
    /* The other boards. Clubs and themes is a link to its pages and needs no
       handler; the board of the week opens its card; previous puzzles opens
       the list by day. The section nav drives the same controls rather than
       reimplementing them — Today is where you already are. */
    var openThemes = function () { location.href = "/football/wordsearch/themes/"; };
    var navThemes = $("navThemes");
    if (navThemes) navThemes.onclick = openThemes;
    $("homePrevious").onclick = toggleArchive;
    $("homeFeatured").onclick = function () {
      mode = "free";
      if (!selectBoard(featuredId, "BOARD OF THE WEEK")) toast("No board this week");
    };
    /* Delegated: the list is rebuilt on every render, so a handler per row
       would have to be rebound each time. A row opens the day's card; the
       clock waits for Kick off, as it does for every other board. */
    $("archiveList").onclick = function (ev) {
      var row = ev.target.closest ? ev.target.closest(".arch-row") : null;
      if (!row) return;
      var day = row.getAttribute("data-day");
      var entry = (archiveDays || []).find(function (e) { return e.day === day; });
      if (!entry) return;
      /* A locked day is asked for, not fetched. The server would refuse it
         anyway, so the answer arrives without a round trip and without this
         page having to unpick a refusal. */
      if (row.classList.contains("locked")) {
        if (window.XIChrome && window.XIChrome.archive) {
          window.XIChrome.archive.askToRegister(
            "The last " + freeArchiveDays + " days are free for everyone. " +
            "Sign in to play the whole archive.");
        }
        return;
      }
      /* Opened from the list: the address says which day, so it can be
         copied out of the bar or shared from the browser's own menu. */
      if (window.XIChrome && window.XIChrome.permalink) window.XIChrome.permalink.show("wordsearch", day);
      openBoard(entry, "PREVIOUS PUZZLE · " + dayLabel(day).toUpperCase(),
        "Free play — only today's board keeps a run going.");
    };
    /* Kick off, on the board: the cover comes off and the clock starts. */
    $("kickBtn").onclick = function () {
      if (!pending) return;
      var p = pending.puzzle;
      uncover();
      startFree(p);
    };
    $("gameBtn").onclick = function () { toggleMenu("gameMenu", "gameBtn"); };
    $("helpBtn").onclick = function () { toggleMenu("helpMenu", "helpBtn"); };
    $("zoomBtn").onclick = function () { toggleMenu("zoomMenu", "zoomBtn"); };
    /* The family's Settings, not a second one. */
    $("setBtn").onclick = function (ev) {
      ev.stopPropagation();
      closeMenus();
      if (window.XIChrome && window.XIChrome.settings) window.XIChrome.settings.open($("setBtn"));
    };
    document.querySelectorAll("#gameMenu .menuRow").forEach(function (r) {
      r.onclick = function () {
        closeMenus();
        if (r.dataset.act === "menu") { goToMenu(); return; }
        if (r.dataset.act === "daily") { goToMenu(); setPrematchMode("daily"); return; }
        if (r.dataset.act === "themes") { openThemes(); return; }
      };
    });
    document.querySelectorAll("#helpMenu .menuRow[data-help]").forEach(function (r) {
      r.onclick = function () { closeMenus(); HELP[r.dataset.help](); };
    });
    document.querySelectorAll("#zoomMenu .menuRow[data-zoom]").forEach(function (r) {
      r.onclick = function () {
        var z = r.dataset.zoom;
        /* In and out are the player taking over; reset hands the board back
           to the size that fits, which is what "reset" now means. */
        if (z === "in") { userZoomed = true; setZoom(cellPx() + ZOOM_STEP); }
        else if (z === "out") { userZoomed = true; setZoom(cellPx() - ZOOM_STEP); }
        else { userZoomed = false; setZoom(fitCell()); }
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

    $("againBtn").onclick = function () { goToMenu(); setPrematchMode("free"); };
    $("resultMenuBtn").onclick = goToMenu;

    /* The server decides the day and hands over the board; the catalog fills
       the browser. Neither response contains a schedule. */
    api("daily").then(function (r) {
      serverDay = r.day; window.__daily = r.puzzle;
      if (typeof r.freeArchiveDays === "number") freeArchiveDays = r.freeArchiveDays;
      /* THE TABLE WAITS FOR THE SERVER'S DAY. Mounted here rather than at
         start-up because the day is what picks the season, and picking one
         before the server has said what day it is would be the device deciding
         — which is the rule this project has broken most often. */
      mountTable();
      tryPermalink();
      /* The hero says whether there is one, where the mode tile used to. */
      setDailyState(r.puzzle ? "" : "No Daily scheduled today — the themes are open.");
    }, function () {
      setDailyState("Could not reach the server — check your connection.");
    });
    api("catalog").then(function (r) {
      catalogBoards = r.boards || [];
      /* #bankLine belonged to the card this landing replaced. The counts it
         carried are on the board cards now, where they describe the thing they
         are next to rather than sitting under a Kick off button. */
      renderLanding();
      /* ?b= IS THE DOOR FROM A THEMES PAGE: the board is named on its card
         and the clock waits for Kick off. Only a released board is in the
         catalog, so a link to tomorrow's names nothing and opens nothing.
         #p= is the older Free Play invitation from a share, and starts at
         once as it always has — the person following it was challenged. */
      var q = (location.search.match(/[?&]b=(XIWS-\d{4})/) || [])[1];
      if (q) {
        mode = "free";
        if (!selectBoard(q, "FROM THE THEMES")) toast("That board is not available");
      }
      /* The permalink names a DAY, which is what this game's dailies are
         called. Opened as a previous puzzle, which is what it is unless it is
         today's — and the run only ever counts today's, decided where it
         always was rather than here. */
      openPermalink();
      var m = location.hash.match(/p=(XIWS-\d{4})/);
      if (m) {
        api("puzzle?id=" + m[1]).then(function (r2) { startFree(r2.puzzle); },
          function () { toast("That board is not available"); });
      }
    }, function () {
      setDailyState("Could not load the board list.");
    });
    /* The days already played, for the count on the card and the list under
       it. Fetched here so the card can say how many, and the list opens
       without a wait. */
    loadArchive();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
