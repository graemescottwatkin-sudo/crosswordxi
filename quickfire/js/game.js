/* QuickFire XI — game script.
 *
 * BUILD must equal the ?v= tag on every one of this game's assets in
 * index.html. deploy_check.mjs checks they agree and that the tag moved when
 * the bytes did.
 *
 * NOTHING about a board lives in this file. The questions, the answers and the
 * bench come from /api/quickfire/daily at run time, which is why the gate can
 * assert there is no bank in any public file. Shipping the schedule to the
 * browser is the fault the word search rebuild retired; this game never had it
 * and must not acquire it.
 */
var BUILD = "v001";

(function bootstrap() {
  'use strict';
  console.log("QuickFire XI build " + BUILD);

  /* CSRF. The family header, defined once in functions/_lib/auth.js. */
  function api(path, body) {
    return fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "X-XI-Games": "1", "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  window.QFX_API = api;

  var code = (/[#&]x=([A-Za-z0-9\-_]+)/.exec(location.hash || "") || [])[1];
  var url = code
    ? "/api/quickfire/challenge?x=" + encodeURIComponent(code)
    : "/api/quickfire/daily";

  api(url)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (payload) {
      window.QFX_SOURCE = payload.source || "unknown";
      window.QFX_DATA = window.QFXBoardFile.fromApi(payload);
      start();
    })
    .catch(function (err) {
      console.error("Could not load " + url + ":", err);
      var loading = document.getElementById("screenLoading");
      if (loading) {
        loading.innerHTML =
          '<p class="kicker">Not today</p>' +
          "<p class=\"blurb\">Today's questions didn't load. Try again in a moment.</p>";
      }
    });
})();

function start() {
  'use strict';

  var PREFIX = "qfx.";
  var CONFIG = window.QFX_CONFIG;
  var Reveal = window.QFXReveal;
  var Matching = window.QFXMatching;
  var Adapters = window.QFXAdapters;
  var Challenge = window.QFXChallenge;
  var DATA = window.QFX_DATA;

  var MAX_MINUTE = CONFIG.MATCH_DURATION_MINUTES;
  var MAX_QUESTION_POINTS = CONFIG.SCORE_BANDS.reduce(function (max, band) {
    return Math.max(max, band.points);
  }, 0);

  /* ---------------------------------------------------------------- data */

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function pickDaily() {
    var today = todayISO();
    var dailies = DATA.daily.dailies;
    var match = dailies.filter(function (d) { return d.date === today; })[0];
    return match || dailies[0];
  }

  function formatDate(iso) {
    var parts = iso.split('-');
    var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return parts[2] + ' ' + months[Number(parts[1]) - 1] + ' ' + parts[0];
  }

  /* -------------------------------------------------------------- scoring */

  function pointsFor(minute) {
    for (var i = 0; i < CONFIG.SCORE_BANDS.length; i++) {
      if (minute <= CONFIG.SCORE_BANDS[i].maxMinute) return CONFIG.SCORE_BANDS[i].points;
    }
    return 0;
  }

  /* ---------------------------------------------------------------- state */

  /* A challenge link carries the exact board in the fragment, so it plays
     without a server and without touching the player's own Daily. */
  function readChallengeCode() {
    var m = /[#&]x=([A-Za-z0-9\-_]+)/.exec(location.hash || '');
    return m ? m[1] : null;
  }

  /* Evergreen and topical content live in separate files on purpose. They are
     merged only here, for id lookup, so a topical clue can never leak into the
     shared bank Pitchword reads. */
  var COMBINED_BANK = {
    entries: DATA.bank.entries.concat(DATA.weekly ? DATA.weekly.entries : [])
  };

  function daysBetween(isoA, isoB) {
    return Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
  }

  /* The most recent week that hasn't gone stale. A seven-day quiz a month old
     is not a seven-day quiz. */
  function pickWeek() {
    if (!DATA.weekly || !DATA.weekly.weeks.length) return null;
    var today = todayISO();
    var live = DATA.weekly.weeks.filter(function (w) {
      var age = daysBetween(w.weekEnding, today);
      return age >= 0 && age <= CONFIG.WEEKLY_SHELF_LIFE_DAYS;
    });
    live.sort(function (a, b) { return a.weekEnding < b.weekEnding ? 1 : -1; });
    return live[0] || null;
  }

  var challengeCode = readChallengeCode();
  var boardError = null;
  var board, questions, bench, originalClueIds, originalBenchIds, storageKey, state;

  function makeState(dateLabel) {
    return {
      date: dateLabel,
      index: 0,          // which of the eleven slots is being played
      results: [],       // one entry per attempt, substitutions included
      totalScore: 0,
      subsUsed: 0,
      benchIndex: 0,
      completed: false
    };
  }

  function dailyBoard() {
    var d = pickDaily();
    return {
      mode: 'daily',
      date: d.date,
      clueIds: d.clueIds,
      benchClueIds: d.benchClueIds || [],
      isChallenge: false
    };
  }

  function weeklyBoard(week) {
    return {
      mode: 'weekly',
      date: week.weekEnding,
      label: week.label || 'The Last 7 Days',
      placeholder: !!week.placeholder,
      clueIds: week.clueIds,
      benchClueIds: week.benchClueIds || [],
      isChallenge: false
    };
  }

  function setBoard(next) {
    board = next;
    var game = board.mode === 'weekly' ? 'quickfire-xi-weekly' : 'quickfire-xi';
    questions = Adapters.buildDaily(COMBINED_BANK, board, game);
    bench = Adapters.buildBench(COMBINED_BANK, board, game);
    originalClueIds = board.clueIds.slice();
    originalBenchIds = board.benchClueIds.slice();
    storageKey = challengeCode && board.isChallenge
      ? CONFIG.STORAGE_KEY + ':c' + Challenge.fingerprint(challengeCode)
      : CONFIG.STORAGE_KEY + ':' + board.mode + ':' + (board.date || 'x');
    state = makeState(board.date || 'challenge');
  }

  /* A challenge can carry either kind of question, so try both game tags. */
  function challengeBoard(decoded) {
    var attempt = { mode: 'daily', date: null, isChallenge: true,
                    clueIds: decoded.clueIds, benchClueIds: decoded.benchClueIds };
    try {
      Adapters.buildDaily(COMBINED_BANK, attempt, 'quickfire-xi');
      return attempt;
    } catch (err) {
      attempt.mode = 'weekly';
      Adapters.buildDaily(COMBINED_BANK, attempt, 'quickfire-xi-weekly');
      return attempt;
    }
  }

  var week = pickWeek();

  if (challengeCode) {
    try {
      setBoard(challengeBoard(Challenge.decode(challengeCode)));
    } catch (err) {
      boardError = /version|damaged/.test(err.message)
        ? err.message
        : 'This challenge uses questions this version of the game does not have.';
      challengeCode = null;
    }
  }
  if (!board) setBoard(dailyBoard());

  var clock = {
    running: false,
    startedAt: 0,
    pausedAt: 0,
    pausedTotal: 0,
    penaltyMs: 0,
    minute: 0,
    frame: null
  };

  var current = null;

  /* ------------------------------------------------------------ elements */

  var el = {};
  ['screenStart', 'screenGame', 'screenResults', 'kickOff', 'startDate', 'startBlurb',
    'stripFill', 'progress', 'clockValue', 'clue', 'enumeration', 'answer', 'feedback',
    'keyInput', 'submit', 'passQuestion', 'subCost', 'runningScore', 'worthNow',
    'resultsBody', 'shareText', 'copyShare', 'copyChallenge', 'challengeHint',
    'playAgain', 'startKicker', 'challengeNote', 'playWeekly',
    'weeklyLabel', 'weeklyState', 'screenLoading'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

  /* ------------------------------------------------------------ rendering */

  /* The answer row is the input. Revealed characters lock in place, the player
     types into what's left, and a wrong guess only clears the cells that were
     wrong — so you retype the blanks, never the whole thing. */

  var LETTER = /[\p{L}\p{N}]/u;

  function isTypeable(index) {
    var q = current.question;
    return LETTER.test(q.answer[index]) && current.revealedSet.indexOf(index) === -1;
  }

  function firstEmpty() {
    var q = current.question;
    for (var i = 0; i < q.answer.length; i++) {
      if (isTypeable(i) && current.entered[i] === undefined) return i;
    }
    return -1;
  }

  function isComplete() {
    return firstEmpty() === -1;
  }

  /* What the player is currently claiming: locked characters plus their own. */
  function assembled() {
    var q = current.question;
    var out = '';
    for (var i = 0; i < q.answer.length; i++) {
      if (!LETTER.test(q.answer[i])) out += q.answer[i];
      else if (current.revealedSet.indexOf(i) !== -1) out += q.answer[i];
      else out += (current.entered[i] === undefined ? ' ' : current.entered[i]);
    }
    return out;
  }

  function renderBoard() {
    var q = current.question;
    var caret = firstEmpty();
    el.answer.innerHTML = '';
    el.answer.classList.remove('solved', 'missed');
    for (var i = 0; i < q.answer.length; i++) {
      var ch = q.answer[i];
      var span = document.createElement('span');
      if (ch === ' ') {
        span.className = 'gap';
        span.textContent = ' ';
      } else if (!LETTER.test(ch)) {
        span.className = 'cell punct';
        span.textContent = ch;
      } else if (current.revealedSet.indexOf(i) !== -1) {
        span.className = 'cell shown' + (current.flash.indexOf(i) !== -1 ? ' fresh' : '');
        span.textContent = ch.toUpperCase();
      } else if (current.entered[i] !== undefined) {
        span.className = 'cell typed';
        span.textContent = current.entered[i].toUpperCase();
      } else {
        span.className = 'cell hidden' + (i === caret ? ' caret' : '');
        span.textContent = '_';
      }
      el.answer.appendChild(span);
    }
    el.answer.setAttribute('aria-label', 'Answer so far: ' + assembled().split('').join(' '));
    el.submit.disabled = !isComplete();
    current.flash = [];   // the flash plays once, on the render that follows the reveal
  }

  /* Solved or timed out — show the finished answer, no cells to type in. */
  function renderAnswer(text, opts) {
    opts = opts || {};
    el.answer.innerHTML = '';
    el.answer.classList.toggle('solved', !!opts.solved);
    el.answer.classList.toggle('missed', !!opts.missed);
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var span = document.createElement('span');
      if (ch === ' ') { span.className = 'gap'; span.textContent = ' '; }
      else if (LETTER.test(ch)) { span.className = 'cell shown'; span.textContent = ch.toUpperCase(); }
      else { span.className = 'cell punct'; span.textContent = ch; }
      el.answer.appendChild(span);
    }
    el.answer.setAttribute('aria-label', 'Answer: ' + text);
  }

  function renderClock(minute) {
    el.clockValue.textContent = minute;
    var pct = Math.min(100, (minute / MAX_MINUTE) * 100);
    el.stripFill.style.width = pct + '%';
    el.stripFill.classList.toggle('late', minute >= 60);
  }

  function renderWorth(minute) {
    var worth = pointsFor(minute);
    el.worthNow.textContent = worth;
    el.worthNow.classList.toggle('low', worth <= 25);
  }

  function subsLeft() {
    return Math.min(CONFIG.SUBS_PER_DAILY - state.subsUsed, bench.length - state.benchIndex);
  }

  function renderSubButton() {
    var left = subsLeft();
    var usable = left > 0;
    el.passQuestion.disabled = !usable;
    el.subCost.textContent = usable
      ? '\u2212' + CONFIG.SUB_POINT_PENALTY + ' \u00b7 ' + left + ' left'
      : 'none left';
  }

  function setFeedback(text, kind) {
    el.feedback.textContent = text || '';
    el.feedback.className = 'feedback' + (kind ? ' ' + kind : '');
  }

  /* -------------------------------------------------------------- clock */

  function elapsedMs() {
    if (!clock.startedAt) return 0;
    var now = clock.running ? Date.now() : clock.pausedAt;
    return (now - clock.startedAt) - clock.pausedTotal + clock.penaltyMs;
  }

  function currentMinute() {
    var m = Math.floor((elapsedMs() / CONFIG.QUESTION_DURATION_MS) * MAX_MINUTE);
    return Math.max(0, Math.min(MAX_MINUTE, m));
  }

  function tick() {
    if (!clock.running) return;
    var minute = currentMinute();
    if (minute !== clock.minute) {
      clock.minute = minute;
      renderClock(minute);
      renderWorth(minute);
      updateReveal(minute);
    }
    if (minute >= MAX_MINUTE) { fullTime(); return; }
    clock.frame = requestAnimationFrame(tick);
  }

  function pauseClock() {
    if (!clock.running) return;
    clock.running = false;
    clock.pausedAt = Date.now();
    if (clock.frame) cancelAnimationFrame(clock.frame);
  }

  function resumeClock() {
    if (clock.running || !clock.startedAt) return;
    clock.pausedTotal += Date.now() - clock.pausedAt;
    clock.running = true;
    clock.frame = requestAnimationFrame(tick);
  }

  document.addEventListener('visibilitychange', function () {
    if (!CONFIG.PAUSE_ON_TAB_HIDDEN || !current || current.finished) return;
    if (document.hidden) pauseClock(); else resumeClock();
  });

  /* ------------------------------------------------------ soft keyboard */

  /* The on-screen keyboard doesn't resize the layout viewport on iOS, so the
     page can't respond to it with CSS alone. Watch the visual viewport, compact
     the layout while the keyboard is up, and keep the question block anchored
     to the top of what's actually visible. */
  (function watchKeyboard() {
    var vv = window.visualViewport;
    if (!vv) return;
    var wasOpen = false;

    function settle() {
      var open = vv.height < window.innerHeight * 0.78;
      if (open !== wasOpen) {
        wasOpen = open;
        document.body.classList.toggle('kbd', open);
      }
      if (open) {
        var top = el.screenGame.getBoundingClientRect().top;
        if (Math.abs(top) > 8) window.scrollBy(0, top - 4);
      }
    }

    vv.addEventListener('resize', settle);
    el.keyInput.addEventListener('focus', function () { setTimeout(settle, 320); });
    el.keyInput.addEventListener('blur', function () { setTimeout(settle, 120); });
  })();

  /* --------------------------------------------------------------- typing */

  var KEY_SENTINEL = '\u200b';

  /* The clock can land on the exact cell the player is mid-keystroke on. Their
     letter would then drop into the next gap and put everything after it out of
     step. If the character they typed is one the clock has just given them, and
     it isn't what the next gap wants, treat it as already served. */
  function stolenByReveal(ch, slot) {
    if (!CONFIG.REVEAL_GRACE_MS || !current.recentReveals.length) return false;
    if (Date.now() - current.lastRevealAt > CONFIG.REVEAL_GRACE_MS) return false;
    var q = current.question;
    var typed = Matching.normalise(ch);
    if (typed === Matching.normalise(q.answer[slot])) return false;  // genuinely the next letter
    return current.recentReveals.some(function (i) {
      return i < slot && Matching.normalise(q.answer[i]) === typed;
    });
  }

  function typeCharacter(ch) {
    var slot = firstEmpty();
    if (slot === -1) return false;
    if (stolenByReveal(ch, slot)) return false;
    current.entered[slot] = ch;
    current.order.push(slot);
    if (CONFIG.RECORD_FIRST_KEYSTROKE && current.firstKeystrokeMinute === null) {
      current.firstKeystrokeMinute = currentMinute();
    }
    return true;
  }

  function backspace() {
    if (!current.order.length) return false;
    var slot = current.order.pop();
    delete current.entered[slot];
    return true;
  }

  function clearTyped() {
    current.entered = {};
    current.order = [];
  }

  function handleTyping(text) {
    var changed = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (!LETTER.test(ch)) continue;   // spaces and punctuation are already on the board
      if (typeCharacter(ch)) changed = true;
    }
    if (changed) {
      renderBoard();
      maybeAutoSubmit();
    }
  }

  function maybeAutoSubmit() {
    if (!isComplete()) return;
    var claim = assembled();
    if (claim === current.lastSubmitted) return;
    submitGuess();
  }

  function focusKeyboard() {
    if (!current || current.finished) return;
    el.keyInput.focus({ preventScroll: true });
  }

  el.keyInput.addEventListener('input', function () {
    if (!current || current.finished) { el.keyInput.value = KEY_SENTINEL; return; }
    var value = el.keyInput.value;
    if (value.length === 0) backspace() && renderBoard();
    else handleTyping(value.replace(KEY_SENTINEL, ''));
    el.keyInput.value = KEY_SENTINEL;
  });

  el.keyInput.addEventListener('keydown', function (e) {
    if (!current || current.finished) return;
    if (e.key === 'Enter') { e.preventDefault(); if (isComplete()) submitGuess(); }
    else if (e.key === 'Backspace') { e.preventDefault(); if (backspace()) renderBoard(); }
  });

  /* Test hooks, for tests/board_test.js only. Defined off the live host, never
     on it: on the site the answers arrive from the API and a hook that hands
     them back is a cheat button. deploy_check asserts the guard is here. */
  var IS_LIVE = location.hostname === 'www.thexigames.com';

  window.QFX_TEST_REVEAL = IS_LIVE ? undefined : function (countOrIndices) {
    if (!current || current.finished) return;
    current.revealed = -1;
    var q = current.question;
    var previous = current.revealedSet;
    current.revealedSet = Array.isArray(countOrIndices)
      ? countOrIndices.slice()
      : q.revealOrder.slice(0, countOrIndices);
    current.recentReveals = current.revealedSet.filter(function (i) {
      return previous.indexOf(i) === -1;
    });
    current.lastRevealAt = Date.now();
    current.flash = current.recentReveals.slice();
    current.recentReveals.forEach(function (i) {
      if (current.entered[i] !== undefined) {
        delete current.entered[i];
        var at = current.order.indexOf(i);
        if (at !== -1) current.order.splice(at, 1);
      }
    });
    renderBoard();
  };

  window.QFX_TEST_ANSWER = IS_LIVE ? undefined : function () {
    return current && !current.finished ? current.question.answer : null;
  };

  el.answer.addEventListener('mousedown', function (e) { e.preventDefault(); focusKeyboard(); });
  el.answer.addEventListener('touchstart', function () { focusKeyboard(); }, { passive: true });

  /* ----------------------------------------------------------- questions */

  function updateReveal(minute) {
    var q = current.question;
    var count = Reveal.revealCountAt(minute, q.revealable, CONFIG.REVEAL_CHECKPOINTS);
    if (count === current.revealed) return;
    var previous = current.revealedSet;
    current.revealed = count;
    current.revealedSet = q.revealOrder.slice(0, count);
    current.recentReveals = current.revealedSet.filter(function (i) {
      return previous.indexOf(i) === -1;
    });
    current.lastRevealAt = Date.now();
    current.flash = current.recentReveals.slice();
    // A cell the clock has just given away no longer belongs to the player.
    current.revealedSet.forEach(function (i) {
      if (current.entered[i] !== undefined) {
        delete current.entered[i];
        var at = current.order.indexOf(i);
        if (at !== -1) current.order.splice(at, 1);
      }
    });
    renderBoard();
  }

  function startQuestion(index) {
    var q = questions[index];
    current = {
      question: q,
      revealed: -1,
      revealedSet: [],
      recentReveals: [],
      lastRevealAt: 0,
      flash: [],
      entered: {},
      order: [],
      lastSubmitted: null,
      guesses: 0,
      firstKeystrokeMinute: null,
      finished: false
    };

    el.progress.textContent = (index + 1) + ' / ' + CONFIG.QUESTIONS_PER_DAILY;
    el.clue.textContent = q.clue;
    el.enumeration.textContent = q.enumeration;
    el.keyInput.value = KEY_SENTINEL;
    el.submit.disabled = true;
    setFeedback('');
    renderClock(0);
    renderWorth(0);
    updateReveal(0);
    renderSubButton();
    el.runningScore.textContent = state.totalScore;

    clock.startedAt = Date.now();
    clock.pausedAt = 0;
    clock.pausedTotal = 0;
    clock.penaltyMs = 0;
    clock.minute = 0;
    clock.running = true;
    clock.frame = requestAnimationFrame(tick);

    focusKeyboard();
  }

  function finishQuestion(result) {
    pauseClock();
    current.finished = true;
    el.submit.disabled = true;
    el.passQuestion.disabled = true;
    state.results.push(result);
    state.totalScore += result.score;
    el.runningScore.textContent = state.totalScore;
    save();

    setTimeout(function () {
      state.index += 1;
      if (state.index >= questions.length) {
        state.completed = true;
        save();
        showResults();
      } else {
        save();
        startQuestion(state.index);
      }
    }, CONFIG.INTER_QUESTION_MS);
  }

  function submitGuess() {
    if (!current || current.finished) return;
    if (!isComplete()) return;
    var q = current.question;
    var claim = assembled();
    var minute = currentMinute();
    current.guesses += 1;
    current.lastSubmitted = claim;

    if (Matching.isCorrect(claim, q.answer, q.aliases)) {
      var score = pointsFor(minute);
      renderAnswer(q.answer, { solved: true });
      renderClock(minute);
      setFeedback('GOAL — ' + minute + "'   +" + score + ' points', 'goal');
      finishQuestion({
        questionId: q.questionId,
        answer: q.answer,
        solved: true,
        solvedAtMinute: minute,
        score: score,
        guesses: current.guesses,
        firstKeystrokeMinute: current.firstKeystrokeMinute
      });
      return;
    }

    /* Clear only what was wrong. Comparison is loose on case and accents, so a
       lower-case entry against an upper-case answer still counts as right. */
    var keep = CONFIG.WRONG_GUESS_KEEP;
    if (keep === 'none') {
      clearTyped();
    } else if (keep === 'correct-positions') {
      var kept = [];
      current.order.forEach(function (slot) {
        if (Matching.normalise(current.entered[slot]) === Matching.normalise(q.answer[slot])) {
          kept.push(slot);
        } else {
          delete current.entered[slot];
        }
      });
      current.order = kept;
    }
    // 'all' leaves every character where it is.

    renderBoard();
    focusKeyboard();
    setFeedback(isComplete() ? 'Not that one — change something'
                             : 'Not that one — fill the gaps', 'miss');
    el.answer.classList.remove('shake');
    void el.answer.offsetWidth;
    el.answer.classList.add('shake');

    if (CONFIG.WRONG_GUESS_MINUTE_PENALTY > 0) {
      clock.penaltyMs += (CONFIG.WRONG_GUESS_MINUTE_PENALTY / MAX_MINUTE) * CONFIG.QUESTION_DURATION_MS;
    }
    if (CONFIG.WRONG_GUESS_POINT_PENALTY > 0) {
      current.penalty = (current.penalty || 0) + CONFIG.WRONG_GUESS_POINT_PENALTY;
    }
  }

  function fullTime() {
    if (!current || current.finished) return;
    pauseClock();
    var q = current.question;
    renderClock(MAX_MINUTE);
    renderWorth(MAX_MINUTE);
    renderAnswer(q.answer, { missed: true });
    setFeedback('FULL TIME — ' + q.answer + '   0 points', 'fulltime');
    finishQuestion({
      questionId: q.questionId,
      answer: q.answer,
      solved: false,
      solvedAtMinute: null,
      score: 0,
      guesses: current.guesses,
      firstKeystrokeMinute: current.firstKeystrokeMinute
    });
  }

  /* ---------------------------------------------------------------- subs */

  /* Passing brings a fresh question off the bench at 0' and charges for it.
     The slot number does not advance — the Daily is still an XI. */
  function passCurrentQuestion() {
    if (!current || current.finished) return;
    if (subsLeft() <= 0) return;
    var minute = currentMinute();
    if (minute < CONFIG.SUB_MIN_MINUTE) {
      setFeedback('No subs before ' + CONFIG.SUB_MIN_MINUTE + "'", 'miss');
      return;
    }

    pauseClock();
    var q = current.question;
    current.finished = true;

    state.results.push({
      questionId: q.questionId,
      answer: q.answer,
      passed: true,
      solved: false,
      solvedAtMinute: null,
      passedAtMinute: minute,
      score: -CONFIG.SUB_POINT_PENALTY,
      guesses: current.guesses,
      firstKeystrokeMinute: current.firstKeystrokeMinute
    });
    state.totalScore -= CONFIG.SUB_POINT_PENALTY;

    questions[state.index] = bench[state.benchIndex];
    state.benchIndex += 1;
    state.subsUsed += 1;

    el.submit.disabled = true;
    el.passQuestion.disabled = true;
    renderAnswer(q.answer, { missed: true });
    setFeedback('SUBBED OFF — ' + q.answer + '   −' + CONFIG.SUB_POINT_PENALTY, 'sub');
    el.runningScore.textContent = state.totalScore;
    save();

    setTimeout(function () { startQuestion(state.index); }, CONFIG.INTER_QUESTION_MS);
  }

  /* ------------------------------------------------------------- results */

  function summarise() {
    var played = state.results.filter(function (r) { return !r.passed; });
    var solved = state.results.filter(function (r) { return r.solved; });
    var minutes = solved.map(function (r) { return r.solvedAtMinute; });
    return {
      correct: solved.length,
      total: played.length,
      subs: state.subsUsed,
      subCost: state.subsUsed * CONFIG.SUB_POINT_PENALTY,
      played: played,
      score: state.totalScore,
      maxScore: CONFIG.QUESTIONS_PER_DAILY * MAX_QUESTION_POINTS,
      average: minutes.length ? Math.round(minutes.reduce(function (a, b) { return a + b; }, 0) / minutes.length) : null,
      fastest: minutes.length ? Math.min.apply(null, minutes) : null,
      latest: minutes.length ? Math.max.apply(null, minutes) : null,
      minutes: minutes
    };
  }

  function shareTextFor(s) {
    var line = s.played.map(function (r) {
      return r.solved ? String(r.solvedAtMinute).padStart(2, '0') + "'" : '—';
    }).join(' ');
    return [
      'QUICKFIRE XI',
      board.isChallenge ? 'CHALLENGE'
        : board.mode === 'weekly' ? 'LAST 7 DAYS — w/e ' + formatDate(state.date)
        : formatDate(state.date),
      '',
      s.correct + '/' + s.total + ' ⚽',
      s.score + '/' + s.maxScore,
      '',
      'Goal times:',
      line,
      '',
      s.average === null ? 'Average: —' : 'Average: ' + s.average + "'",
      'Subs: ' + s.subs + (s.subs ? ' (−' + s.subCost + ')' : '')
    ].join('\n');
  }

  function row(label, value) {
    return '<div class="row"><span class="rowLabel">' + label + '</span>' +
      '<span>' + value + '</span></div>';
  }

  function showResults() {
    var s = summarise();
    var html = '';
    html += '<div class="verdict"><span class="verdictCount">' + s.correct + '</span>' +
      '<span class="verdictOf">/ ' + s.total + ' correct</span></div>';
    html += '<div class="bigscore">' + s.score + ' <span class="of">/ ' + s.maxScore + ' points</span></div>';
    html += '<div class="rows">';
    html += row('Average goal', s.average === null ? 'No goals' : s.average + "'");
    html += row('Fastest goal', s.fastest === null ? 'No goals' : s.fastest + "'");
    html += row('Latest goal', s.latest === null ? 'No goals' : s.latest + "'");
    html += row('Subs used', s.subs + ' of ' + CONFIG.SUBS_PER_DAILY +
      (s.subs ? '  (−' + s.subCost + ')' : ''));
    html += '</div>';
    html += '<ol class="breakdown">';
    state.results.forEach(function (r) {
      var cls = r.passed ? 'subbed' : (r.solved ? 'hit' : 'missed');
      var minute = r.passed ? 'SUB' : (r.solved ? r.solvedAtMinute + "'" : 'FT');
      var pts = r.score > 0 ? r.score : (r.score < 0 ? '−' + Math.abs(r.score) : '0');
      html += '<li class="' + cls + '">' +
        '<span class="bdMin">' + minute + '</span>' +
        '<span class="bdAnswer">' + r.answer + '</span>' +
        '<span class="bdPts">' + pts + '</span></li>';
    });
    html += '</ol>';
    el.resultsBody.innerHTML = html;
    el.shareText.value = shareTextFor(s);
    show('screenResults');
  }

  /* ------------------------------------------------------------ storage */

  function save() {
    try {
      localStorage.setItem(PREFIX + storageKey, JSON.stringify({
        date: state.date,
        index: state.index,
        results: state.results,
        totalScore: state.totalScore,
        subsUsed: state.subsUsed,
        benchIndex: state.benchIndex,
        questionIds: questions.map(function (q) { return q.questionId; }),
        completed: state.completed
      }));
    } catch (err) { /* private browsing — play on without persistence */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(PREFIX + storageKey);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (saved.date !== state.date) return null;
      return saved;
    } catch (err) { return null; }
  }

  /* --------------------------------------------------------------- boot */

  function show(screenId) {
    ['screenStart', 'screenLoading', 'screenGame', 'screenResults'].forEach(function (id) {
      if (el[id]) el[id].hidden = (id !== screenId);
    });
  }

  function begin() {
    show('screenGame');
    startQuestion(state.index);
  }

  el.kickOff.addEventListener('click', begin);
  el.playWeekly.addEventListener('click', function () {
    if (!week) return;
    setBoard(weeklyBoard(week));
    describeBoard();
    restore();
    if (state.completed) showResults(); else begin();
  });
  el.submit.addEventListener('click', submitGuess);
  el.passQuestion.addEventListener('click', passCurrentQuestion);
  function challengeLink() {
    var code = Challenge.encode(originalClueIds, originalBenchIds);
    var base = location.href.split('#')[0];
    return base + '#x=' + code;
  }

  function copyToClipboard(text, button, done) {
    var ok = false;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(function () {});
      ok = true;
    } else {
      var scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.style.position = 'fixed';
      scratch.style.opacity = '0';
      document.body.appendChild(scratch);
      scratch.select();
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(scratch);
    }
    var original = button.textContent;
    button.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(function () { button.textContent = done || original; }, 1600);
  }

  el.copyChallenge.addEventListener('click', function () {
    copyToClipboard(challengeLink(), el.copyChallenge, 'Copy challenge link');
  });

  el.copyShare.addEventListener('click', function () {
    copyToClipboard(el.shareText.value, el.copyShare, 'Copy result');
  });
  el.playAgain.addEventListener('click', function () {
    try { localStorage.removeItem(PREFIX + storageKey); } catch (err) {}
    location.reload();
  });

  /* --------------------------------------------------------- start screen */

  function restore() {
    var saved = load();
    if (!saved) return;
    state.index = saved.index;
    state.results = saved.results;
    state.totalScore = saved.totalScore;
    state.subsUsed = saved.subsUsed || 0;
    state.benchIndex = saved.benchIndex || 0;
    state.completed = saved.completed;
    // Put any substitutions made before the reload back into their slots.
    if (saved.questionIds) {
      var byId = {};
      questions.concat(bench).forEach(function (q) { byId[q.questionId] = q; });
      saved.questionIds.forEach(function (id, i) {
        if (byId[id]) questions[i] = byId[id];
      });
    }
  }

  function describeBoard() {
    if (board.isChallenge) {
      el.startKicker.textContent = 'Someone has challenged you';
      el.startDate.textContent = 'The Challenge XI';
      el.challengeNote.hidden = false;
      el.challengeNote.textContent =
        'Exactly the board they played — same eleven questions, same order, same ' +
        'bench, same reveals. Your Daily is untouched.';
      el.challengeHint.textContent = 'Pass this on and they get this same board too.';
      return;
    }
    if (board.mode === 'weekly') {
      el.startKicker.textContent = 'Week ending ' + formatDate(board.date);
      el.startDate.textContent = board.label;
      return;
    }
    el.startKicker.textContent = "Today's Daily";
    el.startDate.textContent = formatDate(state.date);
  }

  function describeWeeklyButton() {
    if (!week) {
      el.playWeekly.hidden = true;
      return;
    }
    el.playWeekly.hidden = false;
    var label = (week.label || 'The Last 7 Days');
    var done = false;
    try {
      var raw = localStorage.getItem(PREFIX + CONFIG.STORAGE_KEY + ':weekly:' + week.weekEnding);
      done = raw ? !!JSON.parse(raw).completed : false;
    } catch (err) { done = false; }
    el.weeklyLabel.textContent = label;
    el.weeklyState.textContent = done ? 'Played' : (week.placeholder ? 'Placeholder' : 'New');
    el.playWeekly.classList.toggle('placeholder', !!week.placeholder);
  }

  describeBoard();
  describeWeeklyButton();

  if (boardError) {
    el.challengeNote.hidden = false;
    el.challengeNote.textContent = boardError + ' Playing today\u2019s Daily instead.';
  }

  restore();

  if (state.completed) {
    showResults();
  } else if (state.index > 0) {
    el.startBlurb.textContent = 'You are ' + state.index + ' questions in. Pick up at question ' +
      (state.index + 1) + ' of ' + CONFIG.QUESTIONS_PER_DAILY + '.';
    el.kickOff.textContent = 'Resume';
    show('screenStart');
  } else {
    show('screenStart');
  }
}
