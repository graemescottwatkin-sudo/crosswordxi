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
var BUILD = "v001b";

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
    over: false
  };

  /* ---- storage ---------------------------------------------------------- */

  function storeKey() {
    return PREFIX + CFG.STORAGE_KEY + "." + (state.board ? state.board.no : "0");
  }

  function save() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({
        solved: state.solved, hints: state.hints, letters: state.letters,
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
    if (got) return got.name.toUpperCase();
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
        h.className = "hint";
        h.textContent = state.hints[slot.id];
        el.appendChild(h);
      }

      el.setAttribute("aria-label",
        slot.pos + ", " + (got ? got.name : "scrambled, " +
          slot.len.join(" and ") + " letters"));
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
    $("hintLabel").textContent = state.board.hintLabel;
    $("hintCost").textContent = "\u2212" + CFG.REVEAL_HINT_COST;
    $("letterCost").textContent = "\u2212" + CFG.REVEAL_LETTER_COST;
    $("nameCost").textContent = "\u2212" + CFG.REVEAL_NAME_COST;
    $("buyHint").disabled = !!state.hints[id];
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
        if (state.hints[id]) return;
        state.hints[id] = r.value;
        state.help += CFG.REVEAL_HINT_COST;
      } else if (kind === "letter") {
        if (r.index === null) return say("Nothing left to give away there.", "");
        state.letters[id] = (state.letters[id] || "") + r.letter;
        state.help += CFG.REVEAL_LETTER_COST;
      } else if (kind === "name") {
        state.solved[id] = { name: r.name, how: "revealed" };
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

  /* THE TEAM TALK. Free, automatic, once, at half time: every hint is given.
     Eleven anagrams have no intersections, so nothing gets easier as you
     solve — what is left at the end is by definition what you had no route
     into. Without this the second half charges for time that cannot be turned
     into progress. */
  function teamTalk() {
    state.teamTalkDone = true;
    var unsolved = state.board.slots.filter(function (s) {
      return !state.solved[s.id] && !state.hints[s.id];
    });
    if (!unsolved.length) return;
    Promise.all(unsolved.map(function (s) {
      return post("reveal", { token: state.board.token, slotId: s.id, kind: "hint" });
    })).then(function (rs) {
      rs.forEach(function (r) { if (r && r.value) state.hints[r.slotId] = r.value; });
      save();
      drawPitch();
      say("Half time. The manager has given you every " +
        state.board.hintField + ", free.", "good");
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
        state.solved[r.solvedId] = { name: r.name, how: "solved" };
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
    showResults();
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

    /* The honest note. There is no play row, so this number was assembled in
       this browser and the server has not agreed to it. Saying so is cheaper
       than a leaderboard built on numbers nobody checked. */
    var note = document.createElement("p");
    note.className = "ftUnverified";
    note.textContent = "Score not verified by the server \u2014 there is no account " +
      "or leaderboard in this build, so nothing has been recorded.";
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
        $("startTitle").textContent = board.title;
        $("startPool").textContent = board.pool;
        $("startKicker").textContent = board.no === board.today
          ? "Today's board" : "Board #" + board.no;
        $("startClock").textContent = "Ninety match minutes take " +
          Math.round(CFG.MATCH_CLOCK_REAL_SECONDS / 60) + " minutes of real time. " +
          (CFG.HALF_TIME_MINUTE === null ? "" :
            "At half time the manager gives you every " + board.hintField + ", free.");

        var saved = load();
        if (saved) {
          state.solved = saved.solved || {};
          state.hints = saved.hints || {};
          state.letters = saved.letters || {};
          state.help = saved.help || 0;
          state.elapsed = saved.elapsed || 0;
          state.over = !!saved.over;
        }
        show(state.over ? "screenResults" : "screenStart");
        if (state.over) { drawPitch(); showResults(); }
      })
      .catch(function () {
        $("screenLoading").querySelector(".pmLede").textContent =
          "Could not reach today's board. Try again in a moment.";
      });
  }

  $("kickOff").addEventListener("click", function () {
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
