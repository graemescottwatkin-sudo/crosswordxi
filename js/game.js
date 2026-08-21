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

  /* The season's own floor: one point below its bottom club, so running the
     clock out always finishes last. A fixed floor of 36 finished bottom in only
     2 of the 30 seasons — in 2007/08 it placed you 16th for a puzzle you never
     solved. */
  function seasonFloor() {
    if (!season || !season.table || !season.table.length) return undefined;
    var last = season.table[season.table.length - 1];
    return Math.max(0, (last.points || 0) - 1);
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
  /* Pausing hides the puzzle, so it cannot be used to think for free — but it
     does stop the scoring clock, which is worth about 20 points in the first
     half hour. Recorded rather than forbidden: a doorbell should not cost a
     player their score, and "solved in 4 minutes" should not look identical to
     "solved in 4 minutes across six pauses spread over two hours" when there is
     a leaderboard to compare them on. */
  var pauseCount = 0, pausedMs = 0, pauseStartedAt = null;
  var mode = "daily";        // "daily" | "practice" | "theme"
  /* Which themed board to fetch, and what the one in play is called. themeLabel
     is what the server said, not something rebuilt here — the name on the board
     and the name in the share message must not be able to drift apart. */
  var themeWanted = null;
  /* The challenge being played, if any. Set before the board is built and read
     again at Full Time, when the score has been verified and can join a table. */
  var challenge = null;
  var CH_NAME_KEY = "fcw.chName";      // remembered, so a returning player presses Play
  var CH_KEY_KEY = "fcw.entrant";      // one entry each: an id this device keeps

  /* The signed-in player's name. The session returns displayName — the field is
     display_name in the database — and three places asked for account.name,
     which is always undefined. So a signed-in player was treated as a guest
     everywhere it mattered: their own name offered as editable text, and the
     last name typed on the device filled in instead.
     One function, so the next place to need it cannot ask for the wrong field.
     Falls back to the part of the email before the @ rather than to nothing,
     because an account with no display name still belongs to somebody. */
  function accountName() {
    if (!account) return null;
    var n = (account.displayName || "").trim();
    if (n.length >= 2) return n;
    var e = String(account.email || "");
    var at = e.indexOf("@");
    var from = at > 1 ? e.slice(0, at) : "";
    return from.length >= 2 ? from : null;
  }

  function entrantKey() {
    var k = null;
    try { k = localStorage.getItem(CH_KEY_KEY); } catch (e) {}
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(k || "")) {
      k = "d" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      try { localStorage.setItem(CH_KEY_KEY, k); } catch (e) {}
    }
    return k;
  }
  var themeLabel = "";
  var dailyNo = FCW.dailyNumber();
  var cellEls = {};
  var seasonErrors = FCW.loadSeasons(FCW_SEASONS);
  // Answer-repetition control for the Daily. If the table is missing or a day
  // falls outside it, dailyBans() returns null and the Daily plays as before.
  /* The build this file came from. Visible in the footer and on the console, so
     "is the new version actually live?" is a question with an answer. */
  var BUILD = "v50";
  try {
    window.CROSSWORDXI_BUILD = BUILD;
    console.log("Crossword XI build " + BUILD);
    var tag = document.getElementById("buildTag");
    if (tag) tag.textContent = BUILD;
    var badge = document.getElementById("buildBadge");
    if (badge) badge.textContent = BUILD;
  } catch (e) {}

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
        if (!r.ok) {
          /* The server answered and said no — an expired puzzle, a daily that
             is not today. Not a connection problem, and must not be reported
             as one. */
          var e = new Error(j && j.error ? j.error : "Request failed (" + r.status + ")");
          e.status = r.status;
          throw e;
        }
        return j;
      });
    }, function (netErr) {
      // fetch itself rejected: nothing reached the server.
      var e = new Error("No connection");
      e.offline = true;
      throw e;
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
    /* An array, not a string. Dropping blanks shortened the text and shifted
       every later letter out of position. */
    return Object.keys(puzzle.cells).sort().map(function (k) {
      return letters[k] || null;
    });
  }
  function gridFull() {
    return Object.keys(puzzle.cells).every(function (k) { return !!letters[k]; });
  }

  /* Ask the server about any entry that has just been completed or changed.
     Free feedback — the game has always told you when an entry is right the
     moment you finish it. Which letters are wrong is the paid Check, and is
     requested separately with detail. */
  /* ---------- Losing the connection ----------
     Typing, saving and the clock are local and carry on. Everything about
     correctness is a server call, so when the network goes the solved count
     stops moving and completion cannot fire — the player needs to know that,
     and the game needs to catch up by itself when the signal returns rather
     than waiting for the next keystroke. Finishing the grid offline used to
     mean the puzzle never completed at all. */
  var offline = false;
  function setOffline(state, why) {
    if (offline === state) return;
    offline = state;
    document.body.classList.toggle("offline", state);
    var strip = $("netStrip");
    if (strip) {
      strip.textContent = state
        ? (why || "No connection \u2014 answers cannot be checked until it returns")
        : "";
    }
    if (!state) verifyNow();          // catch up on everything missed
  }
  window.addEventListener("online", function () { setOffline(false); });
  window.addEventListener("offline", function () { setOffline(true); });
  /* A dropped request is better evidence than the browser's own flag, which
     reports a connected wifi with no route out as "online". */
  var retryTimer = null;
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setInterval(function () {
      if (!puzzle || !puzzleToken) return;
      var pending = puzzle.entries.some(function (e, i) {
        return entryText(i) !== null && verified[i] !== true;
      });
      if (!pending) { clearInterval(retryTimer); retryTimer = null; return; }
      verifyNow();
    }, 5000);
  }

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
      /* /api/verify, not /api/check-answer: this is the free background check
         that marks an entry solved as you type. Sending it to the paid endpoint
         is what made the server unable to tell the two apart. */
      jobs.push(api("/api/verify", { token: puzzleToken, entry: i, guess: text })
        .then(function (r) { verified[i] = !!r.correct; setOffline(false); })
        .catch(function (err) {
          delete verifySent[i];       // so it is asked again
          /* Only a request that never reached the server means offline. A
             server that answered and said no — a daily that is not today, an
             expired puzzle — is a refusal, and reporting it as a lost
             connection sends the player looking for a network problem that is
             not there. */
          if (err && err.offline) {
            setOffline(true);
            scheduleRetry();          // ...without waiting for a keystroke
          }
        }));
    });
    if (!jobs.length) { updateProgress(); return Promise.resolve(); }
    return Promise.all(jobs).then(function () {
      updateProgress(); flashSolved(); checkComplete();
      // "How many letters are wrong" is free and always has been, but the
      // browser can no longer count it: ask once the grid is full.
      if (gridFull() && !complete) {
        /* /api/verify, and no play id. This is the free nudge — "the grid is
           full but something is off" — and it fires by itself every time the
           last square is filled. Sent to the paid endpoint with a play id, it
           was tallied as a grid check each time: four automatic fires charged
           as four nine-point presses the player never made. Free information
           goes through the free door. */
        return api("/api/verify", { token: puzzleToken, grid: gridText(), detail: 1 })
          .then(function (r) {
            gridStats.wrongCells = r.wrongCells || 0;
            gridStats.wrongEntries = r.wrongEntries || 0;
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

  /* The Football League clubs, so a Bolton or a Wrexham supporter can play as
     their own side. No new season data is needed: the engine already displaces
     the bottom club when yours did not play in the season being used, which is
     exactly right — you take the last place and climb from there.

     Taken from the 2024/25 divisions to match the newest season stored. Divisions
     change every year and this list is written out rather than derived, so it
     will drift; it is only a menu, and a wrong division costs nothing but a
     misplaced heading. Worth checking before launch. */
  var EFL_CLUBS = [
    // Championship 2024/25
    "Blackburn Rovers", "Bristol City", "Cardiff City", "Coventry City",
    "Derby County", "Hull City", "Leeds United", "Luton Town",
    "Middlesbrough", "Millwall", "Norwich City", "Oxford United",
    "Plymouth Argyle", "Portsmouth", "Preston North End",
    "Queens Park Rangers", "Sheffield United", "Sheffield Wednesday",
    "Stoke City", "Sunderland", "Swansea City", "Watford",
    "West Bromwich Albion",
    // League One 2024/25
    "Barnsley", "Birmingham City", "Blackpool", "Bolton Wanderers",
    "Bristol Rovers", "Burton Albion", "Cambridge United", "Charlton Athletic",
    "Crawley Town", "Exeter City", "Huddersfield Town", "Leyton Orient",
    "Lincoln City", "Mansfield Town", "Northampton Town", "Peterborough United",
    "Reading", "Rotherham United", "Shrewsbury Town", "Stevenage",
    "Stockport County", "Wigan Athletic", "Wrexham", "Wycombe Wanderers",
    // League Two 2024/25
    "Accrington Stanley", "AFC Wimbledon", "Barrow", "Bradford City",
    "Bromley", "Carlisle United", "Cheltenham Town", "Chesterfield",
    "Colchester United", "Crewe Alexandra", "Doncaster Rovers",
    "Fleetwood Town", "Gillingham", "Grimsby Town", "Harrogate Town",
    "Milton Keynes Dons", "Morecambe", "Newport County", "Notts County",
    "Port Vale", "Salford City", "Swindon Town", "Tranmere Rovers", "Walsall",
  ];
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
                            revealedAnswerCount(), checkAllsUsed, { floor: seasonFloor() }).score;
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
  /* The clock is only written when something else triggers a save, so twenty-five
     seconds of thinking with nothing typed left elapsed at 0 in storage — and
     the landing screen showed no progress on a game that was plainly running.
     A save every ten seconds costs nothing and makes the displayed time true. */
  var clockSaveT = null;
  function startClockSaves() {
    if (clockSaveT) return;
    clockSaveT = setInterval(function () {
      if (running && puzzle && !complete) save();
    }, 10000);
  }

  function startTimer() {
    startClockSaves();
    if (!started || paused) return; // no clock before kick-off or while paused
    if (!running && !complete) { running = true; timerId = setInterval(tick, 1000); }
  }
  function stopTimer() { running = false; clearInterval(timerId); }
  /* The interval startClockSaves() opened. stopTimer deliberately leaves it
     alone — a paused game still wants its elapsed written — so only a tab that
     is standing down or about to be replaced needs it gone. Nothing cleared it
     before, which is half of why a reset came back to life. */
  function stopClockSaves() { clearInterval(clockSaveT); clockSaveT = null; }

  /* This tab has lost the right to write. Two ways in: another tab changed the
     slot underneath us, or a reset is clearing storage and reloading. Either
     way the copy in this page's memory is now the stale one, and writing it
     back is exactly how a cleared record reappears ten seconds later. */
  var saveBlocked = false;
  function standDown() {
    saveBlocked = true;
    clearTimeout(saveT);
    stopTimer();
    stopClockSaves();
  }

  /* ---------- Persistence (best-effort) ---------- */
  var saveT = null;
  function saveSoon() { clearTimeout(saveT); saveT = setTimeout(save, 400); }
  /* What puzzle this actually is, as opposed to what it is called. A daily
     number or a practice token names a slot; the contents of that slot can
     change — a regenerated daily, a re-imported practice pool — and saved
     letters then land on a different grid at the same address. */
  function puzzleFingerprint(p) {
    if (!p) return null;
    return p.width + "x" + p.height + ":" +
      p.entries.map(function (e) { return e.row.id; }).join(",");
  }

  /* Which slot a mode owns. Three modes, three slots: a themed board is a real
     game with a real clock, and letting it share the practice key would mean
     opening a themed board silently destroyed a practice game in progress. */
  /* Scale the clue to the card it is actually in, now.
     This used to run once, when a clue was selected, and never again — so the
     size was chosen for the width the card had at that moment. Zoom, rotate or
     open the keyboard and the card changes width while the text keeps the size
     it was given, and the card is a fixed height with nowhere to put the
     difference: zoomed in, four lines spilled over the answer boxes; zoomed
     out, the last line was sliced in half. Every resize handler in this file
     already re-fits the board; none of them re-fitted the words. */
  function scaleClue() {
    var el = $("ncText");
    if (!el) return;
    var text = el.textContent || "";
    if (!text) return;
    var cardW = el.clientWidth || (window.innerWidth || 360) - 120;
    var lines = Math.ceil(text.length / Math.max(12, Math.floor(cardW / 8)));
    el.classList.toggle("long", lines === 2);
    el.classList.toggle("xlong", lines === 3);
    /* Four lines fit in a 96px card only at this size. */
    el.classList.toggle("xxlong", lines >= 4);
  }

  function slotKey(m) {
    return m === "daily" ? "fcw.v04.daily"
         : m === "theme" ? "fcw.v04.theme"
         : "fcw.v04.practice";
  }

  function save() {
    /* Given up, either to another tab or to a reset in progress. */
    if (saveBlocked) return;
    /* Nothing is loaded, so there is nothing to write. This is not a
       theoretical case: the landing screen's club control calls saveSoon()
       through applyClubChoice(), and on that screen no puzzle has been built.
       The write that produced was a complete, well-formed, entirely empty
       record — letters {}, elapsed 0 — landing on top of a game in progress.
       Worse, `mode` resets to "daily" on every load (fcw.mode is written and
       never read), so whatever you were last playing, the landing screen wrote
       to the daily slot. Changing your club on the menu destroyed the daily. */
    if (!puzzle) return;
    /* A board that was never played over must not overwrite the save it
       replaced. Lifted the moment a letter is typed. */
    if (suppressSaveUntilPlayed && !Object.keys(letters).length) return;
    suppressSaveUntilPlayed = false;
    /* Belt and braces, and the guard that would have made the above a
       non-event whatever caused it: a record holding letters or time is never
       replaced by one holding neither. Only an explicit reset clears a save —
       and both of those use removeItem, which does not come through here.
       Deliberately not conditioned on mode or on how the empty board arose,
       because every way of arriving at one has the same wrong answer. */
    var fresh = !Object.keys(letters).length && !elapsed && !complete;
    if (fresh) {
      var prev = null;
      try { prev = JSON.parse(localStorage.getItem(
        slotKey(mode))); } catch (e) {}
      if (prev && !prev.complete &&
          (Object.keys(prev.letters || {}).length || prev.elapsed)) return;
    }
    try {
      // Which mode is in play, so a refresh comes back to the same game.
      localStorage.setItem("fcw.mode", mode);
      localStorage.setItem(slotKey(mode), JSON.stringify({
        mode: mode, dailyNo: dailyNo,
        seed: seed, token: puzzleToken, letters: letters,
        fingerprint: puzzleFingerprint(puzzle),
        pauseCount: pauseCount,
        // Include a pause still open, so refreshing mid-pause cannot erase it.
        pausedMs: pausedMs + (pauseStartedAt ? Date.now() - pauseStartedAt : 0),
        revealedCells: Object.keys(revealedCells),
        revealAnswerCells: Object.keys(revealAnswerCells),
        revealedEntries: Object.keys(revealedEntries).map(Number),
        checks: checksUsed, checkAlls: checkAllsUsed, elapsed: elapsed, complete: complete,
        subbedCells: Object.keys(subbedCells), subs: subsUsed,
        excludeIds: builtExcludeIds,
        helpActions: helpActions,
        club: club, clubMode: clubMode,
        // The reference for this sitting, so a refresh continues it.
        playId: playId, playNo: playNo,
        // Which themed board this is, so it can be resumed rather than restarted.
        themeKey: themeWanted && themeWanted.theme
          ? themeWanted.theme + "-" + themeWanted.no : null
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
  /* ---------- Clue circulation (practice) ----------
     Every clue this browser has been shown, so the server can pick puzzles
     built from ones it has not. Practice only: the Daily is the same for
     everyone and must not vary by what you happen to have played. */
  var USED_KEY = "fcw.usedClues.v1";
  var USED_CAP = 2000;
  function loadUsedClues() {
    try {
      var v = JSON.parse(localStorage.getItem(USED_KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function recordUsedClues(ids) {
    try {
      var list = loadUsedClues();
      var have = {};
      list.forEach(function (id) { have[id] = 1; });
      ids.forEach(function (id) { if (!have[id]) { have[id] = 1; list.push(id); } });
      if (list.length > USED_CAP) list = list.slice(list.length - USED_CAP);
      localStorage.setItem(USED_KEY, JSON.stringify(list));
    } catch (e) {}
    renderCirculation();
  }
  var bankReach = 0;
  function renderCirculation() {
    var el = $("circLine");
    if (!el) return;
    var n = loadUsedClues().length;
    if (mode !== "practice") { el.textContent = ""; return; }
    el.textContent = bankReach
      ? n + " of " + bankReach + " clues seen"
      : n + " clues seen";
    var btn = $("circReset");
    if (btn) btn.style.display = n ? "" : "none";
  }
  on("circReset", "click", function () {
    try { localStorage.removeItem(USED_KEY); } catch (e) {}
    renderCirculation();
    toast("Clues back in circulation", "Every clue can appear again.");
  });

  function requestPuzzle(restore) {
    /* Resuming needs the puzzle that was saved, not a new one. The seed used to
       identify it, back when the browser generated the grid itself; now the
       server holds the layout, so the token is the identity and the save
       carries it. Without this, resuming a half-finished practice puzzle
       fetched a different random grid and dropped the saved letters onto it. */
    if (restore && restore.token) {
      var t = String(restore.token);
      if (t.indexOf("practice:") === 0) return api("/api/practice?token=" + encodeURIComponent(t));
      /* A themed board never expires, so resuming one only has to name it. It
         can, however, be withdrawn — so a token that no longer resolves falls
         back to the menu rather than silently opening something else. */
      if (t.indexOf("theme:") === 0) {
        return api("/api/theme-board?id=" + encodeURIComponent(t.slice(6)));
      }
      // A daily token is only valid on its own day; if the date has rolled over
      // the server refuses it, and today's daily is the right thing to open.
      return api("/api/daily");
    }
    if (sharedToken) return api("/api/practice?token=" + encodeURIComponent(sharedToken));
    if (adminDay) return api("/api/admin/daily?n=" + adminDay);
    if (mode === "daily") return api("/api/daily");
    if (mode === "theme") {
      return api(themeWanted && themeWanted.id
        ? "/api/theme-board?id=" + encodeURIComponent(themeWanted.id)
        : "/api/theme-board?theme=" + encodeURIComponent(themeWanted.theme) +
          "&no=" + encodeURIComponent(themeWanted.no));
    }
    var qs = [];
    var cat = practiceCategory();
    if (cat) qs.push("category=" + encodeURIComponent(cat));
    var seen = loadRecent().filter(function (n) { return typeof n === "number"; }).slice(0, 40);
    if (seen.length) qs.push("seen=" + seen.join(","));
    /* POST, because a list of a thousand clue ids will not fit in a URL. */
    return api("/api/practice" + (qs.length ? "?" + qs.join("&") : ""),
               { usedClues: loadUsedClues() });
  }

  function buildPuzzle(restore) {
    builtFilter = JSON.stringify(activeFilter());
    builtExcludeIds = null;
    showLoading(true);
    return requestPuzzle(restore).then(function (res) {
      puzzle = res.puzzle;
      puzzleToken = res.token;
      if (res.mode === "daily" && res.dailyNo) dailyNo = res.dailyNo;
      if (res.mode === "theme") {
        themeLabel = res.label || "";
        themeWanted = { id: res.token ? res.token.slice(6) : null,
                        theme: res.themeId, no: res.boardNo };
      }
      if (res.poolId) recordRecent([res.poolId]);
      if (typeof res.bankSize === "number" && res.bankSize) bankReach = res.bankSize;
      if (res.mode === "practice" && res.puzzle && res.puzzle.entries) {
        recordUsedClues(res.puzzle.entries.map(function (e) { return e.row.id; }));
      }
      renderCirculation();
      verified = {}; verifySent = {}; gridStats = { wrongCells: 0, wrongEntries: 0 };
      verifiedScore = null; verifiedBreakdown = null;   // last game's, not this one's
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

  var staleSave = false;
  var suppressSaveUntilPlayed = false;
  function finishBuild(restore) {
    staleSave = false;
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
      ? "Premier League &middot; " + FCW.dailyPhase(dailyNo).label
      : (mode === "theme" && themeLabel
          ? "Club or theme &middot; " + escapeHtml(themeLabel)
          : "Premier League &middot; Practice");
    $("dailyBtn").style.display = mode === "daily" ? "none" : "";
    document.title = mode === "daily"
      ? FCW.dailyPhase(dailyNo).label + " \u00B7 Crossword XI"
      : (mode === "theme" && themeLabel
          ? themeLabel + " \u00B7 Crossword XI"
          : "Practice \u00B7 Crossword XI");
    letters = {}; wrong = {}; revealedEntries = {}; revealedCells = {}; revealAnswerCells = {};
    pauseCount = 0; pausedMs = 0; pauseStartedAt = null;
    subbedCells = {}; subsUsed = 0;
    checksUsed = 0; checkAllsUsed = 0; elapsed = 0; complete = false;
    helpActions = []; consecutiveChecks = 0; halfTimeShown = false; lastPos = null;
    /* A save from a different grid is discarded rather than applied. Letters
       are stored by cell position, so on a changed puzzle they land on
       unrelated squares — a board that looks half-solved with nonsense in it,
       and no way for the player to tell why. Every daily changed when the
       puzzles moved from twelve answers to eleven; without this, anyone
       mid-solve would have seen exactly that. */
    if (restore && restore.fingerprint &&
        restore.fingerprint !== puzzleFingerprint(puzzle)) {
      restore = null;
      staleSave = true;
      /* Hold off writing until the player actually does something. Discarding a
         save and then immediately saving an empty board destroys the letters
         that were only being questioned — the worst possible reading of "this
         might not match". If the mismatch was ours, they are still there. */
      suppressSaveUntilPlayed = true;
    }
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
      /* The sitting continues: same reference, same row. Without this a
         refresh mid-puzzle became a second attempt with a second number. */
      playId = restore.playId || null;
      playNo = restore.playNo || null;
      pauseCount = restore.pauseCount || 0;
      pausedMs = restore.pausedMs || 0;
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
      $("kickMode").textContent = mode === "daily"
        ? FCW.dailyPhase(dailyNo).label : "Practice puzzle";
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
    renderFlag();
    if (pendingKickOff) { pendingKickOff = false; revealBoard(); }
    else if (started) startTimer();
    save();
    if (staleSave) {
      /* Said out loud. Silently discarding someone's progress is worse than
         telling them why — and this happens whenever a puzzle is rebuilt
         underneath a saved game. */
      toast("This puzzle has changed", "Your earlier progress on it could not be carried over.");
      staleSave = false;
    }
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
    pauseCount++;
    pauseStartedAt = Date.now();
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
    if (pauseStartedAt) { pausedMs += Date.now() - pauseStartedAt; pauseStartedAt = null; }
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
  /* C4 — the player has to scroll down to reach Kick Off on a short screen, and
     without this they land mid-page with the header and match clock cut off.
     Measured scrollY after kick off: 368 at 915x412, 271 at 844x390. */
  /* On the smallest portrait screens a 13-row grid, a clue card and a keyboard
     will not all fit however small the cells are drawn — 320x568 leaves 56px
     for a board that needs 234px at the minimum legible size. Shrinking the
     cells further makes the board unreadable rather than visible.
     What the player actually needs is not the whole board on screen; it is the
     square they are typing into. So the page scrolls, and the active cell is
     kept clear of the keyboard. */
  function keepCellVisible() {
    var el = document.querySelector(".cell.active");
    if (!el) return;
    var kb = document.querySelector(".osk");
    var box = el.getBoundingClientRect();
    var vv = window.visualViewport;
    var viewBottom = (vv ? vv.height : window.innerHeight);
    var kbTop = (kb && kb.offsetParent !== null) ? kb.getBoundingClientRect().top : viewBottom;
    var limit = Math.min(kbTop, viewBottom);
    var headroom = 72;                 // clear of the clue card as well
    if (box.bottom > limit - 4) {
      window.scrollBy({ top: box.bottom - limit + 12, behavior: "auto" });
    } else if (box.top < headroom) {
      window.scrollBy({ top: box.top - headroom, behavior: "auto" });
    }
  }

  function setRotatePrompt(on) {
    document.body.classList.toggle("rotate-needed", !!on);
  }

  function resetViewScroll() {
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  function revealBoard() {
    /* Counted from kick off, not from the board being built: a puzzle nobody
       started is not an attempt, and counting it would make the completion
       rate meaningless. */
    playStart(true);   // keep the reference if the game was restored
    resetViewScroll();
    /* Focusing a cell and the keyboard appearing both scroll the page after
       this point, so one reset at the top of the function is not enough — the
       measured scrollY after kick off was 86 on a 320x568 screen even with it.
       Reset again once the browser has finished reacting. */
    requestAnimationFrame(function () {
      resetViewScroll();
      setTimeout(resetViewScroll, 120);
    });
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
  /* The widest board the generator will build. headless_test reports 9–14
     columns across a full run; the pitch is built for the maximum so its width
     never changes between puzzles. If the generator's bounds ever move, this
     moves with them — a board wider than this would overflow the turf. */
  var MAX_COLS = 14;

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
    var vw = window.innerWidth || document.documentElement.clientWidth || 360;
    /* C1 — visualViewport, not innerHeight. On iOS the system keyboard shrinks
       the visual viewport while innerHeight stays as it was, so a board sized
       against innerHeight is built for space that is no longer there. This is
       the one measurement the whole keyboard-overlap defect turns on. */
    var vv = window.visualViewport;
    var vh = (vv && vv.height) || window.innerHeight ||
             document.documentElement.clientHeight || 800;
    /* No rail any more. It reserved 230-280px beside the board for a column of
       controls, and the controls are under the board now — so on a tablet in
       landscape the board was being sized around space that nothing occupied.
       Removed with the CSS that drew it, because half of either is worse than
       neither: the stylesheet stops laying out a rail while the maths keeps
       paying for one. */
    if (panel) {
      var pp = boxPad(panel), wp = boxPad(wrap);
      padY = pp.y + wp.y;
      availW = panel.clientWidth - pp.x - wp.x - 8;
    }
    if (availW < 160) availW = document.body.clientWidth - 44;
    if (availW < 160) availW = (window.innerWidth || 360) - 44;
    // Height: measured chrome where layout is available, otherwise a
    // sensible reserve so the board never hides under the keyboard.
    /* In rail mode the toolbar is beside the board, not above it. Counting its
       height as vertical chrome made the cell size sensitive to the rail's
       content and was another source of reflow. */
    /* The toolbar only counts as chrome when it is above the board. In the
       landscape rail it sits beside it, and on short screens below it — in
       both cases counting its height would size the board for space it has. */
    /* Everything in the column that is not the board.
       The answer boxes and the message row were added above and below it and
       neither was counted, so the board was sized for space that two other
       elements had already taken — 31px over the bottom of a 1366x768 laptop.
       Anything else that joins this column belongs in this line. */
    var measured = h("header") + h(".now-clue") + h(".bank-strip") + h(".nudge-row") +
                   h(".osk");
    var isTouch = document.body.classList.contains("touch");
    var chrome = (measured > 80 ? measured : (isTouch ? 330 : 230)) + 46 + padY;
    /* C1/C2 — the real remaining height, with no floor.
       availH used to be floored at 200px, and the cell at 20px. At 844x390 the
       true space is 52px, so the board was built to 260px and 208px of it sat
       under the keyboard — measured at 292px on the live site. A floor here is
       not a safety net; it is an instruction to overflow. */
    var availH = vh - chrome;
    /* The pitch is a fixed width: sized for the widest board the generator can
       produce, not for this puzzle. Measured across a full run, boards are
       9–14 columns wide, so a box built for 14 always fits and a narrower
       puzzle sits centred on it with turf either side. The alternative — a box
       that shrinks to each puzzle — moved every element on the page each time
       a new one loaded, because everything below is capped to this width.
       Height still follows the puzzle: it is the width the layout lines up
       against, and a fixed height would only add empty grass below. */
    /* The fixed frame is a wide-screen idea, and so is the arithmetic behind
       it. Dividing by MAX_COLS sizes the board for fourteen columns whether or
       not this puzzle has fourteen — right when there is room for turf either
       side, and wrong on a phone, where a ten-column puzzle came out with
       cells a third smaller than the screen could carry. Below the breakpoint
       the board is sized for the puzzle again, as it was.
       The number matches the CSS gate: change one and change the other. */
    var PLAYABLE = 18;              // matches MIN_PLAYABLE below
    var frameCols = puzzle.width;
    if (vw >= 900) {
      /* Try the fixed frame, and keep it only if the board stays playable.
         A landscape tablet is short rather than narrow: height is what binds,
         and spending width on turf either side pushed the cell under the floor
         and put the "turn your phone upright" card in front of a board that
         would have been fine at its own width. The frame is a luxury for
         screens with room, not a rule to be honoured into unplayability. */
      var wide = Math.max(MAX_COLS, puzzle.width);
      var trial = Math.floor(Math.min(availW / wide, availH / puzzle.height));
      if (trial >= PLAYABLE) frameCols = wide;
    }
    var size = Math.floor(Math.min(availW / frameCols, availH / puzzle.height));
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
    /* Below this a cell holding a typed letter and a clue number is not
       legible, whatever the layout does. If the space cannot afford it, the
       answer is to say so rather than to draw a board nobody can use. */
    var MIN_PLAYABLE = 18;          // below this a letter and clue number do not fit
    var fits = size >= MIN_PLAYABLE;
    size = Math.max(MIN_PLAYABLE, Math.min(52, size));
    /* The 30px tablet floor is gone. It was meant to stop a token-sized board on
       a big screen, but availH/rows already gives a generous cell where there is
       room — the floor only ever bit when the board did not fit, which is
       exactly when it should not. At 820x1180 it forced 30px where 28px fitted:
       two pixels of cell for twenty-three pixels of overflow, and a test that
       passed or failed depending on how many rows the day's puzzle happened to
       have. Fitting the space is deterministic; the floor was not. */
    var portrait = vh >= vw;
    /* When even the minimum will not fit in landscape, say so rather than draw
       a board with half of it under the keyboard. */
    setRotatePrompt(!fits && !portrait);
    if (size !== lastCellSize) {
      lastCellSize = size;
      document.documentElement.style.setProperty("--cell", size + "px");
    }
    /* A squeezed board on a portrait tablet moves the toolbar below it, once.
       The flag is only ever set here and cleared on resize, so this cannot
       chase itself. */
    if (!droppedBelow && !railWanted() && vh > vw && vw >= 700 && size < TIGHT_CELL) {
      droppedBelow = true;
      placeToolbar();
      requestAnimationFrame(function () { fitCells(); });
    }
    /* Publish the widths the rest of the layout lines up against.
       Both are *calculated*, never measured. offsetWidth reads the board as it
       is currently painted, and this runs immediately after --cell changes — so
       it returned the width for the previous cell size and the block came out a
       step behind. Selecting a clue re-ran this, the stale value landed, and the
       whole rail and board slid sideways inside a clue strip that had not moved.
       Derived from the same numbers that chose the cell size, there is nothing
       left to drift: the same puzzle at the same viewport gives the same edges
       every time, whatever the clue card happens to contain. */
    /* Publish how many slots this puzzle actually needs, so the reservation is
       the longest answer here rather than the longest the engine can place.
       The boxes still start in the same place on every clue in the puzzle,
       which is the whole point of reserving the column. */
    var longest = 0;
    for (var li = 0; li < puzzle.entries.length; li++) {
      longest = Math.max(longest, puzzle.entries[li].len || 0);
    }
    document.documentElement.style.setProperty("--bank-slots", Math.max(3, longest));

    var wrapPadX = boxPad(wrap).x;
    var boardW = Math.round(frameCols * size + wrapPadX);
    document.documentElement.style.setProperty("--board-w", boardW + "px");

    /* --block-w was the rail plus the board: the width the clue strip and the
       clue lists had to span to finish level with the pair. One column, so the
       board's own width is the only measure there is. */
    document.documentElement.style.removeProperty("--block-w");
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
      /* In the landscape rail .grid-panel is display:contents. Observing a
         boxless element while its children change clue state is browser-dependent
         and can trigger redundant fit passes. Window resize already covers zoom
         and orientation, so only observe the real panel in non-rail layouts. */
      /* The panel always has a box now: it stopped being display:contents when
         the rail went, so there is no layout in which observing it is unsafe. */
      if (panel) {
        /* Guarded twice, because fitCells changes the size of what is being
           observed: it sets --cell, the grid gets taller, the observer fires,
           and the browser reports "ResizeObserver loop completed with
           undelivered notifications" — which is what rotating a tablet did.
           Only the panel's *width* is an input to the fit; height changes are
           this function's own output and must not feed back into it. And the
           callback is deferred to the next frame, which is what turns a loop
           into a second pass. */
        var lastPanelW = 0, queued = false;
        fitObserver = new ResizeObserver(function (entries) {
          var w = Math.round((entries[0] && entries[0].contentRect.width) || 0);
          if (w === lastPanelW) return;
          lastPanelW = w;
          if (queued) return;
          queued = true;
          requestAnimationFrame(function () {
            queued = false;
            fitCells();
            scaleClue();
            /* The boxes are laid out per clue, so a width change has to redraw
               them as well as the board. */
            if (puzzle && cur.entry != null) renderBank(puzzle.entries[cur.entry]);
          });
        });
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
    $("ncMeta").title = "Jump to another clue";
    /* Scale the clue to fit rather than letting it clip. The card height is
       fixed so the board cannot move between clues, which means a long clue has
       to give — and a clue cut off mid-word is unsolvable, not merely untidy.
       Thresholds are character counts, so the same clue always renders the same
       way regardless of what came before it. */
    var text = clueText(e.row, e.num);
    var el = $("ncText");
    el.textContent = text;
    /* Scale by how many LINES the clue will take, not how many characters it
       has. A 76-character clue is one line on a desktop card and three on a
       390px phone, so a fixed character threshold protects the wrong screen —
       it let a 76-character clue push the answer boxes out of the card on an
       iPhone while scaling nothing.
       The width read here is the card's, which does not depend on the clue, so
       this stays deterministic: the same clue at the same width always renders
       the same way. */
    scaleClue();
    renderBank(e);
    /* Do not call scrollIntoView() when the selected clue changes. On iPad,
       especially with the software keyboard open, Safari may scroll the visual
       viewport to reveal the active item in the clue list below the board. That
       makes the crossword appear to jump even though its CSS position has not
       changed. The fixed active-clue strip already shows the selected clue, so
       keeping the viewport anchored is the better interaction.

       keepCellVisible below is not that: it scrolls only when the active cell
       is actually behind the keyboard or above the fold, and by the minimum
       needed. Anchoring the viewport is right until the square you are typing
       into cannot be seen. */
    keepCellVisible();
  }
  /* Letter bank: the crossing letters you have already earned, gathered
     beside the clue. Adds no information — every letter shown is already
     in the grid — it just saves tracing the row or column by eye. */
  var bankOn = true;
  try { bankOn = localStorage.getItem("fcw.bank") !== "off"; } catch (e) {}

  /* Skip squares that are already filled.
     With crossings in place, "_ _ _ A _ E _" for SHEARER means typing S, H, E,
     then landing on the A you did not type, then R, R. Every crossing makes you
     retype a letter the board already knows, and one mistyped repeat overwrites
     a letter that was right.
     Off by default: it changes what the keyboard does, and somebody who has
     played a crossword before expects a letter to go where the cursor is. */
  var skipFilled = false;
  try { skipFilled = localStorage.getItem("fcw.skip") === "on"; } catch (e) {}
  function renderBank(e) {
    var el = $("letterBank");
    el.innerHTML = "";
    if (!bankOn || !started || paused) return;
    var brk = breakCells(e);
    /* Boxes are grouped into words rather than laid out as one flat run.
       Flat, the row wrapped wherever it ran out of width, so "Sporting Lisbon"
       broke as SPORTING LI / SBON — the second word straddling the wrap, which
       reads as a different answer entirely. A word is a group, groups wrap
       between themselves, and only a word too long for the strip on its own
       can now be split. */
    var word = document.createElement("div");
    word.className = "bank-word";
    el.appendChild(word);
    e.cells.forEach(function (c, i) {
      var k = K(c.x, c.y);
      var d = document.createElement("div");
      var ch = letters[k] || "";
      d.className = "bank-cell" + (ch ? "" : " empty") + (wrong[k] ? " wrong" : "") +
        (revealedCells[k] ? " gold" : (revealAnswerCells[k] ? " gold-ans" : "")) +
        (i === cur.cell ? " here" : "");
      d.textContent = ch;
      word.appendChild(d);
      if (brk[i]) {          // mirror the enumeration's word boundaries
        word = document.createElement("div");
        word.className = "bank-word";
        el.appendChild(word);
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

  /* Theme: auto follows the operating system, which is why the same build looks
     dark on one device and light on another. Light and dark override it. */
  var THEMES = ["auto", "light", "dark"];
  var theme = "auto";
  try { theme = localStorage.getItem("fcw.theme") || "auto"; } catch (e) {}
  if (THEMES.indexOf(theme) === -1) theme = "auto";
  function applyTheme() {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    var b = $("themeToggle");
    if (b) b.textContent = "theme: " + theme;
  }
  on("themeToggle", "click", function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem("fcw.theme", theme); } catch (e) {}
    applyTheme();
  });
  applyTheme();

  /* The league table moves below the board on a phone. CSS cannot reorder across
     containers — the table lives inside the toolbar — so the node itself is
     relocated. Listeners and rendering follow the element, so nothing else in
     the game needs to know which side of the board it is on. */
  /* The toolbar is a sibling of the stage in the markup, but on a landscape
     tablet it has to be a *column of the board* — same grid, same row, so it
     stretches to the board's height and the active clue can span both. CSS
     cannot reparent, so the node moves. */
  var barHome = null, barAnchor = null;
  function railWanted() {
    return window.matchMedia &&
      window.matchMedia("(orientation:landscape) and (max-height:1100px) and (min-width:1000px)").matches;
  }
  /* On the shortest screens the toolbar goes below the board instead of above
     it. At 320x568 the header, clue card and toolbar take ~335px before the
     board even starts, leaving a 15-row grid to finish 37px past the fold —
     measured on the live site, where the real puzzles run taller than the
     development samples.
     Moving the toolbar down buys back its whole height. The clock and New
     Puzzle are read occasionally; the board is looked at constantly, so the
     board takes the top of the screen. The league table already relocates this
     way on phones, so the pattern is established. */
  /* The toolbar goes below the board when keeping it above would squeeze the
     cells. Two cases, one rule:

       - the shortest screens, where 320x568 left 56px for a board needing 234
       - portrait tablets, where an open help block takes ~250px above the board
         and drove 820x1180 down to 18px cells while 1024x1366 managed 49

     Below the board it costs nothing: the clock and New Puzzle are read
     occasionally, the board is looked at constantly. */
  var TIGHT_CELL = 26;               // below this the board is being squeezed
  /* Sticky, and it has to be. Once the toolbar moves below, the board is no
     longer squeezed — so a rule that only asks "is it squeezed now" would move
     it straight back up, squeeze it again, and flip forever. The decision is
     made once per layout and held until the viewport changes. */
  var droppedBelow = false;
  function toolbarBelow() {
    if (railWanted()) return false;
    var vw = window.innerWidth || 360;
    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 800;
    if (vh <= 600 && vw < 700) return true;                 // shortest screens
    return vh > vw && vw >= 700 && droppedBelow;            // portrait tablets
  }
  function placeToolbar() {
    var bar = $("toolbar"), stage = document.querySelector(".stage");
    if (!bar || !stage) return;
    if (!barHome) { barHome = bar.parentNode; barAnchor = bar.nextElementSibling; }
    if (railWanted()) {
      if (bar.parentNode !== stage) stage.insertBefore(bar, stage.firstChild);
    } else if (toolbarBelow()) {
      var panel = document.querySelector(".grid-panel");
      if (panel && bar.previousElementSibling !== panel) {
        panel.parentNode.insertBefore(bar, panel.nextSibling);
      }
    } else if (bar.parentNode !== barHome || bar.nextElementSibling !== barAnchor) {
      barHome.insertBefore(bar, barAnchor);
    }
  }
  placeToolbar();
  window.addEventListener("resize", function () {
    droppedBelow = false;            // decide again for the new size
    placeToolbar();
    if (puzzle) fitCells();
    scaleClue();
  });

  /* Where the league table goes.
     In the rail beside the controls, which is where it belongs on anything
     with a rail: it reads as part of the same dashboard as the clock and the
     help buttons, and the space under the board is the season record's — the
     run of results is what the score actually means, and it belongs against
     the thing that produced it.
     On a phone there is no rail, only a banner, and a twenty-team table in a
     banner is what forced it out in the first place. So on phones it drops
     below the season strip instead. One runtime decision, and .below-board
     describes the phone case only. */
  var tableHome = null, tableAnchor = null;
  function placeTable() {
    var panel = $("tablePanel");
    if (!panel) return;
    // Captured once, before any move, so a relocation cannot make this wrong.
    if (!tableHome) { tableHome = panel.parentNode; tableAnchor = panel.nextElementSibling; }
    var phone = (window.innerWidth || 360) <= 640;
    var season = $("seasonPanel");
    if (phone && season && season.parentNode) {
      if (panel.previousElementSibling !== season) {
        season.parentNode.insertBefore(panel, season.nextSibling);
      }
      panel.classList.add("below-board");
    } else {
      if (tableHome && panel.parentNode !== tableHome) tableHome.insertBefore(panel, tableAnchor);
      panel.classList.remove("below-board");
    }
  }
  placeTable();
  window.addEventListener("resize", placeTable);

  /* Help starts closed on a phone. Its three rows became 44px each when the
     controls were sized for touch, which pushed the board 70px down the page
     and straight under the keyboard — the cells shrank and the grid still
     ended lower, because it now started lower.
     It is the right group to close: Check and Reveal cost points, so they are
     used occasionally and deliberately, unlike the clock and New Puzzle. One
     tap opens them, and the state is remembered. */
  /* 744x1133 overflowed its viewport by 6px with help open — three 44px rows
     is more than that screen can spare above a keyboard. The threshold is the
     narrowest tablet, not the widest phone. */
  /* Help is always open. It collapsed because it used to sit above the board,
     where five rows of 44px controls pushed the grid 70px down a phone screen —
     which is exactly how far the board moved between builds. It is below the
     board now, so collapsing it costs the board nothing and costs the player a
     control they have to discover. */
  function applyHelp() {
    var box = document.querySelector(".tb-help");
    if (box) box.classList.remove("collapsed");
  }
  applyHelp();
  /* fcw.helpOpen and fcw.cluesOpen are left in localStorage rather than
     cleared. They are two small strings on devices that already have them, and
     removing a key nobody reads is a write to everybody's storage to tidy
     something invisible. */

  /* ---------- Accounts (Phase 1) ----------
     Deliberately self-contained. Nothing in the game loop calls into this, and
     nothing here changes how a puzzle is built, scored or saved — a signed-out
     player and a signed-in player play exactly the same game. The account adds
     somewhere for results to live later; it is not a gate. */
  var account = null;              // null = guest
  var accountsAvailable = false;

  function apiAuth(path, body, method) {
    var opts = {
      /* An explicit method where one is given: withdrawing a request is a
         DELETE, and inferring the verb from whether there is a body cannot
         express that. */
      method: method || (body ? "POST" : "GET"),
      headers: { "X-Crossword-XI": "1" },   // the CSRF check on the server
      credentials: "same-origin",
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : "Request failed");
        return j;
      });
    });
  }

  function syncSignInPrompt() {
    var b = $("homeSignIn");
    if (!b) return;
    /* Hidden when there is an account, and when sign-in is not configured at
       all — offering something that cannot work is worse than not offering it. */
    b.hidden = !!account || !accountsAvailable;
  }

  function renderAccount() {
    syncSignInPrompt();
    var toggle = $("accountToggle");
    if (toggle) toggle.textContent = account ? "account" : "sign in";
    var sub = $("acctSub");
    if (sub) {
      sub.textContent = account
        ? "Signed in" + (account.provider
            ? " with " + account.provider.charAt(0).toUpperCase() + account.provider.slice(1)
            : "")
        : "Playing as a guest on this device";
    }
    if ($("acctSignedIn")) $("acctSignedIn").style.display = account ? "" : "none";
    if ($("acctSignedOut")) $("acctSignedOut").style.display = account ? "none" : "";
    if ($("acctUnavailable")) {
      $("acctUnavailable").style.display = accountsAvailable ? "none" : "";
    }
    if (account && $("acctName")) $("acctName").value = account.displayName || "";
  }

  /* Everything a guest has played on this device, in the shape the migrate
     endpoint expects. Read-only — the local copy is never cleared, so signing
     out leaves the player exactly as they were. */
  function guestPayload() {
    var results = [];
    try { results = JSON.parse(localStorage.getItem(RESULTS_KEY)) || []; } catch (e) {}
    return { club: club || null, results: Array.isArray(results) ? results : [] };
  }

  function refreshAdmin() {
    renderFlag();
    fetch("/api/admin/whoami", { headers: { "X-Crossword-XI": "1" }, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        isAdmin = !!d.admin;
        var btn = $("adminToggle");
        if (btn) btn.style.display = isAdmin ? "" : "none";
      })
      .catch(function () {});
  }

  function afterSignIn(res) {
    account = res.user;
    renderAccount();
    refreshAdmin();
    /* Carry the guest's history over once. Failure here is not fatal: the
       player is signed in, and the local copy is still on the device. */
    apiAuth("/api/account/migrate", guestPayload()).then(function (m) {
      var note = $("acctMigrated");
      if (!note) return;
      if (m.added) {
        note.textContent = m.added + (m.added === 1 ? " result" : " results") +
          " from this device saved to your account.";
      } else if (!FCW.dailyPhase(FCW.dailyNumber()).counts) {
        /* Silence here reads as a failure. During pre-season there is genuinely
           nothing to carry across — friendlies are played and scored but not
           recorded — and a player who has just finished a puzzle deserves to be
           told that rather than left wondering. */
        note.textContent = "Nothing to carry over yet \u2014 pre-season friendlies " +
          "are not recorded. Your record starts on Matchday 1.";
      } else {
        note.textContent = "No results on this device to carry over.";
      }
    }).catch(function () {});
  }

  function loadGoogle(clientId) {
    if (window.google && window.google.accounts) return renderGoogleButton(clientId);
    var sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true; sc.defer = true;
    sc.onload = function () { renderGoogleButton(clientId); };
    sc.onerror = function () {
      accountsAvailable = false;
      if ($("acctUnavailable")) {
        $("acctUnavailable").textContent = "Could not reach the sign-in service.";
        $("acctUnavailable").style.display = "";
      }
    };
    document.head.appendChild(sc);
  }

  function renderGoogleButton(clientId) {
    if (!window.google || !window.google.accounts || !$("googleBtn")) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: function (resp) {
        apiAuth("/api/auth/google", { credential: resp.credential })
          .then(afterSignIn)
          .catch(function (err) {
            var note = $("acctUnavailable");
            if (note) { note.textContent = String(err.message || err); note.style.display = ""; }
          });
      },
    });
    window.google.accounts.id.renderButton($("googleBtn"),
      { theme: "outline", size: "large", text: "signin_with", shape: "pill" });
  }

  on("accountToggle", "click", function () {
    $("accountSheet").classList.add("show");
    if (accountsAvailable && !account) loadGoogle(accountsAvailable);
  });
  on("acctClose", "click", function () { $("accountSheet").classList.remove("show"); });
  on("acctSignOut", "click", function () {
    apiAuth("/api/auth/signout", {}).then(function () {
      account = null; isAdmin = false;
      renderAccount(); refreshAdmin();
      /* The Google button has to be rebuilt, or the sheet shows a signed-out
         account with no way back in until the page is reloaded. Google's
         library renders the button once into an element and does not restore it
         when the session it was rendered for ends. */
      if (accountsAvailable) loadGoogle(accountsAvailable);
      /* And the footer, the owner tools and anything else that reads the
         session are re-rendered here rather than on the next refresh: signing
         out should look like something that happened, not like nothing did. */
      if (typeof renderHome === "function") renderHome();
    }).catch(function () {});
  });
  on("acctSave", "click", function () {
    var name = $("acctName") ? $("acctName").value : "";
    apiAuth("/api/account/profile", { displayName: name, club: club || null })
      .then(function (r) { account = r.user; renderAccount(); })
      .catch(function () {});
  });

  /* One call at boot, and the game does not wait for it. */
  apiAuth("/api/auth/session").then(function (r) {
    accountsAvailable = r.googleClientId || false;
    account = r.user || null;
    renderAccount();
    refreshAdmin();
  }).catch(function () { renderAccount(); });

  /* ---------- How far people get ----------
     Two events per attempt. No cookie, no account, nothing derived from the
     person: the play id is random, made when the puzzle starts and forgotten
     when it ends. It pairs a start with its finish and identifies nobody. */
  /* The reference for this attempt. Kept with the saved game rather than in a
     variable: it lived only in memory, so a refresh threw it away and started a
     fresh row — one person reloading twice counted as three players, which is
     most of why the practice figures ran ahead of reality.
     Six digits. A board reaching 999,999 attempts would be a very good problem,
     and a shorter number reads as a score rather than a reference. */
  /* ---------- Where this visit came from ----------
     Read once on arrival, kept for the session, attached to every attempt made
     during it. sessionStorage rather than localStorage on purpose: this dies
     with the tab, so it is not an identifier that follows anyone between days
     or between games. That version needs consent and is a separate decision.

     Values are normalised to lowercase slugs before they are stored, because
     the one thing that cannot be repaired later is a report split across
     Reddit, reddit.com, r/reddit and reddit-social. */
  var ATTR_KEY = "fcw.attr";
  var ATTR_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  function slugify(v) {
    return String(v || "").toLowerCase()
      .replace(/^https?:\/\//, "")        // reddit.com/r/gunners -> reddit.com...
      .replace(/^www\./, "")
      .replace(/\.(com|co\.uk|org|net|io)\b.*$/, "")   // ...-> reddit
      .replace(/^r\//, "")                // r/gunners -> gunners
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }

  function readAttribution() {
    var have = null;
    try { have = JSON.parse(sessionStorage.getItem(ATTR_KEY)); } catch (e) {}
    var q = new URLSearchParams(location.search || "");
    var fresh = {}, any = false;
    ATTR_FIELDS.forEach(function (f) {
      var v = slugify(q.get(f));
      if (v) { fresh[f] = v; any = true; }
    });
    /* A link with campaign tags starts a new attribution; without them, keep
       whatever this session already had. So moving from the landing page into
       a puzzle does not lose where the visit came from. */
    if (!any) return have || null;
    /* The referring page, only where the browser offers it and only its host —
       the full URL can carry a search query or a path that identifies a person,
       and the host is what the report is grouped by anyway. */
    try {
      var ref = document.referrer || "";
      if (ref) fresh.referrer = slugify(new URL(ref).hostname);
    } catch (e) {}
    try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }

  var attribution = readAttribution();

  var playId = null, playSent = false, playNo = null;
  var PLAY_DIGITS = 6;
  function playRef() {
    return playNo ? String(playNo).padStart(PLAY_DIGITS, "0") : null;
  }

  function newPlayId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function playStart(keep) {
    if (!puzzle) return;
    /* keep: a game restored from the save brings its own reference back, so
       the sitting continues rather than becoming a new one. The server hands
       the same number back for a play id it has already seen, so a resend is
       safe either way. */
    if (!keep || !playId) { playId = newPlayId(); playNo = null; }
    playSent = false;
    var phase = mode === "daily" ? FCW.dailyPhase(dailyNo).phase : null;
    fetch("/api/play", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "start", playId: playId, mode: mode,
        dailyNo: mode === "daily" ? dailyNo : null, phase: phase,
        /* Which board, when it is a themed one. Still nothing about the
           person: the play id is random per attempt, as it was. */
        themeKey: mode === "theme" && themeWanted && themeWanted.theme
          ? themeWanted.theme + "-" + themeWanted.no : null,
        total: puzzle.entries.length,
        /* Kept separate from the board on purpose: somebody playing the Arsenal
           board may have arrived from anywhere, including another page here. */
        attribution: attribution }),
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.playNo) { playNo = d.playNo; saveSoon(); }
      })
      .catch(function () {});          // never let counting break the game
  }

  function playEnd(done) {
    if (!playId || playSent || !puzzle) return;
    playSent = true;
    var solved = 0;
    puzzle.entries.forEach(function (e, i) { if (verified[i] === true) solved++; });
    var payload = JSON.stringify({ event: "end", playId: playId, mode: mode,
      solved: solved, completed: !!done, elapsed: elapsed,
      checks: checksUsed, reveals: revealedLetterCount() + revealedAnswerCount() });
    /* sendBeacon, because a normal fetch is cancelled when the tab closes —
       and an abandoned puzzle is the case this whole thing exists to measure.
       Losing exactly the interesting half would be worse than not counting. */
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/play", new Blob([payload], { type: "application/json" }));
        return;
      }
    } catch (e) {}
    fetch("/api/play", { method: "POST", headers: { "Content-Type": "application/json" },
      body: payload, keepalive: true }).catch(function () {});
  }

  /* pagehide rather than unload: unload is unreliable on iOS and does not fire
     when a tab is put in the background and later discarded. */
  window.addEventListener("pagehide", function () { playEnd(false); });

  /* localStorage is shared by every tab on the origin, and until now no tab
     knew the others were there. Three windows open meant three clocks and
     three ten-second saves writing the same two keys, last write winning — so
     a tab left open since the morning could overwrite the board being typed
     into now, and a cleared record came back within ten seconds because
     another tab still held a copy of it in memory.

     A tab that sees its own slot change underneath it stands down rather than
     arguing about who is right. Storage events are only ever delivered to
     *other* documents, so this cannot fire on the tab that did the writing,
     and a single tab never sees it at all. A whole-storage clear reports a
     null key. */
  window.addEventListener("storage", function (e) {
    if (saveBlocked || !puzzle) return;
    var mine = slotKey(mode);
    if (e.key !== null && e.key !== mine) return;
    standDown();
    toast("Open in another window",
      "This game is being played somewhere else, so it is no longer being " +
      "saved here. Reload to pick up where that one is.", "loss");
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") playEnd(false);
  });

  /* ---------- Owner tools ----------
     Shown only when the server says this account is an admin. That is
     convenience, not security: every route behind the panel re-checks the flag
     on the server, on every request, because a hidden button is not a lock and
     anyone can conjure one up from a console. */
  var isAdmin = false;
  var adminDay = null;          // set only while the owner previews another day
  var sharedToken = null;       // set only while opening a shared practice link

  function adminMsg(text) {
    var el = $("adminMsg");
    if (el) el.textContent = text || "";
  }

  function renderAdmin() {
    apiAuth("/api/admin/summary").then(function (d) {
      var rows = [
        statusRow("Today", "#" + d.today + " \u00B7 " + FCW.dailyPhase(d.today).label),
        statusRow("Accounts", d.users),
        statusRow("Results stored", d.results),
        statusRow("Mine", d.myResults),
        statusRow("Flagged clues", d.reports, d.reports ? null : true),
        statusRow("Clues", d.clues),
        statusRow("Dailies", d.dailies + " (to #" + d.lastDay + ")"),
      ];
      $("adminBody").innerHTML = rows.join("");
      $("adminSub").textContent = "Signed in as the owner";
    }).catch(function (err) {
      $("adminSub").textContent = String(err.message || err);
    });
  }

  on("adminToggle", "click", function () {
    fillLinkBoards();
    $("adminSheet").classList.add("show");
    adminMsg("");
    renderAdmin();
  });
  on("adminClose", "click", function () { $("adminSheet").classList.remove("show"); });

  /* Play any day, locally. The Matchday 1 changeover cannot otherwise be seen
     until September, which is a long time to wait to find out it is wrong. */
  on("adminGo", "click", function () {
    var n = parseInt(($("adminDay") || {}).value, 10);
    if (!n || n < 1) { adminMsg("Give a day number."); return; }
    mode = "daily";
    dailyNo = n;
    $("adminSheet").classList.remove("show");
    /* A daily token returns today's puzzle by design — the server refuses to
       serve another day, and that guard is what stops anyone reading tomorrow's
       answers. So this goes through an admin-only route instead of weakening
       it. */
    adminDay = n;
    buildPuzzle(null).then(function () {
      adminDay = null;
      toast("Playing day " + n, FCW.dailyPhase(n).label + " \u2014 reload to return to today.");
    }).catch(function (err) {
      toast("Could not load that day", String(err.message || err), "loss");
    });
  });

  /* Two different things, deliberately not one button.
     Replay throws away today's saved game and its result so the same day can be
     played again — the thing you want twenty times over four weeks of testing.
     Clear my record wipes the history and leaves the game you are in, because
     "record" means the history and a button should not lie about what it does. */
  on("adminReplay", "click", function () {
    var no = dailyNo;
    apiAuth("/api/admin/replay-day", { dailyNo: no }).then(function () {
      /* Stop writing before clearing. location.reload() does not halt this
         page — the browser goes off to fetch the document while everything
         here keeps running — so without this the clock-save interval could
         land after the removeItem below and put the record straight back. */
      standDown();
      try {
        // The saved game, and this day's entry in the local history.
        localStorage.removeItem(slotKey(mode));
        var list = loadResults().filter(function (r) { return r.dailyNo !== no; });
        localStorage.setItem(RESULTS_KEY, JSON.stringify(list));
      } catch (e) {}
      $("adminSheet").classList.remove("show");
      // Reload rather than patch the running game: elapsed time, help actions
      // and the season strip all have to start again, and a reload is the one
      // path that resets every one of them together.
      location.reload();
    }).catch(function (err) { adminMsg(String(err.message || err)); });
  });

  /* Clearing the record clears the saved games too, and it has to.
     Wiping the history while leaving today marked complete produces a state
     that contradicts itself: the record says nothing was played, and the game
     still refuses to let you play it. Of the two, the one the player can see is
     the lie. So this is a full reset — history, saved games, and back to a
     clean start. */
  on("adminReset", "click", function () {
    apiAuth("/api/admin/reset-my-record", {}).then(function () {
      standDown();          // as above: no writes between here and the reload
      try {
        /* Every key the game writes, listed in one place. The themed results
           key was added months after this reset was written and never got added
           to it, so "clear everything" left themed boards still marked as
           played — a record of nothing that still refused to let you play, and
           exactly the contradiction the button exists to prevent.
           Anything new that survives a reload belongs on this list. */
        WIPE_KEYS.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) {}
      // Reload, so the clock, the season strip and the board all start again
      // together rather than one at a time.
      location.reload();
    }).catch(function (err) { adminMsg(String(err.message || err)); });
  });

  /* The list, one row per report, each closable on its own — working through
     them one at a time is how they actually get dealt with, and marking the
     whole lot done in one press is only useful once you have. */
  function loadReports() {
    var all = $("adminShowDone") && $("adminShowDone").checked;
    apiAuth("/api/admin/reports" + (all ? "?all=1" : "")).then(function (d) {
      var box = $("adminReportList");
      var open = d.reports.filter(function (r) { return r.status !== "done"; }).length;
      $("adminReviewed").style.display = open ? "" : "none";
      $("adminReviewed").textContent = "Mark all " + open + " as reviewed";
      if (!d.reports.length) {
        box.innerHTML = "";
        adminMsg(all ? "Nothing flagged." : "Nothing outstanding.");
        return;
      }
      adminMsg("");
      box.innerHTML = d.reports.map(function (r) {
        return '<div class="report-row' + (r.status === "done" ? " done" : "") +
          '" data-id="' + escapeHtml(r.id) + '">' +
          '<div class="rr-body">' +
            '<div class="rr-id">' + escapeHtml(r.clue_id) +
              (r.category ? " \u00B7 " + escapeHtml(r.category) : "") + "</div>" +
            '<div class="rr-clue">' + escapeHtml((r.clue || "(clue not found)")) +
              " \u2192 " + escapeHtml(r.answer || "?") + "</div>" +
            '<div class="rr-reason">' + escapeHtml(r.reason || "(no reason given)") + "</div>" +
          "</div>" +
          (r.status === "done" ? "" :
            '<button class="rr-done" title="Mark as reviewed">\u2713</button>') +
          "</div>";
      }).join("");
    }).catch(function (err) { adminMsg(String(err.message || err)); });
  }

  on("adminPlays", "click", function () {
    apiAuth("/api/admin/plays").then(function (d) {
      var mine = d.ownerPlays
        ? "\n\nYour own testing: " + d.ownerPlays + " attempt" +
          (d.ownerPlays === 1 ? "" : "s") + ", " + d.ownerFinished + " finished " +
          "(kept out of the figures above)"
        : "";
      if (!d.days.length) {
        adminMsg("No visitors have played yet." + mine);
        return;
      }
      $("adminReportList").innerHTML = "";
      var lines = d.days.slice(0, 20).map(function (x) {
        /* Themed boards read as their own name and number, because that is how
           they are shared and how they will be talked about. "man-united-3"
           becomes "Manchester United #3". */
        var name;
        if (x.mode === "theme") {
          var k = String(x.themeKey || "unknown");
          var m = /^(.*)-(\d+)$/.exec(k);
          name = m
            ? m[1].replace(/-/g, " ").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) +
              " #" + m[2]
            : "Club or theme";
        } else if (x.mode === "practice") {
          name = "Practice";
        } else {
          name = x.phase === "season" ? "Matchday " + (x.dailyNo - FCW.PRESEASON_DAYS)
                                      : "Friendly #" + x.dailyNo;
        }
        var out = name + ": " + x.started + " started, " + x.finished + " finished";
        if (x.medianSeconds) out += ", median " + Math.round(x.medianSeconds / 60) + " min";
        if (x.abandoned) {
          out += "\n      " + x.abandoned + " stopped, typically after " +
            x.medianSolvedWhenStopped + " of " + x.total + " clues";
        }
        return out;
      });
      adminMsg(lines.join("\n") + mine);
    }).catch(function (err) { adminMsg(String(err.message || err)); });
  });

  /* What people have asked for, most-wanted first, and a way to clear it down.
     A tally of everything ever asked answers "what has been asked"; what is
     worth reading is "what should I write next". */
  /* One row per attempt, rather than the per-board summary the panel shows. */
  /* Which places sent people who actually played. Deliberately separate from
     the board funnel: those answer different questions. */
  on("adminChallenges", "click", function () {
    apiAuth("/api/admin/challenges").then(function (d) {
      var rows = d.challenges || [];
      if (!rows.length) { adminMsg("Nobody has created a challenge yet."); return; }
      adminMsg(rows.map(function (c) {
        return (c.hidden ? "[hidden] " : "") + c.creator_name +
          (c.group_name ? " \u00B7 " + c.group_name : "") +
          " \u2014 " + c.theme_id + " #" + c.board_no +
          ": " + c.started + " started, " + c.finished + " finished" +
          (c.best === null ? "" : ", best " + c.best) +
          "  /?c=" + c.id;
      }).join("\n"));
    }).catch(function (err) { adminMsg(String(err.message || err)); });
  });

  on("adminSources", "click", function () {
    apiAuth("/api/admin/sources").then(function (d) {
      var rows = d.sources || [];
      if (!rows.length) { adminMsg("No attributed visits yet."); return; }
      adminMsg(rows.map(function (r) {
        var who = r.source + (r.community ? " / " + r.community : "") +
          (r.campaign ? " (" + r.campaign + ")" : "");
        return who + ": " + r.started + " started, " + r.finished + " finished (" +
          r.completionPct + "%), " + r.solvedPct + "% of answers, ~" +
          r.avgMinutes + " min";
      }).join("\n"));
    }).catch(function (err) { adminMsg(String(err.message || err)); });
  });

  /* The campaign link builder. Every value is normalised on the way out, so a
     link cannot introduce a spelling the reports then split on. */
  on("linkMake", "click", function () {
    var board = $("linkBoard").value;
    var q = new URLSearchParams();
    q.set("utm_source", slugify($("linkSource").value));
    q.set("utm_medium", "social");
    q.set("utm_campaign", slugify($("linkCampaign").value));
    var content = slugify($("linkContent").value);
    if (content) q.set("utm_content", content);
    var url = SHARE_URL + "/" + (board ? "?t=" + board + "&" : "?") + q.toString();
    $("linkOut").textContent = url;
    try {
      navigator.clipboard.writeText(url);
      adminMsg("Link built and copied.");
    } catch (e) { adminMsg("Link built — copy it from below."); }
  });

  on("adminPlaysCsv", "click", function () {
    window.location.href = "/api/admin/plays.csv";
  });

  /* The boards a link can point at: whatever is released, plus the daily. */
  function fillLinkBoards() {
    var sel = $("linkBoard");
    if (!sel || sel.options.length) return;
    loadThemes().then(function (d) {
      var opts = ['<option value="">Today\u2019s daily</option>'];
      (d.themes || []).forEach(function (t) {
        t.boards.forEach(function (b) {
          opts.push('<option value="' + escapeHtml(t.id + "-" + b.no) + '">' +
            escapeHtml(t.name) + " #" + b.no + "</option>");
        });
      });
      sel.innerHTML = opts.join("");
    }).catch(function () {});
  }

  on("adminThemeReqs", "click", function () {
    apiAuth("/api/admin/theme-requests").then(function (d) {
      var rows = d.requests || [];
      if (!rows.length) { adminMsg("Nobody has requested a theme yet."); return; }
      $("adminReportList").innerHTML = rows.map(function (r) {
        var name = r.existing || String(r.theme_key).replace(/-/g, " ")
          .replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
        /* Delivered is read from the schedule rather than a stored flag: a
           request is answered when a board for it is out, and asking the
           schedule is always right where a flag set at release can go stale. */
        var state = r.live_boards ? "delivered"
          : r.status === "declined" ? "declined"
          : r.status === "done" ? "done" : "open";
        return '<div class="report-row' + (state === "open" ? "" : " done") + '">' +
          '<div class="rr-body"><div class="rr-clue">' + escapeHtml(name) +
          " \u00B7 " + r.n + " request" + (r.n === 1 ? "" : "s") + "</div>" +
          '<div class="rr-id">' + escapeHtml(state) + "</div></div>" +
          (state === "delivered" ? "" :
            '<button class="rr-done" data-req="' + escapeHtml(r.theme_key) +
            '" data-status="' + (state === "open" ? "done" : "open") + '">' +
            (state === "open" ? "Mark done" : "Reopen") + "</button>") +
          "</div>";
      }).join("");
      adminMsg(rows.length + " theme" + (rows.length === 1 ? "" : "s") + " requested");
    }).catch(function (err) { adminMsg(String(err.message || err)); });
  });
  on("adminReportList", "click", function (e) {
    var b = e.target.closest ? e.target.closest(".rr-done[data-req]") : null;
    if (!b) return;
    apiAuth("/api/admin/theme-request-status",
            { key: b.getAttribute("data-req"), status: b.getAttribute("data-status") })
      .then(function () { $("adminThemeReqs").click(); })
      .catch(function (err) { adminMsg(String(err.message || err)); });
  });

  on("adminReports", "click", loadReports);
  on("adminShowDone", "change", loadReports);

  on("adminReportList", "click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest(".rr-done") : null;
    if (!btn) return;
    var row = btn.closest(".report-row");
    apiAuth("/api/admin/reports/reviewed", { id: row.getAttribute("data-id") })
      .then(function () { loadReports(); renderAdmin(); })
      .catch(function (err) { adminMsg(String(err.message || err)); });
  });

  on("adminReviewed", "click", function () {
    apiAuth("/api/admin/reports/reviewed", {})
      .then(function (r) {
        adminMsg((r.closed === null ? "All" : r.closed) + " marked as reviewed.");
        loadReports(); renderAdmin();
      })
      .catch(function (err) { adminMsg(String(err.message || err)); });
  });

  /* The download is a plain navigation, not fetch: the browser then handles the
     file itself and the Content-Disposition header names it. */
  on("adminExport", "click", function () {
    var all = $("adminShowDone") && $("adminShowDone").checked;
    window.location.href = "/api/admin/reports.csv" + (all ? "?all=1" : "");
  });

  /* Flag a clue while playing. Open to any signed-in player: whoever notices a
     bad clue is whoever happens to be looking at it. */
  /* Always shown, signed in or not. Hiding it meant the one affordance for
     reporting a bad clue was invisible to anyone who had not already signed in
     — which is most people the first time they meet a bad clue. Guests get told
     what it needs rather than finding nothing there. */
  function renderFlag() {
    var btn = $("flagClue");
    if (btn) btn.style.display = "";
  }
  var flagPicked = [];
  on("flagClue", "click", function () {
    if (!puzzle) return;
    if (!account) {
      toast("Sign in to flag a clue", "So it can be traced back and reviewed.");
      return;
    }
    /* Show the clue being reported. Two weeks later a list of clue ids says
       nothing; the wording plus a reason is what tells you whether to reword it
       or bin it. */
    var e = puzzle.entries[cur.entry];
    $("flagClueText").textContent = clueText(e.row, e.num) + "  " + e.row.enum;
    $("flagNote").value = "";
    $("flagMsg").textContent = "";
    flagPicked = [];
    Array.prototype.forEach.call(
      document.querySelectorAll("#flagReasons .btn"),
      function (b) { b.classList.remove("picked"); });
    $("flagSheet").classList.add("show");
  });

  /* The quick reasons are multi-select: a clue is often obscure *and* badly
     worded, and forcing one loses the other. */
  on("flagReasons", "click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest(".btn") : null;
    if (!btn || !btn.getAttribute("data-reason")) return;
    var reason = btn.getAttribute("data-reason");
    var at = flagPicked.indexOf(reason);
    if (at === -1) { flagPicked.push(reason); btn.classList.add("picked"); }
    else { flagPicked.splice(at, 1); btn.classList.remove("picked"); }
  });

  on("flagCancel", "click", function () { $("flagSheet").classList.remove("show"); });

  on("flagSend", "click", function () {
    if (!puzzle || !account) return;
    var row = puzzle.entries[cur.entry].row;
    var note = ($("flagNote").value || "").trim();
    var reason = flagPicked.concat(note ? [note] : []).join("; ");
    if (!reason) { $("flagMsg").textContent = "Pick a reason or write one."; return; }
    apiAuth("/api/report-clue",
            { clueId: row.id, puzzle: puzzleToken, reason: reason })
      .then(function (r) {
        $("flagSheet").classList.remove("show");
        $("flagClue").classList.add("done");
        toast(r.already ? "Already flagged" : "Clue flagged",
              r.updated ? "Reason updated."
                : r.already ? "You had already reported this one."
                : row.id + " \u2014 noted for review.");
      })
      .catch(function (err) { $("flagMsg").textContent = String(err.message || err); });
  });

  /* ---------- What's live ----------
     The badge says which frontend is running. This says which data — the
     question that has actually caused trouble, because a site serving three
     development samples looks exactly like one serving the whole clue bank. */
  function statusRow(label, value, state) {
    var cls = state === true ? " class=\"good\"" : state === false ? " class=\"bad\"" : "";
    return "<tr><td>" + escapeHtml(label) + "</td><td" + cls + ">" +
      escapeHtml(String(value)) + "</td></tr>";
  }
  function showStatus() {
    var sheet = $("statusSheet"), body = $("statusBody"), sub = $("statusSub");
    if (!sheet) return;
    sheet.classList.add("show");
    body.innerHTML = "";
    sub.textContent = "Checking\u2026";
    fetch("/api/status", { headers: { "X-Crossword-XI": "1" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var rows = [statusRow("Build", BUILD)];
        if (!d.db) {
          sub.textContent = "Running on development data";
          rows.push(statusRow("Puzzle source", "development samples", false));
          rows.push(statusRow("Database", "not connected", false));
          rows.push(statusRow("Note", d.note || ""));
        } else {
          sub.textContent = "Running on your database";
          rows.push(statusRow("Puzzle source", "D1", true));
          rows.push(statusRow("Clues in bank", d.clues));
          rows.push(statusRow("Practice puzzles", d.practice));
          rows.push(statusRow("Clues reachable", d.practiceReach +
            (d.clues ? " of " + d.clues : ""), d.clueIdsPresent));
          if (!d.clueIdsPresent) {
            rows.push(statusRow("Clue tracking", "pool predates clue_ids \u2014 re-import", false));
          }
          rows.push(statusRow("Dailies stored", d.firstDay + "\u2013" + d.lastDay));
          rows.push(statusRow("Today", "#" + d.today,
            d.daysLeft === null ? null : d.daysLeft >= 0));
          rows.push(statusRow("Days remaining", d.daysLeft,
            d.daysLeft === null ? null : d.daysLeft > 14));
          /* Themed boards, and enough detail to tell three failures apart: no
             table at all, a table with nothing imported, and boards imported
             but every one dated ahead of today. All three look identical from
             inside the section — an empty list. */
          if (d.themeBoards === null || d.themeBoards === undefined) {
            rows.push(statusRow("Clubs and themes", "no table \u2014 run migration 006", false));
          } else if (!d.themeBoards) {
            rows.push(statusRow("Clubs and themes", "none imported", false));
          } else {
            rows.push(statusRow("Clubs and themes", d.themeLive + " live of " + d.themeBoards,
              d.themeLive > 0));
            if (d.themeNext) rows.push(statusRow("Next board", d.themeNext));
          }
          rows.push(statusRow("Sign-in", d.accounts ? "configured" : "not configured", !!d.accounts));
          rows.push(statusRow("Accounts", d.users === null ? "\u2014" : d.users));
        }
        body.innerHTML = rows.join("");
      })
      .catch(function (err) {
        sub.textContent = "Could not reach the server";
        body.innerHTML = statusRow("Build", BUILD) +
          statusRow("Status", String(err.message || err), false);
      });
  }
  on("buildBadge", "click", showStatus);
  on("statusClose", "click", function () { $("statusSheet").classList.remove("show"); });

  on("skipToggle", "click", function () {
    skipFilled = !skipFilled;
    try { localStorage.setItem("fcw.skip", skipFilled ? "on" : "off"); } catch (e) {}
    $("skipToggle").textContent = "skip filled: " + (skipFilled ? "on" : "off");
    /* Move to a square typing would now use, so the cursor does not sit on a
       letter the setting has just decided to step over. */
    if (puzzle && started) {
      var e = puzzle.entries[cur.entry];
      var i = cur.cell;
      while (i < e.len && passOver(e, i)) i++;
      if (i < e.len) cur.cell = i;
      updateSelection();
    }
  });

  on("bankToggle", "click", function () {
    bankOn = !bankOn;
    try { localStorage.setItem("fcw.bank", bankOn ? "on" : "off"); } catch (e) {}
    $("bankToggle").textContent = "letter bank: " + (bankOn ? "on" : "off");
    updateSelection();
  });
  if ($("bankToggle")) $("bankToggle").textContent = "letter bank: " + (bankOn ? "on" : "off");
  if ($("skipToggle")) $("skipToggle").textContent = "skip filled: " + (skipFilled ? "on" : "off");

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
  /* Which squares typing steps over. Revealed squares always — they cannot be
     overwritten. Filled ones only when the setting is on, and only while the
     entry still has an empty square to reach: with none left, skipping would
     mean the keys did nothing at all and a wrong answer could never be
     corrected. */
  function passOver(e, i) {
    var k = K(e.cells[i].x, e.cells[i].y);
    if (locked(k)) return true;
    if (!skipFilled) return false;
    for (var j = 0; j < e.len; j++) {
      var kk = K(e.cells[j].x, e.cells[j].y);
      if (!locked(kk) && !letters[kk]) return !!letters[k];
    }
    return false;                       // nothing empty left: behave normally
  }

  function typeLetter(ch) {
    if (complete || !started || paused) return;
    var e = puzzle.entries[cur.entry];
    // Land on the next square typing is allowed to fill.
    while (cur.cell < e.len && passOver(e, cur.cell)) cur.cell++;
    if (cur.cell >= e.len) { cur.cell = e.len - 1; advanceToNextEntry(); updateSelection(); return; }
    var c = e.cells[cur.cell];
    var k = K(c.x, c.y);
    letters[k] = ch;
    delete wrong[k];
    do { cur.cell++; } while (cur.cell < e.len && passOver(e, cur.cell));
    /* Move on when the WORD is finished, not only when the cursor happens to
       run off the end of it.

       It used to check the cursor. That fires when you type the last cell in
       the word's own order — but with skip-filled off, which is the default,
       the cursor walks through cells a crossing answer already filled. So the
       ordinary case of typing the fourth letter of a five, where the fifth
       arrived from a crossing, left you sitting on a completed word with
       nothing happening. Checking the entry catches both.

       "Filled" is the most this can know: the browser holds no answers — that
       is what /api/check-answer is for — so a wrong word advances too. That is
       the usual crossword behaviour and the alternative is worse, because
       staying put on a wrong answer tells the player it is wrong. */
    if (cur.cell >= e.len || entryFilled(cur.entry)) {
      cur.cell = Math.min(cur.cell, e.len - 1);
      advanceToNextEntry();
    }
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
  /* Jump straight to another unanswered clue.

     With the arrows gone the only other way to change clue is to find the right
     square on the board, and the full clue list is a scroll past the whole grid
     on a phone. This is the short route.

     Unanswered only: a list that includes what you have already filled is a
     list you read past to find the thing you want. "Filled" is the most it can
     know — the browser holds no answers — so a wrong word counts as done here,
     the same as it does for auto-advance. */
  function buildJumpList() {
    var box = $("jumpList");
    if (!box) return;
    var order = entryOrder(), rows = "";
    for (var n = 0; n < order.length; n++) {
      var i = order[n];
      if (entryFilled(i)) continue;
      var e = puzzle.entries[i];
      rows += '<button class="jump-item" role="option" data-entry="' + i + '"' +
        (i === cur.entry ? ' aria-selected="true"' : '') + '>' +
        '<span class="jn">' + e.num + (e.dir === A ? "A" : "D") + "</span>" +
        '<span class="jt">' + escapeHtml(e.row.clue) + "</span></button>";
    }
    box.innerHTML = rows ||
      '<div class="jump-empty">Every clue has an answer in.</div>';
  }
  function closeJump() {
    var box = $("jumpList");
    if (!box || box.hidden) return;
    box.hidden = true;
    var m = $("ncMeta");
    if (m) m.setAttribute("aria-expanded", "false");
  }
  function toggleJump() {
    var box = $("jumpList"), m = $("ncMeta");
    if (!box || !m) return;
    var opening = box.hidden;
    if (opening) buildJumpList();
    box.hidden = !opening;
    m.setAttribute("aria-expanded", opening ? "true" : "false");
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
    /* Not while somebody is typing into a field. This handler takes every
       letter for the grid and calls preventDefault, so a text box could not be
       typed into at all — the keystroke went to the crossword and never reached
       the input. It only became visible when Full Time grew fields of its own,
       but it applies to every input on the page. */
    var el = ev.target;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ||
               el.tagName === "SELECT" || el.isContentEditable)) return;
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
    var idx = cur.entry;
    var typed = cells.map(function (c) { return letters[K(c.x, c.y)] || null; });
    api("/api/check-answer", { token: puzzleToken, entry: idx, guess: typed, detail: 1,
                               playId: playId })
      .then(function (r) {
        markWrongFromServer(idx, r.wrong || []);
        checksUsed++;
        helpActions.push("check");
        consecutiveChecks++;
        var headline = consecutiveChecks === 2 ? "Back-to-back defeats"
                     : consecutiveChecks >= 3 ? "Three losses on the bounce"
                     : "Defeat \u2014 3 points dropped";
        toast(headline, consecutiveChecks > 1 ? "3 points dropped" : "", "loss");
        updateScoreUI(); saveSoon();
      })
      .catch(function (err) { revealFailed(err); });
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
    /* One request per entry, because the player is owed the positions of every
       wrong letter and each entry is a separate question.
       Only the first carries the play id. The server counts a paid check per
       request, so eleven requests were charged as eleven checks — a grid check
       priced at nine points cost thirty-six. The count belongs to the press of
       the button, not to the traffic it happens to take.
       checkGrid says which kind of press it was, so the server adds one to the
       grid-check tally rather than eleven to the single-check one. */
    var jobs = puzzle.entries.map(function (e, i) {
      var typed = e.cells.map(function (c) { return letters[K(c.x, c.y)] || null; });
      return api("/api/check-answer", {
        token: puzzleToken, entry: i, guess: typed, detail: 1,
        playId: i === 0 ? playId : null,
        checkGrid: 1,
      }).then(function (r) { return { i: i, wrong: r.wrong || [] }; });
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
    }, function () {
      helpActions.push("revealLetter");
      consecutiveChecks = 0;
      toast("Draw \u2014 2 points dropped", "Held to a draw.", "draw");
      // advance to the next editable cell, like typing
      do { cur.cell++; } while (cur.cell < e.len && locked(K(e.cells[cur.cell].x, e.cells[cur.cell].y)));
      if (cur.cell >= e.len) { cur.cell = e.len - 1; advanceToNextEntry(); }
      refreshLetters(); updateSelection(); updateScoreUI(); verifySoon(); saveSoon();
      checkComplete();
    });
    startTimer();
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
    }, function () {
      subsUsed++;                      // a substitution is spent only if used
      toast("Substitution", "Fresh legs \u2014 free letter, nothing conceded.");
      do { cur.cell++; } while (cur.cell < e.len && locked(K(e.cells[cur.cell].x, e.cells[cur.cell].y)));
      if (cur.cell >= e.len) { cur.cell = e.len - 1; advanceToNextEntry(); }
      refreshLetters(); updateSelection(); updateScoreUI(); updateSubUI(); verifySoon(); saveSoon();
      checkComplete();
    });
    startTimer();
  });

  /* One letter, from the server, for Reveal Letter and Substitution alike. */
  /* A failed reveal must cost nothing. `charge` runs only after the letter
     arrives, so a stale token or a dropped connection leaves the score alone. */
  function revealFromServer(entryIdx, cellIdx, apply, charge) {
    api("/api/reveal", { token: puzzleToken, entry: entryIdx, index: cellIdx, playId: playId })
      .then(function (r) { apply(r.letter); if (charge) charge(); })
      .catch(function (err) { revealFailed(err); });
  }
  function revealFailed(err) {
    /* A request that never left the device is a connection problem, not a
       refusal — say so, and start catching up rather than leaving the player
       to work out why nothing is confirming. */
    if (err && err.offline) {
      setOffline(true);
      scheduleRetry();
      toast("No connection", "Nothing charged. It will catch up when you are back.", "loss");
      return;
    }
    var msg = String((err && err.message) || err);
    /* The commonest cause is a puzzle that no longer exists — the practice pool
       was rebuilt under a saved game. Say what to do rather than the error. */
    if (/no longer stored|Unknown puzzle|not today/i.test(msg)) {
      toast("This puzzle has expired", "Press New Puzzle to start a fresh one.", "loss");
    } else {
      toast("Reveal unavailable", msg + " \u2014 nothing charged.", "loss");
    }
  }

  /* ---------- Reveal Answer (selected answer, -9 pts per unique answer) ---------- */
  on("revealBtn", "click", function () {
    if (complete || !started || paused) return;
    var e = puzzle.entries[cur.entry];
    var idx = cur.entry;
    // The one place a whole answer is fetched, and only because the player has
    // asked for it and paid nine points.
    /* The charge lands only once the answer has. Reveals are a server call now,
       and the penalty used to be applied outside the promise — so a request
       that failed (a stale token after a pool re-import, a dropped
       connection) still cost nine points and filled in nothing. */
    api("/api/reveal", { token: puzzleToken, entry: idx, playId: playId })
      .then(function (r) {
        e.cells.forEach(function (c, i) {
          var k = K(c.x, c.y);
          letters[k] = r.answer[i];
          delete wrong[k];
          // Lock every cell; keep prior gold letter-reveals gold (no double charge).
          if (!revealedCells[k]) revealAnswerCells[k] = true;
        });
        if (!revealedEntries[idx]) {
          revealedEntries[idx] = true;
          helpActions.push("revealAnswer");
          consecutiveChecks = 0;
          toast("Three defeats on the bounce", "9 points dropped", "loss");
        }
        refreshLetters(); updateSelection(); updateScoreUI(); verifySoon(); saveSoon();
        checkComplete();
      })
      .catch(function (err) { revealFailed(err); });
    startTimer();
  });

  /* ---------- Daily results (local only, no accounts) ----------
     One structured record per completed Daily. Every figure on My Season is
     derived from these, and the shape is stable enough for a future optional
     account sync to consume unchanged. */
  var RESULTS_KEY = "fcw.results.v1";
  /* What "clear everything" clears: history and saved games, and nothing else.
     Preferences stay — the club you play as, the pitch, the letter bank, the
     clue style — because wiping a record is not the same as resetting a
     device, and somebody clearing their results does not expect their settings
     to change underneath them.
     This list is here rather than inside the handler because it is the thing
     that goes stale: the themed results key was added months after the reset
     was written and never got added to it, so clearing everything left themed
     boards still marked as played. Anything new that survives a reload and
     records what somebody did belongs here. */
  var WIPE_KEYS = [
    "fcw.results.v1",        // daily and practice results
    "fcw.themeResults.v1",   // themed boards, and what was marked as played
    "fcw.streak",            // the run
    "fcw.pre",               // the pre-season record
    "fcw.recent",            // recent answers, so they are not repeated
    "fcw.usedClues.v1",      // clue circulation
    "fcw.v04.daily",         // the three saved games
    "fcw.v04.practice",
    "fcw.v04.theme",
    "fcw.mode",
  ];
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
    /* Friendlies are recorded, but to their own record. A pre-season streak is
       a real thing to build, and it ending on Matchday 1 is the point rather
       than a loss — the season table starts empty for everyone on the same day
       whatever anyone did in August. */
    var phase = FCW.dailyPhase(dailyNo);
    if (!phase.counts) {
      var note = $("rClockNote");
      if (note) {
        note.textContent = "Pre-season friendly \u2014 kept in your pre-season record. " +
          "The season table starts on Matchday 1, 13 September.";
        note.style.display = "";
      }
    }
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
      phase: phase.phase,
      bankVersion: FCW.QUESTION_BANK_VERSION,
      club: club, season: season ? season.season : null,
      score: score, position: pos,
      elapsedSeconds: elapsed, matchMinute: FCW.matchMinute(elapsed),
      checks: checksUsed,
      revealedLetters: revealedLetterCount(),
      revealedAnswers: revealedAnswerCount(),
      /* Recorded so a leaderboard can tell a four-minute solve from a
         four-minute solve spread across two hours. Pausing hides the puzzle, so
         it is not cheating — but it stops the scoring clock, and that is worth
         knowing rather than hiding. */
      pauses: pauseCount,
      pausedSeconds: Math.round(pausedMs / 1000)
    }));
    list.sort(function (a, b) { return a.dailyNo - b.dailyNo; });
    saveResults(list);
    return list;
  }
  /* A themed board keeps its own record, and deliberately not the season's.
     The archive is replayable and unlimited, so anyone could assemble a
     114-point season out of forty easy boards — the same reason friendlies are
     kept to one side. Streaks stay on the Daily, where one a day is the whole
     constraint that makes a streak mean anything.

     Best attempt wins on a replay rather than first: a board that stays open
     for a year is not an exam, and beating your own score is the reason to go
     back to one. */
  function recordThemed(pos, score) {
    if (!themeWanted || !themeWanted.theme) return;
    var key = themeWanted.theme + "-" + themeWanted.no;
    var list = loadThemeResults();
    var prev = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].themeKey === key) { prev = list[i]; break; }
    }
    /* A verified score replaces whatever is there, even when it is lower. The
       guard below keeps the best of several attempts; it must not also keep an
       unverified figure in preference to the server's, or the badge goes on
       showing a number the game no longer stands behind. */
    if (prev && prev.playId && prev.playId === playId) prev = null, list = list.filter(function (x) {
      return !(x && x.themeKey === key);
    });
    if (prev && (prev.score || 0) >= score) return list;
    var rec = {
      themeKey: key, themeLabel: themeLabel, date: FCW.localDateKey(),
      playId: playId,          // so a verified rewrite replaces its own row
      club: club, season: season ? season.season : null,
      score: score, position: pos,
      elapsedSeconds: elapsed, matchMinute: FCW.matchMinute(elapsed),
      checks: checksUsed,
      revealedLetters: revealedLetterCount(),
      revealedAnswers: revealedAnswerCount(),
      pauses: pauseCount, pausedSeconds: Math.round(pausedMs / 1000)
    };
    if (prev) list[list.indexOf(prev)] = rec; else list.push(rec);
    saveThemeResults(list);
    return list;
  }

  /* Their own key, not the results array. That array is sorted by dailyNo,
     read by FCW.streaks(), and posted wholesale to /api/account/migrate on
     sign-in — a record with no dailyNo in it would sort to nowhere, count for
     nothing and be sent to an endpoint that has never seen one. */
  var THEME_RESULTS_KEY = "fcw.themeResults.v1";
  function loadThemeResults() {
    try {
      var r = JSON.parse(localStorage.getItem(THEME_RESULTS_KEY));
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }
  function saveThemeResults(list) {
    try { localStorage.setItem(THEME_RESULTS_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* Say it on the card. A run with the clock stopped for twenty minutes is a
     different run from one without, and the player should see that stated
     rather than have it recorded silently against them. */
  function showPauseNote() {
    var el = $("rPauseNote");
    if (!el) return;
    if (!pauseCount) { el.style.display = "none"; return; }
    var mins = Math.round(pausedMs / 60000);
    el.textContent = "Clock stopped " +
      (pauseCount === 1 ? "once" : pauseCount === 2 ? "twice" : pauseCount + " times") +
      (mins >= 1 ? " for " + mins + (mins === 1 ? " minute" : " minutes") : "") + ".";
    el.style.display = "";
  }

  function showClockNote(playedNo, todayNo) {
    var el = $("rClockNote");
    if (!el) return;
    el.textContent = "Not recorded \u2014 this is " + FCW.dailyPhase(playedNo).label.toLowerCase() +
      ", and today's is #" + todayNo + ".";
    el.style.display = "";
  }
  /* The record for the phase being played. During pre-season that is the
     friendly record; from Matchday 1 it is the season, and the friendlies sit
     behind it as their own line rather than being folded in or thrown away. */
  function phaseResults() {
    var split = FCW.splitByPhase(loadResults());
    return FCW.dailyPhase(dailyNo).counts ? split.season : split.preseason;
  }
  function renderStreak() {
    var st = FCW.seasonStats(phaseResults(), dailyNo);
    var pre = !FCW.dailyPhase(dailyNo).counts;
    $("streakLine").textContent = st.played
      ? (pre ? "Pre-season run " : "Current run ") + st.currentStreak +
        " \u00B7 best " + st.longestStreak + " \u00B7 " + st.played + " played"
      : "";
  }

  /* ---------- My Season ---------- */
  function fmtClock(sec) { return fmt(sec || 0); }
  function renderStats() {
    var split = FCW.splitByPhase(loadResults());
    var inSeason = FCW.dailyPhase(dailyNo).counts;
    var results = inSeason ? split.season : split.preseason;
    var st = FCW.seasonStats(results, dailyNo);
    var label = inSeason ? "Daily" : "pre-season";
    $("statsSub").textContent = st.played
      ? st.played + " " + label + " " + (st.played === 1 ? "puzzle" : "puzzles") + " completed"
      : (inSeason ? "Your record on this device" : "Your pre-season record");
    /* Once the season starts, the friendlies stay visible as their own line.
       Building a run through August and then seeing it vanish would read as a
       bug, however correct the season table is. */
    var preNote = $("statsPreNote");
    if (preNote) {
      if (inSeason && split.preseason.length) {
        var ps = FCW.seasonStats(split.preseason, FCW.PRESEASON_DAYS);
        preNote.textContent = "Pre-season: " + split.preseason.length +
          " played \u00B7 best run " + ps.longestStreak +
          (ps.bestScore !== null ? " \u00B7 best score " + ps.bestScore : "");
        preNote.style.display = "";
      } else {
        preNote.style.display = "none";
      }
    }
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
  /* The clubs of the most recent stored season come first, then everyone else.
     Forty-nine clubs in one alphabetical run means scrolling past Barnsley and
     Bradford to reach the side you actually support.
     Taken from the data rather than typed in, so adding a season moves the list
     on by itself — and labelled with the season it came from rather than
     "current", because the newest table stored is not necessarily the season
     being played. */
  function recentClubs() {
    var last = FCW.latestSeason && FCW.latestSeason();
    if (!last) return { clubs: [], label: "" };
    return {
      clubs: (last.table || []).map(function (r) { return r.club; }),
      label: last.season,
    };
  }

  function populateClubSelect(sel) {
    if (sel.options.length) return;
    var opt = document.createElement("option");
    /* "Random club", not "Random club and season". The season is always drawn
       from the puzzle seed whichever club you pick, so naming it here offered a
       choice that does not exist and implied picking a club would pin the
       season. */
    opt.value = "__random__"; opt.textContent = "Random club";
    sel.appendChild(opt);

    var recent = recentClubs();
    var seen = {};
    function addTo(parent, name) {
      var o = document.createElement("option");
      o.value = name; o.textContent = name;
      parent.appendChild(o);
      seen[name] = true;
    }
    if (recent.clubs.length) {
      var g1 = document.createElement("optgroup");
      g1.label = "Premier League " + recent.label;
      recent.clubs.slice().sort().forEach(function (c) { addTo(g1, c); });
      sel.appendChild(g1);
    }
    var rest = CLUBS.filter(function (c) { return !seen[c]; });
    if (rest.length) {
      var g2 = document.createElement("optgroup");
      g2.label = "Other Premier League clubs";
      rest.forEach(function (c) { addTo(g2, c); });
      sel.appendChild(g2);
    }
    /* Clubs that have never played a Premier League season. They take the
       bottom club's place in whichever season is used — which is the right
       story anyway: you start at the bottom and climb. */
    var efl = EFL_CLUBS.filter(function (c) { return !seen[c]; }).sort();
    if (efl.length) {
      var g3 = document.createElement("optgroup");
      g3.label = "Football League clubs";
      efl.forEach(function (c) { addTo(g3, c); });
      sel.appendChild(g3);
    }
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
    var home = $("homeClubSelect");
    if (home) {
      populateClubSelect(home);
      home.value = clubMode === "chosen" ? club : "__random__";
    }
  }
  on("kickOffBtn", "click", kickOff);
  /* Switch mode from the card itself, then kick off in one press. */
  on("kickAltBtn", "click", function () {
    mode = (mode === "daily") ? "practice" : "daily";
    try { localStorage.setItem("fcw.mode", mode); } catch (e) {}
    seed = (Math.random() * 1e9) | 0;
    renderKickCard();
    buildPuzzle(null).then(function () { kickOff(); });
  });
  function renderKickCard() {
    // #kickMode is the card's existing subtitle; the game already keeps it in
    // step elsewhere, so this only has to set the alternative button's label.
    var alt = $("kickAltBtn");
    if (alt) alt.textContent = mode === "daily"
      ? "Play a practice puzzle instead" : "Play today's daily instead";
  }
  renderKickCard();

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
                               revealedAnswerCount(), checkAllsUsed, { floor: seasonFloor() });
    var table = FCW.buildTable(club, res.score, season);
    var pos = FCW.playerPosition(table);
    lastPosition = pos;
    if ($("rClockNote")) $("rClockNote").style.display = "none";
    showPauseNote();
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
    else if (mode === "theme") recordThemed(pos, res.score);
    renderLeagueRows($("finalTableBody"), table, false); // Full Time: all 20
    var youRow = $("finalTableBody").querySelector("tr.you");
    playEnd(true);
    $("doneOverlay").classList.add("show");
    if (youRow && youRow.scrollIntoView) youRow.scrollIntoView({ block: "center" });
    /* Full Time appears immediately with the score worked out here, then the
       server's verdict replaces it when it arrives. Waiting would mean a
       finished puzzle showing nothing on a slow connection, and a puzzle that
       will not tell you how you did is worse than one that tells you twice. */
    verifyScore();
    /* The sender's own name: the account's, or the last one they used here.
       Remembering this one is right — it is theirs, and they will use it again. */
    var from = $("chFrom");
    if (from) {
      if (accountName()) { from.value = accountName(); from.disabled = true; }
      else {
        from.disabled = false;
        if (!from.value) { try { from.value = localStorage.getItem(CH_NAME_KEY) || ""; } catch (e) {} }
      }
    }
  }

  /* Opening a challenge: who set it, which board, how many have tried — and a
     name, before the board opens.
     The name is asked for first on the owner's decision, taken against my
     advice. The argument that won: a name typed before playing is a commitment,
     people finish what they have put something into, and it makes "six have
     taken this" a real number rather than an estimate. */
  function openChallenge(id) {
    $("homeOverlay").classList.remove("show");
    api("/api/challenge?id=" + encodeURIComponent(id))
      .then(function (c) {
        challenge = { id: c.id, theme: c.themeId, no: c.boardNo, creator: c.creatorName };
        $("chWho").textContent = c.groupName
          ? c.creatorName + " challenged " + c.groupName
          : c.creatorName + " challenged you";
        $("chBoard").textContent = themeNameFor(c.themeId) + " #" + c.boardNo;
        $("chCount").textContent = c.started
          ? c.started + (c.started === 1 ? " person has" : " people have") + " taken this. " +
            c.finished + " reached Full Time."
          : "Nobody has played this yet.";
        /* Blank unless signed in. It used to be filled from the last name typed
           on this device — which, when the challenge was made on the same
           device, offered the sender's own name back to the person answering.
           A wrong suggestion is worse than an empty box: an empty box asks a
           question, a wrong one answers it for you. */
        if (accountName()) {
          $("chName").value = accountName();
          $("chName").disabled = true;
        } else {
          $("chName").value = "";
          $("chName").disabled = false;
        }
        $("challengeOverlay").classList.add("show");
        /* Already played? Then show the standings here. Nothing competitive
           before you have played is the rule; this is after. */
        apiAuth("/api/challenge/table", { id: id, entrantKey: entrantKey() })
          .then(function (t) {
            if (!t || !t.played) return;
            renderStandings($("chStandings"), t, null);
            $("chStandings").hidden = false;
            $("chPlay").textContent = "Play it again";
          })
          .catch(function () {});
        /* Focus the box when there is something to type into it. `saved` used
           to hold a remembered name and was removed when the prefill went; the
           reference stayed, threw a ReferenceError after the fetch had already
           succeeded, and the single catch below reported it as a challenge that
           could not be found. The link was fine every time. */
        if (!$("chName").disabled) setTimeout(function () { $("chName").focus(); }, 60);
      })
      .catch(function (err) {
        if (err && err.handled) return;      // the request failure, already reported
        /* Anything that goes wrong drawing the screen is a different fault and
           says so, with the real error. One catch around both the request and
           the render named the wrong cause for an hour. */
        console.error("Challenge screen failed:", err);
        leaveChallenge();
        toast("That challenge could not be opened",
              String((err && err.message) || err), "loss");
        showHome();
      });
  }

  function submitChallengeEntry() {
    apiAuth("/api/challenge/entry", {
      id: challenge.id, playId: playId,
      name: challenge.name || "", entrantKey: entrantKey(),
    }).then(function () { showChallengeTable(); })
      .catch(function () { showChallengeTable(); });   // the table is worth showing regardless
  }

  /* The standings, at Full Time and nowhere earlier. Time and help beside every
     score: a 114 in thirty-eight seconds with no help is self-evidently what it
     is, and among people who know each other that deters more than any
     validation could. */
  /* The standings, drawn the same way wherever they appear. */
  function renderStandings(box, d, youPlayId) {
    if (!box) return;
    var mine = (challenge && challenge.name || "").toLowerCase();
    var rows = (d.entries || []).map(function (e) {
      /* What was actually done, not how many times something happened. A
         revealed letter costs 2 and a revealed answer 9, so "2 reveals" meant
         either 4 points or 18 — and a legitimate score looked impossible
         beside a worse one. The words are the prices. */
      /* Short forms. Spelled out, one row read "2 checks, 1 grid check, 17
         letters, 3 answers" — wider than the panel, wrapping to three lines and
         pushing the score off the edge. A standings table is scanned, not read:
         the letter is the price, the number is the count.
           C  check      G  grid check
           L  letter     A  answer
         The prices sit under the table so the shorthand explains itself. */
      var help = [];
      var ca = e.checkAnswers != null ? e.checkAnswers : e.checks;
      if (ca) help.push(ca + "C");
      if (e.checkGrids) help.push(e.checkGrids + "G");
      if (e.revealLetters) help.push(e.revealLetters + "L");
      if (e.revealAnswers) help.push(e.revealAnswers + "A");
      /* Older entries carry only the merged totals and cannot be split. */
      if (!help.length && e.reveals) help.push(e.reveals + "?");
      var you = (youPlayId && e.playId === youPlayId) ||
        (!!mine && e.name.toLowerCase() === mine);
      /* Time hard against the score, help in brackets before it. Everything
         that explains the score sits beside the score, so a row reads right to
         left as "91, over 4:19, having used two letters" rather than making the
         eye travel the width of the table to connect the two. */
      return '<tr' + (you ? ' class="you"' : "") + '>' +
        '<td class="ct-pos">' + e.position + "</td>" +
        '<td class="ct-name">' + escapeHtml(e.name) + "</td>" +
        '<td class="ct-help">' + (help.length ? "(" + help.join(" ") + ")" : "") + "</td>" +
        '<td class="ct-time">' + fmt(e.elapsedSeconds) + "</td>" +
        '<td class="ct-score">' + e.score + "</td></tr>";
    }).join("");
    box.innerHTML = "<h3>" + escapeHtml(d.creatorName) +
      (d.groupName ? " \u00B7 " + escapeHtml(d.groupName) : "") +
      "</h3><table><tbody>" + rows + "</tbody></table>" +
      /* Named as the buttons are named. "check" and "letter" describe nothing —
         the four are Check Answer, Check Grid, Reveal Letter and Reveal Answer,
         and a reader who has played will recognise them straight away. */
      '<div class="ct-key">' +
      'C check word \u00B73 \u00A0 G check grid \u00B79 \u00A0 ' +
      'L reveal letter \u00B72 \u00A0 A reveal answer \u00B79</div>';
  }

  function showChallengeTable() {
    var box = $("challengeTable");
    if (!box || !challenge) return;
    api("/api/challenge/table?id=" + encodeURIComponent(challenge.id))
      .then(function (d) {
        /* One renderer. This built its own rows, so every change to the
           standings had to be made twice — and was not: the challenge screen
           got left-aligned names and a penalties column while Full Time kept
           the old markup and the old classes, which is why the same table
           looked different depending on where you saw it. */
        renderStandings(box, d, playId);
        if (challenge.alreadyScored) {
          /* One entry per person is what stops reveal-then-replay, but somebody
             who has just finished and cannot see their number needs telling
             why, or the table looks broken rather than principled. */
          box.insertAdjacentHTML("beforeend",
            '<div class="ct-note">Your first result here still stands. ' +
            "One score each keeps the table honest.</div>");
        }
        box.hidden = false;
      })
      .catch(function () {});
  }

  /* The loop: a new challenge from the result just earned, without replaying.
     Chains rather than single hops are the point — challenge, play, challenge
     again — so this is the strongest thing to offer at Full Time. */
  on("challengeBtn", "click", function () {
    var out = $("challengeOut");
    if (verifiedScore === null) {
      out.textContent = "A challenge needs a verified score. Check your connection and finish again.";
      return;
    }
    var name = accountName() || ($("chFrom").value || "").trim();
    if (name.length < 2) {
      out.textContent = "Your name, at least two characters.";
      $("chFrom").focus();
      return;
    }
    if (!accountName()) { try { localStorage.setItem(CH_NAME_KEY, name); } catch (e) {} }
    var group = ($("chGroup").value || "").trim();
    out.textContent = "Creating\u2026";
    apiAuth("/api/challenge", {
      playId: playId, name: name, groupName: group || null, entrantKey: entrantKey(),
      /* Asked for by name, so a board can go to one group of friends and then
         to another without replaying it. A double-tap still returns the link
         that already exists. */
      another: challengeMade ? 1 : 0,
    }).then(function (r) {
      challengeMade = true;
      var url = SHARE_URL + "/?c=" + r.id;
      out.textContent = url;
      try {
        navigator.clipboard.writeText(url);
        toast("Challenge link copied", "Send it to whoever you want to beat.", "win");
      } catch (e) {}
      $("challengeBtn").textContent = "Challenge another group";
    }).catch(function (err) { out.textContent = String(err.message || err); });
  });
  var challengeMade = false;

  /* Take the challenge out of the address as well as out of the game. Leaving
     it there means a refresh reopens the screen somebody has just declined —
     and when a challenge fails to load, it means the only way back is editing
     the URL by hand. */
  function leaveChallenge() {
    challenge = null;
    try {
      var u = new URL(location.href);
      u.searchParams.delete("c");
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    } catch (e) {}
  }

  on("chCancel", "click", function () {
    $("challengeOverlay").classList.remove("show");
    leaveChallenge();
    mode = "practice"; themeWanted = null;
    showHome();
  });

  function themeNameFor(id) {
    return String(id || "").replace(/-/g, " ")
      .replace(/\b[a-z]/g, function (ch) { return ch.toUpperCase(); });
  }

  on("chPlay", "click", function () {
    if (!challenge) return;
    var name = ($("chName").value || "").trim();
    if (!accountName() && name.length < 2) {
      $("chMsg").textContent = "Please enter a name of at least two characters.";
      $("chName").focus();
      return;
    }
    $("chMsg").textContent = "";
    try { if (name) localStorage.setItem(CH_NAME_KEY, name); } catch (e) {}
    apiAuth("/api/challenge/start",
            { id: challenge.id, name: name, entrantKey: entrantKey() })
      .then(function (r) {
        challenge.name = r.name;
        /* Already scored on this challenge: the board still opens, because
           refusing to let somebody play is worse than a second score that does
           not count. It simply will not replace the entry they have. */
        challenge.alreadyScored = !!r.alreadyScored;
        if (r.alreadyScored) {
          toast("You have already set a score here",
                "Play again if you like — the table keeps your first result.", "info");
        }
        startChallengeBoard();
      })
      .catch(function (err) { $("chMsg").textContent = String(err.message || err); });
  });

  function startChallengeBoard() {
    $("challengeOverlay").classList.remove("show");
    mode = "theme";
    themeWanted = { theme: challenge.theme, no: challenge.no, id: null };
    buildPuzzle(null).then(function () {
      if (puzzle) return;
      leaveChallenge(); themeWanted = null; mode = "practice";
      toast("That board is not available", "It may not have been released yet.", "loss");
      showHome();
    });
  }

  /* The server's score, which is the real one.
     Everything it uses is beyond the browser's reach: the answers to mark the
     grid, its own count of the help it served, and the clock it started when
     the board was pulled. What the page shows is a display of that number.
     The local score stays for the case where the server cannot be reached — a
     finished puzzle should always say how you did — and is marked as
     unverified so the two are never confused. Only a verified score is fit for
     anything other people can see. */
  var verifiedScore = null;
  /* The server's own breakdown, kept whole. The share text needs the same
     shape computeScore returns, not just the total. */
  var verifiedBreakdown = null;
  /* Where the score put you, so a rewritten record carries the right position
     rather than the one the browser's arithmetic implied. */
  var lastPosition = null;
  function verifyScore() {
    var note = $("rVerified");
    if (note) { note.textContent = "checking\u2026"; note.className = "verify-note"; }
    api("/api/finish", { token: puzzleToken, playId: playId, letters: letters })
      .then(function (r) {
        if (!r || !r.verified || typeof r.score !== "number") {
          if (note) {
            note.textContent = "not verified \u2014 this device's own count";
            note.className = "verify-note unverified";
          }
          return;
        }
        verifiedScore = r.score;
        verifiedBreakdown = Object.assign({}, r.breakdown || {}, { score: r.score });
        /* Ranked here rather than beside the call to verifyScore(): the rank
           has to include the score just posted, and that is only true once the
           server has answered. Hung off a timer instead, it would sometimes
           rank against a table the player was not yet in. */
        showTodayRank(r.score);
        if (note) {
          note.textContent = "verified by the server";
          note.className = "verify-note verified";
        }
        /* The two can differ honestly: the verified clock runs from the moment
           the board was pulled and does not pause. Say so rather than letting
           it read as a fault. */
        /* The breakdown comes from the server too, whether or not the total
           changed. Updating the headline and leaving the penalty rows showing
           the browser's working printed a sum that did not add up to the score
           above it — 114 minus 26 minus 12 minus 18 is 58, under a heading
           saying 60. A number nobody can check is worse than no number. */
        var b = r.breakdown || {};
        $("bTime").textContent = fmt(r.elapsedSeconds);
        $("bClock").textContent = FCW.matchClockLabel(r.elapsedSeconds);
        $("bTimePen").textContent = "\u2212" + (b.timePenalty || 0);
        $("bChecks").textContent = footballPhrase("check", r.checks || 0, b.checkPenalty || 0);
        $("bCheckPen").textContent = "\u2212" + (b.checkPenalty || 0);
        $("bCheckAlls").textContent = footballPhrase("answer", r.checkAlls || 0, b.checkAllPenalty || 0);
        $("bCheckAllPen").textContent = "\u2212" + (b.checkAllPenalty || 0);
        $("bLetters").textContent = footballPhrase("draw", r.revealedLetters || 0, b.letterPenalty || 0);
        $("bLetterPen").textContent = "\u2212" + (b.letterPenalty || 0);
        $("bAnswers").textContent = footballPhrase("answer", r.revealedAnswers || 0, b.answerPenalty || 0);
        $("bAnswerPen").textContent = "\u2212" + (b.answerPenalty || 0);
        $("rFinal").textContent = r.score + " / " + FCW.SCORING.MAX_SCORE;

        /* The device's own record is rewritten too. recordDaily and
           recordThemed run when the puzzle finishes, before the server has
           answered, so they stored the browser's figure — and the board badge
           then showed 81 for a game whose Full Time said 82. One game, one
           score, wherever it appears. */
        /* A verified score is the only kind that may join a challenge table.
           Submitted here rather than at Full Time for exactly that reason. */
        if (challenge) submitChallengeEntry();
        if (mode === "theme") recordThemed(lastPosition, r.score);
        else if (mode === "daily") recordDaily(lastPosition, r.score, r.breakdown || {});

        if (r.score !== Number($("rScore").textContent)) {
          var table = FCW.buildTable(club, r.score, season);
          var pos = FCW.playerPosition(table);
          $("rScore").textContent = r.score;
          $("rPos").textContent = (FCW.ordinal(pos) + " \u2014 " + r.score + " pts").toUpperCase();
          $("rFinal").textContent = r.score + " / " + FCW.SCORING.MAX_SCORE;
          $("rMsg").textContent = FCW.outcomeMessage(club, pos);
          renderSeason("rSeasonGames", "rSeasonWdl", r.score);
          renderLeagueRows($("finalTableBody"), table, false);
          if (note) {
            note.textContent = "verified \u2014 timed from when the board was opened, " +
              "which does not pause";
          }
        }
      })
      .catch(function () {
        if (note) {
          note.textContent = "not verified \u2014 this device's own count";
          note.className = "verify-note unverified";
        }
      });
  }
  on("viewGridBtn", "click", function () {
    $("doneOverlay").classList.remove("show"); // gold cells stay marked; input is locked
  });
  /* What gets shared.
     The old version carried no link, which is the one thing a share has to do —
     somebody reads "Arsenal finished 1st, 106/114" and has no way to reach the
     game. It also had no picture. Wordle's grid works because it is instantly
     recognisable and gives nothing away; the season record is this game's
     equivalent, and it is already what the scoreboard is built around. */
  var SHARE_URL = "https://crossword.thexigames.com";

  function shareStrip(score) {
    /* Ten squares, proportional to the season a score represents. Thirty-eight
       is a wall of colour on a phone; ten reads at a glance and still tells a
       good run from a poor one. */
    var rec = FCW.seasonRecord(score);
    var n = rec.marks.length || 1;
    var out = "", used = 0;
    var w = Math.round(rec.won / n * 10), d = Math.round(rec.drawn / n * 10);
    for (var i = 0; i < w && used < 10; i++, used++) out += "\uD83D\uDFE9";
    for (var j = 0; j < d && used < 10; j++, used++) out += "\uD83D\uDFE8";
    while (used < 10) { out += "\uD83D\uDFE5"; used++; }
    return out;
  }

  function shareResult() {
    /* The verified score where there is one. This recomputed locally every
       time, so a shared result carried the browser's arithmetic while the card
       above it showed the server's — the same number off by one, sent to
       everybody the player knows.
       One game, one score, wherever it appears: on the card, on the board
       badge, in the season record, and in what gets shared. */
    if (verifiedScore !== null && verifiedBreakdown) {
      return verifiedBreakdown;
    }
    return FCW.computeScore(elapsed, checksUsed, revealedLetterCount(),
                            revealedAnswerCount(), checkAllsUsed, { floor: seasonFloor() });
  }

  /* A practice puzzle can be handed to somebody else. Each one has a token, and
     the API can serve that exact puzzle, so "beat this" is a real invitation
     rather than a vague one — the daily needs no such link, because everybody
     gets the same puzzle anyway. */
  function shareLink() {
    if (mode === "daily") return SHARE_URL;
    /* A themed link says what it is. /?t=man-united-3 reads as an invitation;
       /?p=4471 reads as a database key, and the name is public anyway the
       moment it appears in the message. */
    if (mode === "theme" && themeWanted && themeWanted.theme) {
      return SHARE_URL + "/?t=" + encodeURIComponent(themeWanted.theme + "-" + themeWanted.no);
    }
    var m = /^practice:(\d+)$/.exec(puzzleToken || "");
    return m ? SHARE_URL + "/?p=" + m[1] : SHARE_URL;
  }

  function shareText() {
    var res = shareResult();
    var table = FCW.buildTable(club, res.score, season);
    var pos = FCW.playerPosition(table);
    var name = mode === "daily"
      ? "Crossword XI \u00B7 " + FCW.dailyPhase(dailyNo).label
      : (mode === "theme" && themeLabel
          ? "Crossword XI \u00B7 " + themeLabel
          : "Crossword XI \u00B7 practice");
    /* The season year is gone. "Arsenal finished 3rd in 2020/21" reads as a
       claim about football rather than about a crossword, and it is not true —
       the table is a real historical season with your score dropped into it.
       "/114" is gone too: the squares already show how good a score is, and a
       denominator asks a reader to do arithmetic before they can care.
       Nothing here gives an answer away, which is what makes a result worth
       posting: a reader sees how you did and can still play it cold. */
    var line = shareStrip(res.score) + "\n" +
      res.score + " pts \u00B7 " + FCW.ordinal(pos) + " \u00B7 " + fmt(elapsed);
    var invite = mode === "daily" ? SHARE_URL : "Beat it: " + shareLink();
    // "Manchester United #3" is the whole point of numbering them.
    return name + "\n" + line + "\n" + invite;
  }

  function shareFallback(text) {
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
  }

  on("shareBtn", "click", function () {
    var text = shareText();
    /* The native sheet on a phone already offers WhatsApp, Messages and
       everything else installed — better than a row of buttons guessing which
       apps somebody has. Desktop has no such thing, so it copies instead. */
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () { shareFallback(text); });
      return;
    }
    shareFallback(text);
  });

  /* Named buttons for where a result actually gets posted. Each opens that
     platform's own composer with the text already in it. */
  on("shareX", "click", function () {
    window.open("https://twitter.com/intent/tweet?text=" +
      encodeURIComponent(shareText()), "_blank", "noopener");
  });
  on("shareWhatsApp", "click", function () {
    window.open("https://wa.me/?text=" + encodeURIComponent(shareText()),
      "_blank", "noopener");
  });
  on("shareReddit", "click", function () {
    /* Reddit takes a title and a link rather than a body, so the result becomes
       the title and the game is the link. */
    var res = shareResult();
    var title = "Crossword XI \u2014 " +
      (mode === "daily" ? FCW.dailyPhase(dailyNo).label : "practice") +
      " \u2014 " + res.score + "/114 in " + fmt(elapsed);
    window.open("https://reddit.com/submit?url=" + encodeURIComponent(SHARE_URL) +
      "&title=" + encodeURIComponent(title), "_blank", "noopener");
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
  /* The edge zones. While the jump list is open they close it and do nothing
     else — a tap that both dismisses a list and moves you somewhere is a tap
     that did two things you only asked one of. */
  on("prevClue", "click", function () {
    if (!$("jumpList").hidden) { closeJump(); return; }
    stepClue(-1);
  });
  on("nextClue", "click", function () {
    if (!$("jumpList").hidden) { closeJump(); return; }
    stepClue(1);
  });
  window.addEventListener("resize", function () { if (puzzle) fitCells(); scaleClue(); });
  /* The keyboard opening does not fire resize on iOS — it changes the visual
     viewport instead. Without this the board is sized for a screen that no
     longer exists the moment a cell is focused. */
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () { if (puzzle) fitCells(); scaleClue(); });
    window.visualViewport.addEventListener("scroll", function () { if (puzzle) fitCells(); scaleClue(); });
  }
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

  /* ---------- The landing screen ----------
     Nothing is loaded and no clock exists until a choice is made. The card this
     replaced opened straight onto the daily, so somebody who wanted practice
     pressed Kick Off, started the daily's clock and lost points on a game they
     had not chosen to play. */
  function savedFor(which) {
    try { return JSON.parse(localStorage.getItem(slotKey(which))); } catch (e) { return null; }
  }

  function renderHome() {
    syncKickSelect();          // fills and syncs the Play as control on this screen
    var today = FCW.dailyNumber();
    var phase = FCW.dailyPhase(today);
    $("homeDailyTitle").textContent = phase.label;
    $("homeDailyNote").textContent = phase.counts
      ? "One a day, the same for everyone. The clock counts."
      : "A friendly. Played and kept, but the season table starts on Matchday 1.";

    /* A game with time on the clock is in progress whether or not anything has
       been typed — twenty-five seconds of reading the clues is still playing,
       and showing nothing there made it look as though the game had been lost. */
    function inProgress(rec) {
      return !!rec && !rec.complete &&
        (Object.keys(rec.letters || {}).length > 0 || (rec.elapsed || 0) > 0);
    }

    var d = savedFor("daily");
    var state = "";
    if (d && d.dailyNo === today) {
      if (d.complete) state = "Played \u00B7 " + (d.score != null ? d.score + "/114" : "done");
      else if (inProgress(d)) state = "In progress \u00B7 " + fmt(d.elapsed || 0);
    }
    $("homeDailyState").textContent = state;

    var p = savedFor("practice");
    /* While practice is suspended the state line has to say whether the tile
       still does anything. "One in progress" now means "and you can still
       finish it", which is the opposite of what the Coming soon label implies,
       so it says so. */
    $("homePracticeState").textContent = inProgress(p)
      ? "One in progress \u00B7 " + fmt(p.elapsed || 0) + " \u00B7 you can finish this one"
      : "";

    /* How many are out, so the card says something before it is opened. Fails
       quietly: a themed count is not worth a broken landing screen. */
    var th = $("homeThemedState");
    if (th) {
      loadThemes().then(function (d) {
        var n = (d.themes || []).reduce(function (a, t) { return a + t.boards.length; }, 0);
        th.textContent = n ? n + (n === 1 ? " board available" : " boards available") : "";
        showFeatured(d.featured);
      }).catch(function () { th.textContent = ""; });
    }
  }

  /* Where today's field put you, on the board of the day.

     Asked for after verifyScore() rather than before: the rank has to include
     the score just posted, and the server only knows it once /api/finish has
     landed. Reading it early would rank you against a table you are not in
     yet, and "3rd of 2" is worse than a moment's wait.

     Only for the featured board. Every other board is playable whenever, so a
     day-scoped table on one would be comparing people who happened to pick the
     same afternoon. */
  function showTodayRank(mine) {
    var el = $("rRank");
    if (!el) return;
    el.style.display = "none";
    var f = featuredBoard;
    if (!f || mode !== "theme" || !themeWanted || themeWanted.theme !== f.themeId ||
        Number(themeWanted.no) !== Number(f.no)) return;

    if (typeof mine !== "number") return;
    api("/api/featured-scores?theme=" + encodeURIComponent(f.themeId) + "&no=" + f.no)
        .then(function (d) {
          if (!d || !d.configured || !d.count) return;
          var better = 0;
          d.scores.forEach(function (s) { if (s.score > mine) better++; });
          /* Only the top ten come back, so a score outside it cannot be ranked
             exactly. Say the field instead of guessing a position. */
          var place = d.scores.length < d.count && better >= d.scores.length
            ? null : better + 1;
          el.textContent = place
            ? "Board of the day: " + ordinal(place) + " of " +
              d.count + (d.count === 1 ? " score today" : " scores today")
            : d.count + " have played today, best so far " + d.best;
          el.style.display = "";
        }).catch(function () {});
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* Board of the day on the landing screen.

     The pick comes from the server so everybody sees the same one; this only
     draws it. Hidden when there is nothing to show rather than drawn empty —
     an empty frame on the landing screen is worse than no frame. */
  var featuredBoard = null;
  function showFeatured(f) {
    var card = $("homeFeatured");
    if (!card) return;
    featuredBoard = f || null;
    if (!f) { card.hidden = true; return; }
    var name = $("homeFeaturedName"), state = $("homeFeaturedState");
    /* Always the number, even on #1. The card names one specific board and
       "Arsenal — Midfielders" alone does not say which, so somebody who has
       played one of two cannot tell whether this is the other. */
    if (name) name.textContent = f.themeName + " #" + f.no;
    if (state) {
      var r = themeResults()[f.themeId + "-" + f.no];
      state.textContent = r
        ? (r.score != null ? "Played \u00B7 " + r.score : "Played")
        : "";
    }
    card.hidden = false;
  }

  /* ---------- The Themed section ----------
     Three panels: what can be played now, what is coming, and how to ask for
     one. Fetched once and cached for the session — the section is opened and
     closed repeatedly while choosing, and refetching on each open makes it
     feel slower than it is. */
  var themeData = null;
  function loadThemes(force) {
    if (themeData && !force) return Promise.resolve(themeData);
    return api("/api/themes").then(function (d) { themeData = d; return d; });
  }

  /* Which themed boards this device has finished, so the list can mark them.
     Kept with the other local records rather than asked of the server: it is
     the same question My Season answers and the same place it reads from. */
  function themeResults() {
    var out = {};
    loadThemeResults().forEach(function (r) {
      if (r && r.themeKey) out[r.themeKey] = r;
    });
    return out;
  }

  /* Every theme that exists, plus every club the game already knows about, so
     a supporter can ask for their club before it has a board. */
  function fillThemeRequestList(d) {
    var sel = $("themeRequestKey");
    if (!sel) return;
    /* Rebuilt each time rather than filled once: what has already been
       requested changes as you request things, and a list that never updates
       makes the one-each rule something you discover by pressing the button. */
    var mine = {};
    ((d && d.mine) || []).forEach(function (k) { mine[k] = true; });
    var seen = {};
    var opts = ((d && d.options) || []).map(function (o) { seen[o.label] = 1; return o; });
    CLUBS.concat(EFL_CLUBS).sort().forEach(function (c) {
      if (!seen[c]) opts.push({ key: slug(c), label: c });
    });
    sel.innerHTML = '<option value="">Choose a theme\u2026</option>' +
      opts.map(function (o) {
        var done = mine[o.key];
        return '<option value="' + escapeHtml(o.key) + '"' + (done ? " disabled" : "") +
          ">" + escapeHtml(o.label) + (done ? " \u2014 requested" : "") + "</option>";
      }).join("");
  }

  /* What this player has asked for, each with a way to take it back. */
  function renderMyRequests(d) {
    var box = $("themeMine");
    if (!box) return;
    var mine = (d && d.mine) || [];
    if (!mine.length) { box.innerHTML = ""; return; }
    var label = {};
    ((d && d.options) || []).forEach(function (o) { label[o.key] = o.label; });
    box.className = "theme-mine";
    box.innerHTML = mine.map(function (k) {
      /* A club with no board yet has no label from the server, so the key is
         all there is: "aston-villa" reads as a database row, "Aston Villa"
         reads as the thing the person asked for. */
      var name = label[k] || k.replace(/-/g, " ")
        .replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
      return '<span class="mine-chip">' + escapeHtml(name) +
        '<button class="mine-drop" data-key="' + escapeHtml(k) +
        '" title="Remove this request" aria-label="Remove request for ' +
        escapeHtml(name) + '">\u00D7</button></span>';
    }).join("");
  }

  on("themeMine", "click", function (e) {
    var btn = e.target.closest ? e.target.closest(".mine-drop") : null;
    if (!btn) return;
    var key = btn.getAttribute("data-key");
    apiAuth("/api/theme-request?key=" + encodeURIComponent(key), null, "DELETE")
      .then(function () {
        $("themeRequestMsg").textContent = "Request removed.";
        /* Refetch rather than patch the DOM: the picklist strikes off what you
           have asked for, so removing one has to put it back. */
        loadThemes(true).then(function () { renderThemes(); }).catch(function () {});
      })
      .catch(function (err) { $("themeRequestMsg").textContent = String(err.message || err); });
  });

  var CORE_SLOTS = [
    { slug: "goalkeepers",  label: "Goalkeepers" },
    { slug: "defenders",    label: "Defenders" },
    { slug: "midfielders",  label: "Midfielders" },
    { slug: "strikers",     label: "Strikers" },
    { slug: "captains",     label: "Captains" },
    { slug: "managers",     label: "Managers" },
    { slug: "legends",      label: "Legends" },
    { slug: "rivalries",    label: "Rivalries" },
    { slug: "in-the-cups",  label: "In the Cups" },
    { slug: "europe",       label: "Europe" },
    { slug: "grounds",      label: "Grounds" },
    { slug: "shirts-and-kits", label: "Shirts & Kits" },
    { slug: "1990s",        label: "1990s" },
    { slug: "2000s",        label: "2000s" },
    { slug: "2010s",        label: "2010s" },
    { slug: "2020s",        label: "2020s" },
    { slug: "way-back-when", label: "Way Back When" }
  ];

  /* Specials a club is known to be planning, so the band shows what is coming
     rather than only what has landed. Sourced from the club's own workbook —
     these are agreed categories, not guesses, and a club with no entry here
     simply shows the Specials it has.

     Note the slug for a year: "1989" alone would make theme id "arsenal-1989",
     which the share-link parser reads as theme "arsenal", board 1989, because
     both it and boardOf() are greedy. Any slug ending in bare digits is unsafe,
     so the year lives in the label and the slug carries a word. */
  var SPECIAL_SLOTS = {
    arsenal: [
      { slug: "wenger-era",      label: "Wenger Era" },
      { slug: "wenger-signings", label: "Wenger Signings" },
      { slug: "invincibles",     label: "The Invincibles" },
      { slug: "highbury",        label: "Highbury" },
      { slug: "before-wenger",   label: "Before Wenger" },
      { slug: "after-wenger",    label: "After Wenger" },
      { slug: "1989-title",      label: "1989" },
      { slug: "1971-double",     label: "1971 Double" }
    ]
  };

  /* Whether the "coming soon" chips are on screen.

     Off by default. A club with four live categories was showing twenty-two
     greyed ones, and a page that is mostly grey reads as empty rather than as
     filling up. The chips still matter — they say the category exists and has
     not been written yet, which is the honest answer to "does my club have
     anything" — so they are one tap away rather than gone.

     Session-scoped on purpose: a preference this cheap to set is not worth
     storing, and remembering it across visits means somebody who turned it on
     once to look around sees a wall of grey every visit after. */
  var showSoon = false;

  function renderThemes() {
    var box = $("themeAvailable"), next = $("themeUpcoming");
    if (!box) return;
    box.innerHTML = '<div class="sheet-empty">Loading\u2026</div>';
    loadThemes().then(function (d) {
      /* Filled first, and whatever else is on screen. It sat inside the branch
         that runs only when boards exist, so the moment asking for a theme
         matters most — when there are none — was the one moment the list was
         empty and the button did nothing. */
      fillThemeRequestList(d);
      renderMyRequests(d);
      if (!d.configured || !d.themes.length) {
        box.innerHTML = '<div class="sheet-empty">No themed boards yet.</div>';
        next.innerHTML = '<div class="sheet-empty">Nothing scheduled yet.</div>';
        return;
      }

      var done = themeResults();
      var asked = {};
      (d.mine || []).forEach(function (k) { asked[k] = true; });

      /* Clubs and topics are different things and are drawn differently.
         A club gets the three bands; a topic keeps its numbered boards, because
         Grounds and Nicknames are not clubs and the bands would mean nothing on
         them. A club theme is one whose club is set — the column, not a guess
         from the id. */
      var clubs = {}, clubOrder = [], topics = [];
      d.themes.forEach(function (t) {
        if (!t.club) { topics.push(t); return; }
        if (!clubs[t.club]) { clubs[t.club] = []; clubOrder.push(t.club); }
        clubs[t.club].push(t);
      });

      var html = clubOrder.map(function (c) { return clubBlock(c, clubs[c], done, asked); })
        .concat(topics.map(function (t) { return topicBlock(t, done, asked); }))
        .join("");

      box.innerHTML = html || '<div class="sheet-empty">No themed boards yet.</div>';

      next.innerHTML = d.upcoming.length
        ? d.upcoming.map(function (u) {
            return '<div class="theme-next"><span>' + escapeHtml(u.name) + " #" + u.no +
              '</span><span class="tn-date">' + friendlyDate(u.releaseOn) + "</span></div>";
          }).join("")
        : '<div class="sheet-empty">Nothing scheduled yet.</div>';

    }).catch(function () {
      box.innerHTML = '<div class="sheet-empty">Could not load the themed boards.</div>';
    });
  }

  /* One club, three bands. */
  function clubBlock(club, themes, done, asked) {
    var byId = {};
    themes.forEach(function (t) { byId[t.id] = t; });

    /* The club's display name comes off whichever theme is at hand, with the
       category trimmed. Falls back to the club id so a club always has a name
       even if every theme it owns is named unexpectedly. */
    var name = clubName(themes, club);

    var core = CORE_SLOTS.map(function (slot) {
      var t = byId[club + "-" + slot.slug];
      return t ? liveSlot(t, slot.label, done, asked) : ghostSlot(slot.label);
    }).join("");

    /* Specials the club has, plus the ones its workbook says are coming.
       Matched on exact theme id, same as Core — never by splitting a name. */
    var haveSpecial = {};
    themes.forEach(function (t) { if (t.family === "special") haveSpecial[t.id] = t; });
    var planned = SPECIAL_SLOTS[club] || [];
    var special = planned.map(function (slot) {
      var t = haveSpecial[club + "-" + slot.slug];
      if (t) { delete haveSpecial[t.id]; return liveSlot(t, slot.label, done, asked); }
      return ghostSlot(slot.label);
    }).join("");
    /* Anything special the club has that the planned list does not mention.
       Listed rather than dropped: a board that exists must always be reachable,
       and a missing entry here is a list to update, not a board to hide. */
    Object.keys(haveSpecial).forEach(function (id) {
      special += liveSlot(haveSpecial[id], categoryOf(haveSpecial[id], name), done, asked);
    });

    var general = themes.filter(function (t) { return t.family === "general"; })
      /* Labelled "General", not by the theme's own name: the theme is called
         "Arsenal", and a chip reading "Arsenal 2" under a heading already
         saying ARSENAL says the club twice and the category not at all. */
      .map(function (t) { return liveSlot(t, "General", done, asked); }).join("");

    return '<div class="theme-club">' +
      '<div class="club-name">' + escapeHtml(name) + "</div>" +
      (core ? band("Core", core) : "") +
      (special ? band("Special", special) : "") +
      (general ? band("General", general) : "") +
      "</div>";
  }

  function band(label, inner) {
    return '<div class="theme-band"><div class="band-label">' + label +
      '</div><div class="band-chips">' + inner + "</div></div>";
  }

  /* A category with boards. One button per board, numbered, so a category with
     three boards reads "Strikers 1 2 3" rather than three separate headings. */
  /* One chip per category, not one per board.

     A category with three boards was three buttons reading "Strikers 1",
     "Strikers 2", "Strikers 3", which is the category name three times and a
     row that grows with the content. One chip carrying a count opens a picker
     instead, so the band stays the same width however many boards land.

     A single board opens straight away: a picker offering one choice is a
     second click for nothing. */
  function liveSlot(t, label, done, asked) {
    var name = label || themeShortName(t);
    var played = 0;
    t.boards.forEach(function (b) { if (done[t.id + "-" + b.no]) played++; });
    var flag = asked[t.club] || asked[t.id]
      ? '<span class="theme-asked">You asked for this</span>' : "";

    if (t.boards.length === 1) {
      var b0 = t.boards[0], r0 = done[t.id + "-" + b0.no];
      return '<button class="theme-board' + (r0 ? " played" : "") +
        '" data-theme="' + escapeHtml(t.id) + '" data-no="' + b0.no +
        '" data-id="' + b0.boardId + '">' + escapeHtml(name) +
        (r0 && r0.score != null ? '<span class="tb-score">' + r0.score + "</span>" : "") +
        "</button>" + flag;
    }

    var picks = t.boards.map(function (b) {
      var r = done[t.id + "-" + b.no];
      return '<button class="theme-board pick' + (r ? " played" : "") +
        '" data-theme="' + escapeHtml(t.id) + '" data-no="' + b.no +
        '" data-id="' + b.boardId + '">#' + b.no +
        (r && r.score != null ? '<span class="tb-score">' + r.score + "</span>" : "") +
        "</button>";
    }).join("");

    /* The count says how many boards, and how many are done when some are —
       "2/3" answers "is there anything new here" without opening it. */
    var badge = played && played < t.boards.length
      ? played + "/" + t.boards.length
      : String(t.boards.length);

    return '<span class="cat-wrap">' +
      '<button class="theme-board cat' + (played === t.boards.length ? " played" : "") +
      '" data-cat="' + escapeHtml(t.id) + '" aria-expanded="false">' +
      escapeHtml(name) + '<span class="tb-count">' + badge + "</span></button>" +
      '<span class="cat-picker" data-for="' + escapeHtml(t.id) + '" hidden>' +
      picks + "</span></span>" + flag;
  }

  /* "Arsenal — Wenger Era" -> "Wenger Era". Used when no slot label applies. */
  function themeShortName(t) {
    var parts = String(t.name).split(/\s+[\u2014-]\s+/);
    return parts.length > 1 ? parts.slice(1).join(" \u2014 ") : t.name;
  }

  /* A Core category with nothing behind it yet.

     Greyed rather than hidden. Hiding it tells a supporter their club has
     nothing; greying it says the category exists and has not been written yet,
     which is both truer and kinder. Not a button — there is nothing to open, and
     a disabled button invites the click that does nothing. */
  function ghostSlot(label) {
    if (!showSoon) return "";
    return '<span class="theme-board ghost" aria-disabled="true">' +
      escapeHtml(label) + '<span class="tb-soon">soon</span></span>';
  }

  /* Topics keep numbered boards: they are not clubs and the bands would mean
     nothing on them. This is the original renderer, unchanged. */
  function topicBlock(t, done, asked) {
    var boards = t.boards.map(function (b) {
      var r = done[t.id + "-" + b.no];
      return '<button class="theme-board' + (r ? " played" : "") +
        '" data-theme="' + escapeHtml(t.id) + '" data-no="' + b.no +
        '" data-id="' + b.boardId + '">#' + b.no +
        (r && r.score != null ? '<span class="tb-score">' + r.score + "</span>" : "") +
        "</button>";
    }).join("");
    var flag = asked[t.id] ? '<span class="theme-asked">You asked for this</span>' : "";
    return '<div class="theme-group"><div class="theme-name">' +
      escapeHtml(t.name) + flag + '</div><div class="theme-boards">' + boards + "</div></div>";
  }

  /* "Arsenal — Goalkeepers" -> "Arsenal". Display only: nothing keys on the
     result, so an unexpected name degrades to the club id rather than to
     nothing. */
  function clubName(themes, club) {
    for (var i = 0; i < themes.length; i++) {
      var cut = String(themes[i].name).split(/\s+[\u2014-]\s+/)[0];
      if (cut && cut !== themes[i].name) return cut;
    }
    return themes.length ? themes[0].name : club;
  }

  /* "Arsenal — Wenger Era" -> "Wenger Era", for a Special chip that should not
     repeat the club name it already sits under. */
  function categoryOf(t, clubNameStr) {
    var n = String(t.name);
    var parts = n.split(/\s+[\u2014-]\s+/);
    return parts.length > 1 ? parts.slice(1).join(" \u2014 ") : n.replace(clubNameStr, "").trim() || n;
  }

  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  /* "Fri 2 Oct" rather than an ISO date: this is read at a glance to answer
     "is that soon", and 2026-10-02 makes that a subtraction. */
  function friendlyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return days[d.getUTCDay()] + " " + d.getUTCDate() + " " + mons[d.getUTCMonth()];
  }

  function openThemed(theme, no, id) {
    mode = "theme";
    themeWanted = { theme: theme, no: no, id: id || null };
    themeLabel = "";
    $("themeSheet").classList.remove("show");
    $("homeOverlay").classList.remove("show");
    /* Come back to the same board rather than starting it again. Only when it
       is the same board: the slot holds one themed game, and opening a
       different one legitimately replaces it. */
    var saved = savedFor("theme");
    var same = saved && saved.themeKey === theme + "-" + no && !saved.complete;
    newPuzzle(same ? saved.seed : undefined, same ? saved : null);
  }

  on("homeFeatured", "click", function () {
    if (!featuredBoard) return;
    openThemed(featuredBoard.themeId, featuredBoard.no, featuredBoard.boardId);
  });
  on("homeThemed", "click", function () { renderThemes(); $("themeSheet").classList.add("show"); });
  on("homeThemes", "click", function () { renderThemes(); $("themeSheet").classList.add("show"); });
  /* Scores on one board, for the owner. Reached from the themed list: every
     chip carries its theme and number already, so there is nothing to type.

     Anonymous, because plays are. play_id is random per attempt, so two goes by
     one visitor are indistinguishable from two visitors and there is no name
     to show. This answers how a board plays — how many finish, what they score,
     how much help they need — not who played it. Names live in the challenge
     tables, where somebody typed one on purpose. */
  function showBoardScores(theme, no) {
    apiAuth("/api/admin/board-scores?theme=" + encodeURIComponent(theme) + "&no=" + no)
      .then(function (d) {
        if (!d.rows || !d.rows.length) {
          adminMsg("No attempts at " + theme + " #" + no + " yet.");
          $("adminReportList").innerHTML = "";
          return;
        }
        adminMsg(theme + " #" + no + " \u2014 " + d.started + " started, " +
          d.finished + " finished" +
          (d.median != null ? ", median " + d.median : "") +
          (d.mine ? " (" + d.mine + " of yours, excluded)" : ""));
        $("adminReportList").innerHTML =
          '<table class="status-table"><tbody>' +
          d.rows.slice(0, 50).map(function (r) {
            var help = (r.srv_checks || 0) + (r.srv_check_alls || 0) +
              (r.srv_reveal_letters || 0) + (r.srv_reveal_answers || 0);
            return "<tr><td>" + (r.completed
                ? (r.score == null ? "\u2014" : r.score)
                : r.solved + "/" + r.total) +
              "</td><td>" + (r.secs ? fmt(r.secs) : "\u2014") +
              "</td><td>" + (help ? help + " help" : "") +
              "</td><td>" + (r.by_owner ? "you" : "") +
              "</td></tr>";
          }).join("") + "</tbody></table>";
      }).catch(function (e) {
        adminMsg("Could not load scores: " + (e && e.message || ""));
      });
  }

  /* Board of the day, set by hand.

     Dated rather than a single "current" setting, so it lapses on its own: a
     one-row override has to be cleared by hand, and forgetting leaves the same
     board featured for a fortnight while everybody assumes the cycle has it.
     Setting a date in the future is the point — a board worth pointing at
     usually coincides with something happening that day. */
  on("adminFeatured", "click", function () {
    apiAuth("/api/admin/featured").then(function (d) {
      var rows = (d.set || []).map(function (r) {
        var when = r.on_date === d.today ? "today" : escapeHtml(r.on_date);
        return '<tr><td>' + when + "</td><td>" +
          escapeHtml(r.name) + " #" + r.board_no +
          '</td><td><button class="btn tiny" data-clear="' + escapeHtml(r.on_date) +
          '">clear</button></td></tr>';
      }).join("");
      var opts = (d.boards || []).map(function (b) {
        return '<option value="' + b.id + '">' + escapeHtml(b.name) + " #" + b.board_no +
          "</option>";
      }).join("");
      adminMsg("Set for a date. It lapses on its own \u2014 after that day the cycle resumes.");
      $("adminReportList").innerHTML =
        '<table class="status-table"><tbody>' +
        (rows || '<tr><td colspan="3">Nothing set. The cycle is choosing.</td></tr>') +
        "</tbody></table>" +
        '<div class="admin-row" id="afRow">' +
        '<input id="afDate" type="date" value="' + escapeHtml(d.today) + '">' +
        '<select id="afBoard">' + opts + "</select>" +
        '<button class="btn secondary" id="afSet">Set</button></div>';
    }).catch(function () { adminMsg("Could not load the board of the day."); });
  });

  /* Delegated so it survives the panel being redrawn after each change. */
  on("adminReportList", "click", function (e) {
    var t = e.target;
    if (t.id === "afSet") {
      var date = $("afDate").value, board = $("afBoard").value;
      if (!date || !board) return;
      apiAuth("/api/admin/featured-set", { date: date, boardId: Number(board) })
        .then(function () { $("adminFeatured").click(); })
        .catch(function (err) { adminMsg("Could not set it: " + (err && err.message || "")); });
      return;
    }
    var clear = t.getAttribute && t.getAttribute("data-clear");
    if (clear) {
      apiAuth("/api/admin/featured-set", { date: clear, clear: true })
        .then(function () { $("adminFeatured").click(); })
        .catch(function () {});
    }
  });

  on("ncMeta", "click", function (e) { e.stopPropagation(); toggleJump(); });
  on("jumpList", "click", function (e) {
    var b = e.target.closest ? e.target.closest(".jump-item") : null;
    if (!b) return;
    e.stopPropagation();
    cur.entry = Number(b.getAttribute("data-entry"));
    cur.cell = firstEmptyCell(cur.entry);
    closeJump();
    updateSelection();
    startTimer();
  });
  /* Anything else closes it. A list left open over the board is a list covering
     the thing it was meant to help with. */
  document.addEventListener("click", closeJump);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeJump();
  });

  on("themeClose", "click", function () { $("themeSheet").classList.remove("show"); });
  on("themeShowSoon", "click", function () {
    showSoon = !showSoon;
    var b = $("themeShowSoon");
    if (b) {
      b.textContent = showSoon ? "Hide coming soon" : "Show coming soon";
      b.setAttribute("aria-pressed", showSoon ? "true" : "false");
    }
    /* Redrawn from the data already held rather than refetched: the flag only
       decides what is drawn, and a round trip to change a local view is a
       spinner for nothing. */
    renderThemes();
  });
  on("themeAvailable", "click", function (e) {
    var b = e.target.closest ? e.target.closest(".theme-board") : null;
    if (!b) return;

    /* A ghost is a span, not a button, so it cannot be clicked — but a stray
       class elsewhere should not open a board with no data on it either. */
    if (b.classList.contains("ghost")) return;

    /* Alt-click opens the board's scores instead of the board. Handled inside
       this listener rather than as a separate capturing one: on() attaches
       without capture and ignores extra arguments, so a second listener would
       have run after this one and opened the board anyway.

       Owner only, and it fails closed — the endpoint checks admin regardless,
       so this is a shortcut rather than the guard. */
    if (e.altKey && b.getAttribute("data-theme") && b.getAttribute("data-no")) {
      e.preventDefault();
      $("themeSheet").classList.remove("show");
      $("adminSheet").classList.add("show");
      showBoardScores(b.getAttribute("data-theme"), Number(b.getAttribute("data-no")));
      return;
    }

    /* A category chip opens its picker rather than a board. Only one picker is
       open at a time: two open lists in one band is the row growing again,
       which is what the chip exists to stop. */
    var cat = b.getAttribute("data-cat");
    if (cat) {
      var box = $("themeAvailable");
      var want = box.querySelector('.cat-picker[data-for="' + cssEscape(cat) + '"]');
      var wasOpen = want && !want.hidden;
      Array.prototype.forEach.call(box.querySelectorAll(".cat-picker"), function (p) {
        p.hidden = true;
      });
      Array.prototype.forEach.call(box.querySelectorAll(".theme-board.cat"), function (c) {
        c.setAttribute("aria-expanded", "false");
      });
      if (want && !wasOpen) {
        want.hidden = false;
        b.setAttribute("aria-expanded", "true");
      }
      return;
    }

    openThemed(b.getAttribute("data-theme"), Number(b.getAttribute("data-no")),
               b.getAttribute("data-id"));
  });

  /* Theme ids are our own slugs, so this only ever has to survive a hyphen —
     but the selector is built from data rather than typed, and quoting it is
     cheaper than trusting that forever. */
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }
  on("themeRequestBtn", "click", function () {
    var sel = $("themeRequestKey"), msg = $("themeRequestMsg");
    if (!sel || !sel.value) { msg.textContent = "Choose a theme first."; return; }
    var label = sel.options[sel.selectedIndex].textContent;
    apiAuth("/api/theme-request", { key: sel.value }).then(function (r) {
      msg.textContent = r.already
        ? "You have already asked for " + label + "."
        : "Noted \u2014 thanks. " + label + " is on the list.";
      /* Refetch and clear the choice: the marker appears now rather than on the
         next visit, the theme just requested is struck off the list, and the
         control is ready for the next one. Requesting several is the normal
         case, not the exception. */
      sel.value = "";
      loadThemes(true).then(function () { renderThemes(); }).catch(function () {});
    }).catch(function (err) {
      /* Sign-in is required, exactly as it is for flagging a clue. Say which
         it is rather than failing silently. */
      msg.textContent = String(err.message || err);
    });
  });

  function showHome() {
    /* Stop anything running. Coming back to the menu must not leave a clock
       ticking on a puzzle nobody is looking at. */
    stopTimer();
    /* Write immediately rather than leaving it to the debounce. Saving is
       deferred 400ms, so letters typed just before pressing Menu were still in
       a pending timer — and the landing screen then read the file without
       them. */
    if (puzzle && started) { clearTimeout(saveT); save(); }
    renderHome();
    $("startOverlay").classList.remove("show");
    $("homeOverlay").classList.add("show");
    document.querySelector(".stage").classList.add("prestart");
  }

  function chooseMode(which) {
    mode = which;
    try { localStorage.setItem("fcw.mode", which); } catch (e) {}
    $("homeOverlay").classList.remove("show");
    if (which === "daily") {
      dailyNo = FCW.dailyNumber();
      var saved = savedFor("daily");
      newPuzzle(saved && saved.dailyNo === dailyNo && saved.seed != null ? saved.seed : FCW.dailySeed(dailyNo),
                saved && saved.dailyNo === dailyNo ? saved : null);
    } else {
      var sp = savedFor("practice");
      if (sp && !sp.complete && sp.seed != null) newPuzzle(sp.seed, sp);
      else newPuzzle();
    }
  }

  on("homeDaily", "click", function () { chooseMode("daily"); });
  on("homePractice", "click", function () {
    /* Suspended, but not for somebody mid-puzzle. Stranding a half-finished
       board to enforce a suspension costs a real player something to save
       nobody anything — and the puzzle is already on their device, so letting
       them finish takes no board off the shelf.

       Shared practice links and /api/practice are untouched: a link somebody
       sent still opens. This closes the front door, not the building. */
    if (inProgress(savedFor("practice"))) { chooseMode("practice"); return; }
    toast("Practice is being rebuilt alongside the new club boards.");
  });
  on("homeSeason", "click", function () { renderStats(); $("statsSheet").classList.add("show"); });
  on("homeAccount", "click", function () { $("accountSheet").classList.add("show"); });
  on("homeSignIn", "click", function () { $("accountSheet").classList.add("show"); });
  on("kickBack", "click", showHome);
  /* From inside a game. Switching modes now goes through the menu rather than
     a button that silently moves you between a scored daily and free practice. */
  on("menuBtn", "click", function () {
    if (mode === "daily" && started && !complete) {
      /* Leaving a daily mid-play stops its clock, exactly as Pause does — the
         alternative is a timer running on a puzzle nobody can see. */
      pauseGame();
      $("pauseOverlay").classList.remove("show");
    }
    showHome();
  });

  /* ---------- Boot: today's daily first; unfinished practice resumes ---------- */
  (function boot() {
    /* Return to whatever was last being played. The old rule resumed practice
       only if letters had been typed *and* today's daily was finished — so
       refreshing on a practice board you had not written in yet dropped you
       onto the daily, and so did refreshing on practice with the daily still
       open. Refreshing should not change what you are playing. */
    /* A shared practice link goes straight to that puzzle. Somebody following
       "beat it" wants the puzzle, not a menu — and the link is the whole point
       of the invitation. */
    /* A themed link names the board in words: /?t=man-united-3. Handled before
       the practice link because the two cannot both be present and this one is
       the readable form somebody was given deliberately. */
    /* A challenge link. Handled before the themed link because a challenge names
       its own board, and the two must not both act. */
    var chLink = /[?&]c=([a-z0-9]{6,16})/.exec(location.search || "");
    if (chLink) {
      openChallenge(chLink[1]);
      return;
    }
    var themed = /[?&]t=([a-z0-9-]+)-(\d+)/.exec(location.search || "");
    if (themed) {
      mode = "theme";
      themeWanted = { theme: themed[1], no: Number(themed[2]), id: null };
      $("homeOverlay").classList.remove("show");
      /* Checked on the way out rather than caught: buildPuzzle() handles its
         own failures — it shows the nudge and resolves — so a .catch() here
         never fires and a link to a board that is not out left the player on a
         dead screen with no way back to the menu. If no puzzle arrived, no
         puzzle arrived. */
      buildPuzzle(null).then(function () {
        if (puzzle) return;
        themeWanted = null; mode = "practice";
        toast("That board is not available", "It may not have been released yet.", "loss");
        showHome();
      });
      return;
    }
    var shared = /[?&]p=(\d+)/.exec(location.search || "");
    if (shared) {
      mode = "practice";
      sharedToken = "practice:" + shared[1];
      $("homeOverlay").classList.remove("show");
      /* Same shape, and the same reason: the .catch() this replaces could not
         fire, so a stale practice link showed an error and nothing else. */
      buildPuzzle(null).then(function () {
        sharedToken = null;
        if (!puzzle) showHome();
      });
      return;
    }
    /* Otherwise, straight to the choice. Guessing which mode somebody wants is
       how the daily's clock ended up running on a game they had not picked. */
    renderHome();
    $("homeOverlay").classList.add("show");
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
