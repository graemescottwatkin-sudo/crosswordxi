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

  /* ---------- Clue wording ----------
     The bank writes whole sentences. Nothing wraps them here.

     There were CLUE_TEMPLATES: twelve categories, two phrasings each, picked by
     seed so wording varied between puzzles. That was written when those twelve
     categories held bare source terms — "Hill Dickinson Stadium" — and needed a
     frame to become a question.

     They are self-contained now, and the frame doubled them:
        "What the side at Nickname of the club that plays at Emirates Stadium
         are known as"

     The reason to remove rather than revert is not that QuickFire needs bare
     clues, though it does. It is that the templates only ever covered twelve
     categories of forty-two — the other thirty already shipped full sentences,
     and the old `if (!fns) return raw + hint` was the majority path. Removing
     the frame makes the bank consistent with itself, and that still holds if
     QuickFire never ships.

     What is lost: the same clue no longer reads two ways between puzzles. That
     was a real property and it applied to under a third of the bank, at the
     price of clues that could not be read outside this game. */
  function clueText(row) {
    /* The " - not " disambiguator needs no special handling now.

       It used to be cut out before templating and re-attached after, because a
       frame wrapped around "the Rovers - not Doncaster" would have read as a
       question about the whole string. With no frame the hint is simply part of
       the sentence, which is where it belonged.

       Worth recording why it was found: the separator was an em-dash, and a
       bank-wide ASCII fold turned it into a hyphen. game.js stopped matching at
       that point and nobody noticed, because a clue that fails to split still
       reads correctly — it just loses the visual break. Both the fold and the
       template removal are now moot for this, and the ASCII rule stands
       unbroken. */
    return String(row.clue || "");
  }



  /* The drawn season's bottom club, minus one.

     NOT used for scoring. It was, and that was a mistake: pickSeason() draws
     from seasonsForClub(), so the season — and therefore the floor — depends on
     the club you picked for flavour. Identical play scored 66 as Aston Villa
     and 76 as Blackpool. The daily is meant to be the same for everyone, and a
     ten-point spread decided by a club badge is not that.

     Kept because placing a player in a table is a table concern and a real one:
     running the clock out should finish last in the season being shown. Where
     that lands is presentation. What the score IS must not depend on it. */
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
  /* Which themed board to fetch, and what the one in play is called. themeLabel
     is what the server said, not something rebuilt here — the name on the board
     and the name in the share message must not be able to drift apart. */
  /* Which daily is wanted, when it is not today's.

     Null means today. A number opens an earlier board from the archive —
     needed because a season is thirty-eight played boards and only one exists
     per day, so anybody arriving late has to be able to reach the ones behind
     them. The server refuses anything after today whatever this says. */
  /* ---------- Which board is in play ----------

     One value, one writer.

     There were six: board.kind, board.no, dailyWanted, board.theme, board.token and
     board.adminDay, each written from a different route and each carrying part of the
     answer. Every reader then had to reassemble it, and they disagreed. Six
     separate faults came out of that — boot(), chooseMode(), syncServerDate(),
     recordDaily(), bootDaily() and showDailyPrompt() each held their own idea of
     what "today" meant, and each was found only after fixing the previous one
     moved the symptom rather than removing it.

       kind     "daily" or "theme"
       no       the daily number, for kind "daily"
       theme    { theme, no, id } for kind "theme"
       openedAsToday  true when this board IS today's daily, false for an
                      archive board. The distinction the six copies kept getting
                      wrong. Derived inside openBoard, never passed in.
       token    a shared practice link
       board.adminDay the owner's preview

     openBoard() is the only thing that writes it. Readers ask board.* for what
     is being played and today() for what day it is; those are different
     questions and conflating them is the whole story above. */
  var board = Object.freeze({ kind: "daily", no: null, theme: null,
                              openedAsToday: false, token: null, adminDay: null });

  function today() { return FCW.dailyNumber(); }

  /* The only writer of `board`, and of the play reference that goes with it.

     Every route that used to set a variable and call newPuzzle() calls this
     instead: chooseMode, bootDaily's replacement, the hero tile, a calendar
     cell, the Full Time prompt, the toolbar, admin preview, openThemed, a
     challenge, a shared link and the boot resume. One place to read when asking
     "what happens when a board opens", and one place a new route has to go
     through.

     `openedAsToday` is the distinction the six scattered copies kept losing: a
     daily can be today's or an earlier one, and almost every bug in this area
     came from code that assumed the first. */
  function openBoard(target, restore) {
    var t = target || {};
    var kind = t.kind || "daily";
    var no = kind === "daily" ? (t.no || today()) : null;
    board = Object.freeze({
      kind: kind,                       // "daily" | "theme" | "practice"
      no: no,
      theme: t.theme || null,
      /* Derived, never passed. A caller that could say it was today with a past
         number would create a board that lies about itself. */
      openedAsToday: kind === "daily" && no === today(),
      token: t.token || null,
      adminDay: t.adminDay || null,
    });

    /* The play reference belongs to a board. Cleared here so a new board cannot
       run on the previous one's row — which it did, because the reset inside
       newPuzzle() covered eleven pieces of state and not these three. A restore
       puts the saved one back, so a refresh mid-puzzle is not a second attempt. */
    if (restore && restore.playId) {
      playId = restore.playId; playNo = restore.playNo || null; playSent = true;
    } else {
      playId = null; playNo = null; playSent = false;
    }

    try { localStorage.setItem("fcw.mode", kind); } catch (e) {}
    setHomeVisible(false);
  }

  /* The one legitimate second writer.

     We always ask by number, so a different number coming back means the server
     refused — a clock ahead of the host's. Adopting it by property assignment
     would be a stray write on a value that is otherwise frozen, so it gets a
     named constructor and the freeze stays meaningful. */
  function adoptServerBoard(no) {
    board = Object.freeze({
      kind: "daily", no: no, theme: null,
      openedAsToday: no === today(),
      token: null, adminDay: board.adminDay,
    });
  }

  /* Which save slot a board owns.

     Keyed by the board, not by the board.kind. One `fcw.v04.daily` slot was shared by
     today's board and every archive board, so opening one overwrote the other —
     and the symptom was a board that came back blank.

     Reads fall back to the old unkeyed slot once, so a game already in progress
     when this shipped is not thrown away. */
  function boardSlot(b) {
    var t = b || board;
    if (t.kind === "theme") {
      var k = t.theme ? (t.theme.theme + "-" + t.theme.no) : "none";
      return "fcw.v04.theme." + k;
    }
    return "fcw.v04.daily." + (t.no || today());
  }

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
  var cellEls = {};
  var seasonErrors = FCW.loadSeasons(FCW_SEASONS);
  // Answer-repetition control for the Daily. If the table is missing or a day
  // falls outside it, dailyBans() returns null and the Daily plays as before.
  /* The build this file came from. Visible in the footer and on the console, so
     "is the new version actually live?" is a question with an answer. */
  var BUILD = "v146";
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
  var randomPick = null;     // season chosen alongside the club in Random board.kind
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
    elapsed++; renderClock();
    /* Written straight through once a second, not through the 400ms debounce.

       saveSoon() cancels the pending write each time it is called, and this is
       called every second — so the write was always 400ms away and never
       arrived. Refresh and the clock came back at the last value that happened
       to be saved by something else, which meant holding Ctrl+R froze it.

       The verified score was never affected: /api/finish computes elapsed from
       started_at in the database, on the server's clock. But a clock that lies
       about a score which is genuinely falling is its own problem. */
    if (elapsed % 5 === 0) { clearTimeout(saveT); save(); } else { saveSoon(); }
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

  /* Which slot a board.kind owns. Three modes, three slots: a themed board is a real
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

  /* Kept as the name everything calls, now answered by the board rather than
     the board.kind. Practice is gone as a board.kind; the slot name survives for saves
     written before it was. */
  function slotKey(m) {
    if (m === "practice") return "fcw.v04.practice";
    return boardSlot(board);
  }



  function save() {
    /* Given up, either to another tab or to a reset in progress. */
    if (saveBlocked) return;
    /* Nothing is loaded, so there is nothing to write. This is not a
       theoretical case: the landing screen's club control calls saveSoon()
       through applyClubChoice(), and on that screen no puzzle has been built.
       The write that produced was a complete, well-formed, entirely empty
       record — letters {}, elapsed 0 — landing on top of a game in progress.
       Worse, `board.kind` resets to "daily" on every load (fcw.mode is written and
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
       Deliberately not conditioned on board.kind or on how the empty board arose,
       because every way of arriving at one has the same wrong answer. */
    var fresh = !Object.keys(letters).length && !elapsed && !complete;
    if (fresh) {
      var prev = null;
      try { prev = JSON.parse(localStorage.getItem(
        slotKey(board.kind))); } catch (e) {}
      if (prev && !prev.complete &&
          (Object.keys(prev.letters || {}).length || prev.elapsed)) return;
    }
    try {
      // Which mode is in play, so a refresh comes back to the same game.
      localStorage.setItem("fcw.mode", board.kind);
      localStorage.setItem(slotKey(board.kind), JSON.stringify({
        mode: board.kind, dailyNo: board.no,
        seed: seed, token: puzzleToken, letters: letters,
        fingerprint: puzzleFingerprint(puzzle),
        /* Wall-clock, so a reload can be charged for the time it took.

           `elapsed` counts ticks, and a tick only happens while the page is
           open — so seconds spent reloading were never counted, and holding
           Ctrl+R stopped the clock outright. The rule the game states is that
           the clock does not pause and closing the tab does not stop it; this
           is what makes that true of the display as well as the score. */
        savedAt: Date.now(),
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
        themeKey: board.theme && board.theme.theme
          ? board.theme.theme + "-" + board.theme.no : null
      }));
    } catch (e) { /* storage unavailable — play without persistence */ }
  }
  /* Reads a board's slot.

     A fallback to the old unkeyed fcw.v04.daily lived here so a game in
     progress survived the move to per-board slots. Deleted: it costs one
     in-progress board for whoever is mid-puzzle at deploy, and there are no
     players yet. The dead key is in WIPE_KEYS so it clears.  */
  function readSlot(which, forBoard) {
    var b = forBoard || board;
    try { return JSON.parse(localStorage.getItem(boardSlot(b))); } catch (e) { return null; }
  }
  function loadSaved(which) { return readSlot(which); }

  var DAILY_PREFIX = "fcw.v04.daily.";

  /* Every unfinished daily, on any board.

     Walked back from today to 1 before, which is correct and reads 300 keys at
     boot. A prefix scan reads only the slots that exist, and collecting all of
     them rather than the first lets boot tell the difference between "resume
     this" and "you have three going" — one resumes, several go to the landing
     screen with the count. */
  function unfinishedDailies() {
    var out = [];
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(DAILY_PREFIX) !== 0) return;
        var raw = null;
        try { raw = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
        if (raw && !raw.complete && inProgress(raw)) out.push(raw);
      });
    } catch (e) {}
    return out.sort(function (a, b) { return (b.dailyNo || 0) - (a.dailyNo || 0); });
  }

  /* Finished slots accumulate one a day forever. Once a result is recorded the
     save has nothing left to say, so it goes. */
  function pruneDailySlot(no) {
    try { localStorage.removeItem(DAILY_PREFIX + no); } catch (e) {}
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
    if (board.kind !== "practice") { el.textContent = ""; return; }
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
      /* A daily token names its own board. Resuming an archive board has to ask
         for that number, not for today — otherwise reopening a half-finished
         board from last week silently swaps it for today's. */
      var rt = /^daily:(\d+)$/.exec(t);
      return api("/api/daily" + (rt ? "?no=" + rt[1] : ""));
    }
    if (board.token) return api("/api/practice?token=" + encodeURIComponent(board.token));
    if (board.adminDay) return api("/api/admin/daily?n=" + board.adminDay);
    if (board.kind === "daily") {
      /* Always explicit. "No parameter means today" is the server's own second
         definition of today, and relying on it meant the browser and the server
         could disagree about which board this is — which is exactly what
         happened whenever dailyWanted was left set from a previous board. */
      return api("/api/daily?no=" + (board.no || today()));
    }
    if (board.kind === "theme") {
      return api(board.theme && board.theme.id
        ? "/api/theme-board?id=" + encodeURIComponent(board.theme.id)
        : "/api/theme-board?theme=" + encodeURIComponent(board.theme.theme) +
          "&no=" + encodeURIComponent(board.theme.no));
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
      /* The server decides which daily this is. It should already agree —
         requestPuzzle now always asks by number — but the server owns the
         calendar, so its answer wins and `board` is updated rather than a
         separate variable drifting from it. */
      if (res.mode === "daily" && res.dailyNo && res.dailyNo !== board.no) {
        /* Different number back means the server refused ours — a clock ahead
           of the host's. Named constructor, not a property write: board is
           frozen so a stray assignment throws rather than drifting. */
        adoptServerBoard(res.dailyNo);
      }
      if (res.mode === "theme") {
        themeLabel = res.label || "";
        openBoard({ kind: "theme",
                    theme: { id: res.token ? res.token.slice(6) : null,
                             theme: res.themeId, no: res.boardNo } });
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
    /* The board's own date, on the board.

       Without it there is nothing on screen saying WHICH daily this is — and
       now that earlier ones are playable, "Today's puzzle" is often not today's
       at all. Somebody four boards into the archive has no way to tell one from
       another.

       The date rather than the number: a number that only counts up tells a
       newcomer they are late, and the date is what the calendar they came from
       was showing. */
    $("strapText").innerHTML = board.kind === "daily"
      ? escapeHtml(FCW.dailyPhase(board.no).label) + " &middot; " +
        escapeHtml(FCW.dailyDate(board.no).toLocaleDateString(undefined,
          { weekday: "short", day: "numeric", month: "short" }))
      : (board.kind === "theme" && themeLabel
          ? "Club or theme &middot; " + escapeHtml(themeLabel)
          : "Training");
    $("dailyBtn").style.display = board.kind === "daily" ? "none" : "";
    document.title = board.kind === "daily"
      ? FCW.dailyPhase(board.no).label + " \u00B7 Crossword XI"
      : (board.kind === "theme" && themeLabel
          ? themeLabel + " \u00B7 Crossword XI"
          : "Practice \u00B7 Crossword XI");
    letters = {}; wrong = {}; revealedEntries = {}; revealedCells = {}; revealAnswerCells = {};
    pauseCount = 0; pausedMs = 0; pauseStartedAt = null;
    subbedCells = {}; subsUsed = 0;
    checksUsed = 0; checkAllsUsed = 0; elapsed = 0; complete = false;
    helpActions = []; consecutiveChecks = 0; halfTimeShown = false; lastPos = null;
    /* The play reference belongs to a board, not to the tab.

       These were never cleared: playStart() only mints a new one when playId is
       null, and only the restore branch below set it. So finishing the daily
       and opening an archive board ran the new board on the OLD board's play
       row — /api/finish answered `already: true` with the daily's score and no
       breakdown, recordDaily rewrote the archive result with the daily's
       number, and a challenge started after any other board was refused as a
       duplicate entry.

       Cleared here, with the rest of the per-board state. The restore branch
       still puts back the saved one, which is what keeps a refresh mid-puzzle
       from counting as a second attempt. */
    playId = null; playNo = null; playSent = false;
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
      /* Charge the gap since the save. Only for a game that was still running:
         a finished board has nothing left to run, and a paused one is paused.
         Capped at an hour so a board reopened next week does not arrive with a
         nonsense number — past full time the score has stopped falling anyway. */
      if (!restore.complete && restore.savedAt) {
        var away = Math.round((Date.now() - restore.savedAt) / 1000);
        if (away > 0) elapsed += Math.min(away, 3600);
      }
      /* A finished board comes back finished.

         `complete` resets when a board loads and was only ever set by finishing
         one, so reopening a completed puzzle left the flag false. Delete a
         letter and put it back and checkComplete() ran the whole Full Time path
         a second time: another /api/finish, another recorded result, another
         Full Time screen — with the breakdown missing, which is where the
         NaN:aN in the time row came from.

         Restoring the flag stops all of it. The screen is still reachable
         through the normal route; what is prevented is finishing twice. */
      complete = !!restore.complete;
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
      $("kickMode").textContent = board.kind === "daily"
        ? FCW.dailyPhase(board.no).label : "Practice puzzle";
      syncKickSelect();
      // Topic filters belong to Practice: the Daily is the same for everyone.
      $("filterBox").style.display = board.kind === "practice" ? "" : "none";
      $("kickNote").textContent = board.kind === "daily"
        ? "Today's puzzle, the same for everyone. The clock starts at kick-off."
        : "The clock starts at kick-off.";
      if (board.kind === "practice") renderFilters(); else $("kickOffBtn").disabled = false;
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
     alone; choosing topics in Daily board.kind would fork the shared puzzle. */
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
    return board.kind === "practice" && FCW.LEVELS[filterOn.level]
      ? filterOn.level : FCW.DEFAULT_LEVEL;
  }
  /* Help costs match minutes, charged here so the four call sites cannot
     drift. Converted to real seconds because that is what `elapsed` counts.

     This is what makes help cost SCORE. Subs decide the result; the clock
     decides the number — and pushes you toward full time, which is itself a
     draw, so help late is riskier than help early. */
  function chargeHelp(kind) {
    var mins = FCW.SCORING.HELP_MINUTES[kind] || 0;
    if (!mins) return;
    var perMin = FCW.SCORING.MATCH_CLOCK_REAL_SECONDS / FCW.SCORING.MATCH_CLOCK_MAX_MINUTES;
    elapsed += Math.round(mins * perMin);
    renderClock(); updateScoreUI();
    clearTimeout(saveT); save();
  }

  /* Subs spent so far on THIS board, from the counters already kept. */
  function subsSpentNow() {
    return revealedLetterCount() * FCW.SCORING.SUBS_PER_LETTER +
           revealedAnswerCount() * FCW.SCORING.SUBS_PER_ANSWER;
  }
  function subsRemainingNow() {
    return Math.max(0, FCW.SCORING.SUBS_PER_BOARD - subsSpentNow());
  }
  /* Would this help exceed the allocation, turning the day into a draw?
     Already exceeded means the answer is no — it cannot get worse. */
  function wouldExceed(cost) {
    if (subsSpentNow() > FCW.SCORING.SUBS_PER_BOARD) return false;
    return subsSpentNow() + cost > FCW.SCORING.SUBS_PER_BOARD;
  }

  /* Confirm only where the allocation would be exceeded. Returns false if the
     player backs out. */
  function confirmSubCost(cost, what) {
    /* One accepted cost covers the whole lot: Reveal everything already asked,
       with the real arithmetic, before any of this started. */
    if (bulkReveal) return true;
    if (!wouldExceed(cost)) return true;
    var left = subsRemainingNow();
    return window.confirm(
      "Revealing " + what + " uses " + cost +
      (cost === 1 ? " substitution" : " substitutions") +
      " and you have " + left + " left.\n\n" +
      "That takes you past your three, so today becomes a draw however you " +
      "finish. The score still counts.\n\nGo ahead?");
  }

  function subsAllowance() {
    return board.kind === "practice" ? FCW.LEVELS[currentLevel()].subs : 0;
  }
  function activeFilter() {
    // Pre-1990 is opt-in. With no explicit selection — and always on the Daily —
    // the default era set applies, keeping the game modern without archiving
    // the older clues out of existence.
    if (board.kind !== "practice") return FCW.dailyFilter(board.no || FCW.dailyNumber());
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
    return (board.kind === "practice" && filterOn.groups && filterOn.groups.length)
      ? filterOn.groups[0] : null;
  }
  function activeFilterPreview() { return activeFilter(); }
  on("filterToggle", "click", function () {
    $("filterBody").classList.toggle("show");
  });

  function kickOff() {
    // Topics are chosen on this card, after the grid was generated, so rebuild
    // before starting if the selection has changed.
    if (board.kind === "practice" && JSON.stringify(activeFilter()) !== builtFilter) {
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

  /* ============ FLEX LAYOUT ============
     Opt-in. The board sits in a frame and pans and zooms inside it, instead of
     being shrunk until it fits above the keyboard.

     Everything below is guarded on flexOn, and fitCells() hands over at its
     first line — so the classic path is not merely unused here, it does not
     run. A sizing function still computing a cell size nothing reads is the
     kind of thing that comes back later looking like a bug. */
  var flexOn = false;
  var fxScale = 1, fxTx = 0, fxTy = 0, fxFit = 1, fxMin = 1;
  var FX_MAX = 3.2, FX_BASE = 34;      // px per cell before scaling

  function fxUsedBox() {
    /* The rectangle the white squares occupy, not the whole grid. Blocked
       squares are transparent — the turf shows through them — so rows and
       columns of solid block at the edges are empty space, and fitting them as
       though they were board costs real cell size. */
    var minX = puzzle.width, maxX = -1, minY = puzzle.height, maxY = -1;
    for (var k in puzzle.cells) {
      var p = k.split(","), x = +p[0], y = +p[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
  }
  function fxApply() {
    var g = $("grid");
    if (!g) return;
    g.style.transform = "translate(" + fxTx + "px," + fxTy + "px) scale(" + fxScale + ")";
    var zi = $("fxIn"), zo = $("fxOut");
    if (zi) zi.disabled = fxScale >= FX_MAX - 0.01;
    if (zo) zo.disabled = fxScale <= fxMin + 0.01;
  }
  function fxClamp() {
    var wrap = document.querySelector(".grid-wrap");
    if (!wrap || !puzzle) return;
    var u = fxUsedBox();
    var fw = wrap.clientWidth, fh = wrap.clientHeight;
    var w = u.cols * FX_BASE * fxScale, h = u.rows * FX_BASE * fxScale;
    var ox = u.x * FX_BASE * fxScale, oy = u.y * FX_BASE * fxScale;
    fxTx = w <= fw ? (fw - w) / 2 - ox : Math.min(-ox, Math.max(-ox + (fw - w), fxTx));
    fxTy = h <= fh ? (fh - h) / 2 - oy : Math.min(-oy, Math.max(-oy + (fh - h), fxTy));
  }
  function fxDoFit(fitMode) {
    var wrap = document.querySelector(".grid-wrap");
    if (!wrap || !puzzle) return;
    var fw = wrap.clientWidth, fh = wrap.clientHeight;
    if (!fw || !fh) return;            // measured before layout; a later call will
    var u = fxUsedBox();
    /* A little turf around the puzzle. Fitted flush the outer squares sit hard
       against the frame edge and the board reads as cropped, and on a phone
       that edge is where the thumb rests. */
    var aw = Math.max(40, fw - 12), ah = Math.max(40, fh - 12);
    var w = u.cols * FX_BASE, h = u.rows * FX_BASE;
    fxFit = fitMode === "whole" ? Math.min(aw / w, ah / h) : aw / w;
    fxMin = Math.min(fxFit, Math.min(aw / w, ah / h));
    fxScale = fxFit; fxTx = 0; fxTy = 0;
    fxClamp(); fxApply();
  }
  /* Three ways for the board to sit.

     manual  the board stays where you put it
     board   fitted whole, every white square in the frame
     word    the active answer is kept framed as you move between clues

     "word" does not literally fit each answer. An eight-letter across entry
     wants about 1.4x and a nine-letter down entry is tall and narrow, so the
     height binds and it barely zooms — moving between them would zoom in and
     out on every clue. It holds a comfortable magnification instead and only
     moves the board when the answer is not already in view, which is the thing
     the board.kind is actually for: never losing the word you are typing into. */
  /* Follow word on a phone, whole board on anything bigger.

     On a phone the clue lists are gone and the board is the only thing on
     screen, so keeping the answer being typed framed is what the board.kind is for.
     On a tablet or a laptop the lists are beside the board and there is room to
     see all of it, so the whole board is the better resting state.

     Overridden by whatever was last chosen, so this is a first-run default and
     not a rule. */
  /* The whole board, everywhere, until somebody asks for otherwise.

     Phones defaulted to Follow word, which since the modes were coupled also
     hides everything except the answer being typed. That is a good way to solve
     and a bad way to arrive: most people reach this from a link somebody sent
     them, and a first screen showing one word does not tell them they have a
     crossword. Show them the thing, let them narrow it.

     A first-run default, not a rule — whatever was last chosen still wins. */
  var fxMode = "board";
  var FX_WORD_K = 1.6;               // magnification held in word board.kind

  function fxWordBox() {
    var e = puzzle && puzzle.entries[cur.entry];
    if (!e) return null;
    var minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    e.cells.forEach(function (c) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    });
    return { x: minX, y: minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
  }
  /* Fit the answer to its own axis, and centre it on the other.

     A down answer fills the frame top to bottom and sits centred left to
     right; an across answer fills it left to right and sits centred top to
     bottom. So the word being typed is always as large as it can be and always
     in the same place, whichever way it runs.

     The zoom therefore changes between clues — a nine-letter down entry and an
     eight-letter across entry want different magnifications, and moving
     between them will visibly rescale. That is the cost of the board.kind and it is
     the point of it: predictable placement in exchange for a changing zoom.

     One limit, and it only bites on very short answers. Filling 393px with
     four letters means 98px squares, which is wall tiles rather than a
     crossword, so the cell is capped at 92px. Everything from five letters up
     fills its axis exactly; a three or four letter answer is centred at the cap
     instead. */
  var FX_CELL_MAX = 92;

  function fxFollow() {
    if (!flexOn || fxMode !== "word" || !puzzle) return;
    var wrap = document.querySelector(".grid-wrap");
    var b = fxWordBox();
    if (!wrap || !b) return;
    var fw = wrap.clientWidth, fh = wrap.clientHeight;
    if (!fw || !fh) return;

    var e = puzzle.entries[cur.entry];
    var across = e.dir === A;
    var pad = 10;

    /* Along its own axis the answer fills the frame; across the other it takes
       whatever that scale gives it. */
    var along = across ? (fw - pad * 2) / (b.cols * FX_BASE)
                       : (fh - pad * 2) / (b.rows * FX_BASE);
    var k = Math.min(along, FX_MAX, FX_CELL_MAX / FX_BASE);
    k = Math.max(fxMin, k);
    fxScale = k;

    var cw = b.cols * FX_BASE * k, ch = b.rows * FX_BASE * k;
    var ox = b.x * FX_BASE * k, oy = b.y * FX_BASE * k;

    /* Centre on both axes. On the filled axis that lands it at the padding by
       construction; on the other it puts the answer's line through the middle
       of the frame, which is where the eye already is. */
    fxTx = (fw - cw) / 2 - ox;
    fxTy = (fh - ch) / 2 - oy;

    /* Deliberately not clamped to the board's edges. An answer on the top row
       centred vertically needs the board to hang past the frame, and clamping
       it back would put the word off centre — which is the one thing this board.kind
       is for. */
    fxApply();
  }

  /* Below this the frame is not a board, whatever the zoom does with it.

     render_test measured 20px of frame at 568x320 and 54px at 844x390: the
     header, the toolbar, the letter bank, the clue card and the keyboard
     between them take the whole screen in landscape, leaving a slot the board
     cannot be panned around inside. Two of those viewports also put the square
     being typed into outside the visible frame, which is worse than a small
     board — it is typing into something you cannot see. */
  var FX_MIN_FRAME = 150;

  function fitFlex() {
    var g = $("grid");
    if (!g || !puzzle) return;
    var wrap = document.querySelector(".grid-wrap");
    var fh = wrap ? wrap.clientHeight : 0;
    var vw = window.innerWidth || 360;
    var vv = window.visualViewport;
    var vh = (vv && vv.height) || window.innerHeight || 800;

    /* The rotate prompt lived in the classic half of fitCells(), which this
       returns before ever reaching — so in the flex layout nothing told a
       landscape player to turn the phone.

       Judged on the cell it would produce, not on the frame height. A 160px
       frame cleared a 150px floor at 915x412 and drew a 6.9px cell: the frame
       was tall enough by the number and the board was unreadable, which is the
       wrong question answered correctly. Eighteen pixels is the same floor the
       classic layout used — below it a letter and a clue number do not fit. */
    var wrapW = wrap ? wrap.clientWidth : 0;
    if (fh > 0 && wrapW > 0) {
      var u = fxUsedBox();
      var whole = Math.min((wrapW - 12) / (u.cols * FX_BASE),
                           (fh - 12) / (u.rows * FX_BASE));
      setRotatePrompt(FX_BASE * whole < 18 && vw > vh);
    }

    document.documentElement.style.setProperty("--cell", FX_BASE + "px");
    g.style.gridTemplateColumns = "repeat(" + puzzle.width + ", var(--cell))";
    /* A fresh puzzle starts in whatever board.kind was left, so the board does not
       silently revert to fitted after every clue change. */
    if (fxMode === "word") { fxDoFit("whole"); fxFollow(); }
    else fxDoFit(fxMode === "manual" ? "width" : "whole");
  }

  function fitCells() {
    /* The whole of the classic sizing below is skipped in the flex layout. */
    if (flexOn) { fitFlex(); return; }
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
    /* In rail board.kind the toolbar is beside the board, not above it. Counting its
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
        '<span class="cl-text">' + escapeHtml(clueText(e.row)) +
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
    /* Called here rather than from each of the half-dozen places that change
       the clue — stepClue, the jump list, a tap on a square, auto-advance —
       because every one of them ends up here. One hook instead of six that can
       drift apart. */
    if (typeof fxFollow === "function") fxFollow();
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
      var on = i === cur.entry;
      li.classList.toggle("active", on);
      li.classList.toggle("done", entryFilled(i));
      /* Bring the selected clue into view in the side panel.

         Deliberately not done in the classic layout, and the note further down
         says why: there the clue list sits BELOW the board, so revealing an
         item in it scrolls the page and the crossword appears to jump. In the
         flex layout the list is in its own scrolling panel beside the board, so
         moving it moves nothing else — and a highlight two scrolls down the
         panel is no highlight at all.

         nearest, not center: the panel moves only when the clue is actually off
         it, so a clue already visible does not shuffle under the eye on every
         letter typed. */
      if (on && flexOn && li.scrollIntoView) {
        var panel = li.closest(".clues-block");
        if (panel && panel.scrollHeight > panel.clientHeight) {
          try { li.scrollIntoView({ block: "nearest" }); } catch (e) {}
        }
      }
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
    var text = clueText(e.row);
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
    /* The toolbar control and the Full Time offer follow the same state, from
       here — the one place that already knows whether there is an account.

       The toolbar shows either. Signed in it is the name, which is worth having
       on screen: it answers "am I saving this?" without opening anything, and
       it is how somebody notices they are signed in as the wrong person on a
       shared device. Signed out it is the way in.

       Hidden entirely when accounts are not configured, because offering a
       sign-in that cannot happen is worse than not offering one. */
    var who = $("tbSignIn"), label = $("tbSignInLabel");
    if (who) {
      who.style.display = (account || accountsAvailable) ? "" : "none";
      who.classList.toggle("signed-in", !!account);
      if (label) {
        /* accountName() already falls back to the part of the email before the
           @, so a signed-in player always has something to be called. */
        label.textContent = account
          ? (accountName() || "Account")
          : "Log in / register";
      }
      who.title = account ? "Your account" : "Save your results across devices";
    }
    if ($("resSignIn")) {
      $("resSignIn").style.display = (!account && accountsAvailable) ? "" : "none";
    }
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
    seasonTestLabel();
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
    /* Push first, then pull. Order matters: migrate writes this device's rows
       to the account, and the pull then brings back everything the account has
       from anywhere — including what was just pushed. The other way round would
       fetch, merge, and then push rows the account already had. */
    apiAuth("/api/account/migrate", guestPayload()).then(function (m) {
      pullAccountResults();
      var note = $("acctMigrated");
      if (!note) return;
      if (m.added) {
        note.textContent = m.added + (m.added === 1 ? " result" : " results") +
          " from this device saved to your account.";
      /* phase name, not `counts`: that is false for BOTH "preseason" and
         "daily", so from board #11 this claimed a friendly forever. */
      } else if (FCW.dailyPhase(FCW.dailyNumber()).phase === "preseason") {
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
    renderDeviceCode();
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
    /* Every load, not only on sign-in.

       The pull was first hung off migrate, which runs once when a guest signs
       in — so somebody already signed in, opening the site on a second device,
       never fetched anything and saw an empty history. That is precisely the
       case this was built for. Here it runs whenever a session exists, which
       is every visit on every device. */
    if (account) pullAccountResults();
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

    /* ?r=a1 — a short alias for a campaign tag.

       utm_source=reddit&utm_campaign=arsenal-match-thread is fifty characters
       of machinery hanging off a link somebody is deciding whether to click,
       and a long ugly URL is one people skip. A two-character code does the
       same job: it groups the arrivals from one post, and it is opaque to
       whoever reads it.

       It fills the campaign field, with the source marked "ref" so a short-link
       arrival is distinguishable from a tagged one. What a1 meant is a note you
       keep, not something the site needs to know — a lookup table here would be
       a second place to maintain for no gain.

       An explicit utm_campaign still wins: this is the shorthand, not a
       replacement. */
    var short = slugify(q.get("r"));
    if (short && !fresh.utm_campaign) {
      fresh.utm_campaign = short;
      if (!fresh.utm_source) fresh.utm_source = "ref";
      any = true;
    }
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
    var phase = board.kind === "daily" ? FCW.dailyPhase(board.no).phase : null;
    fetch("/api/play", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "start", playId: playId, mode: board.kind,
        dailyNo: board.kind === "daily" ? board.no : null, phase: phase,
        /* Which board, when it is a themed one. Still nothing about the
           person: the play id is random per attempt, as it was. */
        themeKey: board.kind === "theme" && board.theme && board.theme.theme
          ? board.theme.theme + "-" + board.theme.no : null,
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
    var payload = JSON.stringify({ event: "end", playId: playId, mode: board.kind,
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
    var mine = slotKey(board.kind);
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
    $("adminSheet").classList.remove("show");
    /* Through openBoard like every other route. It assigned `board` directly,
       which is a second writer — and a second writer is how the six variables
       this replaced got out of step in the first place. */
    openBoard({ kind: "daily", no: n, adminDay: n });
    /* A daily token returns today's puzzle by design — the server refuses to
       serve another day, and that guard is what stops anyone reading tomorrow's
       answers. So this goes through an admin-only route instead of weakening
       it. */
    buildPuzzle(null).then(function () {
      /* The preview flag is spent: reopened without it so a later request does
         not go back to the admin route. */
      openBoard({ kind: "daily", no: n });
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
    var no = board.no;
    apiAuth("/api/admin/replay-day", { dailyNo: no }).then(function () {
      /* Stop writing before clearing. location.reload() does not halt this
         page — the browser goes off to fetch the document while everything
         here keeps running — so without this the clock-save interval could
         land after the removeItem below and put the record straight back. */
      standDown();
      try {
        // The saved game, and this day's entry in the local history.
        localStorage.removeItem(slotKey(board.kind));
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
      /* Say the period. "50 finished" with no window is a number nobody can
         act on — it could be today's post or a month of drift. */
      var window = d.hours
        ? (d.hours === 24 ? "last 24 hours"
           : d.hours % 24 === 0 ? "last " + (d.hours / 24) + " days"
           : "last " + d.hours + " hours")
        : "recent plays";
      if (!d.days.length) {
        adminMsg("No visitors have played in the " + window + "." + mine);
        return;
      }
      $("adminReportList").innerHTML = "";
      adminMsg("How far players got \u2014 " + window +
        ". The CSV covers everything." + mine);
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
          /* Asked for, not recomputed. This worked out the matchday itself from
             PRESEASON_DAYS, which was right while the season began the day
             pre-season ended and wrong the moment it did not. dailyPhase()
             already knows, and there is now a third phase it would not have
             produced a label for at all. */
          name = FCW.dailyPhase(x.dailyNo).label;
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
    var pickedBoard = $("linkBoard").value;
    var q = new URLSearchParams();
    q.set("utm_source", slugify($("linkSource").value));
    q.set("utm_medium", "social");
    q.set("utm_campaign", slugify($("linkCampaign").value));
    var content = slugify($("linkContent").value);
    if (content) q.set("utm_content", content);
    var url = SHARE_URL + "/" + (pickedBoard ? "?t=" + pickedBoard + "&" : "?") + q.toString();
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

  /* Try a season before starting one, on this device.

     Not a gate: engine.js runs in the browser, so the override is reachable by
     anyone who looks. What it can do is small — the phase decides labels and
     whether this browser's own table counts, and the server has no notion of
     phases at all. Somebody who found it would see "Matchday 1" early on their
     own screen and nothing would follow from it.

     Starts at tomorrow's daily rather than today's, so the first matchday is
     one puzzle away instead of retroactively renaming what has been played. */
  function seasonTestLabel() {
    var b = $("adminSeasonTest");
    if (!b) return;
    var v = null;
    try { v = localStorage.getItem("fcw.seasonStart"); } catch (e) {}
    b.textContent = v ? "Season test: from daily #" + v : "Season test: off";
  }
  on("adminSeasonTest", "click", function () {
    var v = null;
    try { v = localStorage.getItem("fcw.seasonStart"); } catch (e) {}
    try {
      if (v) {
        localStorage.removeItem("fcw.seasonStart");
        adminMsg("Season test off. Labels are back to Daily #n.");
      } else {
        var from = FCW.dailyNumber() + 1;
        localStorage.setItem("fcw.seasonStart", String(from));
        adminMsg("Season test on from daily #" + from + " \u2014 tomorrow is Matchday 1. " +
          "This device only. Results recorded while it is on carry phase " +
          "\"season\", so turn it off before playing a daily you want recorded " +
          "honestly.");
      }
    } catch (e) { adminMsg("Could not write the setting."); }
    seasonTestLabel();
    /* Guarded: these throw without a puzzle loaded, and an exception here would
       skip the label and leave the button lying about the state. */
    try { renderHome(); } catch (e) {}
    try { renderStreak(); } catch (e) {}
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
    $("flagClueText").textContent = clueText(e.row) + "  " + e.row.enum;
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
    /* Tapping a square is a deliberate act: from here typing overwrites rather
       than skipping, however skip-filled is set. */
    skipExempt = target;
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
  /* Which entry, if any, is currently exempt from skip-filled.

     Skipping over letters already in the grid is right while an answer is being
     filled — it is what the setting is for. It is wrong the moment somebody
     taps a filled square, because the only reason to do that is to change what
     is there, and skipping past it means the correction lands somewhere else.

     Exempt for that answer only, and only until the selection moves on. The
     setting is not changed and nothing has to be put back. */
  var skipExempt = -1;

  function passOver(e, i) {
    var k = K(e.cells[i].x, e.cells[i].y);
    if (locked(k)) return true;
    if (skipExempt === cur.entry) return false;
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
    /* Was the word already complete before this letter?

       If it was, the player is correcting something, not finishing it — and a
       correction must not move them on. See the advance below. */
    var wasFilled = entryFilled(cur.entry);
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
    /* Advance only when this letter COMPLETED the word.

       `entryFilled` after the keystroke was not enough: on a word that was
       already full it is true every time, so correcting one letter of a
       finished answer moved to the next clue on every keystroke and the player
       could not fix a spelling at all. `wasFilled` separates finishing a word
       from editing a finished one.

       The cursor test stays for the case it was always for: running off the end
       of a word that still has gaps elsewhere. */
    if (!wasFilled && (cur.cell >= e.len || entryFilled(cur.entry))) {
      cur.cell = Math.min(cur.cell, e.len - 1);
      advanceToNextEntry();
    } else if (cur.cell >= e.len) {
      /* Correcting the last square: stay on it rather than running past the
         end of the word. */
      cur.cell = e.len - 1;
    }
    refreshLetters(); updateSelection(); saveSoon();
    maybeOfferFollowWord();
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
      if (!entryFilled(i)) { cur.entry = i; cur.cell = firstEmptyCell(i); clearSkipExempt(); return; }
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
    /* Guarded on the puzzle as well as the box. Tapping the label before a
       puzzle has loaded threw on puzzle.entries, and because the throw happened
       before the list was unhidden, the symptom was a control that did nothing
       rather than an error anybody would see. */
    if (!box || !puzzle) return;
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
    if (!box || !m || !puzzle) return;
    var opening = box.hidden;
    if (opening) buildJumpList();
    box.hidden = !opening;
    m.setAttribute("aria-expanded", opening ? "true" : "false");
  }

  function clearSkipExempt() { skipExempt = -1; }

  function stepClue(delta) {
    /* The edge zones are on screen before a puzzle is. Guarded here rather
       than at each caller: stepClue is reached from the zones, the keyboard,
       Enter and the jump list, and one guard cannot drift out of step with
       four call sites. */
    if (paused || !puzzle) return;
    var order = entryOrder();
    var pos = order.indexOf(cur.entry);
    cur.entry = order[(pos + delta + order.length) % order.length];
    cur.cell = firstEmptyCell(cur.entry);
    clearSkipExempt();
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
        chargeHelp("check");
        consecutiveChecks++;
        var headline = consecutiveChecks === 2 ? "Back-to-back defeats"
                     : consecutiveChecks >= 3 ? "Three losses on the bounce"
                     : "Defeat \u2014 " + FCW.SCORING.HELP_MINUTES.check + " minutes on the clock";
        toast(headline, consecutiveChecks > 1
          ? FCW.SCORING.HELP_MINUTES.check + " minutes on the clock" : "", "loss");
        updateScoreUI(); saveSoon();
      })
      .catch(function (err) { revealFailed(err); });
  });

  /* ---------- Check All (whole grid, HELP_MINUTES.checkAll) ----------
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
    chargeHelp("checkAll");
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
    /* Warned only when it costs the win. Somebody with subs in hand is making
       an ordinary decision and does not need a dialog; somebody about to exceed
       is giving up a win, which they should be told before the clock moves. */
    if (!confirmSubCost(FCW.SCORING.SUBS_PER_LETTER, "a letter")) return;
    // §6 of the deployment standard: the server returns an answer only on an
    // explicit request. This is one — it costs two points.
    revealFromServer(cur.entry, cur.cell, function (ch) {
      letters[k] = ch;                 // insert or correct
      delete wrong[k];
      revealedCells[k] = true;         // locked + gold from here on
    }, function () {
      helpActions.push("revealLetter");
      chargeHelp("revealLetter");
      consecutiveChecks = 0;
      /* revealLetter, matching the charge on the line above. It read .check —
         said 2, cost 3 — because the toasts were converted in one pass and this
         one sits inside the reveal handler rather than the check handler. */
      toast("Draw \u2014 " + FCW.SCORING.HELP_MINUTES.revealLetter +
            " minutes on the clock", "Held to a draw.", "draw");
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

  /* ---------- Reveal Answer (HELP_MINUTES.revealAnswer, 3 subs) ---------- */
  on("revealBtn", "click", function () {
    if (complete || !started || paused) return;
    var e = puzzle.entries[cur.entry];
    var idx = cur.entry;
    /* A whole answer is the bench in one go. With fewer than three left it is
       the moment a win is given up, so it is said before the clock moves. */
    if (!confirmSubCost(FCW.SCORING.SUBS_PER_ANSWER, "a whole answer")) return;
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
          chargeHelp("revealAnswer");
          consecutiveChecks = 0;
          /* Read from SCORING rather than written out. This said "9 points
             dropped" and went on saying it after the price became 12 — a
             number in a string cannot follow the constant it describes. */
          toast("Four defeats on the bounce",
                FCW.SCORING.HELP_MINUTES.revealAnswer + " minutes on the clock", "loss");
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
  /* Everything a reset should clear.

     Six keys the game writes were missing, so a reset left the device
     half-reset: the board.kind, whether the menu had been left deliberately, the
     owner's season override and the one-time tip all survived it.

     `fcw.streak` and `fcw.pre` stay although nothing has written them for two
     revisions — that is exactly why. A player who last opened the game months
     ago still has them, and dropping them from this list would strand those
     keys in their browser permanently. A wipe list is the one place legacy
     names earn their keep. */
  var WIPE_KEYS = [
    "fcw.results.v1",        // daily and archive results
    "fcw.themeResults.v1",   // themed boards, and what was marked as played
    "fcw.streak",            // legacy: the run, before it was derived
    "fcw.pre",               // legacy: the pre-season record
    "fcw.recent",            // recent answers, so they are not repeated
    "fcw.usedClues.v1",      // clue circulation
    "fcw.v04.daily",         // the three saved games
    "fcw.v04.practice",
    "fcw.v04.theme",
    "fcw.mode",
    "fcw.v04.daily",         // dead: the shared slot before boards had their own
    "fcw.athome",            // whether the menu was left deliberately
    "fcw.seasonStart",       // the owner's season test override
    "fcw.tip.followword",    // the one-time tip
    /* Deliberately NOT wiped, and each for a reason:

       fcw.deviceCode  is an identity, not a record. Wiping it would cut the
                       player off from results already synced to their account,
                       which a reset of local history has no business doing.
       fcw.clubPref    the club you play as. Not history — and since the season
                       floor came out of scoring it does not affect a score
                       either.
       fcw.theme, fcw.pitch, fcw.bank, fcw.skip, fcw.fxmode, fcw.filter
                       display preferences. A reset clears what you have DONE,
                       not how you like the thing to look.

       Listed by name so each omission reads as a decision rather than a gap. */
  ];
  function loadResults() {
    try {
      var r = JSON.parse(localStorage.getItem(RESULTS_KEY));
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }
  /* Bring the account's history down to this device.

     migrate.js was only ever half of it: the browser posted what it had and
     nothing came back, so signing in on a second device showed an empty
     history while the rows sat on the account. The sign-in offer promised
     "across every device you play on", which was not true until this existed.

     Merged rather than replaced. A player can finish a puzzle signed out and
     sign in afterwards, so the local copy can hold something the account has
     not seen — overwriting would throw that away. */
  function mergeResults(local, remote) {
    var byKey = {};
    var keyOf = function (r) {
      /* A daily is one per player per number, which is what migrate.js relies
         on to top up rather than duplicate. Anything else keys on what it has,
         so a themed board played twice stays two rows. */
      return r && r.mode === "daily" && r.dailyNo != null
        ? "daily:" + r.dailyNo
        : [r && r.mode, r && r.date, r && r.completedAt, r && r.score].join("|");
    };
    (local || []).forEach(function (r) { byKey[keyOf(r)] = r; });
    (remote || []).forEach(function (r) {
      var k = keyOf(r), have = byKey[k];
      /* The account wins a tie only where it has more to say. A local row for
         the same daily is the same run — this device reported it — so keeping
         the better-scored of the two is wrong; keeping the one that is not
         missing fields is right. */
      if (!have) { byKey[k] = r; return; }
      if (have.score == null && r.score != null) byKey[k] = r;
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; })
      .sort(function (a, b) { return (a.dailyNo || 0) - (b.dailyNo || 0); });
  }

  function pullAccountResults() {
    /* apiAuth with no body is a GET, and it carries the session cookie and the
       CSRF header the endpoint checks. */
    return apiAuth("/api/account/results").then(function (d) {
      if (!d || !Array.isArray(d.results)) return;
      var before = loadResults();
      var merged = mergeResults(before, d.results);
      if (merged.length === before.length) return;      // nothing new
      saveResults(merged);
      /* Everything derived from results is recomputed, or the streak and the
         season table go on showing this device's slice of the history. */
      renderStreak();
      if (typeof renderHome === "function") renderHome();
    }).catch(function () { /* offline or signed out: leave the device as it is */ });
  }

  function saveResults(list) {
    try { localStorage.setItem(RESULTS_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function recordDaily(pos, score, res) {
    /* Friendlies are recorded, but to their own record. A pre-season streak is
       a real thing to build, and it ending on Matchday 1 is the point rather
       than a loss — the season table starts empty for everyone on the same day
       whatever anyone did in August. */
    var phase = FCW.dailyPhase(board.no);
    /* Same fault: `counts` is false for a daily as well as a friendly. */
    if (phase.phase !== "season") {
      var note = $("rClockNote");
      if (note) {
        /* No hardcoded date. "13 September" was written when the season began
           the day pre-season ended; the epoch has moved since and SEASON_START
           is null, so there is no Matchday 1 date to name at all. A sentence
           that states a date it cannot know is worse than one that does not. */
        note.textContent = phase.phase === "preseason"
          ? "Pre-season friendly \u2014 kept in your pre-season record."
          : "Kept in your record. The season table starts when the season does.";
        note.style.display = "";
      }
    }
    var list = loadResults();
    // A Daily is recorded once; a later replay never overwrites the original.
    /* A rewrite of this same attempt replaces its row; a different attempt at a
       board already banked is refused.

       This returned on ANY existing result for the number, so the verified
       rewrite that follows the server's answer did nothing at all — the record
       kept the browser's figure while the card showed the server's. Exactly the
       fault recordThemed guards against with prev.playId === playId, three
       hundred lines below. */
    var mine = list.filter(function (r) {
      return r && r.dailyNo === board.no && r.playId && r.playId === playId;
    });
    if (mine.length) {
      list = list.filter(function (r) { return !(r && r.dailyNo === board.no); });
    } else if (list.some(function (r) { return r.dailyNo === board.no; })) {
      return list;
    }
    /* Spec §19: only the host's clock can bank a result. If the device clock
       has been moved to open a Daily that is not today, the puzzle stays
       playable — it just does not count towards points, streak or history.
       Offline there is no trusted clock and no way to tell, so play records as
       normal: refusing would punish honest offline players to stop a cheat that
       only ever affects the cheater's own device. */
    /* A board from the archive is not a moved clock.

       This refused to bank anything whose number was not today's, which was
       right when today's was the only daily reachable. With the archive open it
       dropped every finished archive board — and silently, because
       renderPreviousCount never fell and nextUnplayedDaily offered the same
       board again, which then opened blank over the single daily save slot.

       The fourth copy of the "the daily in play is today's" assumption, after
       boot(), chooseMode() and syncServerDate().

       The check it replaces still matters and is kept: a number AHEAD of today
       can only come from a moved clock, since the server will not serve one. */
    var ts = FCW.timeState();
    if (ts.trusted && board.no > FCW.dailyNumber()) {
      showClockNote(board.no, FCW.dailyNumber());
      return list;
    }
    /* The save has nothing left to say once the result is banked, and a
       finished slot would otherwise sit there for good. */
    pruneDailySlot(board.no);
    list.push(FCW.makeResultRecord({
      date: FCW.localDateKey(), dailyNo: board.no, seed: seed,
      /* So a verified rewrite can find its own row. recordThemed has carried
         this for the same reason; the daily never did, which is why the
         verified score could not replace the browser's. */
      playId: playId,
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
    if (!board.theme || !board.theme.theme) return;
    var key = board.theme.theme + "-" + board.theme.no;
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

  /* Their own key, not the results array. That array is sorted by board.no,
     read by FCW.streaks(), and posted wholesale to /api/account/migrate on
     sign-in — a record with no board.no in it would sort to nowhere, count for
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
    /* Two faults in one line.

       C: board.no is the board being PLAYED, not today. Visiting an archive
       board left it set, so the landing screen reported a live run as "0 day
       run" — streaks() only counts a current run when the last result is today
       or yesterday.

       E: splitByPhase divides friendly from not-friendly, but this keyed on
       `counts`, which is false for BOTH "preseason" and "daily". From board #11
       every reader would have taken the pre-season bucket: streak line blank,
       My Season showing ten friendlies and nothing else. The phase name is what
       splitByPhase actually uses. */
    return FCW.dailyPhase(FCW.dailyNumber()).phase !== "preseason"
      ? split.season : split.preseason;
  }
  function renderStreak() {
    var st = FCW.seasonStats(phaseResults(), FCW.dailyNumber());
    var pre = FCW.dailyPhase(FCW.dailyNumber()).phase === "preseason";
    $("streakLine").textContent = st.played
      ? (pre ? "Pre-season run " : "Current run ") + st.currentStreak +
        " \u00B7 best " + st.longestStreak + " \u00B7 " + st.played + " played"
      : "";
  }

  /* ---------- My Season ---------- */
  function fmtClock(sec) { return fmt(sec || 0); }
  function renderStats() {
    var split = FCW.splitByPhase(loadResults());
    var inSeason = FCW.dailyPhase(FCW.dailyNumber()).phase !== "preseason";
    var results = inSeason ? split.season : split.preseason;
    var st = FCW.seasonStats(results, FCW.dailyNumber());
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
  /* The tile opens the season view that already exists rather than a second
     one. My Season is the table; this is a shortcut to it from the landing
     screen. */
  on("homeSeason", "click", function () {
    renderStats();
    $("statsSheet").classList.add("show");
  });
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
  var lastShownScore = null;
  /* The number on its own, updated whether or not a club has been chosen.

     updateScoreUI() returns early without a club, because everything below it
     is the league table — and the table was the only place the running score
     appeared. In the flex layout there is no table, so that early return took
     the score off the screen entirely. */
  function updateLiveScoreChip() {
    var el = $("liveScoreVal");
    if (!el || !puzzle) return;
    var v = liveScore();
    if (v === lastShownScore) return;
    var fell = lastShownScore !== null && v < lastShownScore;
    lastShownScore = v;
    el.textContent = v;
    if (fell) {
      var box = $("liveScoreChip");
      if (box) {
        box.classList.remove("dropped");
        void box.offsetWidth;               // restart the animation
        box.classList.add("dropped");
      }
    }
  }

  function updateScoreUI() {
    updateLiveScoreChip();
    /* The table only exists once a club is chosen, and choosing one is
       optional. Without it there is no table to read the score off, so the chip
       stays — with it, the chip would be saying the same thing twice, which is
       why it was removed in the first place. */
    document.body.classList.toggle("has-table", club !== null);
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
      /* No season in the label. The season you are scored against is drawn from
         the puzzle seed whichever club you pick, so naming one here reads as
         "pick from this season" and implies a link that does not exist — the
         same confusion the note above was written to avoid. */
      g1.label = "Top flight clubs";
      recent.clubs.slice().sort().forEach(function (c) { addTo(g1, c); });
      sel.appendChild(g1);
    }
    var rest = CLUBS.filter(function (c) { return !seen[c]; });
    if (rest.length) {
      var g2 = document.createElement("optgroup");
      g2.label = "Other clubs";
      rest.forEach(function (c) { addTo(g2, c); });
      sel.appendChild(g2);
    }
    /* Clubs that have never played in the top flight. They take the bottom
       club's place in whichever season is used — which is the right story
       anyway: you start at the bottom and climb.

       Grouped with the others rather than named separately: "Football League"
       is a mark too, and the only distinction that matters to a player is
       whether a club is in the current twenty. */
    var efl = EFL_CLUBS.filter(function (c) { return !seen[c]; }).sort();
    if (efl.length) {
      var g3 = document.createElement("optgroup");
      g3.label = "Other clubs";
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
  /* kickAltBtn is gone. It offered "play a practice puzzle instead" from the
     Kick Off card, and practice no longer exists — past dailies replaced it.
     The button had already been removed from the markup, leaving a handler
     bound to nothing and a "Missing element: kickAltBtn" warning on every
     load. A warning nobody can act on trains people to ignore the console. */

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
  /* What a row of help cost, in minutes on the clock.

     The breakdown printed the point penalties, which are zero now — four rows
     reading "-0" under a score that had plainly fallen. The clock is the only
     cost, so the breakdown reports the clock. */
  function helpMins(kind, n) {
    var m = (FCW.SCORING.HELP_MINUTES[kind] || 0) * (n || 0);
    return m ? "+" + m + "\u2032" : "\u2014";
  }

  function footballPhrase(kind, count, points) {
    if (!count) return "None";
    if (kind === "draw") return count === 1 ? "1 draw" : count + " draws";
    if (kind === "check") return count === 1 ? "1 defeat" : count + " defeats";
    return count === 1 ? "3 defeats" : (count * 3) + " defeats";
  }

  /* The final score, written to both places at once.

     It appears on the collapsed summary and inside the panel, and three
     separate paths set it — the local calculation, the server's verified score,
     and the re-render after verification. Three writes to one element became
     six the moment there were two elements, which is how they drift. */
  /* The result line: position, score and what was available.

     "20TH \u2014 15 PTS" over "15 / 114 pts" was one number said twice. The
     ceiling is the only thing the second line carried, so it lives here now. */
  function setResultLine(pos, score) {
    $("rPos").textContent = (FCW.ordinal(pos) + "  \u00B7  " + score +
      " / " + FCW.SCORING.MAX_SCORE).toUpperCase();
  }

  var shownScore = null;

  function setFinalScore(score) {
    shownScore = score;
    if ($("rFinal")) $("rFinal").textContent = score + " / " + FCW.SCORING.MAX_SCORE;
    /* The summary shows what was LOST, not the total.

       The total was already on the result line directly above it and in the
       league table below — repeating it here made four appearances of one
       number. The deduction is the thing this panel actually explains, and it
       is the only place on the screen that says it.

       Nothing lost, nothing to say: a clean sheet gets no number at all. */
    var peek = $("rFinalPeek");
    if (peek) {
      var lost = FCW.SCORING.MAX_SCORE - score;
      peek.textContent = lost > 0 ? "\u2212" + lost : "";
    }
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
    lastPosition = pos;
    if ($("rClockNote")) $("rClockNote").style.display = "none";
    showPauseNote();
    updateScoreUI();
    $("rClub").textContent = club + (season ? "  \u00B7  " + season.season : "");
    setResultLine(pos, res.score);
    $("rMsg").textContent = FCW.outcomeMessage(club, pos);
    renderSeason("rSeasonGames", "rSeasonWdl", res.score);
    $("bClock").textContent = FCW.matchClockLabel(elapsed);
    $("bTime").textContent = fmt(elapsed);
    $("bTimePen").textContent = "\u2212" + res.timePenalty;
    $("bChecks").textContent = footballPhrase("check", checksUsed, res.checkPenalty);
    $("bCheckPen").textContent = helpMins("check", checksUsed);
    $("bCheckAlls").textContent = footballPhrase("answer", checkAllsUsed, res.checkAllPenalty);
    $("bCheckAllPen").textContent = helpMins("checkAll", checkAllsUsed);
    $("bLetters").textContent = footballPhrase("draw", revealedLetterCount(), res.revealLetterPenalty);
    $("bLetterPen").textContent = helpMins("revealLetter", revealedLetterCount());
    $("bAnswers").textContent = footballPhrase("answer", revealedAnswerCount(), res.revealAnswerPenalty);
    $("bAnswerPen").textContent = helpMins("revealAnswer", revealedAnswerCount());
    setFinalScore(res.score);
    if (board.kind === "daily") { recordDaily(pos, res.score, res); renderStreak(); }
    else if (board.kind === "theme") recordThemed(pos, res.score);
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
    showDailyPrompt();
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
    setHomeVisible(false);
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
         a revealed letter and a revealed answer cost different amounts, so
         "2 reveals" meant
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
    openBoard({ kind: "practice" });
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
    openBoard({ kind: "theme",
                theme: { theme: challenge.theme, no: challenge.no, id: null } });
    buildPuzzle(null).then(function () {
      if (puzzle) return;
      leaveChallenge(); openBoard({ kind: "practice" });
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
    /* The floor goes with it: only this device knows which season was drawn,
       and the server scores against the same curve or the two disagree. */
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
        /* Counts come from r, not b. b is the server's breakdown and carries
           penalties only — reading b.checks gave undefined and every cost
           rendered as a dash, while the count beside it read r.checks and was
           right. The line above and the line below disagreed about which
           object held the same fact. */
        $("bTimePen").textContent = "\u2212" + (b.timePenalty || 0);
        $("bChecks").textContent = footballPhrase("check", r.checks || 0, b.checkPenalty || 0);
        $("bCheckPen").textContent = helpMins("check", r.checks || 0);
        $("bCheckAlls").textContent = footballPhrase("answer", r.checkAlls || 0, b.checkAllPenalty || 0);
        $("bCheckAllPen").textContent = helpMins("checkAll", r.checkAlls || 0);
        $("bLetters").textContent = footballPhrase("draw", r.revealedLetters || 0, b.letterPenalty || 0);
        $("bLetterPen").textContent = helpMins("revealLetter", r.revealedLetters || 0);
        $("bAnswers").textContent = footballPhrase("answer", r.revealedAnswers || 0, b.answerPenalty || 0);
        $("bAnswerPen").textContent = helpMins("revealAnswer", r.revealedAnswers || 0);
        setFinalScore(r.score);

        /* The device's own record is rewritten too. recordDaily and
           recordThemed run when the puzzle finishes, before the server has
           answered, so they stored the browser's figure — and the board badge
           then showed 81 for a game whose Full Time said 82. One game, one
           score, wherever it appears. */
        /* A verified score is the only kind that may join a challenge table.
           Submitted here rather than at Full Time for exactly that reason. */
        if (challenge) submitChallengeEntry();
        if (board.kind === "theme") recordThemed(lastPosition, r.score);
        else if (board.kind === "daily") recordDaily(lastPosition, r.score, r.breakdown || {});

        /* Compared against the value, not against the text on screen. This read
           Number($("rScore").textContent) — using rendered display text as
           state, which breaks the moment the display changes shape, and did. */
        if (r.score !== shownScore) {
          var table = FCW.buildTable(club, r.score, season);
          var pos = FCW.playerPosition(table);
          setResultLine(pos, r.score);
          setFinalScore(r.score);
          $("rMsg").textContent = FCW.outcomeMessage(club, pos);
          renderSeason("rSeasonGames", "rSeasonWdl", r.score);
          renderLeagueRows($("finalTableBody"), table, false);
          /* Re-scrolled, because re-rendering the rows throws the scroll back
             to the top. It barely showed while the window was ten rows deep;
             at five it would leave you looking at the top of the league rather
             than at where you finished. */
          var youAgain = $("finalTableBody").querySelector("tr.you");
          if (youAgain && youAgain.scrollIntoView) {
            youAgain.scrollIntoView({ block: "center" });
          }
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
                            revealedAnswerCount(), checkAllsUsed);
  }

  /* A practice puzzle can be handed to somebody else. Each one has a token, and
     the API can serve that exact puzzle, so "beat this" is a real invitation
     rather than a vague one — the daily needs no such link, because everybody
     gets the same puzzle anyway. */
  function shareLink() {
    if (board.kind === "daily") return SHARE_URL;
    /* A themed link says what it is. /?t=man-united-3 reads as an invitation;
       /?p=4471 reads as a database key, and the name is public anyway the
       moment it appears in the message. */
    if (board.kind === "theme" && board.theme && board.theme.theme) {
      return SHARE_URL + "/?t=" + encodeURIComponent(board.theme.theme + "-" + board.theme.no);
    }
    var m = /^practice:(\d+)$/.exec(puzzleToken || "");
    return m ? SHARE_URL + "/?p=" + m[1] : SHARE_URL;
  }

  function shareText() {
    var res = shareResult();
    var table = FCW.buildTable(club, res.score, season);
    var pos = FCW.playerPosition(table);
    var name = board.kind === "daily"
      ? "Crossword XI \u00B7 " + FCW.dailyPhase(board.no).label
      : (board.kind === "theme" && themeLabel
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
    var invite = board.kind === "daily" ? SHARE_URL : "Beat it: " + shareLink();
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
      (board.kind === "daily" ? FCW.dailyPhase(board.no).label : "practice") +
      " \u2014 " + res.score + "/114 in " + fmt(elapsed);
    window.open("https://reddit.com/submit?url=" + encodeURIComponent(SHARE_URL) +
      "&title=" + encodeURIComponent(title), "_blank", "noopener");
  });

  function startPractice() {
    openBoard({ kind: "practice" });
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
    if (board.kind === "practice" && !complete && progressRatio() > 0.25) {
      if (!window.confirm("Leave this practice puzzle and open today's daily?")) return;
    }
    bootDaily();
  });
  /* "Play today's daily" — the toolbar, Full Time, the board.kind menu.

     It set board.kind and board.no directly and never touched dailyWanted, which
     requestPuzzle reads. So: calendar to an archive board, Home, any club
     board, then "today's puzzle" — and you got the archive board, with today's
     seed. The sixth copy of the assumption, and it never compared against
     dailyNumber() at all, which is why grepping for that comparison kept
     missing it.

     Now the same route as everything else, and it asks before reopening a board
     already banked — the hero tile has done that since v138 and this did not,
     so the two doors to the same board behaved differently. */
  function bootDaily() {
    var no = today();
    var done = alreadyPlayedElsewhere(no);
    if (done && !window.confirm(
      "You have already played this one" +
      (done.score != null ? " and scored " + done.score : "") +
      ".\n\nYour result is saved. Playing again will not change it.\n\nOpen it anyway?")) {
      return;
    }
    chooseMode("daily", { kind: "daily", no: no});
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
  /* `which` is a board.kind, kept because callers ask in modes. `forBoard` lets a
     caller ask about a board that is not the one open — the landing screen asks
     about today's while an archive board is in play. */
  function savedFor(which, forBoard) {
    if (which === "practice") {
      try { return JSON.parse(localStorage.getItem("fcw.v04.practice")); } catch (e) { return null; }
    }
    return readSlot(which, forBoard || (which === "daily"
      ? { kind: "daily", no: today() } : board));
  }

  /* A game with time on the clock is in progress whether or not anything has
     been typed — twenty-five seconds of reading the clues is still playing, and
     showing nothing there made it look as though the game had been lost.

     Declared here rather than inside renderHome(). It was nested there, and the
     Practice handler — which needs it to let somebody finish a puzzle started
     before the board.kind was suspended — is bound at load time, outside that scope.
     The result was a ReferenceError on every tap of Practice. */
  function inProgress(rec) {
    return !!rec && !rec.complete &&
      (Object.keys(rec.letters || {}).length > 0 || (rec.elapsed || 0) > 0);
  }

  function renderHome() {
    syncKickSelect();          // fills and syncs the Play as control on this screen
    var today = FCW.dailyNumber();
    var phase = FCW.dailyPhase(today);
    /* Both the dimming and the badge follow DAILY_OPEN, from here.

       They were written into index.html as a static class and a span inside the
       title. Two things went wrong with that: the class stayed on whatever the
       flag said, so setting DAILY_OPEN = true left the tile greyed and looking
       unclickable; and this line writes the whole title as textContent, which
       silently removed the badge span every render. The tile ended up dimmed
       with nothing explaining why. */
    $("homeDailyTitle").textContent = phase.label;
    /* The kicker names the competition, the title names the fixture. */
    if ($("homeDailyKicker")) {
      $("homeDailyKicker").textContent =
        (phase.phase === "preseason" ? "TODAY \u00B7 PRE-SEASON"
         : phase.phase === "season" ? "TODAY \u00B7 SEASON" : "TODAY");
    }
    $("homeDaily").classList.toggle("hero", true);
    $("homeDaily").classList.toggle("soon", !DAILY_OPEN);
    if (!DAILY_OPEN) {
      var badge = document.createElement("span");
      badge.className = "hc-soon";
      badge.textContent = "Coming soon";
      $("homeDailyTitle").appendChild(document.createTextNode(" "));
      $("homeDailyTitle").appendChild(badge);
    }
    /* The note is written here too, so the suspension message and the phase
       message cannot both be true at once. The markup's copy is a placeholder
       for the moment before this runs. */
    $("homeDailyNote").textContent = !DAILY_OPEN
      ? "Being rebuilt alongside the new club boards."
      : phase.phase === "preseason"
        ? "A friendly. Played and kept, but the season table starts on Matchday 1."
        : "One a day, the same for everyone. The clock counts.";

    /* The season tile, while the test override is on.

       Not a board.kind of its own — the season is the daily, counted. This is a
       readout of where the run has got to and a way into the table, so the
       shape can be judged before any of it is committed to. */
    var seasonTile = $("homeSeason");
    if (seasonTile) {
      var on = false;
      try { on = !!localStorage.getItem("fcw.seasonStart"); } catch (e) {}
      seasonTile.style.display = on ? "" : "none";
      if (on) {
        var played = loadResults().filter(function (r) {
          return r && r.phase === "season";
        });
        var pts = played.reduce(function (a, r) {
          /* The same mapping the table uses: a score resolves to one result,
             and three points for a win, one for a draw. */
          return a + (r.score >= 76 ? 3 : r.score >= 38 ? 1 : 0);
        }, 0);
        $("homeSeasonNote").textContent = phase.phase === "season"
          ? "Today is " + phase.label + " of 38."
          : "Starts at " + FCW.dailyPhase(FCW.seasonStart()).label + ".";
        $("homeSeasonState").textContent = played.length
          ? played.length + (played.length === 1 ? " game" : " games") +
            " played \u00B7 " + pts + (pts === 1 ? " point" : " points")
          : "No matchdays played yet";
      }
    }

    var d = savedFor("daily");
    var state = "";

    /* Played is a fact about the PLAYER, not about this browser.

       This read only savedFor("daily"), which is this device's localStorage and
       never crosses devices — so finishing on a laptop and opening the iPad
       showed the daily as unplayed, and playing it again was the obvious next
       step. The results DO sync; the tile was not asking them.

       Results win over the local save: a result is banked and verified, a save
       is a working copy. */
    var doneToday = null;
    loadResults().forEach(function (r) {
      if (r && r.mode === "daily" && r.dailyNo === today) doneToday = r;
    });
    if (doneToday) {
      state = "Played \u00B7 " + (doneToday.score != null ? doneToday.score + "/114" : "done");
    } else if (d && d.dailyNo === today) {
      if (d.complete) state = "Played \u00B7 " + (d.score != null ? d.score + "/114" : "done");
      /* No number. It showed the elapsed time from the save, which stopped
         being true the moment you left — the clock does not pause, so a figure
         frozen at whatever it read when you walked away is quietly wrong and
         gets wronger the longer you look at it.

         "In progress" is the part that is still true. The real number is on the
         board, where it is live. */
      else if (inProgress(d)) state = "In progress";
    }
    $("homeDailyState").textContent = state;

    var p = savedFor("practice");
    /* While practice is suspended the state line has to say whether the tile
       still does anything. "One in progress" now means "and you can still
       finish it", which is the opposite of what the Coming soon label implies,
       so it says so. */
    /* Same as the daily tile: no number, because a clock that does not pause
       cannot be reported from a save. And the old wording — "you can finish
       this one" — dated from when practice was suspended and finishing was the
       exception; these are ordinary boards now. */
    $("homePracticeState").textContent = inProgress(p) ? "One in progress" : "";

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
  /* The daily, offered at Full Time.

     The strongest thing this game has for bringing somebody back is that there
     is one a day and it is the same for everyone. Somebody arriving from a
     shared link never learns that: they finish a themed board and the buttons
     all point at the board they just played.

     The wording changes with what they have already done, because the reason to
     come back is different in each case:
       never played a daily  -> what it is
       played before, streak -> the streak, which is a thing to lose
       played before, no run -> the invitation to start one

     Nothing is shown when today's daily is already done or when it IS what they
     just played. Offering somebody a puzzle they have finished reads as a game
     that has not noticed. */
  function showDailyPrompt() {
    var box = $("resDaily");
    if (!box) return;
    box.style.display = "none";
    /* Nothing to offer while the daily is suspended. */
    if (!DAILY_OPEN || board.kind === "daily") return;

    var done = loadResults().some(function (r) {
      /* today(), not board.no. board.no is the board being played — so finishing
         a club board after visiting an archive daily checked whether THAT
         daily was done, and hid the prompt or offered the wrong board. */
      return r && r.mode === "daily" && r.dailyNo === today();
    });
    if (done) return;

    var st = FCW.seasonStats(phaseResults(), FCW.dailyNumber());
    var line = $("rdLine"), note = $("rdNote");

    if (!st.played) {
      line.textContent = "Today's puzzle";
      note.textContent = "One a day, the same puzzle for everyone. " +
        "Play tomorrow's too and you have a run going.";
    } else if (st.currentStreak > 0) {
      line.textContent = "Your run is " + st.currentStreak +
        (st.currentStreak === 1 ? " day" : " days");
      note.textContent = "Miss it and the run goes back to nothing.";
    } else {
      line.textContent = "Today's puzzle";
      note.textContent = "You have played " + st.played +
        (st.played === 1 ? " daily" : " dailies") +
        ". Two days running starts a new run.";
    }
    box.style.display = "";
  }

  /* The Follow word tip: offered once, and only where it earns its interruption.

     Four conditions, all of them about the moment rather than the person:
       the flex layout, since that is where the board.kind exists
       Fit board, or there is nothing to suggest
       cells under 32px, which is a board with more columns than this screen
         comfortably carries
       three letters typed, so they are solving rather than arriving

     Shown once ever. A tip that returns is an advert. */
  var TIP_KEY = "fcw.tip.followword";
  var tipShown = false;

  function maybeOfferFollowWord() {
    if (tipShown || !flexOn || fxMode !== "board" || !puzzle) return;
    var box = $("fxTip");
    if (!box || !box.hidden) return;
    try { if (localStorage.getItem(TIP_KEY)) { tipShown = true; return; } } catch (e) {}
    if (Object.keys(letters).length < 3) return;

    /* The cell as it is actually drawn, which is FX_BASE through the transform
       — not FX_BASE, which is the size before any of the fitting happens. */
    var cell = FX_BASE * fxScale;
    if (cell >= 32) return;

    tipShown = true;
    /* Says what it does, not that something is wrong. The board is fine; this
       is an option, and a tip that opens by diagnosing a problem the player has
       not noticed invents one. */
    $("fxTipText").textContent =
      "Follow word zooms to the answer you are typing, one at a time.";
    box.hidden = false;
  }
  function closeTip(remember) {
    var box = $("fxTip");
    if (box) box.hidden = true;
    if (remember) { try { localStorage.setItem(TIP_KEY, "1"); } catch (e) {} }
  }

  function showTodayRank(mine) {
    var el = $("rRank");
    if (!el) return;
    el.style.display = "none";
    var f = featuredBoard;
    if (!f || board.kind !== "theme" || !board.theme || board.theme.theme !== f.themeId ||
        Number(board.theme.no) !== Number(f.no)) return;

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
            ? "Board of the week: " + ordinal(place) + " of " +
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
    openBoard({ kind: "theme", theme: { theme: theme, no: no, id: id || null } });
    themeLabel = "";
    $("themeSheet").classList.remove("show");
    setHomeVisible(false);
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
  /* The header nav drives the controls that already do these jobs rather than
     reimplementing them. Today is where you already are. */
  on("navClubs", "click", function () {
    /* Drives homeThemed, the control directly above. An earlier version called
       click("homeThemes"), a helper that does not exist in this scope — the
       nav button threw instead of opening anything. */
    renderThemes(); $("themeSheet").classList.add("show");
  });
  on("navSeason", "click", function () { renderStats(); $("statsSheet").classList.add("show"); });

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
    clearSkipExempt();
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

  /* ---- flex layout: gestures and the toggle ---- */
  (function () {
    var wrap = document.querySelector(".grid-wrap");
    if (!wrap) return;
    var pts = {}, n = 0, startD = 0, startK = 1, startMid = null, moved = false;

    function mid() {
      var a = [], k;
      for (k in pts) a.push(pts[k]);
      return a;
    }
    wrap.addEventListener("pointerdown", function (ev) {
      if (!flexOn) return;
      /* The board controls sit inside the frame. Capturing the pointer here
         would redirect their own pointerup to the frame and they would never
         fire — they would look broken while being merely intercepted. */
      if (ev.target.closest && ev.target.closest(".fx-zoom, .fx-fit")) return;
      pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY }; n++;
      moved = false;
      if (n === 2) {
        var a = mid();
        startD = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        startK = fxScale;
        var r = wrap.getBoundingClientRect();
        startMid = { x: (a[0].x + a[1].x) / 2 - r.left, y: (a[0].y + a[1].y) / 2 - r.top };
      }
    });
    wrap.addEventListener("pointermove", function (ev) {
      if (!flexOn || !pts[ev.pointerId]) return;
      var prev = pts[ev.pointerId];
      pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (n === 2 && startD) {
        var a = mid();
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        var k = Math.min(FX_MAX, Math.max(fxMin, startK * (d / startD)));
        /* Zoom about the midpoint of the fingers so the square under them stays
           under them; without it the board slides away as you pinch. */
        var bx = (startMid.x - fxTx) / fxScale, by = (startMid.y - fxTy) / fxScale;
        fxScale = k;
        fxTx = startMid.x - bx * fxScale; fxTy = startMid.y - by * fxScale;
        moved = true; fxClamp(); fxApply();
        return;
      }
      if (n === 1) {
        var dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
        /* Slop, so a tap that wobbles is still a tap and still selects a
           square — the cell handlers are left to fire on their own. */
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        fxTx += dx; fxTy += dy; fxClamp(); fxApply();
      }
    });
    function up(ev) { if (pts[ev.pointerId]) { delete pts[ev.pointerId]; n--; } if (n < 2) startD = 0; }
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);

    /* Safari raises pinch as its own gesture events, at document level, and has
       ignored user-scalable=no since iOS 10. Refused only when the fingers went
       down on the board, so a pinch anywhere else still zooms the page for
       anyone who needs the clue text bigger. */
    var inFrame = false;
    document.addEventListener("touchstart", function (ev) {
      inFrame = !!(flexOn && ev.target.closest && ev.target.closest(".grid-wrap"));
    }, { passive: true });
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {
      document.addEventListener(t, function (ev) { if (inFrame) ev.preventDefault(); },
        { passive: false });
    });
    document.addEventListener("touchmove", function (ev) {
      if (inFrame && ev.touches.length > 1) ev.preventDefault();
    }, { passive: false });

    /* Ctrl+wheel, and a trackpad pinch, which browsers report the same way.
       passive:false matters: wheel listeners default to passive and a passive
       listener cannot preventDefault, so the page would zoom underneath with
       nothing to say why. */
    wrap.addEventListener("wheel", function (ev) {
      if (!flexOn || !ev.ctrlKey) return;
      ev.preventDefault();
      var r = wrap.getBoundingClientRect();
      var px = ev.clientX - r.left, py = ev.clientY - r.top;
      var bx = (px - fxTx) / fxScale, by = (py - fxTy) / fxScale;
      fxScale = Math.min(FX_MAX, Math.max(fxMin, fxScale * Math.exp(-ev.deltaY * 0.0025)));
      fxTx = px - bx * fxScale; fxTy = py - by * fxScale;
      fxClamp(); fxApply();
    }, { passive: false });

    function zoomBy(m) {
      var r = wrap.getBoundingClientRect();
      var cx = r.width / 2, cy = r.height / 2;
      var bx = (cx - fxTx) / fxScale, by = (cy - fxTy) / fxScale;
      fxScale = Math.min(FX_MAX, Math.max(fxMin, fxScale * m));
      fxTx = cx - bx * fxScale; fxTy = cy - by * fxScale;
      fxClamp(); fxApply();
    }
    /* Zooming by hand is a deliberate act, so it drops the board out of any
       automatic board.kind rather than fighting the next thing that moves it. */
    function toManual() { fxMode = "manual"; applyFxMode(); }
    on("fxIn", "click", function () { toManual(); zoomBy(1.25); });
    on("fxOut", "click", function () { toManual(); zoomBy(1 / 1.25); });

    on("fxFit", "click", function () {
      fxMode = fxMode === "board" ? "word" : "board";
      applyFxMode();
      try { localStorage.setItem("fcw.fxmode", fxMode); } catch (e) {}
    });
  })();

  /* The button says what pressing it will do next, not what board.kind you are in —
     a control labelled with the current state leaves you working out what the
     other one was. */
  /* Focus is not a separate setting: it is what Follow word means.

     Following the answer and hiding everything else are the same intent stated
     twice, and two switches for one idea is two things a player has to line up
     before either does what they wanted. Fit board shows the whole board, so
     hiding most of it there would be a contradiction.

     One place decides, and both the class and the fit follow from it. */
  /* State and label only. At boot there is no puzzle to fit, and fxDoFit would
     measure a frame that has not been laid out yet. */
  function applyFxModeQuiet() {
    document.body.classList.toggle("focus-word", fxMode === "word");
    fxLabel();
  }

  function applyFxMode() {
    document.body.classList.toggle("focus-word", fxMode === "word");
    fxLabel();
    if (fxMode === "board") fxDoFit("whole");
    else if (fxMode === "word") fxFollow();
  }

  function fxLabel() {
    var b = $("fxFit");
    if (!b) return;
    b.textContent = fxMode === "board" ? "Follow word"
      : fxMode === "word" ? "Fit board" : "Fit board";
  }

  /* The layout, not a layout.

     Flex is what everybody gets. The classic path is still in the file and
     still works — but it is no longer reachable, and the stored preference is
     ignored rather than honoured, so anybody who chose classic during the
     opt-in comes across with everyone else.

     The code stays until the Playwright gate covers the new layout. That gate
     is the only automated check either layout has, and deleting the one it
     tests before it tests the other leaves nothing watching. */
  /* Daily is suspended.

     One flag, read everywhere it matters, so the tile, the menu item and the
     Full Time prompt cannot drift apart — a prompt advertising a board.kind the tile
     refuses to open is worse than either on its own. */
  var DAILY_OPEN = true;

  /* Showing the landing and hiding the game are one act, so they are one call.

     Seven places toggled the overlay class directly. That was fine while it was
     a layer over a board that stayed rendered underneath — now the board must
     not be reachable at all until something is chosen, and seven places each
     remembering to do two things is seven chances to do one.

     Named setHomeVisible, not showHome: showHome() already exists and does more
     than show it — it stops the clock and flushes the pending save first. This
     is the display half, and showHome() calls it. Naming it the same shadowed
     the original and made it call itself. */
  /* ---------- Device code ----------

     A twelve-character code that identifies this player. Generated here and
     kept in this browser; nothing reaches the server until they ask to save,
     which keeps the server holding nothing for the great majority who never
     do.

     Thirty characters: Crockford base32 with 0 and 1 dropped as well. I, L,
     O and U go for Crockford's reasons; 0 and 1 go because 0/O and 1/I are
     exactly what people get wrong copying a code from an iPad onto a laptop,
     and removing one side of each pair is not enough. 2^59 over twelve. */
  var CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  var CODE_KEY = "fcw.deviceCode";

  function makeDeviceCode() {
    var out = "";
    try {
      /* crypto, not Math.random: predictable randomness makes the entropy
         calculation a fiction, and this is the only thing standing between an
         account and anyone. */
      var buf = new Uint32Array(12);
      crypto.getRandomValues(buf);
      for (var i = 0; i < 12; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    } catch (e) {
      for (var j = 0; j < 12; j++) {
        out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
    }
    return out;
  }

  function deviceCode() {
    var c = null;
    try { c = localStorage.getItem(CODE_KEY); } catch (e) {}
    if (c && c.length === 12) return c;
    c = makeDeviceCode();
    try { localStorage.setItem(CODE_KEY, c); } catch (e) {}
    return c;
  }

  /* XXXX-XXXX-XXXX. Three even groups of four is the pattern people already
     know from product keys, and the eye chunks it without being asked. */
  function formatCode(c) {
    return String(c || "").replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3");
  }

  function claimCode(code, then) {
    apiAuth("/api/account/code", { code: code }).then(function (d) {
      if (!d || d.error) { toast("That code is not right", "Check it and try again", "loss"); return; }
      account = d.user || account;
      try { localStorage.setItem(CODE_KEY, String(code).toUpperCase().replace(/[^0-9A-Z]/g, "")); } catch (e) {}
      renderAccount();
      /* Push what this device has, then pull everything the account holds.
         Merged, never replaced — linking a second device must not wipe what
         was played on it before linking. */
      apiAuth("/api/account/migrate", guestPayload()).then(function () {
        pullAccountResults();
      });
      if (then) then(d);
    }).catch(function () {
      toast("Could not reach the server", "Try again in a moment", "loss");
    });
  }

  function setHomeVisible(on) {
    var v = $("homeOverlay");
    if (v) v.classList.toggle("show", !!on);
    document.body.classList.toggle("home-showing", !!on);
    /* Remembered across a refresh, so leaving is not undone by one.

       Resuming an unfinished game is right when the player was interrupted —
       a refresh, a closed tab, a dropped connection. It is wrong when they
       pressed Home, because the game is still saved and still unfinished and
       looks identical from the save alone. The difference is intent, and only
       this function knows it.

       Written here rather than in showHome(): every route to the landing goes
       through this one, and a second place setting it would be a second place
       to forget. */
    try { localStorage.setItem("fcw.athome", on ? "1" : ""); } catch (e) {}
    if (on) {
      renderRunLine();
      renderPreviousCount();
      try { window.scrollTo(0, 0); } catch (e) {}
    }
  }

  /* Where a returning player is, on the screen they land on. The streak is the
     reason to come back and it lived only in the footer. */
  /* Form, the way football shows it: a row of results rather than a sentence.

     "Run of 3 · best 7" is a stat line. W W D W L is the same information in
     the language the rest of the game speaks, and a red L is something you
     want to fix tomorrow in a way "run of 0" is not. */
  function renderRunLine() {
    var el = $("homeRun"), title = $("homeRunTitle");
    if (!el) return;
    try {
      var recent = phaseResults().slice(-FCW.SCORING.FORM_LENGTH);
      var st = FCW.seasonStats(phaseResults(), FCW.dailyNumber());
      if (!st.played) {
        if (title) title.textContent = "No run yet";
        el.innerHTML = "<span class=\"run-none\">Play today to start one.</span>";
        return;
      }
      if (title) {
        title.textContent = st.currentStreak +
          (st.currentStreak === 1 ? " day run" : " day run");
      }
      var chips = recent.map(function (r) {
        /* The same mapping the season table uses, so the chips and the table
           can never disagree about what a result was. */
        var v = r && r.score != null ? r.score : 0;
        var k = v >= 76 ? "w" : v >= 38 ? "d" : "l";
        return '<span class="rc ' + k + '">' + k.toUpperCase() + "</span>";
      }).join("");
      el.innerHTML = '<span class="run-chips">' + chips + "</span>" +
        '<span class="run-best">best ' + st.longestStreak + "</span>";
    } catch (e) { el.textContent = ""; }
  }

  function setLayout() {
    flexOn = true;
    document.body.classList.add("flex-layout");
    setVh();
    /* Two frames, not one. The class changes the column, and the frame cannot
       be measured until that has been laid out — measured too early it reports
       zero and the fit is meaningless. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (puzzle) fitCells(); scaleClue(); });
    });
  }

  function setVh() {
    var v = window.visualViewport;
    document.documentElement.style.setProperty("--vh",
      ((v && v.height) || window.innerHeight) + "px");
  }

  /* Boot: restore the fit board.kind, then apply the layout.

     Both of these were lost when the standalone focus control was removed — the
     regex that took out that block took the boot calls with it, and setLayout()
     ended up defined and never called. The layout still looked right, because
     the CSS default carries it, but nothing restored the board.kind and nothing
     called fxLabel(), so the button label never matched the state.

     A function that is defined and never called is invisible to a syntax check
     and to every test that does not assert on its effect. Worth remembering as
     a shape: `grep -c` on the definition is not the same question as whether
     anything runs it. */
  try {
    var fm = localStorage.getItem("fcw.fxmode");
    if (fm === "word" || fm === "manual" || fm === "board") fxMode = fm;
  } catch (e) {}
  applyFxModeQuiet();
  setLayout();

  /* ---------- Toolbar ----------
     Every item drives the button that already does the job. Nothing here
     reimplements checking, revealing or scoring — a second implementation is
     two things that have to agree forever, and this codebase has been bitten by
     exactly that shape more than once. */
  var buildSettings = function () {};

  (function () {
    var POPS = ["tbModePop", "tbCheckPop", "tbRevealPop", "tbSettingsPop"];
    function closePops(except) {
      POPS.forEach(function (id) {
        var p = $(id);
        if (!p || id === except) return;
        p.hidden = true;
        var b = $(id.replace("Pop", ""));
        if (b) b.setAttribute("aria-expanded", "false");
      });
    }
    function toggle(btnId, popId) {
      on(btnId, "click", function (ev) {
        ev.stopPropagation();
        var p = $(popId);
        if (!p) return;
        var opening = p.hidden;
        closePops(opening ? popId : null);
        p.hidden = !opening;
        this.setAttribute("aria-expanded", opening ? "true" : "false");
        if (opening) { refreshMenus(); if (popId === "tbSettingsPop") buildSettings(); }
      });
    }
    toggle("tbMode", "tbModePop");
    toggle("tbCheck", "tbCheckPop");
    toggle("tbReveal", "tbRevealPop");
    toggle("tbSettings", "tbSettingsPop");
    /* Driving a footer control synthesises a click on it, and that click bubbles
       to the document — where the handler below closes every menu. So pressing
       a setting closed the menu it was pressed in, which is the opposite of
       what "rebuild rather than close" was meant to do. The flag makes the
       synthesised click invisible to the closer. */
    var driving = false;
    document.addEventListener("click", function () {
      if (driving) return;
      closePops(null);
    });

    function click(id) { var el = $(id); if (el) el.click(); }

    /* What is left to reveal, and what that would cost. Nine a word, the same
       as revealing them one at a time — this is a shortcut, not a discount. */
    function unsolvedEntries() {
      if (!puzzle) return [];
      var out = [];
      puzzle.entries.forEach(function (e, i) {
        if (!entryFilled(i)) out.push(i);
        else {
          /* A filled answer that was typed rather than revealed still counts:
             revealing it would still correct it. */
          var anyOpen = e.cells.some(function (c) { return !locked(K(c.x, c.y)); });
          if (anyOpen) out.push(i);
        }
      });
      return out;
    }

    function refreshMenus() {
      var left = unsolvedEntries().length;
      /* Minutes, not the old nine points. This read left * 9 and showed
         "-99" on the toolbar item for eleven answers, which stopped being the
         price when help moved to the clock. */
      var cost = left * FCW.SCORING.HELP_MINUTES.revealAnswer;
      var c = $("tbRevealAllCost");
      if (c) c.textContent = left ? "+" + cost + "\u2032" : "\u2014";
      var ra = document.querySelector('[data-act="reveal-all"]');
      if (ra) ra.disabled = !left;
      /* Every price read from SCORING, never written in the markup.

         The menu said "Selected word -3" when a check costs 2, and "Selected
         word -9" when revealing an answer costs 12 — numbers typed into the
         HTML when those were the prices, left behind when they changed. A
         number in a string cannot follow the constant it describes.

         The reveals also say what they cost in substitutions, because that is
         what decides the result and the menu was silent on it. */
      var HM = FCW.SCORING.HELP_MINUTES;
      /* Minutes, not points. The point penalties are zero — the clock is the
         only score cost now — so printing them said "-0", which reads as free.

         Minutes are the honest unit anyway: the score is whatever the clock has
         left, so moving the clock is the only thing that moves the score. */
      var setCost = function (id, mins, subs) {
        var el = $(id);
        if (!el) return;
        el.textContent = "+" + mins + "\u2032" +
          (subs ? "  \u00B7  " + subs + " sub" + (subs === 1 ? "" : "s") : "");
      };
      /* The footer buttons carry the same prices and had the same stale
         numbers. Driven from here so there is one source, not five. */
      setCost("costCheck", HM.check, 0);
      setCost("costCheckAll", HM.checkAll, 0);
      setCost("costLetter", HM.revealLetter, FCW.SCORING.SUBS_PER_LETTER);
      setCost("costWord", HM.revealAnswer, FCW.SCORING.SUBS_PER_ANSWER);
      setCost("tbCostCheck", HM.check, 0);
      setCost("tbCostCheckAll", HM.checkAll, 0);
      setCost("tbCostLetter", HM.revealLetter, FCW.SCORING.SUBS_PER_LETTER);
      setCost("tbCostWord", HM.revealAnswer, FCW.SCORING.SUBS_PER_ANSWER);

      /* Substitutions are universal now — three a board, every board. The item
         said "Practice only", which was true when they were a practice
         difficulty setting and became wrong when they started deciding whether
         a day is a win. */
      var item = $("tbSub"), note = $("tbSubNote");
      if (item) {
        item.disabled = true;      // a readout, not a control
        if (note) {
          var leftSubs = subsRemainingNow();
          note.textContent = subsSpentNow() > FCW.SCORING.SUBS_PER_BOARD
            ? "Exceeded \u2014 draw"
            : leftSubs + " of " + FCW.SCORING.SUBS_PER_BOARD + " left";
        }
      }
      /* Practice is the only board.kind where clearing is offered. A daily or a
         themed board can be sent as a challenge, and wiping one is a way to
         lose a run somebody else is measuring themselves against. */
      var cl = $("tbClear");
      if (cl) cl.hidden = board.kind !== "practice";
      /* Practice is suspended while the clue bank is rebuilt. Left in the menu
         so the track is visibly coming rather than quietly missing — the same
         reasoning as the Coming soon tile on the landing screen. */
      var pr = $("tbPractice");
      if (pr) pr.disabled = true;
      var dy = $("tbDaily");
      if (dy) {
        dy.disabled = !DAILY_OPEN;
        /* Label and badge together, from the one flag. Two places deciding
           whether the daily is open is how a greyed item ends up next to a
           working one. */
        dy.textContent = "Daily";
        if (!DAILY_OPEN) {
          var b = document.createElement("span");
          b.className = "pc soon";
          b.textContent = "Soon";
          dy.appendChild(b);
        }
      }
      var lab = $("tbModeLabel");
      if (lab) {
        lab.textContent = board.kind === "daily" ? "Daily"
          : board.kind === "practice" ? "Practice"
          : board.kind === "theme" ? "Clubs & themes" : "Puzzle";
      }
    }
    window.addEventListener("cxi:mode", refreshMenus);

    on("tbModePop", "click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-act]");
      if (!b) return;
      ev.stopPropagation();
      closePops(null);
      var a = b.getAttribute("data-act");
      if (a === "daily") { if (!DAILY_OPEN) return; click("dailyBtn"); }
      else if (a === "practice") return;      // suspended; the item is disabled
      else if (a === "themes") { renderThemes(); $("themeSheet").classList.add("show"); }
      else if (a === "new") click("newBtn");

    });

    on("tbCheckPop", "click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-act]");
      if (!b) return;
      ev.stopPropagation();
      closePops(null);
      click(b.getAttribute("data-act") === "check-word" ? "checkBtn" : "checkAllBtn");
    });

    on("tbRevealPop", "click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-act]");
      if (!b || b.disabled) return;
      ev.stopPropagation();
      var a = b.getAttribute("data-act");
      closePops(null);
      if (a === "reveal-letter") return click("revealLetterBtn");
      if (a === "reveal-word") return click("revealBtn");
      if (a === "sub") return click("subBtn");
      if (a !== "reveal-all") return;

      /* Revealing everything is giving up, and it is one press away from the
         two harmless items above it. Said plainly, with the number, and framed
         as what it is — a points deduction, not a hint. A mis-press here would
         end the puzzle. */
      var left = unsolvedEntries();
      if (!left.length) return;
      /* The real arithmetic, not the list price.

         Reveals clamp at what you hold, so somebody on 5 pays 5 rather than 12
         and the sum printed here would not match the sum on the Full Time
         screen. This is exactly the calculation a player would do in their
         head before deciding, done for them.

         Not framed as a forfeit. It is Reveal answer pressed N times in one
         tap — three left with 90 in hand leaves 54, which is a poor result
         rather than a wiped one. Eleven left with 114 lands on 0 by the same
         rule, so it self-forfeits when it should without needing a state of
         its own. */
      /* Minutes and substitutions, which is what it costs. This read
         the old point penalty and, once that became zero, told the player
         "11 answers at 0 points each. That costs 0, leaving you 114." before
         charging 154 minutes and turning the day into a draw. */
      var perMins = FCW.SCORING.HELP_MINUTES.revealAnswer;
      var mins = left.length * perMins;
      var subsNeeded = left.length * FCW.SCORING.SUBS_PER_ANSWER;
      var ok = window.confirm(
        "Reveal everything left?\n\n" +
        left.length + " answer" + (left.length === 1 ? "" : "s") +
        " at " + perMins + " minutes each: " + mins + " minutes on the clock.\n\n" +
        (subsNeeded > subsRemainingNow()
          ? "That is more substitutions than you have, so today becomes a draw.\n\n"
          : "") +
        "It finishes the puzzle for you. There is no way back from it.");
      if (!ok) return;
      /* One at a time through the button that already exists, so the server
         accounting is the same as if they had been revealed by hand.

         Sequential, not a forEach. Each press is a server call that returns
         immediately, so a synchronous loop finished in microseconds with eleven
         requests still in flight — press Home before they landed and the board
         came back part-filled, because the letters arrived after the save.

         And with substitutions in, a loop would hit the confirm on every press
         after the third. bulkReveal suppresses it: the cost was accepted once,
         above, for the whole lot. */
      bulkReveal = true;
      var queue = left.slice();
      (function next() {
        if (!queue.length) {
          bulkReveal = false;
          clearTimeout(saveT); save();
          return;
        }
        cur.entry = queue.shift();
        cur.cell = 0;
        updateSelection();
        var before = Object.keys(letters).length;
        click("revealBtn");
        /* Waits for the letters to arrive rather than assuming they have. A
           fixed delay would be a guess about the network. */
        var tries = 0;
        (function settle() {
          if (Object.keys(letters).length > before || tries++ > 40) {
            setTimeout(next, 0);
          } else {
            setTimeout(settle, 50);
          }
        })();
      })();
    });

    on("tbClear", "click", function (ev) {
      ev.stopPropagation();
      if (board.kind !== "practice") return;
      if (!window.confirm("Clear every letter you have typed?\n\n" +
        "Revealed letters stay. Nothing is scored for this.")) return;
      Object.keys(letters).forEach(function (k) {
        if (!locked(k)) delete letters[k];
      });
      Object.keys(wrong).forEach(function (k) { delete wrong[k]; });
      refreshLetters();
      updateSelection();
      saveSoon();
    });

    /* The settings menu is built from the footer, every time it opens.

       Each row is a live mirror of a footer control: its text is that control's
       text, and pressing it presses that control. So there is one place a
       setting lives and one place its label is written — a second list would be
       two things to keep in step, and this is a codebase where that shape has
       gone wrong before.

       Rows whose control is hidden are left out, so owner tools and reset clues
       appear only when they apply. */
    var SETTINGS = [
      { id: "accountToggle", label: "Account" },
      { id: "statsBtn",      label: "My Season" },
      { id: "adminToggle",   label: "Owner tools" },
      { id: "themeToggle",   label: "Theme" },
      { id: "bankToggle",    label: "Letter bank" },
      { id: "pitchToggle",   label: "Pitch" },
      { id: "skipToggle",    label: "Skip filled" },
      { id: "circReset",     label: "Reset clues" }
    ];
    function stateOf(el) {
      /* Footer labels read "theme: auto" and "letter bank: on". The part after
         the colon is the state; the part before is the name, which the row
         already gives. */
      var t = (el.textContent || "").trim();
      var i = t.indexOf(":");
      return i === -1 ? "" : t.slice(i + 1).trim();
    }
    /* Assigned to the outer binding, not declared here.

       This lived inside the toolbar IIFE, which is right until something
       outside it needs the same menu — the landing screen does, because the
       toolbar is not on screen there. Exposing the one builder beats a second
       copy: the menu is generated from the footer controls, and two builders
       reading the same controls is how they drift.

       Assigned rather than moved, so everything it closes over stays where it
       was. */
    buildSettings = function () {
      var pop = $("tbSettingsPop");
      if (!pop) return;
      var rows = "";
      SETTINGS.forEach(function (r) {
        var el = $(r.id);
        if (!el) return;
        /* style.display is how the footer hides owner tools and reset clues. */
        if (el.style && el.style.display === "none") return;
        rows += '<button role="menuitem" data-drive="' + r.id + '">' +
          escapeHtml(r.label) +
          '<span class="pc">' + escapeHtml(stateOf(el)) + "</span></button>";
      });
      rows += '<a role="menuitem" href="privacy.html">Privacy<span class="pc">&rsaquo;</span></a>';
      rows += '<div class="set-build">' +
        escapeHtml(($("buildTag") && $("buildTag").textContent) || "") + "</div>";
      pop.innerHTML = rows;
    };
    on("tbSettingsPop", "click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-drive]");
      if (!b) { ev.stopPropagation(); return; }   // a link looks after itself
      ev.stopPropagation();
      var el = $(b.getAttribute("data-drive"));
      if (el) { driving = true; try { el.click(); } finally { driving = false; } }
      /* Rebuilt rather than closed: changing the theme or the letter bank is
         something people do two or three times in a row, and a menu that shuts
         after each one makes that three round trips. Anything that opens a
         sheet closes it, because the menu would be behind the sheet. */
      var opensSheet = /accountToggle|statsBtn|adminToggle/.test(b.getAttribute("data-drive"));
      if (opensSheet) { closePops(null); return; }
      buildSettings();
    });

    refreshMenus();
  })();

  /* Both routes press accountToggle rather than opening the sheet themselves.

     Opening it meant adding the .show class — which is all the sheet needs to
     appear, and not all that opening it involves: accountToggle also calls
     loadGoogle(), which fetches Google's script and renders the sign-in button
     into #googleBtn. So the sheet opened with an empty space where the button
     should be, and only worked once something else had loaded the script — the
     cog, which drives the real control.

     "It is only one line" is exactly how a second implementation starts. */
  on("fxTipYes", "click", function (ev) {
    ev.stopPropagation();
    closeTip(true);
    fxMode = "word";
    applyFxMode();
    try { localStorage.setItem("fcw.fxmode", fxMode); } catch (e) {}
  });
  on("fxTipNo", "click", function (ev) { ev.stopPropagation(); closeTip(true); });

  /* Drives menuBtn, the control that already leaves a game — it stops the
     clock and flushes the pending save before showing the menu. Saving is
     debounced 400ms, so letters typed just before pressing this would
     otherwise not be in the file the landing screen reads. */
  on("tbHome", "click", function (ev) {
    ev.stopPropagation();
    var b = $("menuBtn");
    if (b) b.click(); else showHome();
  });

  on("tbSignIn", "click", function (ev) {
    ev.stopPropagation();
    var b = $("accountToggle");
    if (b) b.click();
  });
  on("rdPlay", "click", function () {
    $("doneOverlay").classList.remove("show");
    var b = $("dailyBtn");
    if (b) b.click(); else chooseMode("daily");
  });
  on("resSignInBtn", "click", function () {
    var b = $("accountToggle");
    if (b) b.click();
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
    setHomeVisible(true);
    document.querySelector(".stage").classList.add("prestart");
  }

  /* Opens a board and starts it. The one route in.

     Was: set board.kind, set board.no from dailyWanted, work out whether the save
     belongs to it, call newPuzzle. Four decisions, three of them duplicated
     elsewhere. openBoard() makes them once. */
  function chooseMode(which, target) {
    if (which === "daily") {
      var t = target || { kind: "daily", no: today()};
      var saved = savedFor("daily", { kind: "daily", no: t.no || today() });
      var mine = saved && saved.dailyNo === (t.no || today());
      openBoard(t, mine ? saved : null);
      newPuzzle(mine && saved.seed != null ? saved.seed : FCW.dailySeed(board.no),
                mine ? saved : null);
      return;
    }
    /* Practice is gone as a mode, but a shared link still opens one and a save
       from before it went still resumes. */
    openBoard({ kind: "practice" });
    var sp = savedFor("practice");
    if (sp && !sp.complete && sp.seed != null) newPuzzle(sp.seed, sp);
    else newPuzzle();
  }


  /* Already played on another device? Say so rather than opening it fresh.

     The results sync but the SAVE does not, so a daily finished on a laptop
     looked untouched on a tablet — and the natural next move was to play it
     again, which banks a second attempt at the same board. The result is
     already safe; there is nothing to gain and a record to muddle.

     Not a refusal. Looking at a board you have finished is reasonable, and the
     server will not bank it twice — the confirm is so it is a decision rather
     than a surprise. */
  function alreadyPlayedElsewhere(no) {
    var local = savedFor("daily");
    if (local && local.dailyNo === no && local.complete) return null;   // played here
    var found = null;
    loadResults().forEach(function (r) {
      if (r && r.mode === "daily" && r.dailyNo === no) found = r;
    });
    return found;
  }

  on("homeDaily", "click", function () {
    var done = alreadyPlayedElsewhere(FCW.dailyNumber());
    if (done && !window.confirm(
      "You have already played this one" +
      (done.score != null ? " and scored " + done.score : "") +
      ".\n\nYour result is saved. Playing again will not change it.\n\nOpen it anyway?")) {
      return;
    }
    /* The hero is always today's, whatever was opened last. Passed explicitly
       rather than cleared from a variable somebody else might have set. */
    /* Anyone part-way through today's can still finish it. Stranding a
       half-played board to enforce a suspension costs a real player something
       and saves nobody anything — the puzzle is already on their device. */
    if (!DAILY_OPEN && !inProgress(savedFor("daily"))) {
      toast("Daily is being rebuilt alongside the new club boards.");
      return;
    }
    chooseMode("daily");
  });
  /* Previous puzzles. Opens the most recent one not yet played.

     Deliberately not a list to browse. Somebody wanting to catch up wants the
     next one they missed, not a menu of two hundred — and a chooser is a
     screen to design, populate and scroll before anyone can play anything.
     A list can come later if people ask for one. */
  /* The calendar, rather than opening the next unplayed board.

     A grid was overkill with one board behind us and is right by the time
     there are ten, so it is built now while nobody is watching rather than
     swapped under people later. */
  var calMonth = null;   // first of the month being shown

  on("homePrevious", "click", function () {
    calMonth = null;
    renderCalendar();
    $("archiveSheet").classList.add("show");
  });
  on("archiveClose", "click", function () { $("archiveSheet").classList.remove("show"); });
  on("calPrev", "click", function () { stepCalendar(-1); });
  on("calNext", "click", function () { stepCalendar(1); });

  function stepCalendar(by) {
    var d = calMonth || startOfMonth(FCW.dailyDate(FCW.dailyNumber()));
    calMonth = new Date(d.getFullYear(), d.getMonth() + by, 1);
    renderCalendar();
  }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

  function renderCalendar() {
    var grid = $("calGrid");
    if (!grid) return;
    var today = FCW.dailyNumber();
    var first = calMonth || startOfMonth(FCW.dailyDate(today));
    calMonth = first;

    var played = {};
    loadResults().forEach(function (r) {
      if (r && r.mode === "daily" && r.dailyNo != null) played[r.dailyNo] = r;
    });

    $("calMonth").textContent = first.toLocaleDateString(undefined,
      { month: "long", year: "numeric" });

    /* Monday first: this is a football game and the week starts on Monday
       everywhere it is played. getDay() puts Sunday at 0, hence the shift. */
    var lead = (first.getDay() + 6) % 7;
    var days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

    var out = [], i;
    for (i = 0; i < lead; i++) out.push('<div class="cal-cell empty"></div>');
    for (i = 1; i <= days; i++) {
      var date = new Date(first.getFullYear(), first.getMonth(), i);
      var no = FCW.dailyNumber(date);
      /* A date can map to #1 twice: dailyNumber clamps at 1, so everything
         before the epoch reports as the first board. Compare the date back to
         be sure this cell really is that board. */
      var real = FCW.dailyDate(no).toDateString() === date.toDateString();
      var cls = "cal-cell";
      var body = "";
      if (!real || no > today) {
        cls += " none";
      } else if (played[no]) {
        cls += " done";
        /* On its own line under the date. Rendered inline they ran together
           and "24" with a score of 97 read as "2497". */
        body = '<b class="cal-score">' +
          (played[no].score != null ? played[no].score : "\u2713") + "</b>";
      } else if (no === today) {
        /* Today is the hero on the landing screen, not an archive entry. Marked
           so it can be seen and tapped, but not counted as something missed —
           the day is not over. */
        cls += " today open";
      } else {
        cls += " open";
      }
      out.push('<button class="' + cls + '" data-no="' + (real ? no : "") + '">' +
        "<span>" + i + "</span>" + body + "</button>");
    }
    grid.innerHTML = out.join("");

    /* Never past the month today falls in: there is nothing to show there and
       a next arrow that does nothing is worse than one that is plainly off. */
    var thisMonth = startOfMonth(FCW.dailyDate(today));
    $("calNext").disabled = first >= thisMonth;
    var firstEver = startOfMonth(FCW.dailyDate(1));
    $("calPrev").disabled = first <= firstEver;

    var left = 0;
    for (i = today - 1; i >= 1; i--) if (!played[i]) left++;
    $("archiveSub").textContent = left === 0
      ? "You have played every board so far."
      : left + (left === 1 ? " board" : " boards") + " left to play";
  }

  /* Delegated: the grid is rebuilt on every render, so a handler per cell would
     have to be rebound each time. */
  on("calGrid", "click", function (ev) {
    var cell = ev.target.closest ? ev.target.closest(".cal-cell") : null;
    if (!cell || cell.classList.contains("none") || cell.classList.contains("empty")) return;
    var no = Number(cell.getAttribute("data-no"));
    if (!no) return;
    $("archiveSheet").classList.remove("show");
    chooseMode("daily", { kind: "daily", no: no});
  });

  /* The most recent board before today that has no result yet. Counts back
     rather than forward: the boards nearest today are the ones somebody
     actually missed, and the ones from months ago matter least. */
  function nextUnplayedDaily() {
    var played = {};
    loadResults().forEach(function (r) {
      if (r && r.mode === "daily" && r.dailyNo != null) played[r.dailyNo] = true;
    });
    for (var n = FCW.dailyNumber() - 1; n >= 1; n--) if (!played[n]) return n;
    return null;
  }

  /* How many are left to play. A stock, not a total: "9 to play" says there is
     something here, and it falls as they are played rather than climbing
     forever. */
  function renderPreviousCount() {
    var el = $("homePreviousCount");
    if (!el) return;
    var played = {}, n;
    loadResults().forEach(function (r) {
      if (r && r.mode === "daily" && r.dailyNo != null) played[r.dailyNo] = true;
    });
    var left = 0;
    for (n = FCW.dailyNumber() - 1; n >= 1; n--) if (!played[n]) left++;
    el.textContent = left === 0 ? "All caught up"
      : left === 1 ? "1 to play" : left + " to play";
  }
  on("homeSeason", "click", function () { renderStats(); $("statsSheet").classList.add("show"); });
  /* These two had the same defect as the toolbar route and predate it: opening
     the sheet without loading Google, so the sign-in button was missing until
     something else had fetched the script. Four ways in, one of which knew how
     to open it. */
  on("homeAccount", "click", function () {
    var b = $("accountToggle");
    if (b) b.click();
  });
  /* Opens the account sheet's sibling: the settings menu lives in the toolbar,
     which is hidden here, so this drives the footer controls the menu is built
     from. One list, reached from two places. */
  /* The settings menu lives in the toolbar, which is not on screen here — so
     the landing gets its own copy of the same list.

     Built by buildSettings() from the footer controls, exactly as the
     toolbar's is. One source, two places it can be opened from.

     An earlier version added a "more-open" class: that was the old
     footer-panel mechanism, removed two releases before, so the button did
     nothing at all. */
  on("homeSettings", "click", function (ev) {
    ev.stopPropagation();
    var pop = $("tbSettingsPop"), host = $("homeSettings");
    if (!pop || !host) return;
    var opening = pop.hidden;
    if (opening) {
      buildSettings();
      /* Moved under the button rather than left in the toolbar, which is
         hidden here and would leave the menu floating over nothing. */
      host.parentNode.insertBefore(pop, host.nextSibling);
    }
    pop.hidden = !opening;
    pop.classList.toggle("as-home", opening);
  });

  /* Shown when the sheet opens rather than at boot, so a code is only put on
     screen for somebody who went looking for it. */
  function renderDeviceCode() {
    var el = $("acctCode");
    if (el) el.textContent = formatCode(deviceCode());
  }

  on("acctCodeCopy", "click", function () {
    var code = formatCode(deviceCode());
    try {
      navigator.clipboard.writeText(code);
      toast("Code copied", "Enter it on your other device");
    } catch (e) {
      /* Clipboard refused, which happens without a secure context or a user
         gesture the browser trusts. The code is on screen either way, so say
         so rather than failing silently. */
      toast("Copy it by hand", code);
    }
  });

  on("acctCodeGo", "click", function () {
    var raw = ($("acctCodeInput") && $("acctCodeInput").value) || "";
    var code = String(raw).toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (code.length !== 12) {
      toast("That code is not right", "Twelve characters, like XXXX-XXXX-XXXX", "loss");
      return;
    }
    claimCode(code, function () {
      /* Entering a code is the moment anonymous play becomes an account: the
         server has to hold it for the other device to find it. Said once,
         here, rather than letting it happen quietly. */
      toast("Devices linked", "Your results are saved and will follow you");
      $("accountSheet").classList.remove("show");
    });
  });

  on("homeSignIn", "click", function () {
    var b = $("accountToggle");
    if (b) b.click();
  });
  on("kickBack", "click", showHome);
  /* From inside a game. Switching modes now goes through the menu rather than
     a button that silently moves you between a scored daily and free practice. */
  on("menuBtn", "click", function () {
    if (board.kind === "daily" && started && !complete) {
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
      openBoard({ kind: "theme",
                  theme: { theme: themed[1], no: Number(themed[2]), id: null } });
      setHomeVisible(false);
      /* Checked on the way out rather than caught: buildPuzzle() handles its
         own failures — it shows the nudge and resolves — so a .catch() here
         never fires and a link to a board that is not out left the player on a
         dead screen with no way back to the menu. If no puzzle arrived, no
         puzzle arrived. */
      buildPuzzle(null).then(function () {
        if (puzzle) return;
        openBoard({ kind: "practice" });
        toast("That board is not available", "It may not have been released yet.", "loss");
        showHome();
      });
      return;
    }
    var shared = /[?&]p=(\d+)/.exec(location.search || "");
    if (shared) {
      openBoard({ kind: "practice", token: "practice:" + shared[1] });
      /* Same shape, and the same reason: the .catch() this replaces could not
         fire, so a stale practice link showed an error and nothing else. */
      buildPuzzle(null).then(function () {
        /* The token is spent once the board is built; a reopen must not reuse
           it. Reopened as a plain practice board rather than mutating a frozen
           value. */
        if (puzzle) openBoard({ kind: "practice" });
        else showHome();
      });
      return;
    }
    /* A game already under way resumes. Anything else goes to the choice.

       The note this replaces says guessing a board.kind is how the daily's clock
       ended up running on a game nobody had picked, and that is still true —
       so this does not guess a board.kind. It resumes a PUZZLE that is already
       started and not finished: the letters are on disk, the clock has been
       running against it, and the player was on it moments ago. Reopening
       something you are mid-way through is not a guess about what you want.

       Finished games and untouched modes still land on the menu, because
       either of those would mean starting something new on your behalf. */
    var last = null;
    try { last = localStorage.getItem("fcw.mode"); } catch (e) {}
    /* Left deliberately last time: show the menu, whatever is saved. */
    var resumeChoices = 0;
    var atHome = false;
    try { atHome = !!localStorage.getItem("fcw.athome"); } catch (e) {}

    /* Boot has to find a game in progress on ANY board, not just today's.

       savedFor("daily") defaults to today's slot, which is right for the
       landing screen — it asks "has today been played?" — and wrong here, where
       the question is "was anything left unfinished?". Asking the default meant
       an archive board in progress was invisible and boot showed the menu: the
       same class of fault this refactor exists to remove, reintroduced by the
       refactor itself.

       Scans the daily slots instead, newest first, and stops at the first
       unfinished one. */
    var saved = null;
    if (!atHome) {
      if (last === "practice" || last === "theme") saved = savedFor(last);
      else if (last === "daily") {
        /* One resumes. Several means several boards were left going, and
           picking one for the player would be a guess — the landing screen says
           how many and lets them choose. */
        var open_ = unfinishedDailies();
        if (open_.length === 1) saved = open_[0];
        else if (open_.length > 1) resumeChoices = open_.length;
      }
    }

    /* A themed board resumes through openThemed(), not chooseMode().

       It was left out of the first version and the difference showed straight
       away: practice survived a refresh and a club board did not. A themed
       game needs to know WHICH board it was, and chooseMode() has no argument
       for that — the save carries it as themeKey ("arsenal-wenger-era-3"), put
       there for exactly this reason.

       Split on the last hyphen: theme ids contain hyphens and the board number
       does not, so the last one is always the boundary. */
    if (last === "theme" && saved && inProgress(saved) && saved.themeKey) {
      var cut = String(saved.themeKey).lastIndexOf("-");
      var tId = cut > 0 ? saved.themeKey.slice(0, cut) : null;
      var tNo = cut > 0 ? Number(saved.themeKey.slice(cut + 1)) : NaN;
      if (tId && isFinite(tNo)) {
        openThemed(tId, tNo);
        return;
      }
    }
    /* Today's daily only.

       chooseMode("daily") starts a FRESH puzzle when the save is not today's —
       so resuming on a stale save would have started the clock on a game
       nobody picked, which is the exact fault the note above describes. The
       save has to be both unfinished and the one currently open.

       Practice has no such date, so an unfinished practice puzzle is always
       the one that was being played. */
    /* Theme is handled above and must not fall through to here.

       chooseMode() has no theme branch — it would reach newPuzzle() and open a
       random practice board while calling itself "theme". A themed save
       without a themeKey cannot say which board it was, so there is nothing to
       resume and the menu is the honest answer. */
    var resumable = last !== "theme" && saved && inProgress(saved);
    if (resumable) {
      /* Reopen the board that was actually being played, not today's.

         This used to require saved.dailyNo === dailyNumber(), which was right
         when today's was the only daily reachable. With the archive open it
         meant an unfinished board from last week could never resume: the check
         refused it, boot showed the menu, and the menu set fcw.athome — so the
         next refresh refused it again for a second reason. A letter and a
         minute on the clock, lost on every reload.

         The original worry stands and is handled: chooseMode("daily") starts a
         FRESH puzzle when the save is not today's, which would put the clock on
         a board nobody picked. Naming the board in the target is what stops
         that — it reopens the one in the save. */
      if (last === "daily") {
        var no = saved.dailyNo || today();
        chooseMode("daily", { kind: "daily", no: no});
      } else {
        chooseMode(last);
      }
      return;
    }
    renderHome();
    setHomeVisible(true);
    if (resumeChoices > 1) {
      toast(resumeChoices + " boards in progress",
            "Pick one from Previous puzzles.");
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
    /* Nothing opened yet: board.no is null on the landing screen, and null is
       not today, so without this the sync decided the clock was wrong and
       opened a board nobody had chosen. */
    if (!board.no || today() === board.no) return;
    /* An earlier board is not a wrong clock.

       This exists for a device whose date is off: it corrects the puzzle before
       kick-off, when nothing is at stake. But since the archive opened,
       board.no is deliberately not today's whenever an earlier board is being
       played — so the sync read that as a bad clock and called bootDaily(),
       which loaded today's board over the top.

       That is what showed as the letters appearing for a moment and then a
       blank grid with the Kick Off card: the restore worked, and this replaced
       it a second later. */
    if (board.openedAsToday && board.no !== today() && !started && !complete) {
      chooseMode("daily", { kind: "daily", no: today()});
    }
  });
})();
