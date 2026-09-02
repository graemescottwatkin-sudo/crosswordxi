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
 *   - no practice, no archive picker. One board a day, and the past reachable
 *     only by ?no=N, which the server checks against its own clock.
 */
var BUILD = "v001o";

(function () {
  "use strict";

  var CFG = window.SCX_CONFIG;
  var SCORING = window.SCX_SCORING;

  /* This game's localStorage namespace. Distinct per game or two games sharing
     a browser overwrite each other's saves. Family-wide facts (the theme) live
     under "xi." and belong to the chrome, not here. */
  var PREFIX = "xisc.";

  var $ = function (id) { return document.getElementById(id); };

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
      var utc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
      var pick = (Math.floor(utc / 604800000) % today) + 1;
      $("homeFeaturedName").textContent = "Board #" + pick;
      $("homeFeaturedState").textContent = "One of " + today + " released";
      $("homeFeatured").onclick = function () { location.search = "?no=" + pick; };
      $("homePreviousCount").textContent = today + " boards so far";
      $("homePrevious").onclick = function () {
        location.search = "?no=" + Math.max(1, today - 1);
      };
    }
    renderForm();
    fillClubs();
  }

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

  function storeKey() {
    return PREFIX + CFG.STORAGE_KEY + "." + (state.board ? state.board.no : "0");
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
    if (state.solved[slotId]) { state.picked = null; hideBench(); drawPitch(); return; }
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
    save();
    bankResult();
    showResults();
  }

  /* WHAT A FINISHED BOARD LEAVES BEHIND. Written before the card is drawn, so
     a player who closes the tab on the Full Time screen still keeps it. */
  function bankResult() {
    if (!state.board) return;
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
      "Scrambled XI #" + state.board.no + "\n" +
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

  function boot() {
    /* ?id= is the OWNER's address — any board, through the admin route, which
       re-checks the flag server-side. ?no= stays the public one: a position in
       the daily ring, past and today only. A signed-out visitor sending ?id=
       gets a 401 from that route and the start card says so, which is the
       honest failure rather than a silent fall back to today's board. */
    var params = new URLSearchParams(location.search);
    var asked = params.get("no");
    var byId = params.get("id");
    var url = byId
      ? "/api/admin/scrambled?id=" + encodeURIComponent(byId)
      : "/api/scrambled/daily" + (asked ? "?no=" + encodeURIComponent(asked) : "");
    fetch(url, {
      headers: { "X-XI-Games": "1" }, credentials: "same-origin"
    })
      .then(function (r) { return r.json(); })
      .then(function (board) {
        if (board.error) { say(board.error, "bad"); return; }
        state.board = board;
        /* What day it is according to the SERVER, kept so the landing can
           count the archive and judge whether a run reaches today. Never
           computed here: the server decides what day it is. */
        state.todayNo = board.today || board.no;
        $("startTitle").textContent = board.title;
        $("startPool").textContent = board.pool;
        $("startKicker").textContent = board.no === board.today
          ? "TODAY" : "BOARD #" + board.no;
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
        show(state.over ? "screenResults" : "screenStart");
        if (state.over) { drawPitch(); showResults(); }
      })
      .catch(function () {
        $("screenLoading").querySelector(".pmLede").textContent =
          "Could not reach today's board. Try again in a moment.";
      });
  }

  /* The hero IS the kick off now: one control that says what it opens,
     rather than a card with a button under it. */
  $("homeDaily").addEventListener("click", function () {
    $("poolLine").textContent = state.board.pool;
    show("screenGame");
    drawPitch();
    startClock();
    $("answer").focus({ preventScroll: true });
  });

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
    state.picked = null; hideBench(); drawPitch();
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
