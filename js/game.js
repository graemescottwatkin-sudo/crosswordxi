/* ============================================================
   MODULES: clue wording, state, rendering, input, scoring UI,
   timer, persistence, completion, dev panel, in-browser tests
   ============================================================ */
(function () {
  "use strict";
  var A = FCW.ACROSS, D = FCW.DOWN;
  var $ = function (id) { return document.getElementById(id); };
  // Bind a handler defensively: if an element is ever missing, log it and
  // carry on rather than throwing and leaving the player a blank page.
  var wiringWarnings = [];
  function on(id, evt, fn) {
    var el = $(id);
    if (!el) { wiringWarnings.push(id); console.warn("Missing element: " + id); return; }
    el.addEventListener(evt, fn);
  }
  var K = function (x, y) { return x + "," + y; };

  /* ---------- Clue wording (V0.2 informative templates) ----------
     Terse mode (raw source term) is retained in the dev panel only,
     for playtest comparison. */
  var clueStyle = "descriptive";
  try { clueStyle = localStorage.getItem("fcw.clueStyle") || "descriptive"; } catch (e) {}
  var NO_ARTICLE = { "Spurs": true }; // nicknames that don't take "the"
  // Two phrasings per category; the seed and clue number pick one, so
  // wording varies between puzzles without leaving the house style.
  var CLUE_TEMPLATES = {
    "Nickname \u2192 Club": [
      function (c) { return "This team's nickname is " + (NO_ARTICLE[c] ? c : "the " + c); },
      function (c) { return "They're known as " + (NO_ARTICLE[c] ? c : "the " + c); }
    ],
    "Club \u2192 Nickname": [
      function (c) { return c + "'s nickname"; },
      function (c) { return "The nickname of " + c; }
    ],
    "City \u2192 Club": [
      function (c) { return "This team plays in " + c; },
      function (c) { return "A club based in " + c; }
    ],
    "Club \u2192 City": [
      function (c) { return "The city where " + c + " play"; },
      function (c) { return c + "'s home city"; }
    ],
    "Stadium \u2192 Club": [
      function (c) { return "This team plays at " + c; },
      function (c) { return "The home side at " + c; }
    ],
    "Club \u2192 Stadium": [
      function (c) { return c + "'s stadium"; },
      function (c) { return "The home ground of " + c; }
    ],
    "City \u2192 Stadium": [
      function (c) { return "This stadium is in " + c; },
      function (c) { return "A ground found in " + c; }
    ],
    "Stadium \u2192 City": [
      function (c) { return "The city where " + c + " is located"; },
      function (c) { return c + "'s home city"; }
    ],
    // Routes that avoid the club name, so clubs named after their city
    // (Hull City, Coventry City) are still cluable.
    "City \u2192 Nickname": [
      function (c) { return "What the side from " + c + " are known as"; },
      function (c) { return "The nickname of the team from " + c; }
    ],
    "Nickname \u2192 City": [
      function (c) { return "The city where " + (NO_ARTICLE[c] ? c : "the " + c) + " play"; },
      function (c) { return "Home city of " + (NO_ARTICLE[c] ? c : "the " + c); }
    ],
    "Stadium \u2192 Nickname": [
      function (c) { return "What the side at " + c + " are known as"; },
      function (c) { return "The nickname of the team at " + c; }
    ],
    "Nickname \u2192 Stadium": [
      function (c) { return (NO_ARTICLE[c] ? c : "The " + c) + "' home ground"; },
      function (c) { return "Where " + (NO_ARTICLE[c] ? c : "the " + c) + " play"; }
    ]
  };
  function clueText(row, num) {
    // A disambiguating hint ("— not Doncaster") belongs at the END of the
    // rendered sentence. Several templates put the term mid-sentence, so strip
    // the hint before templating and re-attach it after.
    var raw = String(row.clue || "");
    var hint = "";
    var cut = raw.indexOf(" \u2014 not ");
    if (cut !== -1) { hint = raw.slice(cut); raw = raw.slice(0, cut); }
    if (clueStyle === "terse") return raw + hint;
    var fns = CLUE_TEMPLATES[row.cat];
    if (!fns) return raw + hint;   // categories whose Clue cell is a full sentence
    var v = ((seed || 0) + (num || 0) * 7) % 2;
    return fns[v](raw) + hint;
  }

  /* ---------- Puzzle state ---------- */
  var puzzle = null;
  var letters = {};          // "x,y" -> typed letter
  var wrong = {};            // "x,y" -> true (cleared on edit)
  var revealedCells = {};    // "x,y" -> true — Reveal Letter (locked, gold)
  var revealAnswerCells = {};// "x,y" -> true — filled by Reveal Answer (locked)
  var subbedCells = {};      // "x,y" -> true — Substitution: free reveal, no score effect
  var subsUsed = 0;          // substitutions taken this puzzle (practice levels)
  var revealedEntries = {};  // entryIdx -> true (unique revealed answers)
  var cur = { entry: 0, cell: 0 };
  var checksUsed = 0, checkAllsUsed = 0;
  var helpActions = [];      // ordered: "check" | "revealLetter" | "revealAnswer"
  var consecutiveChecks = 0; // for back-to-back defeat wording
  var halfTimeShown = false;
  var elapsed = 0, timerId = null, running = false, complete = false;
  var seed = null;
  var started = false;       // pre-kick-off gate: grid/clues hidden, clock stopped
  var paused = false;        // half time: clock stopped, grid and clues hidden
  var mode = "daily";        // "daily" | "practice"
  var dailyNo = FCW.dailyNumber();
  var cellEls = {};
  var seasonErrors = FCW.loadSeasons(FCW_SEASONS);
  // Answer-repetition control for the Daily. If the table is missing or a day
  // falls outside it, dailyBans() returns null and the Daily plays as before.
  /* ---------- Server API ----------
     The clue bank lives in D1 and never reaches this browser. What arrives is
     one puzzle: the grid shape and the clues, with no solution letters in it.
     Every question about correctness — is this entry right, which letters are
     wrong, what is this letter — is answered by the server.

     `token` names the puzzle being played so the server knows which answers to
     compare against. It is not a secret and grants nothing: a daily token is
     refused on any day but its own. */
  var puzzleToken = null;
  var verified = {};          // entry index -> true|false, as last judged server-side
  var verifySent = {};        // entry index -> the text last sent, to avoid re-asking
  var gridStats = { wrongCells: 0, wrongEntries: 0 };

  function api(path, body) {
    var opts = body
      ? { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body) }
      : { method: "GET" };
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : "Request failed (" + r.status + ")");
        return j;
      });
    });
  }

  /* The letters typed into an entry, or null if it is not yet full. Only full
     entries are worth asking about. */
  function entryText(i) {
    var e = puzzle.entries[i], out = "";
    for (var n = 0; n < e.cells.length; n++) {
      var ch = letters[K(e.cells[n].x, e.cells[n].y)];
      if (!ch) return null;
      out += ch;
    }
    return out;
  }
  function gridText() {
    return Object.keys(puzzle.cells).sort().map(function (k) {
      return letters[k] || "";
    }).join("");
  }
  function gridFull() {
    return Object.keys(puzzle.cells).every(function (k) { return !!letters[k]; });
  }

  /* Ask the server about any entry that has just been completed or changed.
     Free feedback — the game has always told you when an entry is right the
     moment you finish it. Which letters are wrong is the paid Check, and is
     requested separately with detail. */
  var verifyTimer = null;
  function verifySoon() {
    if (verifyTimer) clearTimeout(verifyTimer);
    verifyTimer = setTimeout(verifyNow, 130);
  }
  function verifyNow() {
    if (!puzzle || !puzzleToken) return Promise.resolve();
    var jobs = [];
    puzzle.entries.forEach(function (e, i) {
      var text = entryText(i);
      if (text === null) { verified[i] = false; delete verifySent[i]; return; }
      if (verifySent[i] === text) return;
      verifySent[i] = text;
      jobs.push(api("/api/check-answer", { token: puzzleToken, entry: i, guess: text })
        .then(function (r) { verified[i] = !!r.correct; })
        .catch(function () { delete verifySent[i]; }));
    });
    if (!jobs.length) { updateProgress(); return Promise.resolve(); }
    return Promise.all(jobs).then(function () {
      updateProgress(); flashSolved(); checkComplete();
      // "How many letters are wrong" is free and always has been, but the
      // browser can no longer count it: ask once the grid is full.
      if (gridFull() && !complete) {
        return api("/api/check-answer", { token: puzzleToken, grid: gridText(), detail: 1 })
          .then(function (r) {
            gridStats.wrongCells = r.wrongCells || 0;
            updateNudge();
          }).catch(function () {});
      }
      gridStats.wrongCells = 0;
      updateNudge();
    });
  }

  FCW.loadDailyBans(null);   // the daily chain is applied server-side now
  /* Server-date sync (spec §19). The page's own HTTP response carries a Date
     header set by the host, which a player cannot move by changing their device
     clock. Same-origin, so the header is readable without any CORS opt-in; HEAD,
     so the 1.2MB file is not refetched. Failure is silent and total: a local
     file, no
     network, or no hosting yet all leave the device clock in charge, which is
     exactly the previous behaviour. Play never waits on it. */
  function syncServerDate(done) {
    var settled = false;
    function finish(ok) {
      if (settled) return;
      settled = true;
      try { done(ok); } catch (e) {}
    }
    setTimeout(function () { finish(false); }, 2500);  // never hold up the Daily
    try {
      if (typeof fetch !== "function" || !/^https?:/.test(location.protocol)) {
        return finish(false);
      }
      fetch(location.href, { method: "HEAD", cache: "no-store" })
        .then(function (r) { finish(FCW.setTrustedTime(r.headers.get("Date"))); })
        .catch(function () { finish(false); });
    } catch (e) { finish(false); }
  }
  var CLUBS = FCW.historicalClubs();   // all 49 clubs of the 20-team era
  if (seasonErrors.length) console.warn("Season data problems:", seasonErrors);
  var season = null;  // the historical season this puzzle is played in
  var clubMode = "random";   // "random" | "chosen"
  var club = null;           // this puzzle's club identity
  var randomPick = null;     // season chosen alongside the club in Random mode
  try {
    var pref = localStorage.getItem("fcw.clubPref");
    if (pref && CLUBS.indexOf(pref) !== -1) { clubMode = "chosen"; club = pref; }
  } catch (e) {}
  function locked(k) { return !!(revealedCells[k] || revealAnswerCells[k] || subbedCells[k]); }
  function revealedLetterCount() { return Object.keys(revealedCells).length; }
  function revealedAnswerCount() { return Object.keys(revealedEntries).length; }
  function liveScore() {
    return FCW.computeScore(elapsed, checksUsed, revealedLetterCount(),
                            revealedAnswerCount(), checkAllsUsed).score;
  }

  function breakCells(entry) {
    var marks = {};
    entry.row.breaks.forEach(function (b) { marks[b - 1] = true; });
    return marks;
  }

  /* ---------- Timer (MM:SS, then H:MM:SS past the hour) ---------- */
  function fmt(s) {
    if (s >= 3600) {
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h + ":" + ("0" + m).slice(-2) + ":" + ("0" + (s % 60)).slice(-2);
    }
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }
  function renderClock() {
    var m = FCW.matchMinute(elapsed);
    $("matchClock").innerHTML = escapeHtml(FCW.matchClockLabel(elapsed)) +
      '<small id="elapsedLine">' + fmt(elapsed) + ' elapsed</small>';
    $("matchClock").classList.toggle("ht", m >= 45 && m < 46);
    if (m >= 45 && !halfTimeShown) { halfTimeShown = true; toast("Half Time", "45 minutes gone."); }
  }
  function tick() {
    elapsed++; renderClock(); saveSoon();
    // The score only moves when the football minute changes, so re-sort then.
    if (elapsed % Math.round(FCW.SCORING.MATCH_CLOCK_REAL_SECONDS / FCW.SCORING.MATCH_CLOCK_MAX_MINUTES) === 0) {
      updateScoreUI();
    }
  }
  function startTimer() {
    if (!started || paused) return; // no clock before kick-off or while paused
    if (!running && !complete) { running = true; timerId = setInterval(tick, 1000); }
  }
  function stopTimer() { running = false; clearInterval(timerId); }

  /* ---------- Persistence (best-effort) ---------- */
  var saveT = null;
  function saveSoon() { clearTimeout(saveT); saveT = setTimeout(save, 400); }
  function save() {
    try {
      localStorage.setItem(mode === "daily" ? "fcw.v04.daily" : "fcw.v04.practice", JSON.stringify({
        mode: mode, dailyNo: dailyNo,
        seed: seed, token: puzzleToken, letters: letters,
        revealedCells: Object.keys(revealedCells),
        revealAnswerCells: Object.keys(revealAnswerCells),
        revealedEntries: Object.keys(revealedEntries).map(Number),
        checks: checksUsed, checkAlls: checkAllsUsed, elapsed: elapsed, complete: complete,
        subbedCells: Object.keys(subbedCells), subs: subsUsed,
        excludeIds: builtExcludeIds,
        helpActions: helpActions,
        club: club, clubMode: clubMode
      }));
    } catch (e) { /* storage unavailable — play without persistence */ }
  }
  function loadSaved(which) {
    try { return JSON.parse(localStorage.getItem("fcw.v04." + which)); } catch (e) { return null; }
  }

  /* ---------- Puzzle lifecycle ---------- */
  function progressRatio() {
    if (!puzzle) return 0;
    var total = Object.keys(puzzle.cells).length;
    return total ? Object.keys(letters).length / total : 0;
  }
  function newPuzzle(fixedSeed, restore) {
    seed = fixedSeed != null ? fixedSeed : ((Math.random() * 1e9) | 0);
    var nb = $("newBtn");
    nb.disabled = true;
    // Never touch textContent here: the button holds two responsive labels
    // (.lbl-full / .lbl-short) and reading textContent flattens them into
    // "New puzzleNew", which writing back then makes permanent. Toggle a class
    // and let CSS swap in the busy label instead.
    nb.classList.add("busy");
    $("grid").style.opacity = "0.45";
    /* buildPuzzle() is a network call now, so the button stays busy until the
       puzzle actually arrives rather than for a fixed 30ms. */
    return buildPuzzle(restore).then(function () {
      nb.disabled = false;
      nb.classList.remove("busy");
    });
  }
  /* Fetch the puzzle rather than build it.
     The grid used to be laid out here, from a clue bank embedded in the page.
     Now the server holds the bank, lays the grid out ahead of time and sends
     one puzzle with no solution letters in it. Everything downstream of this
     function is unchanged: the same shape arrives, minus the answers. */
  function requestPuzzle(restore) {
    /* Resuming needs the puzzle that was saved, not a new one. The seed used to
       identify it, back when the browser generated the grid itself; now the
       server holds the layout, so the token is the identity and the save
       carries it. Without this, resuming a half-finished practice puzzle
       fetched a different random grid and dropped the saved letters onto it. */
    if (restore && restore.token) {
      var t = String(restore.token);
      if (t.indexOf("practice:") === 0) return api("/api/practice?token=" + encodeURIComponent(t));
      // A daily token is only valid on its own day; if the date has rolled over
      // the server refuses it, and today's daily is the right thing to open.
      return api("/api/daily");
    }
    if (mode === "daily") return api("/api/daily");
    var qs = [];
    var cat = practiceCategory();
    if (cat) qs.push("category=" + encodeURIComponent(cat));
    var seen = loadRecent().filter(function (n) { return typeof n === "number"; }).slice(0, 40);
    if (seen.length) qs.push("seen=" + seen.join(","));
    return api("/api/practice" + (qs.length ? "?" + qs.join("&") : ""));
  }

  function buildPuzzle(restore) {
    builtFilter = JSON.stringify(activeFilter());
    builtExcludeIds = null;
    showLoading(true);
    return requestPuzzle(restore).then(function (res) {
      puzzle = res.puzzle;
      puzzleToken = res.token;
      if (res.mode === "daily" && res.dailyNo) dailyNo = res.dailyNo;
      if (res.poolId) recordRecent([res.poolId]);
      verified = {}; verifySent = {}; gridStats = { wrongCells: 0, wrongEntries: 0 };
      showLoading(false);
      finishBuild(restore);
    }).catch(function (err) {
      showLoading(false);
      showLoadError(err);
    });
  }

  function showLoading(on) {
    var n = $("gridNudge");
    if (!n) return;
    n.classList.toggle("show", !!on);
    if (on) n.textContent = "Getting the puzzle\u2026";
  }
  function showLoadError(err) {
    var n = $("gridNudge");
    if (!n) return;
    n.classList.add("show");
    n.textContent = "Could not load the puzzle. " + String(err && err.message || err);
  }

  function finishBuild(restore) {
    var diff = FCW.puzzleDifficulty(puzzle);
    if (randomPick && clubMode === "random") {
      // Re-derive with the puzzle's difficulty now that the grid exists.
      randomPick = FCW.pickSeasonAndClub(seed, diff);
      club = randomPick.club;
      season = randomPick.season;
    } else {
      season = FCW.pickSeason(club, seed, diff);
    }
    $("grid").style.opacity = "";
    $("strapText").innerHTML = mode === "daily"
      ? "Premier League &middot; Daily #" + dailyNo
      : "Premier League &middot; Practice";
    $("dailyBtn").style.display = mode === "daily" ? "none" : "";
    document.title = mode === "daily"
      ? "Daily #" + dailyNo + " \u00B7 Crossword XI"
      : "Practice \u00B7 Crossword XI";
    letters = {}; wrong = {}; revealedEntries = {}; revealedCells = {}; revealAnswerCells = {};
    subbedCells = {}; subsUsed = 0;
    checksUsed = 0; checkAllsUsed = 0; elapsed = 0; complete = false;
    helpActions = []; consecutiveChecks = 0; halfTimeShown = false; lastPos = null;
    if (restore) {
      letters = restore.letters || {};
      (restore.revealedCells || []).forEach(function (k) { revealedCells[k] = true; });
      (restore.revealAnswerCells || []).forEach(function (k) { revealAnswerCells[k] = true; });
      (restore.subbedCells || []).forEach(function (k) { subbedCells[k] = true; });
      subsUsed = restore.subs || 0;
      (restore.revealedEntries || []).forEach(function (i) { revealedEntries[i] = true; });
      checksUsed = restore.checks || 0;
      checkAllsUsed = restore.checkAlls || 0;
      elapsed = restore.elapsed || 0;
      helpActions = restore.helpActions || [];
      halfTimeShown = FCW.matchMinute(elapsed) >= 45;
      if (restore.clubMode) clubMode = restore.clubMode;
      if (restore.club && CLUBS.indexOf(restore.club) !== -1) club = restore.club;
    } else if (clubMode === "random" || !club) {
      // Season first, then a club from that season — and both derived from
      // the puzzle seed, so a daily gives every player the same pairing.
      randomPick = FCW.pickSeasonAndClub(seed, null);
      club = randomPick ? randomPick.club : CLUBS[0];
    } else {
      randomPick = null;
    }
    syncClubSelect();
    updateSubUI();
    stopTimer();
    renderClock();
    var firstA = null;
    puzzle.entries.forEach(function (e, i) {
      if (e.dir === A && (firstA === null || e.num < puzzle.entries[firstA].num)) firstA = i;
    });
    cur = { entry: firstA !== null ? firstA : 0, cell: 0 };
    renderGrid(); renderClues(); updateSelection(); updateScoreUI();
    scheduleFit();
    $("doneOverlay").classList.remove("show");
    // Kick-off gate: fresh puzzles hide the grid and clues until the
    // player starts the match; resumed puzzles go straight back in.
    var inProgress = restore && (restore.elapsed > 0 || Object.keys(letters).length > 0);
    started = !!inProgress;
    document.querySelector(".stage").classList.toggle("prestart", !started);
    $("startOverlay").classList.toggle("show", !started);
    if (!started) {
      $("kickMode").textContent = mode === "daily" ? "Daily #" + dailyNo : "Practice puzzle";
      syncKickSelect();
      // Topic filters belong to Practice: the Daily is the same for everyone.
      $("filterBox").style.display = mode === "practice" ? "" : "none";
      $("kickNote").textContent = mode === "daily"
        ? "Today's puzzle, the same for everyone. The clock starts at kick-off."
        : "The clock starts at kick-off.";
      if (mode === "practice") renderFilters(); else $("kickOffBtn").disabled = false;
    }
    paused = false; lastSolved = {};
    renderStreak();
    $("pauseOverlay").classList.remove("show");
    $("pauseBtn").disabled = !started; syncPauseIcon();
    if (pendingKickOff) { pendingKickOff = false; revealBoard(); }
    else if (started) startTimer();
    save();
    if (restore) checkComplete(); // a finished daily boots straight to Full Time
  }
  /* The icon shows what pressing it would do next: pause bars while running,
     a play triangle once the clock is stopped. */
  function syncPauseIcon() {
    var b = $("pauseBtn");
    if (!b) return;
    b.classList.toggle("playing", paused);
    var label = paused ? "Resume" : "Pause";
    b.setAttribute("aria-label", label);
    b.title = paused ? "Restart the clock" : "Stop the clock and hide the puzzle";
  }
  function pauseGame() {
    if (!started || complete || paused) return;
    paused = true;
    stopTimer();
    // Same treatment as pre-kick-off: the whole stage (grid, selected clue,
    // and both clue lists) is blurred and interaction is disabled.
    document.querySelector(".stage").classList.add("prestart");
    $("pauseMode").textContent = "Clock stopped at " + fmt(elapsed);
    $("pauseOverlay").classList.add("show");
    $("pauseBtn").disabled = true; syncPauseIcon();
  }
  function resumeGame() {
    if (!paused) return;
    paused = false;
    document.querySelector(".stage").classList.remove("prestart");
    $("pauseOverlay").classList.remove("show");
    $("pauseBtn").disabled = false; syncPauseIcon();
    updateSelection();
    startTimer();
  }
  on("pauseBtn", "click", pauseGame);
  on("resumeBtn", "click", resumeGame);

  /* ---------- Free-run topic filters (Practice only) ----------
     The Daily must be identical for everyone, so filters apply to Practice
     alone; choosing topics in Daily mode would fork the shared puzzle. */
  /* Practice recency: the last rows seen sit the next puzzles out, so the
     same clue cannot come straight back. Personal (localStorage), practice
     only — the Daily is shared and uses deterministic rotation instead. */
  var RECENT_CAP = 200;
  function loadRecent() {
    try { return JSON.parse(localStorage.getItem("fcw.recent")) || []; }
    catch (e) { return []; }
  }
  function recordRecent(ids) {
    try {
      var list = loadRecent().filter(function (id) { return ids.indexOf(id) === -1; });
      list = list.concat(ids);
      if (list.length > RECENT_CAP) list = list.slice(list.length - RECENT_CAP);
      localStorage.setItem("fcw.recent", JSON.stringify(list));
    } catch (e) {}
  }
  /* Recency moved to the server. The browser sends the pool ids it has seen
     lately as ?seen=, and /api/practice avoids them while it can — the same
     "don't serve me that again" idea, decided where the pool actually is. */
  var builtFilter = null;                       // filter the current grid was built with
  var builtExcludeIds = null;                   // recency exclusion the grid was built with
  var filterOn = { groups: null, eras: null };   // null = everything
  try {
    var savedF = JSON.parse(localStorage.getItem("fcw.filter"));
    if (savedF && (savedF.groups || savedF.eras)) filterOn = savedF;
  } catch (e) {}
  /* Practice difficulty level. The Daily takes none of this: same puzzle,
     same conditions, for everyone — its pool is the full mix and it grants
     no substitutions. */
  function currentLevel() {
    return mode === "practice" && FCW.LEVELS[filterOn.level]
      ? filterOn.level : FCW.DEFAULT_LEVEL;
  }
  function subsAllowance() {
    return mode === "practice" ? FCW.LEVELS[currentLevel()].subs : 0;
  }
  function activeFilter() {
    // Pre-1990 is opt-in. With no explicit selection — and always on the Daily —
    // the default era set applies, keeping the game modern without archiving
    // the older clues out of existence.
    if (mode !== "practice") return FCW.dailyFilter(dailyNo || FCW.dailyNumber());
    return { groups: filterOn.groups, eras: filterOn.eras || FCW.DEFAULT_ERAS,
             diffs: FCW.LEVELS[currentLevel()].diffs };
  }
  function saveFilter() {
    try { localStorage.setItem("fcw.filter", JSON.stringify(filterOn)); } catch (e) {}
  }
  function chipRow(id, counts, selected, onPick) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = "";
    Object.keys(counts).sort().forEach(function (k) {
      var b = document.createElement("button");
      b.className = "chip" + (!selected || selected.indexOf(k) !== -1 ? " on" : "");
      b.innerHTML = escapeHtml(k) + '<span class="n">' + counts[k] + "</span>";
      b.addEventListener("click", function () { onPick(k); });
      el.appendChild(b);
    });
  }
  function toggleIn(list, key, all, keepFull) {
    var cur = list ? list.slice() : Object.keys(all);
    var i = cur.indexOf(key);
    if (i === -1) cur.push(key); else cur.splice(i, 1);
    if (!cur.length) return null;                      // none left: back to all
    // A full selection normally collapses to null ("no filter"). For eras that
    // collapse is wrong: null eras means DEFAULT_ERAS, which excludes Pre-1990,
    // so "all six eras" must survive as an explicit list or Pre-1990 can never
    // be switched on alongside the modern eras.
    if (cur.length === Object.keys(all).length) return keepFull ? cur : null;
    return cur;
  }
  /* Topics come from /api/categories: the server only publishes ones it has a
     pool for, so the list is always playable. Fetched once and reused. */
  var serverCategories = null;
  function loadCategories() {
    if (serverCategories) return Promise.resolve(serverCategories);
    return api("/api/categories").then(function (r) {
      serverCategories = r.categories || [];
      return serverCategories;
    }).catch(function () { serverCategories = []; return serverCategories; });
  }
  function renderFilters() {
    if (serverCategories === null) { loadCategories().then(renderFilters); return; }
    var groups = {};
    serverCategories.forEach(function (c) { groups[c] = 1; });
    var opts = { groups: groups, eras: {} };
    var lvlEl = $("levelChips");
    if (lvlEl) {
      lvlEl.innerHTML = "";
      Object.keys(FCW.LEVELS).forEach(function (k) {
        var cfg = FCW.LEVELS[k];
        var b = document.createElement("button");
        b.className = "chip" + (currentLevel() === k ? " on" : "");
        b.innerHTML = escapeHtml(cfg.label) +
          '<span class="n">' + (cfg.subs ? cfg.subs + " subs" : "no subs") + "</span>";
        b.title = cfg.diffs
          ? (k === "easy" ? "Easier clues, friendlier season, " + cfg.subs + " free letters"
                          : "No easy clues, tougher season, no free letters")
          : "The full clue mix, " + cfg.subs + " free letters";
        b.addEventListener("click", function () {
          filterOn.level = k;
          saveFilter(); renderFilters();
        });
        lvlEl.appendChild(b);
      });
    }
    chipRow("groupChips", opts.groups, filterOn.groups, function (k) {
      // One topic at a time: /api/practice takes a single category, because the
      // pools it draws from are built per topic.
      filterOn.groups = (filterOn.groups && filterOn.groups[0] === k) ? null : [k];
      saveFilter(); renderFilters();
    });
    /* No era chips. Practice draws from pools built per topic, so era is not a
       filter the server can honour, and a control that silently does nothing is
       worse than no control. Era selection can come back the day the pools are
       built per era as well. */
    var eraEl = $("eraChips");
    if (eraEl) {
      eraEl.innerHTML = "";
      var eraRow = eraEl.closest ? eraEl.closest(".filter-row") : null;
      if (eraRow) eraRow.style.display = "none";
    }
    $("filterSummary").textContent = practiceCategory() || "all topics";
    /* Viability used to be computed here against the local bank. The server
       only publishes topics it has a pool for, so anything offered is playable
       and there is nothing to warn about. */
    var chosen = practiceCategory();
    $("filterWarn").textContent = chosen ? chosen + " puzzles" : "All topics";
    $("filterWarn").classList.add("ok");
    $("kickOffBtn").disabled = false;
    $("kickOffBtn").textContent = "Kick Off";
  }

  /* The single topic practice is filtered by, or null for all. */
  function practiceCategory() {
    return (mode === "practice" && filterOn.groups && filterOn.groups.length)
      ? filterOn.groups[0] : null;
  }
  function activeFilterPreview() { return activeFilter(); }
  on("filterToggle", "click", function () {
    $("filterBody").classList.toggle("show");
  });

  function kickOff() {
    // Topics are chosen on this card, after the grid was generated, so rebuild
    // before starting if the selection has changed.
    if (mode === "practice" && JSON.stringify(activeFilter()) !== builtFilter) {
      seed = (Math.random() * 1e9) | 0;
      pendingKickOff = true;
      buildPuzzle(null);   // revealBoard() runs from finishBuild once it lands
      return;
    }
    revealBoard();
  }
  function revealBoard() {
    started = true;
    document.querySelector(".stage").classList.remove("prestart");
    $("startOverlay").classList.remove("show");
    $("pauseBtn").disabled = false; syncPauseIcon();
    updateSelection();   // the letter bank only renders once play has started
    scheduleFit();       // the overlay was occupying space while measuring
    startTimer();
  }
  var pendingKickOff = false;

  /* ---------- Grid rendering ---------- */
  function renderGrid() {
    var g = $("grid");
    g.innerHTML = ""; cellEls = {};
    lastCellSize = null;   // a new puzzle may need a different cell size
    fitCells();
    g.style.gridTemplateColumns = "repeat(" + puzzle.width + ", var(--cell))";
    for (var y = 0; y < puzzle.height; y++) {
      for (var x = 0; x < puzzle.width; x++) {
        var c = puzzle.cells[K(x, y)];
        var el = document.createElement("div");
        if (!c) {
          el.className = "cell block";
        } else {
          el.className = "cell";
          el.dataset.x = x; el.dataset.y = y;
          if (c.num) {
            var n = document.createElement("span");
            n.className = "num"; n.textContent = c.num;
            el.appendChild(n);
          }
          var span = document.createElement("span");
          span.className = "ltr";
          el.appendChild(span);
          if (c.across !== null) {
            var ea = puzzle.entries[c.across];
            if (breakCells(ea)[x - ea.x]) el.classList.add("brk-r");
          }
          if (c.down !== null) {
            var ed = puzzle.entries[c.down];
            if (breakCells(ed)[y - ed.y]) el.classList.add("brk-b");
          }
          el.addEventListener("pointerdown", onCellTap);
          cellEls[K(x, y)] = el;
        }
        g.appendChild(el);
      }
    }
    refreshLetters();
  }
  function fitCells() {
    // Measure the chrome that actually surrounds the grid rather than
    // guessing, so the board always fits above the on-screen keyboard.
    var h = function (sel) {
      var el = typeof sel === "string" ? document.querySelector(sel) : sel;
      return el ? el.getBoundingClientRect().height : 0;
    };
    var panel = document.querySelector(".grid-panel");
    var wrap = document.querySelector(".grid-wrap");
    // Width: prefer the real column, then the body, then the viewport.
    // clientWidth includes padding, so subtract it — both the panel's and the
    // board box's, since the turf margin around the grid is real space the
    // cells cannot use. Counting it as usable would overflow the column.
    var availW = 0, padY = 0;
    var boxPad = function (el) {
      var c = el && window.getComputedStyle ? window.getComputedStyle(el) : null;
      return c ? { x: (parseFloat(c.paddingLeft) || 0) + (parseFloat(c.paddingRight) || 0),
                   y: (parseFloat(c.paddingTop) || 0) + (parseFloat(c.paddingBottom) || 0) }
               : { x: 0, y: 0 };
    };
    if (panel) {
      var pp = boxPad(panel), wp = boxPad(wrap);
      padY = pp.y + wp.y;
      availW = panel.clientWidth - pp.x - wp.x - 8;
    }
    if (availW < 160) availW = document.body.clientWidth - 44;
    if (availW < 160) availW = (window.innerWidth || 360) - 44;
    // Height: measured chrome where layout is available, otherwise a
    // sensible reserve so the board never hides under the keyboard.
    var measured = h("header") + h(".toolbar") + h(".now-clue") + h(".osk");
    var isTouch = document.body.classList.contains("touch");
    var chrome = (measured > 80 ? measured : (isTouch ? 330 : 230)) + 46 + padY;
    var availH = (window.innerHeight || 800) - chrome;
    if (availH < 200) availH = 200;
    var size = Math.floor(Math.min(availW / puzzle.width, availH / puzzle.height));
    /* Cells stay 20–52px. Removing the sidebar freed a lot of width, and the
       temptation is to spend it on bigger cells — but a 64px cell on a 1920
       monitor reads as oversized rather than substantial. The width goes to the
       pitch around the grid instead: the board box is full width and the grid
       sits centred on it, so the extra space becomes turf. */
    /* Floor raised from 20 to 30 on anything but a phone. A 20px cell keeps the
       whole board above the keyboard, but at that size it stops being the thing
       the page is for — better to let the board be substantial and let the page
       scroll a little. Phones keep the low floor: there, fitting the board on
       screen matters more than its size. */
    var floor = (window.innerWidth || 360) >= 700 ? 30 : 20;
    size = Math.max(floor, Math.min(52, size));
    if (size !== lastCellSize) {
      lastCellSize = size;
      document.documentElement.style.setProperty("--cell", size + "px");
    }
    /* Publish the board box's width so the active clue strip, the clue columns
       and the season strip all share one measure with the pitch. */
    var board = document.querySelector(".grid-wrap");
    if (board && board.offsetWidth) {
      document.documentElement.style.setProperty("--board-w", board.offsetWidth + "px");
    }
  }
  /* First paint measures the page before the web fonts have loaded, so the
     header, toolbar and clue card are all the wrong height and the grid is
     sized against them. Re-fit once layout settles, once fonts arrive, and
     whenever the grid column itself changes width. */
  var lastCellSize = null;
  var fitObserver = null;
  function scheduleFit() {
    if (!puzzle) return;
    fitCells();
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () { fitCells(); });
    }
    setTimeout(fitCells, 120);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { fitCells(); });
    }
    if (window.ResizeObserver && !fitObserver) {
      var panel = document.querySelector(".grid-panel");
      if (panel) {
        fitObserver = new ResizeObserver(function () { fitCells(); });
        fitObserver.observe(panel);
      }
    }
  }
  function refreshLetters() {
    Object.keys(cellEls).forEach(function (k) {
      var el = cellEls[k];
      el.querySelector(".ltr").textContent = letters[k] || "";
      el.classList.toggle("wrong", !!wrong[k]);
      el.classList.toggle("gold", !!(revealedCells[k] || subbedCells[k]));
      el.classList.toggle("gold-ans", !revealedCells[k] && !!revealAnswerCells[k]);
      el.setAttribute("aria-label", cellAria(k));
    });
    updateNudge();
    updateProgress();
    if (puzzle && started) renderBank(puzzle.entries[cur.entry]);
  }
  function cellAria(k) {
    var xy = k.split(",");
    var s = "Row " + (+xy[1] + 1) + " column " + (+xy[0] + 1) + ", " + (letters[k] || "blank");
    if (locked(k)) s += ", revealed";
    if (wrong[k]) s += ", marked wrong";
    return s;
  }
  function updateProgress() {
    if (!puzzle) return;
    var solved = 0;
    // verified[] is the server's last verdict on each entry; the browser has
    // no answers to compare against.
    puzzle.entries.forEach(function (e, i) { if (verified[i]) solved++; });
    var narrow = document.body.clientWidth <= 640;
    $("progressChip").textContent = solved + "/" + puzzle.entries.length + (narrow ? "" : " solved");
  }
  function updateNudge() {
    if (!puzzle) return;
    var g = { full: gridFull(), wrongCells: gridStats.wrongCells,
              wrongEntries: gridStats.wrongEntries };
    var show = g.full && !complete && g.wrongCells > 0;
    $("gridNudge").classList.toggle("show", show);
    if (!show) { $("gridNudge").textContent = ""; return; }
    // Free: how much is wrong. Not free: where. This only removes the
    // dead end of hunting an error that might not exist.
    var sq = g.wrongCells === 1 ? "1 square is wrong" : g.wrongCells + " squares are wrong";
    var wd = g.wrongEntries === 1 ? "1 answer" : g.wrongEntries + " answers";
    $("gridNudge").textContent =
      "The grid is full, but " + sq + ", across " + wd + ". Check or reveal to find them.";
  }

  /* ---------- Clue rendering ---------- */
  function renderClues() {
    var lists = { A: $("acrossList"), D: $("downList") };
    lists.A.innerHTML = ""; lists.D.innerHTML = "";
    entryOrder().forEach(function (i) {
      var e = puzzle.entries[i];
      var li = document.createElement("li");
      li.dataset.entry = i;
      li.innerHTML = '<span class="cl-num">' + e.num + '</span>' +
        '<span class="cl-text">' + escapeHtml(clueText(e.row, e.num)) +
        ' <span class="cl-enum">' + escapeHtml(e.row.enum) + '</span></span>';
      li.addEventListener("click", function () {
        cur = { entry: i, cell: firstEmptyCell(i) };
        updateSelection(); startTimer();
      });
      lists[e.dir].appendChild(li);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function firstEmptyCell(entryIdx) {
    var e = puzzle.entries[entryIdx];
    for (var i = 0; i < e.cells.length; i++) {
      if (!letters[K(e.cells[i].x, e.cells[i].y)]) return i;
    }
    return 0;
  }
  function entryOrder() {
    return puzzle.entries.map(function (e, i) { return i; })
      .sort(function (a, b) {
        var ea = puzzle.entries[a], eb = puzzle.entries[b];
        if (ea.dir !== eb.dir) return ea.dir === A ? -1 : 1;
        return ea.num - eb.num;
      });
  }

  /* ---------- Selection ---------- */
  function updateSelection() {
    var e = puzzle.entries[cur.entry];
    Object.keys(cellEls).forEach(function (k) {
      cellEls[k].classList.remove("in-word", "active");
    });
    e.cells.forEach(function (c, i) {
      var el = cellEls[K(c.x, c.y)];
      el.classList.add("in-word");
      if (i === cur.cell) el.classList.add("active");
    });
    document.querySelectorAll(".clue-col li").forEach(function (li) {
      var i = +li.dataset.entry;
      li.classList.toggle("active", i === cur.entry);
      li.classList.toggle("done", entryFilled(i));
    });
    // Compact: "1A (6)" reads as well as "1 Across · (6)" and keeps the clue,
    // the numbering and the letter bank together on one line.
    $("ncMeta").textContent = e.num + (e.dir === A ? "A" : "D") + " " + e.row.enum;
    $("ncMeta").title = e.num + " " + (e.dir === A ? "Across" : "Down");
    $("ncText").textContent = clueText(e.row, e.num);
    renderBank(e);
    var active = document.querySelector(".clue-col li.active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }
  /* Letter bank: the crossing letters you have already earned, gathered
     beside the clue. Adds no information — every letter shown is already
     in the grid — it just saves tracing the row or column by eye. */
  var bankOn = true;
  try { bankOn = localStorage.getItem("fcw.bank") !== "off"; } catch (e) {}
  function renderBank(e) {
    var el = $("letterBank");
    el.innerHTML = "";
    if (!bankOn || !started || paused) return;
    var brk = breakCells(e);
    e.cells.forEach(function (c, i) {
      var k = K(c.x, c.y);
      var d = document.createElement("div");
      var ch = letters[k] || "";
      d.className = "bank-cell" + (ch ? "" : " empty") + (wrong[k] ? " wrong" : "") +
        (revealedCells[k] ? " gold" : (revealAnswerCells[k] ? " gold-ans" : "")) +
        (i === cur.cell ? " here" : "");
      d.textContent = ch;
      el.appendChild(d);
      if (brk[i]) { // mirror the enumeration's word boundaries
        var g = document.createElement("div");
        g.className = "bank-gap";
        el.appendChild(g);
      }
    });
  }
  /* Pitch backdrop. Defaults on; off restores the plain paper board exactly. */
  var pitchOn = true;
  try { pitchOn = localStorage.getItem("fcw.pitch") !== "off"; } catch (e) {}
  function applyPitch() {
    document.body.classList.toggle("no-pitch", !pitchOn);
    var b = $("pitchToggle");
    if (b) b.textContent = "pitch: " + (pitchOn ? "on" : "off");
  }
  on("pitchToggle", "click", function () {
    pitchOn = !pitchOn;
    try { localStorage.setItem("fcw.pitch", pitchOn ? "on" : "off"); } catch (e) {}
    applyPitch();
  });
  applyPitch();

  on("bankToggle", "click", function () {
    bankOn = !bankOn;
    try { localStorage.setItem("fcw.bank", bankOn ? "on" : "off"); } catch (e) {}
    $("bankToggle").textContent = "letter bank: " + (bankOn ? "on" : "off");
    updateSelection();
  });
  if ($("bankToggle")) $("bankToggle").textContent = "letter bank: " + (bankOn ? "on" : "off");

  function entryFilled(i) {
    return puzzle.entries[i].cells.every(function (c) { return letters[K(c.x, c.y)]; });
  }

  function onCellTap(ev) {
    if (paused) return;
    var x = +ev.currentTarget.dataset.x, y = +ev.currentTarget.dataset.y;
    var c = puzzle.cells[K(x, y)];
    var e = puzzle.entries[cur.entry];
    var inCurrent = c.across === cur.entry || c.down === cur.entry;
    var isActive = inCurrent && e.cells[cur.cell].x === x && e.cells[cur.cell].y === y;
    var target;
    if (isActive && c.across !== null && c.down !== null) {
      target = (cur.entry === c.across) ? c.down : c.across;      // toggle direction
    } else if (inCurrent) {
      target = cur.entry;
    } else {
      target = c.across !== null ? c.across : c.down;             // prefer across
    }
    cur.entry = target;
    var te = puzzle.entries[target];
    cur.cell = te.cells.findIndex(function (cc) { return cc.x === x && cc.y === y; });
    updateSelection(); startTimer();
    ev.preventDefault();
  }

  /* ---------- Input ---------- */
  var lastSolved = {};
  function flashSolved() {
    if (!puzzle) return;
    puzzle.entries.forEach(function (e, i) {
      var ok = !!verified[i];
      if (ok && !lastSolved[i]) {
        e.cells.forEach(function (c) {
          var el = cellEls[K(c.x, c.y)];
          if (!el) return;
          el.classList.add("just-solved");
          setTimeout(function () { el.classList.remove("just-solved"); }, 600);
        });
      }
      lastSolved[i] = ok;
    });
  }
  function typeLetter(ch) {
    if (complete || !started || paused) return;
    var e = puzzle.entries[cur.entry];
    // Locked (revealed) cells cannot be overwritten: land on the next editable cell.
    while (cur.cell < e.len && locked(K(e.cells[cur.cell].x, e.cells[cur.cell].y))) cur.cell++;
    if (cur.cell >= e.len) { cur.cell = e.len - 1; advanceToNextEntry(); updateSelection(); return; }
    var c = e.cells[cur.cell];
    var k = K(c.x, c.y);
    letters[k] = ch;
    delete wrong[k];
    do { cur.cell++; } while (cur.cell < e.len && locked(K(e.cells[cur.cell].x, e.cells[cur.cell].y)));
    if (cur.cell >= e.len) { cur.cell = e.len - 1; advanceToNextEntry(); }
    refreshLetters(); updateSelection(); saveSoon();
    verifySoon();   // the server judges the entry; flashSolved() follows from it
  }
  function backspace() {
    if (complete || !started || paused) return;
    var e = puzzle.entries[cur.entry];
    var c = e.cells[cur.cell];
    var k = K(c.x, c.y);
    if (letters[k] && !locked(k)) {
      delete letters[k]; delete wrong[k];
    } else if (cur.cell > 0) {
      do { cur.cell--; } while (cur.cell > 0 && locked(K(e.cells[cur.cell].x, e.cells[cur.cell].y)));
      var p = e.cells[cur.cell];
      var pk = K(p.x, p.y);
      if (!locked(pk)) { delete letters[pk]; delete wrong[pk]; }
    }
    refreshLetters(); updateSelection(); saveSoon();
    verifySoon();   // deleting a letter un-solves an entry: re-ask
  }
  function advanceToNextEntry() {
    var order = entryOrder();
    var pos = order.indexOf(cur.entry);
    for (var s = 1; s <= order.length; s++) {
      var i = order[(pos + s) % order.length];
      if (!entryFilled(i)) { cur.entry = i; cur.cell = firstEmptyCell(i); return; }
    }
  }
  function stepClue(delta) {
    if (paused) return;
    var order = entryOrder();
    var pos = order.indexOf(cur.entry);
    cur.entry = order[(pos + delta + order.length) % order.length];
    cur.cell = firstEmptyCell(cur.entry);
    updateSelection(); startTimer();
  }
  function moveArrow(dx, dy) {
    var e = puzzle.entries[cur.entry];
    var c = e.cells[cur.cell];
    var wantDir = dx !== 0 ? A : D;
    if (e.dir !== wantDir) {
      var cc = puzzle.cells[K(c.x, c.y)];
      var other = wantDir === A ? cc.across : cc.down;
      if (other !== null) {
        cur.entry = other;
        cur.cell = puzzle.entries[other].cells.findIndex(function (p) { return p.x === c.x && p.y === c.y; });
        updateSelection();
        return;
      }
    }
    var nx = c.x + dx, ny = c.y + dy;
    while (nx >= 0 && ny >= 0 && nx < puzzle.width && ny < puzzle.height) {
      var t = puzzle.cells[K(nx, ny)];
      if (t) {
        var entry = wantDir === A ? (t.across !== null ? t.across : t.down)
                                  : (t.down !== null ? t.down : t.across);
        cur.entry = entry;
        cur.cell = puzzle.entries[entry].cells.findIndex(function (p) { return p.x === nx && p.y === ny; });
        updateSelection();
        return;
      }
      nx += dx; ny += dy;
    }
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (!started || paused) return;
    if (/^[a-zA-Z]$/.test(ev.key)) { typeLetter(ev.key.toUpperCase()); startTimer(); ev.preventDefault(); }
    else if (ev.key === "Backspace") { backspace(); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { moveArrow(-1, 0); ev.preventDefault(); }
    else if (ev.key === "ArrowRight") { moveArrow(1, 0); ev.preventDefault(); }
    else if (ev.key === "ArrowUp") { moveArrow(0, -1); ev.preventDefault(); }
    else if (ev.key === "ArrowDown") { moveArrow(0, 1); ev.preventDefault(); }
    else if (ev.key === "Tab") { stepClue(ev.shiftKey ? -1 : 1); ev.preventDefault(); }
    else if (ev.key === "Enter") { stepClue(1); ev.preventDefault(); }
  });

  /* ---------- On-screen keyboard ---------- */
  function buildOsk() {
    var rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
    var osk = $("osk");
    rows.forEach(function (r, ri) {
      var div = document.createElement("div");
      div.className = "osk-row";
      r.split("").forEach(function (ch) {
        var b = document.createElement("button");
        b.className = "osk-key"; b.textContent = ch;
        b.addEventListener("pointerdown", function (ev) { typeLetter(ch); startTimer(); ev.preventDefault(); });
        div.appendChild(b);
      });
      if (ri === 2) {
        var bs = document.createElement("button");
        bs.className = "osk-key wide"; bs.innerHTML = "&#9003;";
        bs.addEventListener("pointerdown", function (ev) { backspace(); ev.preventDefault(); });
        div.appendChild(bs);
      }
      osk.appendChild(div);
    });
  }
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
    document.body.classList.add("touch");
  }
  buildOsk();

  /* ---------- Check (selected answer, -3 pts) ---------- */
  /* Which letters are wrong is what Check costs three points for, so it is
     asked for explicitly with `detail` and answered server-side. Nothing here
     knows the correct letter — only that a position does not match. */
  function markWrongFromServer(entryIdx, wrongPositions) {
    var e = puzzle.entries[entryIdx];
    wrongPositions.forEach(function (i) {
      var c = e.cells[i];
      if (c) wrong[K(c.x, c.y)] = true;
    });
    refreshLetters(); saveSoon();
  }
  on("checkBtn", "click", function () {
    if (complete || !started || paused) return;
    var cells = puzzle.entries[cur.entry].cells;
    var hasLetters = cells.some(function (c) { return letters[K(c.x, c.y)]; });
    if (!hasLetters) return; // nothing to check — no charge
    checksUsed++;
    helpActions.push("check");
    consecutiveChecks++;
    var idx = cur.entry;
    var typed = cells.map(function (c) { return letters[K(c.x, c.y)] || " "; }).join("");
    api("/api/check-answer", { token: puzzleToken, entry: idx, guess: typed, detail: 1 })
      .then(function (r) { markWrongFromServer(idx, r.wrong || []); })
      .catch(function (err) { toast("Check unavailable", String(err.message || err), "loss"); });
    var headline = consecutiveChecks === 2 ? "Back-to-back defeats"
                 : consecutiveChecks >= 3 ? "Three losses on the bounce"
                 : "Defeat \u2014 3 points dropped";
    toast(headline, consecutiveChecks > 1 ? "3 points dropped" : "", "loss");
    updateScoreUI();
  });

  /* ---------- Check All (whole grid, -9 pts) ----------
     Priced above the single check so it never dominates it: checking one
     answer stays the cheap, considered move. */
  on("checkAllBtn", "click", function () {
    if (complete || !started || paused) return;
    var all = [];
    puzzle.entries.forEach(function (e) { all = all.concat(e.cells); });
    var anyTyped = all.some(function (c) { return letters[K(c.x, c.y)]; });
    if (!anyTyped) return;                       // nothing to check — no charge
    checkAllsUsed++;
    helpActions.push("checkAll");
    consecutiveChecks = 0;
    // One request per entry, asking for detail because this is the paid check.
    var jobs = puzzle.entries.map(function (e, i) {
      var typed = e.cells.map(function (c) { return letters[K(c.x, c.y)] || " "; }).join("");
      return api("/api/check-answer", { token: puzzleToken, entry: i, guess: typed, detail: 1 })
        .then(function (r) { return { i: i, wrong: r.wrong || [] }; });
    });
    Promise.all(jobs).then(function (res) {
      var total = 0;
      res.forEach(function (r) { total += r.wrong.length; markWrongFromServer(r.i, r.wrong); });
      gridStats.wrongCells = total;
      toast("Three defeats on the bounce",
        total ? total + (total === 1 ? " letter is wrong" : " letters are wrong")
              : "Everything you've filled in is correct", "loss");
      updateNudge();
    }).catch(function (err) {
      toast("Check unavailable", String(err.message || err), "loss");
    });
    updateScoreUI();
  });

  /* ---------- Reveal Letter (selected cell, -2 pts per unique cell) ---------- */
  on("revealLetterBtn", "click", function () {
    if (complete || !started || paused) return;
    var e = puzzle.entries[cur.entry];
    var c = e.cells[cur.cell];
    var k = K(c.x, c.y);
    if (locked(k)) return; // already revealed: no effect, no charge
    // §6 of the deployment standard: the server returns an answer only on an
    // explicit request. This is one — it costs two points.
    revealFromServer(cur.entry, cur.cell, function (ch) {
      letters[k] = ch;                 // insert or correct
      delete wrong[k];
      revealedCells[k] = true;         // locked + gold from here on
      refreshLetters(); verifySoon(); saveSoon();
    });
    helpActions.push("revealLetter");
    consecutiveChecks = 0;
    toast("Draw \u2014 2 points dropped", "Held to a draw.", "draw");
    // advance to the next editable cell, like typing
    do { cur.cell++; } while (cur.cell < e.len && locked(K(e.cells[cur.cell].x, e.cells[cur.cell].y)));
    if (cur.cell >= e.len) { cur.cell = e.len - 1; advanceToNextEntry(); }
    refreshLetters(); updateSelection(); updateScoreUI(); saveSoon();
    startTimer();
    checkComplete();
  });

  /* ---------- Substitution (practice levels): free letter, no score effect ---------- */
  function subsLeft() { return Math.max(0, subsAllowance() - subsUsed); }
  function updateSubUI() {
    var btn = $("subBtn");
    if (!btn) return;
    var allowance = subsAllowance();
    btn.style.display = allowance > 0 ? "" : "none";
    btn.disabled = subsLeft() <= 0;
    $("subCount").textContent = subsLeft() + " left";
  }
  on("subBtn", "click", function () {
    if (complete || !started || paused || subsLeft() <= 0) return;
    var e = puzzle.entries[cur.entry];
    var c = e.cells[cur.cell];
    var k = K(c.x, c.y);
    if (locked(k)) return; // already revealed: no effect, no sub spent
    revealFromServer(cur.entry, cur.cell, function (ch) {
      letters[k] = ch;
      delete wrong[k];
      subbedCells[k] = true;           // locked + gold, but never scored
      refreshLetters(); verifySoon(); saveSoon();
    });
    subsUsed++;
    toast("Substitution", "Fresh legs \u2014 free letter, nothing conceded.");
    do { cur.cell++; } while (cur.cell < e.len && locked(K(e.cells[cur.cell].x, e.cells[cur.cell].y)));
    if (cur.cell >= e.len) { cur.cell = e.len - 1; advanceToNextEntry(); }
    refreshLetters(); updateSelection(); updateScoreUI(); updateSubUI(); saveSoon();
    startTimer();
    checkComplete();
  });

  /* One letter, from the server, for Reveal Letter and Substitution alike. */
  function revealFromServer(entryIdx, cellIdx, apply) {
    api("/api/reveal", { token: puzzleToken, entry: entryIdx, index: cellIdx })
      .then(function (r) { apply(r.letter); })
      .catch(function (err) { toast("Reveal unavailable", String(err.message || err), "loss"); });
  }

  /* ---------- Reveal Answer (selected answer, -9 pts per unique answer) ---------- */
  on("revealBtn", "click", function () {
    if (complete || !started || paused) return;
    var e = puzzle.entries[cur.entry];
    var idx = cur.entry;
    // The one place a whole answer is fetched, and only because the player has
    // asked for it and paid nine points.
    api("/api/reveal", { token: puzzleToken, entry: idx })
      .then(function (r) {
        e.cells.forEach(function (c, i) {
          var k = K(c.x, c.y);
          letters[k] = r.answer[i];
          delete wrong[k];
          // Lock every cell; keep prior gold letter-reveals gold (no double charge).
          if (!revealedCells[k]) revealAnswerCells[k] = true;
        });
        refreshLetters(); verifySoon(); saveSoon();
      })
      .catch(function (err) { toast("Reveal unavailable", String(err.message || err), "loss"); });
    if (!revealedEntries[cur.entry]) {
      revealedEntries[cur.entry] = true;
      helpActions.push("revealAnswer");
      consecutiveChecks = 0;
      toast("Three defeats on the bounce", "9 points dropped", "loss");
    }
    refreshLetters(); updateSelection(); updateScoreUI(); saveSoon();
    startTimer();
    checkComplete();
  });

  /* ---------- Daily results (local only, no accounts) ----------
     One structured record per completed Daily. Every figure on My Season is
     derived from these, and the shape is stable enough for a future optional
     account sync to consume unchanged. */
  var RESULTS_KEY = "fcw.results.v1";
  function loadResults() {
    try {
      var r = JSON.parse(localStorage.getItem(RESULTS_KEY));
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }
  function saveResults(list) {
    try { localStorage.setItem(RESULTS_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function recordDaily(pos, score, res) {
    var list = loadResults();
    // A Daily is recorded once; a later replay never overwrites the original.
    if (list.some(function (r) { return r.dailyNo === dailyNo; })) return list;
    /* Spec §19: only the host's clock can bank a result. If the device clock
       has been moved to open a Daily that is not today, the puzzle stays
       playable — it just does not count towards points, streak or history.
       Offline there is no trusted clock and no way to tell, so play records as
       normal: refusing would punish honest offline players to stop a cheat that
       only ever affects the cheater's own device. */
    var ts = FCW.timeState();
    if (ts.trusted && dailyNo !== FCW.dailyNumber()) {
      showClockNote(dailyNo, FCW.dailyNumber());
      return list;
    }
    list.push(FCW.makeResultRecord({
      date: FCW.localDateKey(), dailyNo: dailyNo, seed: seed,
      bankVersion: FCW.QUESTION_BANK_VERSION,
      club: club, season: season ? season.season : null,
      score: score, position: pos,
      elapsedSeconds: elapsed, matchMinute: FCW.matchMinute(elapsed),
      checks: checksUsed,
      revealedLetters: revealedLetterCount(),
      revealedAnswers: revealedAnswerCount()
    }));
    list.sort(function (a, b) { return a.dailyNo - b.dailyNo; });
    saveResults(list);
    return list;
  }
  function showClockNote(playedNo, todayNo) {
    var el = $("rClockNote");
    if (!el) return;
    el.textContent = "Not recorded \u2014 this is Daily #" + playedNo +
      ", and today's is #" + todayNo + ".";
    el.style.display = "";
  }
  function renderStreak() {
    var st = FCW.seasonStats(loadResults(), dailyNo);
    $("streakLine").textContent = st.played
      ? "Current run " + st.currentStreak + " \u00B7 best " + st.longestStreak +
        " \u00B7 " + st.played + " played"
      : "";
  }

  /* ---------- My Season ---------- */
  function fmtClock(sec) { return fmt(sec || 0); }
  function renderStats() {
    var results = loadResults();
    var st = FCW.seasonStats(results, dailyNo);
    $("statsSub").textContent = st.played
      ? st.played + " Daily " + (st.played === 1 ? "puzzle" : "puzzles") + " completed"
      : "Your record on this device";
    var cells = [
      ["Current run", st.currentStreak],
      ["Best run", st.longestStreak],
      ["Played", st.played],
      ["Best points", st.bestScore === null ? "\u2014" : st.bestScore],
      ["Average points", st.averageScore === null ? "\u2014" : st.averageScore],
      ["Best finish", st.bestFinish === null ? "\u2014" : FCW.ordinal(st.bestFinish)],
      ["Titles", st.titles],
      ["Top four", st.topFour],
      ["Relegations", st.relegations],
      ["Fastest", st.fastestSeconds === null ? "\u2014" : fmtClock(st.fastestSeconds)],
      ["Average time", st.averageSeconds === null ? "\u2014" : fmtClock(st.averageSeconds)],
      ["European places", st.european]
    ];
    $("statGrid").innerHTML = cells.map(function (c) {
      return '<div class="stat"><b>' + escapeHtml(String(c[1])) + '</b><span>' +
        escapeHtml(c[0]) + '</span></div>';
    }).join("");
    // Compact history, most recent first.
    var recent = results.slice().sort(function (a, b) { return b.dailyNo - a.dailyNo; }).slice(0, 20);
    $("historyEmpty").style.display = recent.length ? "none" : "";
    $("historyBody").innerHTML = recent.map(function (r) {
      return "<tr>" +
        '<td class="dim">' + escapeHtml(r.date) + "</td>" +
        '<td class="club">' + escapeHtml(r.club || "\u2014") + "</td>" +
        '<td class="dim">' + escapeHtml(r.season || "\u2014") + "</td>" +
        '<td class="pos">' + FCW.ordinal(r.position) + "</td>" +
        "<td>" + r.score + " pts</td>" +
        '<td class="dim">' + fmtClock(r.elapsedSeconds) + "</td>" +
        "</tr>";
    }).join("");
  }
  on("statsBtn", "click", function () { renderStats(); $("statsSheet").classList.add("show"); });
  on("statsClose", "click", function () { $("statsSheet").classList.remove("show"); });

  /* ---------- Football-result notifications (presentation only) ---------- */
  var toastT = null;
  /* Uncaught errors get a visible, precise report inside the game. In a
     sandboxed preview frame the host console only ever sees the masked
     "Script error." — this handler runs same-origin with the inline script,
     so it always has the real message and line. If this strip stays silent
     while a host console complains, the error is the host's, not ours. */
  var errCount = 0;
  function showErr(text) {
    errCount++;
    var el = $("errStrip"), msg = $("errStripMsg");
    if (!el || !msg) return;
    msg.textContent = "[" + errCount + "] " + text;
    el.style.display = "";
  }
  window.addEventListener("error", function (ev) {
    showErr((ev.message || "unknown error") +
      (ev.filename ? "  @" + String(ev.filename).slice(-30) : "") +
      (ev.lineno ? ":" + ev.lineno + (ev.colno ? ":" + ev.colno : "") : "") +
      (ev.error && ev.error.stack ? "\n" + String(ev.error.stack).split("\n").slice(0, 3).join("\n") : ""));
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev.reason;
    showErr("unhandled rejection: " + (r && (r.stack || r.message) || String(r)).split("\n").slice(0, 3).join("\n"));
  });
  (function () {
    var x = $("errStripX");
    if (x) x.addEventListener("click", function () { $("errStrip").style.display = "none"; });
  })();

  function toast(headline, detail, kind) {
    var el = $("toast");
    if (!el) return;
    el.innerHTML = escapeHtml(headline) + (detail ? "<small>" + escapeHtml(detail) + "</small>" : "");
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.className = "toast" + (kind ? " " + kind : ""); }, 2200);
  }

  /* ---------- Season strip ----------
     All 38 games, derived from the live score: a win is 3 points and a draw 1,
     so the score resolves to exactly one W/D/L split. Time and help both show
     here, because both cost points. */
  function renderSeason(gamesId, wdlId, score) {
    var el = $(gamesId);
    if (!el) return;
    // Built from what the player actually did, so the strip and the Full Time
    // breakdown tell the same story.
    var r = FCW.seasonFromActions(elapsed, checksUsed, revealedLetterCount(),
                                  revealedAnswerCount(), checkAllsUsed);
    var lastWin = r.won - 1;
    el.innerHTML = r.marks.map(function (m, i) {
      return '<span class="game ' + m + (i === lastWin ? ' now' : '') + '"></span>';
    }).join("");
    if ($(wdlId)) {
      $(wdlId).textContent = r.won + "W  " + r.drawn + "D  " + r.lost + "L";
    }
    el.setAttribute("aria-label",
      "Season record: " + r.won + " wins, " + r.drawn + " draws, " + r.lost + " defeats");
  }

  /* ---------- Live league table ---------- */
  /* Which positions the live table shows: the player with one club above and
     one below. At the top or bottom of the table the window is clamped, so
     1st sees 1-3 and 20th sees 18-20 — always three rows. */
  function liveWindow(playerPos, size) {
    var lo = Math.max(1, Math.min(playerPos - 1, size - 2));
    return { from: lo, to: Math.min(size, lo + 2) };
  }
  function renderLeagueRows(tbody, table, compact) {
    tbody.innerHTML = "";
    var playerPos = FCW.playerPosition(table);
    var win = compact ? liveWindow(playerPos, table.length) : null;
    table.forEach(function (r) {
      var tr = document.createElement("tr");
      if (r.isPlayer) tr.className = "you";
      if (r.pos <= 4) tr.classList.add("ucl");
      else if (r.pos <= 6) tr.classList.add("euro");
      if (r.pos >= 18) tr.classList.add("drop");
      if (r.pos === 4 || r.pos === 6 || r.pos === 17) tr.classList.add("zone-edge");
      if (win && (r.pos < win.from || r.pos > win.to)) tr.classList.add("faroff");
      if (r.pos === 4 || r.pos === 6 || r.pos === 17) tr.classList.add("zone-end"); // UCL / Europe / safety
      tr.innerHTML = '<td class="pos">' + r.pos + '</td><td class="club">' + escapeHtml(r.club) +
        '</td><td class="pts">' + r.points + '</td>';
      tbody.appendChild(tr);
    });
  }
  var lastPos = null;
  function announceMove(pos) {
    if (lastPos === null) { lastPos = pos; return; }
    if (pos === lastPos) return;
    var up = pos < lastPos;
    // Crossing a zone boundary is the more interesting story than the number.
    var msg;
    if (up && pos <= 4 && lastPos > 4) msg = "\u25B2 Into the top four";
    else if (!up && pos > 4 && lastPos <= 4) msg = "\u25BC Out of the top four";
    else if (!up && pos >= 18 && lastPos < 18) msg = "\u25BC Into the relegation zone";
    else if (up && pos < 18 && lastPos >= 18) msg = "\u25B2 Out of the relegation zone";
    else if (up && pos === 1) msg = "\u25B2 Top of the league";
    else msg = (up ? "\u25B2 Up to " : "\u25BC Down to ") + FCW.ordinal(pos);
    toast(msg, "", up ? "" : "loss");
    // brief row tint, cleared after the transition
    var row = $("leagueBody") && $("leagueBody").querySelector("tr.you");
    if (row) {
      row.classList.add("moved", up ? "up" : "down");
      setTimeout(function () { row.classList.remove("moved", "up", "down"); }, 600);
    }
    lastPos = pos;
  }
  function updateScoreUI() {
    if (!puzzle || club === null) return;
    var score = liveScore();
    var table = FCW.buildTable(club, score, season);
    if (!table.length) return;
    var pos = FCW.playerPosition(table);
    renderSeason("seasonGames", "seasonWdl", score);
    if (started && !complete && !paused) announceMove(pos);
    // The position and running score are read off the league table itself —
    // a chip repeating them in the toolbar was saying the same thing twice.
    $("tableSeason").textContent = season ? season.season : "";
    renderLeagueRows($("leagueBody"), table, true);
  }

  /* ---------- Club selection (sidebar + kick-off card share state) ---------- */
  function populateClubSelect(sel) {
    if (sel.options.length) return;
    var opt = document.createElement("option");
    opt.value = "__random__"; opt.textContent = "Random club and season";
    sel.appendChild(opt);
    CLUBS.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { applyClubChoice(sel.value); });
  }
  function applyClubChoice(value) {
    if (value === "__random__") {
      clubMode = "random";
      try { localStorage.removeItem("fcw.clubPref"); } catch (e) {}
      if (!started) {                       // reroll before kick-off
        randomPick = FCW.pickSeasonAndClub(seed, null);
        if (randomPick) { club = randomPick.club; season = randomPick.season; }
      }
      // mid-puzzle: keep this puzzle's club; next New Puzzle rerolls
    } else {
      clubMode = "chosen"; club = value;
      try { localStorage.setItem("fcw.clubPref", club); } catch (e) {}
    }
    syncClubSelect(); syncKickSelect();
    updateScoreUI(); saveSoon();
  }
  function syncClubSelect() {
    var sel = $("clubSelect");
    populateClubSelect(sel);
    sel.value = clubMode === "chosen" ? club : "__random__";
  }
  function syncKickSelect() {
    var sel = $("kickClubSelect");
    populateClubSelect(sel);
    sel.value = clubMode === "chosen" ? club : "__random__";
  }
  on("kickOffBtn", "click", kickOff);

  /* ---------- Completion + scoring ---------- */
  /* Completion is the server's word. Every entry has to have been judged
     correct, and the grid has to be full — the browser cannot check the letters
     itself, and should not be able to. */
  function isComplete() {
    if (!puzzle || !gridFull()) return false;
    return puzzle.entries.every(function (e, i) { return verified[i] === true; });
  }
  /* Help stated as football results. Safe to phrase this way because the
     season strip is now derived from the same actions, so the two agree. */
  function footballPhrase(kind, count, points) {
    if (!count) return "None";
    if (kind === "draw") return count === 1 ? "1 draw" : count + " draws";
    if (kind === "check") return count === 1 ? "1 defeat" : count + " defeats";
    return count === 1 ? "3 defeats" : (count * 3) + " defeats";
  }

  function checkComplete() {
    if (complete || !isComplete()) return;
    complete = true;
    paused = false; $("pauseBtn").disabled = true; syncPauseIcon();
    stopTimer(); save();
    var res = FCW.computeScore(elapsed, checksUsed, revealedLetterCount(),
                               revealedAnswerCount(), checkAllsUsed);
    var table = FCW.buildTable(club, res.score, season);
    var pos = FCW.playerPosition(table);
    if ($("rClockNote")) $("rClockNote").style.display = "none";
    updateScoreUI();
    $("rClub").textContent = club + (season ? "  \u00B7  " + season.season : "");
    $("rPos").textContent = (FCW.ordinal(pos) + " \u2014 " + res.score + " pts").toUpperCase();
    $("rScore").textContent = res.score;
    $("rMsg").textContent = FCW.outcomeMessage(club, pos);
    renderSeason("rSeasonGames", "rSeasonWdl", res.score);
    $("bClock").textContent = FCW.matchClockLabel(elapsed);
    $("bTime").textContent = fmt(elapsed);
    $("bTimePen").textContent = "\u2212" + res.timePenalty;
    $("bChecks").textContent = footballPhrase("check", checksUsed, res.checkPenalty);
    $("bCheckPen").textContent = "\u2212" + res.checkPenalty;
    $("bCheckAlls").textContent = footballPhrase("answer", checkAllsUsed, res.checkAllPenalty);
    $("bCheckAllPen").textContent = "\u2212" + res.checkAllPenalty;
    $("bLetters").textContent = footballPhrase("draw", revealedLetterCount(), res.revealLetterPenalty);
    $("bLetterPen").textContent = "\u2212" + res.revealLetterPenalty;
    $("bAnswers").textContent = footballPhrase("answer", revealedAnswerCount(), res.revealAnswerPenalty);
    $("bAnswerPen").textContent = "\u2212" + res.revealAnswerPenalty;
    $("rFinal").textContent = res.score + " / " + FCW.SCORING.MAX_SCORE;
    if (mode === "daily") { recordDaily(pos, res.score, res); renderStreak(); }
    renderLeagueRows($("finalTableBody"), table, false); // Full Time: all 20
    var youRow = $("finalTableBody").querySelector("tr.you");
    $("doneOverlay").classList.add("show");
    if (youRow && youRow.scrollIntoView) youRow.scrollIntoView({ block: "center" });
  }
  on("viewGridBtn", "click", function () {
    $("doneOverlay").classList.remove("show"); // gold cells stay marked; input is locked
  });
  on("shareBtn", "click", function () {
    var res = FCW.computeScore(elapsed, checksUsed, revealedLetterCount(),
                               revealedAnswerCount(), checkAllsUsed);
    var table = FCW.buildTable(club, res.score, season);
    var pos = FCW.playerPosition(table);
    var name = mode === "daily" ? "Crossword XI #" + dailyNo : "Crossword XI (practice)";
    var text = name + " \u2014 " + club + " finished " + FCW.ordinal(pos) +
      (season ? " in " + season.season : "") +
      " \u2014 " + res.score + "/114 pts \u26BD " + fmt(elapsed);
    function done(ok) {
      $("shareBtn").textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(function () { $("shareBtn").textContent = "Share result"; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { done(document.execCommand("copy")); } catch (e) { done(false); }
      document.body.removeChild(ta);
    }
  });
  function startPractice() {
    mode = "practice";
    newPuzzle(); // fresh random seed
  }
  on("againBtn", "click", function () { startPractice(); });
  on("newBtn", "click", function () {
    if (!complete && progressRatio() > 0.25) {
      if (!window.confirm("Abandon this puzzle and start a practice puzzle?")) return;
    }
    startPractice();
  });
  on("dailyBtn", "click", function () {
    if (mode === "practice" && !complete && progressRatio() > 0.25) {
      if (!window.confirm("Leave this practice puzzle and open today's daily?")) return;
    }
    bootDaily();
  });
  function bootDaily() {
    mode = "daily";
    dailyNo = FCW.dailyNumber();
    var saved = loadSaved("daily");
    if (saved && saved.dailyNo === dailyNo && saved.seed != null) {
      newPuzzle(saved.seed, saved);      // resume today's daily (finished or not)
    } else {
      newPuzzle(FCW.dailySeed(dailyNo)); // fresh daily for today
    }
  }
  on("prevClue", "click", function () { stepClue(-1); });
  on("nextClue", "click", function () { stepClue(1); });
  window.addEventListener("resize", function () { if (puzzle) fitCells(); });
  window.addEventListener("orientationchange", function () {
    setTimeout(function () { if (puzzle) fitCells(); }, 250);
  });

  /* ---------- Dev panel ---------- */
  /* The developer panel is gone.
     It generated puzzles in the browser with FCW.generate(FCW_DATA, ...) and
     compared typed letters against the solution — both of which needed the clue
     bank to be present in the page, which is exactly what this version removes.
     Its checks now live where they can still run: the grid, scoring and
     completion rules in headless_test.js, and the API contract in
     functions_test.mjs. */
  var devToggle = $("devToggle");
  if (devToggle) devToggle.style.display = "none";

  /* ---------- Boot: today's daily first; unfinished practice resumes ---------- */
  (function boot() {
    var daily = loadSaved("daily");
    var practice = loadSaved("practice");
    if (practice && practice.seed != null && !practice.complete &&
        Object.keys(practice.letters || {}).length &&
        !(daily && daily.dailyNo === FCW.dailyNumber() && !daily.complete)) {
      mode = "practice";
      newPuzzle(practice.seed, practice); // mid-practice takes priority over a fresh daily
    } else {
      bootDaily();
    }
  })();

  /* The sync lands after boot, so the Daily opens instantly and offline play is
     unaffected. If the host's date disagrees with the device, correct the
     puzzle — but only before kick-off, when nothing is at stake and the grid is
     still hidden. Mid-play the puzzle is left alone and recordDaily declines to
     bank it instead; yanking a grid out from under someone would be worse than
     the cheat. */
  syncServerDate(function (synced) {
    if (!synced) return;
    var trueNo = FCW.dailyNumber();
    if (trueNo === dailyNo) return;
    if (mode === "daily" && !started && !complete) bootDaily();
  });
})();
