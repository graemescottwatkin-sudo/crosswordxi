/* Scrambled XI — game.js
 *
 * The browser holds no names. It holds scrambles, positions and whatever the
 * server has told it, and every guess goes up to be marked. That is not
 * security theatre — the scramble IS the letters, so an anagram solver beats
 * this board however it is served — it is what stops the whole XI, its aliases
 * and its hint values riding down in the payload for free.
 *
 * WHAT IS DELIBERATELY NOT HERE (v001, first build on the monorepo):
 *   - no accounts, no challenges, no leaderboard. All three port from
 *     Crossword XI largely unchanged once the game is worth sharing.
 *   - no server-trusted score. There is no play row, so the number on the Full
 *     Time card is assembled here and the card says so. "Unverified" is the
 *     truth rather than a number that looks authoritative and is not.
 *   - no practice. There is now an archive picker and a finals catalogue; what
 *     is still missing is a practice mode, which this game may never want.
 */
var BUILD = "v002a";

(function () {
  "use strict";

  var CFG = window.SCX_CONFIG;
  var SCORING = window.SCX_SCORING;

  /* This game's localStorage namespace. Distinct per game or two games sharing
     a browser overwrite each other's saves. Family-wide facts (the theme) live
     under "xi." and belong to the chrome, not here. */
  var PREFIX = "xisc.";

  var $ = function (id) { return document.getElementById(id); };

  /* Wiring a control that is not on the page must not take the page down with
     it — the same helper, and the same reasoning, as the crossword's. */
  function on(id, evt, fn) {
    var el = $(id);
    if (!el) { console.warn("Missing element: " + id); return; }
    el.addEventListener(evt, fn);
  }

  var state = {
    board: null,
    solved: {},        // slotId -> { name, how: "solved" | "revealed" }
    hints: {},         // slotId -> the hint value, once bought or given
    letters: {},       // slotId -> string of leading letters revealed
    help: 0,           // points spent off the bench
    startedAt: null,
    elapsed: 0,
    picked: null,
    teamTalkDone: false,
    /* WHETHER THE CAREERS HAVE BEEN REVEALED, as one fact rather than as
       eleven. Derived from state.hints it would be wrong: a slot whose player
       has no career on file never gets an entry, so "every slot has a hint"
       is false on a board that has already given up everything it has — and
       the player would be charged a second time for nothing. */
    hintsRevealed: false,
    over: false
  };

  /* ---- the landing ---------------------------------------------------- */

  /* FORM, drawn by the shared chrome so a win looks the same in every game.
     This game owns what a RESULT is — a numbered board, like the crossword —
     and hands over only the scores. A run is consecutive BOARD NUMBERS ending
     at today's or yesterday's: finishing an old board today does not revive a
     streak, which is the rule the other two already keep. */
  function renderForm() {
    var el = $("homeRun"), title = $("homeRunTitle");
    if (!el || !window.XIChrome) return;
    var done = readResults().filter(function (r) { return r && typeof r.no === "number"; })
      .sort(function (a, b) { return a.no - b.no; });
    if (!done.length) {
      title.textContent = "No run yet";
      el.innerHTML = window.XIChrome.formChips([]) +
        '<span class="run-none">Play today to start one.</span>';
      return;
    }
    var nos = done.map(function (r) { return r.no; });
    var today = state.todayNo || nos[nos.length - 1];
    var run = 0;
    if (nos[nos.length - 1] >= today - 1) {
      run = 1;
      for (var i = nos.length - 1; i > 0; i--) {
        if (nos[i - 1] === nos[i] - 1) run++; else break;
      }
    }
    var best = 1, walk = 1;
    for (var k = 1; k < nos.length; k++) {
      walk = nos[k - 1] === nos[k] - 1 ? walk + 1 : 1;
      if (walk > best) best = walk;
    }
    title.textContent = run + " day run";
    el.innerHTML = window.XIChrome.formChips(
      done.map(function (r) { return r.score; })) +
      '<span class="run-best">best ' + best + "</span>";
  }

  /* PLAY AS, from the family's club list rather than a copy of it. Stored
     under xi. because the club is the player, not the game. */
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
      try { localStorage.setItem("xi.club", sel.value); } catch (e) {}
    };
  }

  /* THE BOARD OF THE WEEK, picked by the week rather than chosen by anyone:
     derived from the ISO week so everyone sees the same one and it turns over
     on Monday with nothing scheduled and nothing stored. Drawn only from
     boards already released, so it can never name a future XI. */
  function renderLanding() {
    var today = state.todayNo || 0;
    if (today > 0) {
      var utc = todayUTC();
      var pick = (Math.floor(utc / 604800000) % today) + 1;
      $("homeFeaturedName").textContent = "Board #" + pick;
      $("homeFeaturedState").textContent = "One of " + today + " released";
      /* ONE NAMED BOARD, SO THE CLICK IS THE ANSWER. This reloaded the page at
         the board's permalink, which opened its start card and asked to be
         clicked again — the same two steps as the daily, for a card that has
         already made the choice. It opens and kicks off. */
      $("homeFeatured").onclick = function () {
        openBoard({ kind: "daily", no: pick }, { play: true });
      };
      $("homePreviousCount").textContent = today + " boards so far";
    }
    renderForm();
    fillClubs();
  }

  /* ---- previous boards, as a calendar -----------------------------------

     This card opened yesterday's board. That is not an archive, it is one
     board with a plural label: everything before yesterday was unreachable
     and nothing said which days had been played. The crossword answered this
     with a month grid and the same answer belongs here.

     THE DATES ARE DERIVED, NOT STORED A SECOND TIME. Board #N ran (today - N)
     days before today, and the server said what today is — so there is no
     epoch written down here to drift from the one the server keeps. UTC
     throughout, because the server decides what day it is. */
  var DAY_MS = 86400000;
  var calMonth = null;   // {y, m} of the month on screen, in UTC

  function todayUTC() {
    var n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  }
  function dateForNo(no) { return new Date(todayUTC() - ((state.todayNo || 0) - no) * DAY_MS); }
  function noForDate(ms) { return (state.todayNo || 0) - Math.round((todayUTC() - ms) / DAY_MS); }

  function openArchive() {
    calMonth = null;
    renderCalendar();
    $("archiveSheet").classList.add("show");
  }
  function closeArchive() { $("archiveSheet").classList.remove("show"); }

  function stepCalendar(by) {
    var d = calMonth || monthOf(dateForNo(state.todayNo || 1));
    var n = new Date(Date.UTC(d.y, d.m + by, 1));
    calMonth = { y: n.getUTCFullYear(), m: n.getUTCMonth() };
    renderCalendar();
  }
  function monthOf(d) { return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; }

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  function renderCalendar() {
    var grid = $("calGrid");
    if (!grid) return;
    var today = state.todayNo || 0;
    var first = calMonth || monthOf(dateForNo(today || 1));
    calMonth = first;

    var played = {};
    readResults().forEach(function (r) {
      if (r && typeof r.no === "number") played[r.no] = r;
    });

    $("calMonth").textContent = MONTHS[first.m] + " " + first.y;

    /* Monday first: this is a football game and the week starts on Monday
       everywhere it is played. getUTCDay() puts Sunday at 0, hence the shift. */
    var firstMs = Date.UTC(first.y, first.m, 1);
    var lead = (new Date(firstMs).getUTCDay() + 6) % 7;
    var days = new Date(Date.UTC(first.y, first.m + 1, 0)).getUTCDate();

    var out = [], i;
    for (i = 0; i < lead; i++) out.push('<div class="cal-cell empty"></div>');
    for (i = 1; i <= days; i++) {
      var no = noForDate(Date.UTC(first.y, first.m, i));
      var cls = "cal-cell", body = "";
      if (no < 1 || no > today) {
        cls += " none";
      } else if (played[no]) {
        cls += " done";
        /* On its own line under the date: rendered inline, "24" with a score
           of 97 read as "2497". */
        body = '<b class="cal-score">' +
          (played[no].score != null ? played[no].score : "✓") + "</b>";
      } else if (no === today) {
        /* Today is the hero on the landing screen, not something missed — the
           day is not over. Marked so it can be seen and tapped. */
        cls += " today open";
      } else {
        cls += " open";
      }
      out.push('<button type="button" class="' + cls + '" data-no="' +
        (no >= 1 && no <= today ? no : "") + '"><span>' + i + "</span>" + body + "</button>");
    }
    grid.innerHTML = out.join("");

    /* Never past the month today falls in, and never before the first board:
       an arrow that does nothing is worse than one that is plainly off. */
    var thisMonth = monthOf(dateForNo(today || 1));
    var firstEver = monthOf(dateForNo(1));
    $("calNext").disabled = first.y > thisMonth.y ||
      (first.y === thisMonth.y && first.m >= thisMonth.m);
    $("calPrev").disabled = first.y < firstEver.y ||
      (first.y === firstEver.y && first.m <= firstEver.m);

    var left = 0;
    for (i = today - 1; i >= 1; i--) if (!played[i]) left++;
    $("archiveSub").textContent = left === 0
      ? "You have played every board so far."
      : left + (left === 1 ? " board" : " boards") + " left to play";
  }

  /* Delegated: the grid is rebuilt on every render, so a handler per cell
     would have to be rebound each time. */
  on("calGrid", "click", function (ev) {
    var cell = ev.target.closest ? ev.target.closest(".cal-cell") : null;
    if (!cell || cell.classList.contains("none") || cell.classList.contains("empty")) return;
    var no = Number(cell.getAttribute("data-no"));
    if (!no) return;
    closeArchive();
    openBoard({ kind: "daily", no: no });
  });

  /* ---- the finals ------------------------------------------------------

     Five hundred and forty-three boards — every cup and play-off final in the
     bank, both XIs of each — have been in the database since the import with
     no way to reach them, because the daily token names a position in a ring
     these boards are deliberately outside. The card said "Soon" and the note
     beside it said they were "not yet imported", which stopped being true a
     long time before anybody noticed.

     Fetched once and kept: it is one list of five fields, and re-fetching it
     every time the sheet opens would be a request per browse. */
  var finals = null;
  var finalsFilter = "";

  function openFinals() {
    $("finalsSheet").classList.add("show");
    var box = $("finalsInput");
    if (box) box.focus({ preventScroll: true });
    if (finals) { renderFinals(); return; }
    $("finalsList").innerHTML = '<div class="sheet-empty">Reading the list…</div>';
    fetch("/api/scrambled/iconic", {
      headers: { "X-XI-Games": "1" }, credentials: "same-origin"
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        finals = (d && d.boards) || [];
        renderFinals();
      })
      .catch(function () {
        $("finalsList").innerHTML =
          '<div class="sheet-empty">Could not reach the list. Try again in a moment.</div>';
      });
  }
  function closeFinals() { $("finalsSheet").classList.remove("show"); }

  /* Matched on everything a row shows, so what is on screen is what is being
     searched: "1999" finds the year, "Liverpool" the side, "FA Cup" the
     competition. Nothing clever — a list this size does not need it. */
  function finalsMatch(row, needle) {
    if (!needle) return true;
    return ((row.title || "") + " " + (row.side || "")).toLowerCase().indexOf(needle) !== -1;
  }

  function renderFinals() {
    var list = $("finalsList");
    if (!list) return;
    var needle = finalsFilter.trim().toLowerCase();
    var rows = (finals || []).filter(function (r) { return finalsMatch(r, needle); });

    if (!rows.length) {
      list.innerHTML = '<div class="sheet-empty">Nothing matches &ldquo;' +
        esc(finalsFilter) + "&rdquo;.</div>";
      $("finalsSub").textContent = (finals || []).length + " finals";
      return;
    }

    /* Grouped by competition and newest first inside it, which is the order
       somebody looking for a final they remember will look in. A board whose
       title does not parse keeps its place under a heading that says so
       rather than being dropped: it is a real board. */
    var groups = {}, order = [];
    rows.forEach(function (r) {
      var key = r.comp || "Other finals";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    order.sort(function (a, b) { return groups[b].length - groups[a].length; });

    var out = [];
    order.forEach(function (key) {
      out.push('<div class="fin-head">' + esc(key) + " <i>" + groups[key].length + "</i></div>");
      groups[key]
        .sort(function (a, b) { return (b.year || 0) - (a.year || 0); })
        .forEach(function (r) {
          out.push('<button type="button" class="fin-row" data-id="' + r.id + '">' +
            '<span class="fin-side">' + esc(r.side || r.title) + "</span>" +
            '<span class="fin-when">' + esc(r.title) + "</span></button>");
        });
    });
    list.innerHTML = out.join("");
    $("finalsSub").textContent = needle
      ? rows.length + " of " + (finals || []).length + " finals"
      : rows.length + " finals, both XIs of each";
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  on("finalsList", "click", function (ev) {
    var row = ev.target.closest ? ev.target.closest(".fin-row") : null;
    if (!row) return;
    closeFinals();
    openBoard({ kind: "iconic", id: row.getAttribute("data-id") });
  });

  /* ---- the durable record ---------------------------------------------

     TWO STORES WITH TWO JOBS, the same split the other two games use.
     xisc.board.v1.<no> is the board in progress and is pruned; xisc.results
     is the record of what was finished, which is what a run is counted from
     and what the account carries between devices.

     A row is unique by BOARD NUMBER, not by date: this game's boards are
     numbered and a player can finish yesterday's today. The crossword keys on
     dailyNo for the same reason. */
  var RESULTS_KEY = PREFIX + "results";
  var account = null;

  function readResults() {
    try {
      var r = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }

  function recordResult(rec) {
    try {
      /* FIRST RESULT BANKED WINS, which is the family's merge rule. Replaying
         a board you have already finished does not overwrite the run you set
         on it. */
      var all = readResults();
      if (all.some(function (r) { return r && r.no === rec.no; })) return;
      all.push(rec);
      localStorage.setItem(RESULTS_KEY, JSON.stringify(all.slice(-800)));
    } catch (e) {}
    /* The device keeps the record whatever happens next. Pushing it to the
       account is a best effort on top: a failed push leaves the row where it
       is and the next sync carries it. */
    pushResults();
  }

  /* The session cookie is scoped to the family, so a player signed in on
     another game is already signed in here. */
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

  /* Failures here are logged and swallowed. A sync that cannot reach the
     server is not a signed-out player, and telling them so mid-game would be
     a lie they cannot act on. */
  function accountNote(what, e) {
    try { console.info("scrambled account " + what + ": " + (e && e.message)); } catch (x) {}
  }

  function pushResults() {
    if (!account) return Promise.resolve(null);
    return apiAuth("/api/account/migrate", { game: "scrambled", results: readResults() })
      .catch(function (e) { accountNote("push", e); return null; });
  }

  function pullResults() {
    if (!account) return Promise.resolve(null);
    return apiAuth("/api/account/results?game=scrambled").then(function (r) {
      var remote = (r && r.results) || [];
      if (!remote.length) return null;
      /* THE ACCOUNT'S ROW WINS OUTRIGHT on pull, and unpushed local rows
         survive — the family's rule, so a device that has been offline does
         not lose what it banked while it was. */
      var byNo = {};
      readResults().forEach(function (r2) { if (r2 && r2.no != null) byNo[r2.no] = r2; });
      remote.forEach(function (r2) { if (r2 && r2.no != null) byNo[r2.no] = r2; });
      var merged = Object.keys(byNo).map(function (k) { return byNo[k]; })
        .sort(function (a, b) { return a.no - b.no; });
      try { localStorage.setItem(RESULTS_KEY, JSON.stringify(merged.slice(-800))); } catch (e) {}
      renderForm();
      return merged;
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
      /* A transient failure is NOT a sign-out. Nulling the account here would
         make one dropped request look like being logged out. */
      accountNote("session", e);
      return null;
    });
  }

  /* ---- storage ---------------------------------------------------------- */

  /* ONE KEY PER BOARD, AND A BOARD IS NOT ALWAYS A NUMBER. A final has no
     place in the ring, so it has no number to key on and its id is used
     instead — prefixed, because id 12 and board #12 are different boards and
     an unprefixed key would have them share a save. */
  function storeKey() {
    var b = state.board;
    if (!b) return PREFIX + CFG.STORAGE_KEY + ".0";
    if (b.iconic) return PREFIX + CFG.STORAGE_KEY + ".f" + b.id;
    if (b.preview) return PREFIX + CFG.STORAGE_KEY + ".p" + b.id;
    return PREFIX + CFG.STORAGE_KEY + "." + b.no;
  }

  function save() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({
        solved: state.solved, hints: state.hints, letters: state.letters,
        hintsRevealed: state.hintsRevealed,
        help: state.help, elapsed: state.elapsed, over: state.over
      }));
    } catch (e) { /* a full or blocked store must not end the game */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(storeKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  /* ---- the clock -------------------------------------------------------- */

  var ticker = null;

  function startClock() {
    state.startedAt = Date.now() - state.elapsed * 1000;
    if (ticker) clearInterval(ticker);
    ticker = setInterval(tick, 500);
    tick();
    playsStart();
  }

  /* HOW FAR PEOPLE GET, counted through the family's helper: a start when
     the clock first runs on a board, an end at full time or on the way out
     of the page. Guarded on active(), because the clock also restarts when
     a hidden tab comes back and that is the same attempt. Nothing about the
     person; see shared/xi-plays.js. */
  function playsProgress() {
    var ids = Object.keys(state.solved);
    return {
      solved: ids.length, elapsed: Math.round(state.elapsed || 0),
      detail: {
        help: state.help,
        revealed: ids.filter(function (k) { return state.solved[k] && state.solved[k].how === "revealed"; }).length,
      },
    };
  }
  function playsStart() {
    if (!window.XIPlays || window.XIPlays.active() || !state.board || state.over) return;
    /* The board's own token IS its key — the thing the server already uses to
       name this board — rather than a second spelling built here. And a board
       off the ring is mode "free", which is what the family calls a board that
       was chosen rather than served: no run at stake. */
    window.XIPlays.start({
      game: "scrambled",
      mode: state.board.no == null ? "free" : "daily",
      boardKey: state.board.token,
      total: 11,
    }, playsProgress);
  }
  function playsEnd(completed) {
    if (window.XIPlays && window.XIPlays.active()) window.XIPlays.end(!!completed);
  }

  function stopClock() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function tick() {
    if (state.over) return;
    state.elapsed = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    var minute = SCORING.matchMinute(state.elapsed);
    $("clockValue").textContent = minute;
    $("worthNow").textContent = SCORING.computeScore(state.elapsed, state.help).score;
    if (CFG.HALF_TIME_MINUTE !== null && !state.teamTalkDone &&
        minute >= CFG.HALF_TIME_MINUTE) teamTalk();
  }

  if (CFG.PAUSE_ON_TAB_HIDDEN) {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopClock();
      else if (state.board && !state.over) startClock();
    });
  }

  /* ---- the pitch -------------------------------------------------------- */

  function bandY(id) {
    var b = (state.board.bands || []).find(function (x) { return x.id === id; });
    return b ? b.y : 0.5;
  }

  function tileText(slot) {
    var got = state.solved[slot.id];
    /* The REVEAL, not the cypher: a solved tile reads GARY LINEKER, because
       that is the moment of recognition. The cypher was only ever the letters
       to unscramble. */
    if (got) return String(got.name).toUpperCase();
    var known = state.letters[slot.id] || "";
    if (!known) return slot.scramble;
    /* Revealed letters sit in front, in order, and the rest of the bag follows
       — so a bought letter is visibly worth something without turning the tile
       into a different puzzle. */
    return known + " \u00B7 " + remainingBag(slot, known);
  }

  /* ---- what the typing shows -------------------------------------------
     Type a letter and every tile that could supply it lifts that letter out of
     its bag. Type another and the tiles that cannot supply BOTH drop back to
     their full scramble. So the board answers "which of these could my word
     be" while it is being typed, rather than only when it is submitted.

     Matched against the bag as a MULTISET, in the order typed: TTUB supplies a
     T, and still supplies a second T, but never an S. That is why BUTT holds
     on "T" and lets go on "TS" while STAM keeps both — which is the whole
     point, because those two tiles are indistinguishable on a first look.

     It reads only the letters already on screen. Nothing is asked of the
     server, so this cannot leak which tile is the answer: a tile that can
     supply the letters is not a tile that IS the word. */
  function supplyFrom(bag, typed) {
    var pool = bag.split("");
    for (var i = 0; i < typed.length; i++) {
      var at = pool.indexOf(typed[i]);
      if (at === -1) return null;
      pool.splice(at, 1);
    }
    return pool.join("");
  }

  function remainingBag(slot, known) {
    var pool = slot.scramble.split("");
    known.split("").forEach(function (ch) {
      var at = pool.indexOf(ch);
      if (at > -1) pool.splice(at, 1);
    });
    return pool.join("");
  }

  /* Repaints the tiles for whatever is currently typed. Targeted rather than a
     drawPitch(): the pitch is rebuilt on every change elsewhere, and rebuilding
     eleven buttons on every keystroke would throw away focus and the picked
     tile mid-word. */
  function paintTyped() {
    var typed = ($("answer").value || "").toUpperCase().replace(/[^A-Z]/g, "");
    state.board.slots.forEach(function (slot) {
      var el = document.querySelector('.slot[data-slot="' + slot.id + '"]');
      if (!el) return;
      var lifted = el.querySelector(".lifted");
      var letters = el.querySelector(".letters");
      if (!letters) return;
      /* A solved tile shows its name and takes no further part. */
      if (state.solved[slot.id]) { if (lifted) lifted.textContent = ""; return; }
      var rest = typed ? supplyFrom(slot.scramble, typed) : null;
      if (rest === null) {
        if (lifted) lifted.textContent = "";
        el.classList.remove("could");
        letters.textContent = tileText(slot);
        return;
      }
      if (lifted) lifted.textContent = typed;
      el.classList.add("could");
      letters.textContent = rest;
    });
    paintEcho();
  }

  /* THE PICKED TILE, ECHOED ABOVE THE BOX. On a phone the system keyboard
     scrolls the box into view and the pitch out of it, so a player typing at
     a tile could not see the tile. The echo repeats what the tile shows —
     position, the letters lifted so far, the letters left in the bag, the
     enumeration — and the box sits directly under it, so whatever the
     keyboard does to the page the two stay together. Hidden when no tile is
     picked: typing at the whole board has eleven tiles to watch, not one. */
  function paintEcho() {
    var echo = $("echo");
    if (!echo) return;
    var id = state.picked;
    var slot = id && state.board ? slotOf(id) : null;
    if (!slot || state.solved[id]) { echo.hidden = true; return; }
    var typed = ($("answer").value || "").toUpperCase().replace(/[^A-Z]/g, "");
    var rest = typed ? supplyFrom(slot.scramble, typed) : null;
    $("echoPos").textContent = slot.pos;
    $("echoLifted").textContent = rest === null ? "" : typed;
    $("echoLetters").textContent = rest === null ? tileText(slot) : rest;
    $("echoEnum").textContent = "(" + slot.len.join(",") + ")";
    echo.hidden = false;
  }

  function drawPitch() {
    var pitch = $("pitch");
    pitch.innerHTML = "";
    ["bottom", "top"].forEach(function (which) {
      var box = document.createElement("div");
      box.className = "box " + which;
      pitch.appendChild(box);
    });

    state.board.slots.forEach(function (slot) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "slot";
      el.style.left = (slot.x * 100) + "%";
      el.style.top = (bandY(slot.band) * 100) + "%";
      el.dataset.slot = slot.id;

      var got = state.solved[slot.id];
      if (got) el.classList.add(got.how === "revealed" ? "given" : "solved");
      if (state.picked === slot.id) el.classList.add("picked");

      var pos = document.createElement("span");
      pos.className = "pos";
      pos.textContent = slot.pos;
      el.appendChild(pos);

      /* The lifted line: the letters the player has typed that THIS tile could
         supply, sitting above the bag they came out of. Empty for every tile
         until something is typed. */
      var lifted = document.createElement("span");
      lifted.className = "lifted";
      el.appendChild(lifted);

      var letters = document.createElement("span");
      letters.className = "letters";
      letters.textContent = tileText(slot);
      el.appendChild(letters);

      if (!got) {
        var en = document.createElement("span");
        en.className = "enum";
        en.textContent = "(" + slot.len.join(",") + ")";
        el.appendChild(en);
      }

      if (state.hints[slot.id] && !got) {
        var h = document.createElement("span");
        h.className = "hint" + (slot.id === state.picked ? " focus" : "");
        h.textContent = state.hints[slot.id];
        el.appendChild(h);
      }

      /* WHAT THE PLAYER IS KNOWN FOR, under the name, once the tile is solved.
         Two clubs at most: the point is recognition, not a career listing —
         the full history is what the career hint sells, and repeating all of
         it here would give away for free what the bench charges for. */
      if (got && got.clubs && got.clubs.length) {
        var cl = document.createElement("span");
        cl.className = "clubs";
        cl.textContent = got.clubs.map(function (c) {
          /* No number where the bank has no count. Printing 0 would claim he
             never played for them, which is not what missing data means. */
          return c.apps ? c.club + " " + c.apps : c.club;
        }).join(" · ");
        el.appendChild(cl);
      }

      el.setAttribute("aria-label",
        slot.pos + ", " + (got
          ? got.name + (got.clubs && got.clubs.length
              ? ", " + got.clubs.map(function (c) {
                  return c.apps ? c.club + ", " + c.apps + " appearances" : c.club;
                }).join("; ")
              : "")
          : "scrambled, " + slot.len.join(" and ") + " letters"));
      el.addEventListener("click", function () { pick(slot.id); });
      pitch.appendChild(el);
    });

    $("solvedCount").textContent = Object.keys(state.solved).length;
    $("helpSpent").textContent = state.help;
    /* Painted at the end of every rebuild too, not only on input. drawPitch()
       runs on any change — a solve, a bought letter, a pick — and it recreates
       the tiles, so without this the lifted letters would vanish mid-word. It
       also covers the reverse: submit() clears the box by assignment, and a
       programmatic value change fires no input event. */
    paintTyped();
  }

  /* ---- the bench -------------------------------------------------------- */

  function pick(slotId) {
    if (state.over) return;
    if (state.solved[slotId]) { state.picked = null; hideBench(); drawPitch(); paintEcho(); return; }
    state.picked = slotId;
    syncBench();
    drawPitch();
  }

  /* THE BENCH IS REDRAWN AFTER EVERY PURCHASE, NOT ONLY WHEN A TILE IS PICKED.
     It was set up in pick() alone, so buying a hint left its button enabled:
     the guard in buy() refused the second purchase correctly and silently, and
     the player was left clicking a live control that did nothing. A control
     that is enabled and inert is worse than one that is disabled, because the
     player has no way to tell it apart from a broken game. Found by
     journey_test.mjs on its first honest run. */
  function syncBench() {
    var id = state.picked;
    if (!id) return;
    var slot = slotOf(id);
    var lettersKnown = (state.letters[id] || "").length;
    var nameLength = slot.len.reduce(function (a, b) { return a + b; }, 0);
    $("benchFor").textContent = "Bench \u2014 " + slot.pos + ", (" + slot.len.join(",") + ")";
    /* A BOARD THAT SELLS NOTHING OFFERS NOTHING. hintLabel is null when the
       bench has no hint to sell \u2014 a board declaring "none", or a last-two
       board whose hint is the fixture on its start card \u2014 and a button that
       charged for an empty answer would be the purchase of nothing the hint
       rule exists to prevent. Letters and names stay on sale. */
    var sells = !!state.board.hintLabel;
    $("hintLabel").textContent = state.board.hintLabel || "";
    $("buyHint").hidden = !sells;
    $("hintCost").textContent = "\u2212" + CFG.REVEAL_HINT_COST;
    $("letterCost").textContent = "\u2212" + CFG.REVEAL_LETTER_COST;
    $("nameCost").textContent = "\u2212" + CFG.REVEAL_NAME_COST;
    $("buyHint").disabled = !sells || state.hintsRevealed;
    /* PROMINENTLY FOR THE ONE SELECTED. Every tile carries its career once the
       board is revealed, but eleven careers at tile size is a wall of text and
       none of it is answering the question the player is actually asking. The
       bench is where they are looking, so the picked slot's career is repeated
       there at a size that can be read. */
    var mine = state.hints[id];
    $("benchHint").textContent = mine || "";
    $("benchHint").hidden = !mine;
    paintEcho();
    /* The last letter is never for sale: a letter reveal that completes the
       name is a name reveal at the cheaper price. The server refuses it; the
       button has to say so rather than take the click and return nothing. */
    $("buyLetter").disabled = lettersKnown >= nameLength - 1;
    $("benchRow").hidden = false;
  }

  function hideBench() { $("benchRow").hidden = true; }

  function slotOf(id) {
    return state.board.slots.find(function (s) { return String(s.id) === String(id); });
  }

  function post(path, body) {
    return fetch("/api/scrambled/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function buy(kind) {
    var id = state.picked;
    if (!id || state.solved[id]) return;
    post("reveal", {
      token: state.board.token, slotId: id, kind: kind,
      known: (state.letters[id] || "").length
    }).then(function (r) {
      if (r.error) return say(r.error, "bad");
      if (kind === "hint") {
        /* Charged on the transition, not on the click: the board is revealed
           once and the button goes dead, so a second click cannot bill for a
           thing the player already owns. */
        if (state.hintsRevealed) return;
        adoptHints(r.hints);
        state.help += CFG.REVEAL_HINT_COST;
        say(hintNoun() + " shown for the whole XI — " +
          slotOf(id).pos + " in front.", "good");
      } else if (kind === "letter") {
        if (r.index === null) return say("Nothing left to give away there.", "");
        state.letters[id] = (state.letters[id] || "") + r.letter;
        state.help += CFG.REVEAL_LETTER_COST;
      } else if (kind === "name") {
        state.solved[id] = { name: r.name, clubs: r.clubs, how: "revealed" };
        state.help += CFG.REVEAL_NAME_COST;
        state.picked = null;
        hideBench();
        say(r.name.toUpperCase() + " \u2014 given.", "");
      }
      save();
      syncBench();
      drawPitch();
      tick();
      checkFullTime();
    });
  }

  /* THE ONE PLACE HINTS ARRIVE, bought or given. Both routes now ask the same
     question and get the same board-wide answer, so neither can drift into
     showing something the other would not. */
  /* WHAT THIS BOARD SELLS, AS A NOUN. hintField is a data key — "clubs" —
     and reading it out to the player produced "every clubs, free". The label
     is the sentence the board already states about itself, so the noun comes
     off the front of that and there is no second list to keep in step. */
  function hintNoun(b) {
    var src = b || state.board || {};
    return String(src.hintLabel || "").replace(/^Reveal /, "") || "hint";
  }

  function adoptHints(map) {
    if (!map) return;
    Object.keys(map).forEach(function (k) { state.hints[k] = map[k]; });
    state.hintsRevealed = true;
  }

  /* THE TEAM TALK. Free, automatic, once, at half time: every hint is given.
     Eleven anagrams have no intersections, so nothing gets easier as you
     solve — what is left at the end is by definition what you had no route
     into. Without this the second half charges for time that cannot be turned
     into progress. */
  function teamTalk() {
    state.teamTalkDone = true;
    if (state.hintsRevealed) return;
    /* Nothing to give on a board that sells nothing: the manager has no
       careers to hand out, and saying he had would be a half time of nothing. */
    if (!state.board.hintLabel) return;
    /* One request, where this used to fire eleven in parallel — the board
       answers for every slot now, so eleven round trips bought nothing but
       eleven chances for one of them to fail alone. */
    post("reveal", { token: state.board.token, kind: "hint" }).then(function (r) {
      if (!r || r.error) return;
      adoptHints(r.hints);
      save();
      drawPitch();
      say("Half time. The manager has given you every " +
        hintNoun() + ", free.", "good");
    });
  }

  /* ---- guessing --------------------------------------------------------- */

  function say(text, tone) {
    var el = $("feedback");
    el.textContent = text;
    el.className = "feedback" + (tone ? " " + tone : "");
  }

  function submit() {
    if (state.over) return;
    var typed = $("answer").value.trim();
    if (!typed) return;
    post("guess", {
      token: state.board.token,
      guess: typed,
      solved: Object.keys(state.solved)
    }).then(function (r) {
      if (r.error) return say(r.error, "bad");
      if (r.solvedId) {
        state.solved[r.solvedId] = { name: r.name, clubs: r.clubs, how: "solved" };
        $("answer").value = "";
        state.picked = null;
        hideBench();
        paintEcho();
        say(r.name.toUpperCase() + " \u2014 in.", "good");
        save();
        drawPitch();
        checkFullTime();
      } else {
        say("Not on this board \u2014 or not one you still need.", "bad");
      }
    });
    $("answer").focus();
  }

  function checkFullTime() {
    if (Object.keys(state.solved).length < state.board.slots.length) return;
    state.over = true;
    stopClock();
    playsEnd(true);
    save();
    bankResult();
    showResults();
  }

  /* WHAT A FINISHED BOARD LEAVES BEHIND. Written before the card is drawn, so
     a player who closes the tab on the Full Time screen still keeps it. */
  function bankResult() {
    if (!state.board) return;
    /* A RESULT IS A NUMBERED BOARD. A run here is consecutive board numbers,
       so a board with no number cannot be part of one — and recording it
       under `no: null` would put a row in the record that every reader of the
       record has to remember to skip. The finals are played for their own
       sake; the card still shows the score. */
    if (state.board.no == null) return;
    var res = SCORING.computeScore(state.elapsed, state.help);
    recordResult({
      no: state.board.no,
      title: state.board.title,
      score: res.score,
      elapsedSeconds: Math.round(state.elapsed),
      help: state.help,
      revealed: Object.keys(state.solved).filter(function (k) {
        return state.solved[k] && state.solved[k].how === "revealed";
      }).length,
      at: Date.now(),
    });
  }

  function showResults() {
    var res = SCORING.computeScore(state.elapsed, state.help);
    var mins = Math.floor(state.elapsed / 60), secs = state.elapsed % 60;
    var body = $("resultsBody");
    body.innerHTML = "";

    var score = document.createElement("div");
    score.className = "ftScore";
    score.textContent = res.score + " / " + SCORING.MAX_SCORE;
    body.appendChild(score);

    var line = document.createElement("p");
    line.className = "ftLine";
    line.textContent = state.board.title + " \u00B7 " + mins + "m " + secs + "s \u00B7 " +
      res.timePenalty + " off the clock, " + res.helpPenalty + " off the bench";
    body.appendChild(line);

    var list = document.createElement("ul");
    list.className = "ftList";
    state.board.slots.forEach(function (s) {
      var got = state.solved[s.id] || {};
      var li = document.createElement("li");
      var who = document.createElement("span");
      who.className = "who";
      who.textContent = s.pos + "  " + String(got.name || "").toUpperCase();
      var how = document.createElement("span");
      how.className = "how";
      how.textContent = got.how === "revealed" ? "given" : "unravelled";
      li.appendChild(who); li.appendChild(how);
      list.appendChild(li);
    });
    body.appendChild(list);

    /* The honest note, and it has changed: the result IS recorded now, on the
       device and on the account. What is still true is that the SCORE was
       assembled in this browser — there is no play row the server timed — so
       it is banked as a result and not offered as a verified one. */
    var note = document.createElement("p");
    note.className = "ftUnverified";
    note.textContent = "Kept in your record. The score is worked out in your " +
      "browser, so it is not a verified time.";
    body.appendChild(note);

    var solvedCount = state.board.slots.filter(function (s) {
      return (state.solved[s.id] || {}).how === "solved";
    }).length;
    $("shareText").value =
      (state.board.no == null ? "Scrambled XI" : "Scrambled XI #" + state.board.no) + "\n" +
      state.board.title + "\n" +
      solvedCount + " of 11 unravelled, " + (11 - solvedCount) + " given\n" +
      res.score + "/" + SCORING.MAX_SCORE + " in " + mins + "m " + secs + "s\n" +
      "thexigames.com/scrambled/";

    show("screenResults");
  }

  /* ---- screens ---------------------------------------------------------- */

  function show(id) {
    ["screenLoading", "screenStart", "screenGame", "screenResults"]
      .forEach(function (s) { $(s).hidden = s !== id; });
    /* THE KEYBOARD BELONGS TO THE BOARD. On the landing and the full-time card
       there is nothing to type into, and a keyboard stuck to the bottom of a
       page somebody is reading takes a third of the screen for nothing. The
       crossword hides its own the same way while its landing is up. */
    document.body.classList.toggle("playing", id === "screenGame");
  }

  /* ---- start ------------------------------------------------------------ */

  /* ---- the owner's board picker ----------------------------------------
     Revealed only when the server says this account is an admin, and every
     board it loads comes back through the admin route which re-checks that on
     each request. Convenience, not security — the same reasoning the crossword
     writes above its own owner tools.

     Addressed by board ID, not by the ?no= the public route takes. ?no= is a
     position in the daily ring, and the ring is only the boards eligible for a
     daily — so it moves the moment one is marked daily:false, and a proofing
     link that points somewhere else next week is worse than none. */
  function ownerTools() {
    fetch("/api/admin/whoami", { headers: { "X-XI-Games": "1" }, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.admin) return;
        return fetch("/api/admin/scrambled?list=1", {
          headers: { "X-XI-Games": "1" }, credentials: "same-origin"
        }).then(function (r) { return r.json(); }).then(function (list) {
          if (!list || !list.boards) return;
          var sel = $("ownerBoard");
          var asked = new URLSearchParams(location.search).get("id");
          list.boards.forEach(function (b) {
            var o = document.createElement("option");
            o.value = b.id;
            /* The ring flag is shown, because "why is this never my daily" is
               the first question a picker full of boards invites. */
            o.textContent = "#" + b.id + "  " + b.title + (b.daily ? "" : "   (not in the daily)");
            if (String(b.id) === String(asked)) o.selected = true;
            sel.appendChild(o);
          });
          $("ownerNote").textContent = list.boards.length + " boards, from " + list.source;
          sel.addEventListener("change", function () {
            location.search = "?id=" + encodeURIComponent(sel.value);
          });
          $("ownerBar").hidden = false;
        });
      })
      .catch(function () { /* not an admin, or offline: the bar stays hidden */ });
  }

  /* The permalink is read from the path by the shared chrome, which states
     its shape once for the family — see shared/xi-chrome.js, and
     functions/_lib/permalink.js for the server's half. */
  function permalinkKey() {
    return window.XIChrome && window.XIChrome.permalink ? window.XIChrome.permalink.read() : null;
  }

  /* WHICH BOARD THE PAGE IS AFTER, as one value rather than as a chain of
     conditions read again at every point that needs it. Four routes reach a
     board and they are not variations on one address:

       daily     a position in the ring, today or behind it, run at stake
       iconic    a final, addressed by board id, out of the rotation entirely
       preview   the OWNER's address for any board, re-checked server-side
       (and a signed-out visitor sending ?id= gets a 401 from that route and
       the start card says so, which is the honest failure rather than a
       silent fall back to today's board.)

     ?iconic= rather than a permalink, and it is worth saying why: the
     permalink shape is /scrambled/daily/<board number>, and a final's id is
     1424. In four years the ring reaches 1424 and the same address would mean
     two different boards. A final is not a daily and does not get a daily's
     address. */
  function askFromUrl() {
    var params = new URLSearchParams(location.search);
    var iconic = params.get("iconic");
    if (iconic) return { kind: "iconic", id: iconic };
    var byId = params.get("id");
    if (byId) return { kind: "preview", id: byId };
    /* The permalink is the same question ?no= asks, in the path: one URL, one
       board, forever. It wins over ?no= because it is the address the visitor
       actually came to. */
    var asked = permalinkKey();
    return { kind: "daily", no: Number(asked || params.get("no")) || null,
             fromLink: !!asked };
  }

  function askUrl(ask) {
    if (ask.kind === "iconic") {
      return "/api/scrambled/iconic?id=" + encodeURIComponent(ask.id);
    }
    if (ask.kind === "preview") {
      return "/api/admin/scrambled?id=" + encodeURIComponent(ask.id);
    }
    return "/api/scrambled/daily" + (ask.no ? "?no=" + encodeURIComponent(ask.no) : "");
  }

  /* EVERYTHING A BOARD OWNS, PUT BACK. Opening a second board in the same
     page is new — until the catalogue existed the only way to change board
     was to reload — and every field below belonged to the board that was
     open. Left behind, the finals card would have opened on the daily's
     solved names and its clock. */
  function forgetBoard() {
    stopClock();
    playsEnd(false);
    state.solved = {}; state.hints = {}; state.letters = {};
    state.hintsRevealed = false; state.help = 0;
    state.startedAt = null; state.elapsed = 0;
    state.picked = null; state.teamTalkDone = false; state.over = false;
  }

  /* Opens a board and draws its start card. `play` starts the clock straight
     away, for the places that name one board rather than offering a choice —
     the board of the week is a pick, not a menu, so the pick IS the answer. */
  function openBoard(ask, opts) {
    var play = !!(opts && opts.play);
    forgetBoard();
    return fetch(askUrl(ask), {
      headers: { "X-XI-Games": "1" }, credentials: "same-origin"
    })
      .then(function (r) { return r.json(); })
      .then(function (board) {
        if (board.error) { say(board.error, "bad"); return; }
        state.board = board;
        /* What day it is according to the SERVER, kept so the landing can
           count the archive and judge whether a run reaches today. Never
           computed here: the server decides what day it is. A board off the
           ring carries no `today`, so the count already established stands. */
        if (board.today) state.todayNo = board.today;
        /* Followed a link to an older board: say how old, once, and only
           where the page was OPENED at one. Somebody who just picked a board
           out of the calendar was looking at its date a second ago. */
        if (ask.fromLink && window.XIChrome && window.XIChrome.permalink) {
          window.XIChrome.permalink.aged("scrambled", (state.todayNo || 0) - (board.no || 0));
        }
        address(board);
        $("startTitle").textContent = board.title;
        $("startPool").textContent = board.pool;
        $("startKicker").textContent = startKicker(board);
        /* SHORT, because hc-state is a status line and not a paragraph. The
           full explanation of the clock and the team talk belongs on How to
           play; here it was three lines of small caps across the hero. */
        $("startClock").textContent = "Ninety minutes in " +
          Math.round(CFG.MATCH_CLOCK_REAL_SECONDS / 60) + " of real time" +
          (CFG.HALF_TIME_MINUTE === null ? "" : " · half time is free");

        var saved = load();
        if (saved) {
          state.solved = saved.solved || {};
          state.hints = saved.hints || {};
          state.hintsRevealed = !!saved.hintsRevealed;
          state.letters = saved.letters || {};
          state.help = saved.help || 0;
          state.elapsed = saved.elapsed || 0;
          state.over = !!saved.over;
        }
        renderLanding();
        syncAccount();
        if (state.over) { show("screenResults"); drawPitch(); showResults(); return; }
        if (play) kickOff(); else show("screenStart");
      })
      .catch(function () {
        $("screenLoading").querySelector(".pmLede").textContent =
          "Could not reach today's board. Try again in a moment.";
      });
  }

  /* WHAT THE START CARD CALLS THIS BOARD. Three kinds of board and one line to
     name them: a final says which final, because "BOARD #null" is what it said
     while the number belonged to a ring this board is not in. */
  function startKicker(board) {
    if (board.iconic) return "ICONIC MATCH";
    if (board.preview) return "PREVIEW · BOARD " + board.id;
    return board.no === board.today ? "TODAY" : "BOARD #" + board.no;
  }

  /* THE ADDRESS SAYS WHICH BOARD IS OPEN, so it can be copied and come back
     to the same one. A daily gets the family's permalink; a final gets a
     query, for the reason askFromUrl sets out.

     The other spelling is cleared each time, and that is the point rather
     than tidiness: going from a final to a daily and leaving ?iconic= behind
     would give an address that reloads as the final. The owner's ?id= is left
     alone — it is their address for this page and the owner bar reads it. */
  function address(board) {
    if (board.preview) return;
    try {
      history.replaceState(null, "",
        (board.iconic ? "/scrambled/?iconic=" + encodeURIComponent(board.id)
                      : location.pathname) + location.hash);
    } catch (e) { /* a browser that will not have it keeps the address it has */ }
    var perma = window.XIChrome && window.XIChrome.permalink;
    if (!perma || board.iconic || board.no == null) return;
    if (board.no !== state.todayNo) perma.show("scrambled", board.no);
    else perma.clear("scrambled");
  }

  function boot() { openBoard(askFromUrl()); }

  /* The hero IS the kick off now: one control that says what it opens,
     rather than a card with a button under it. Named, because openBoard also
     kicks off — a board that was chosen by name rather than picked from a
     list has already been decided on, and a second click to confirm it is a
     click that asks nothing. */
  function kickOff() {
    if (!state.board) return;
    $("poolLine").textContent = state.board.pool;
    show("screenGame");
    drawPitch();
    startClock();
    $("answer").focus({ preventScroll: true });
  }
  $("homeDaily").addEventListener("click", kickOff);

  /* The two sheets. Bound once, here, rather than rebound by renderLanding
     each time a board opens — a handler added on every render is a handler
     that fires as many times as the page has loaded a board. */
  on("homePrevious", "click", openArchive);
  on("archiveClose", "click", closeArchive);
  on("calPrev", "click", function () { stepCalendar(-1); });
  on("calNext", "click", function () { stepCalendar(1); });
  on("homeThemed", "click", openFinals);
  /* The header nav drives the controls that already do these jobs, the same
     way the crossword's does. Both of these were in the markup and wired to
     nothing: "Matches" has been a button that does not react since the landing
     was built, because there was nothing yet for it to open. */
  on("navClubs", "click", openFinals);
  on("navToday", "click", function () {
    if (state.board && state.board.no === state.todayNo) { show("screenStart"); return; }
    openBoard({ kind: "daily" });
  });
  on("finalsClose", "click", closeFinals);
  on("finalsInput", "input", function (ev) {
    finalsFilter = ev.target.value || "";
    renderFinals();
  });

  /* ---- the keyboard ----------------------------------------------------

     THE FAMILY'S KEYS, NOT THE DEVICE'S. This game had a plain text input, so
     a phone raised the system keyboard over the pitch — half the board gone,
     and a different keyboard from the one the crossword draws two taps away.
     shared/xi-keys.js builds the same three rows here; what they mean is this
     game's, and here a letter goes in the answer box.

     inputmode is switched to "none" on a touch device rather than making the
     box readonly: readonly takes the caret with it, and a player needs to see
     where the next letter is going. On anything with a real keyboard nothing
     changes at all — no keys are drawn and the box is typed into as before.

     Only the letters, backspace and enter. Every guess is normalised to A-Z
     before it is marked — see functions/_lib/sc-names.js — so a space bar and
     a hyphen would be two keys that cannot change any answer, taking room
     from the twenty-six that can. */
  function keyInto(ch) {
    if (!state.board || state.over) return;
    var box = $("answer");
    box.value += ch;
    paintTyped();
  }
  function keyBack() {
    var box = $("answer");
    box.value = box.value.slice(0, -1);
    paintTyped();
  }
  if (window.XIKeys) {
    var onTouch = window.XIKeys.markTouch();
    if (onTouch) $("answer").setAttribute("inputmode", "none");
    window.XIKeys.build($("osk"), { letter: keyInto, back: keyBack, enter: submit });
  }

  $("submit").addEventListener("click", submit);
  $("answer").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });
  /* "input", not "keydown": keydown fires before the character lands, so the
     tiles would always be one letter behind, and it misses paste and the
     backspace that empties the box. */
  $("answer").addEventListener("input", function () {
    if (state.board && !state.over) paintTyped();
  });
  $("buyHint").addEventListener("click", function () { buy("hint"); });
  $("buyLetter").addEventListener("click", function () { buy("letter"); });
  $("buyName").addEventListener("click", function () { buy("name"); });
  $("benchClose").addEventListener("click", function () {
    state.picked = null; hideBench(); drawPitch(); paintEcho();
  });
  $("copyShare").addEventListener("click", function () {
    $("shareText").select();
    try { document.execCommand("copy"); } catch (e) { /* clipboard blocked */ }
  });
  $("playAgain").addEventListener("click", function () {
    try { localStorage.removeItem(storeKey()); } catch (e) { /* ignore */ }
    location.reload();
  });

  boot();

  /* After boot, deliberately: the board is the page, the owner bar is an extra.
     Ahead of it, the admin check was the first request the page made and pushed
     the board fetch second, which journey_test caught by asserting what the
     FIRST call was. */

  ownerTools();
})();
