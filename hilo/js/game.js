/* HiLo XI — game.js
 *
 * The browser holds names and context. It holds ONE value — the first — and
 * every call goes up to be judged; the value it was called against comes
 * back with the verdict and the row's source. A board with its values in the
 * page would be a board with its answer key in the page.
 *
 * THE RULES ARE THE OWNER'S, in js/scoring.js: eleven clocks, one per call,
 * a right call worth up to ten, three substitutions, runs of five worth two
 * more, 114 the ceiling. This file is the page: the landing the family
 * shares, the ladder of two rows, the clock, the answers list, the share.
 */
var BUILD = "v001g";

(function () {
  "use strict";

  window.HILOXI_BUILD = BUILD;
  try { console.log("HiLo XI build " + BUILD); } catch (e) {}

  var S = window.HL_SCORING;
  var $ = function (id) { return document.getElementById(id); };
  var PREFIX = "xihl.";
  var RESULTS_KEY = PREFIX + "results";
  var DOT = "·", SQ_ON = "🟩", SQ_OFF = "🟥", SQ_NONE = "⬜";

  /* ---- state ---------------------------------------------------------- */
  var serverDay = null, todayBoard = null, catalog = null, archiveDays = null;
  var g = null;      /* the round in play */

  function freshRound(board, mode, meta) {
    return {
      token: board.token, board: board, mode: mode, day: meta.day || null,
      kicker: meta.kicker || "", step: 0,
      results: [], worths: [], values: [board.rows[0].value], sources: [],
      subsUsed: 0, over: false, awaitingNext: false, inflight: false,
      clockStart: null, ticker: null, startedAt: Date.now(), elapsed: 0,
    };
  }

  /* ---- formatting ----------------------------------------------------- */
  function fmt(v, unit) {
    if (v === undefined || v === null) return "?";
    if (unit === "pounds") return "£" + Number(v).toLocaleString("en-GB");
    if (unit === "count") return Number(v).toLocaleString("en-GB");
    return String(v);
  }
  /* A live age, on a board of people: the reveal reads "born 4 January
     1986, age 40", worked out from today each time. */
  function bornText(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00Z"); if (isNaN(d.getTime())) return "";
    var now = new Date(), age = now.getUTCFullYear() - d.getUTCFullYear();
    var m = now.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return "born " + d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", age " + age;
  }
  function faces(board) {
    var d = board.direction || {};
    return { hi: d.higher || "Higher", lo: d.lower || "Lower" };
  }

  /* ---- the durable record and the account ------------------------------ */
  function readResults() {
    try { var r = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]"); return Array.isArray(r) ? r : []; }
    catch (e) { return []; }
  }
  function recordResult(rec) {
    try {
      /* FIRST RESULT BANKED WINS, the family's merge rule. */
      var all = readResults();
      if (all.some(function (r) { return r && r.day === rec.day; })) return;
      all.push(rec);
      localStorage.setItem(RESULTS_KEY, JSON.stringify(all.slice(-800)));
    } catch (e) {}
    pushResults();
  }
  var account = null;
  function accountNote(what, err) {
    try { console.warn("[account] " + what + " failed:", err && err.message ? err.message : err); } catch (e) {}
  }
  function apiAuth(path, body) {
    var opts = { method: body ? "POST" : "GET", headers: { "X-XI-Games": "1" }, credentials: "same-origin" };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  }
  function pushResults() {
    if (!account) return Promise.resolve(null);
    return apiAuth("/api/account/migrate", { game: "hilo", results: readResults() })
      .catch(function (e) { accountNote("push", e); return null; });
  }
  function pullResults() {
    if (!account) return Promise.resolve(null);
    return apiAuth("/api/account/results?game=hilo").then(function (r) {
      var remote = (r && r.results) || [];
      if (!remote.length) return null;
      /* The account's row wins outright; an unpushed local row survives. */
      var byDay = {};
      readResults().forEach(function (x) { if (x && x.day) byDay[x.day] = x; });
      remote.forEach(function (x) { if (x && x.day) byDay[x.day] = x; });
      var merged = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
      try { localStorage.setItem(RESULTS_KEY, JSON.stringify(merged.slice(-800))); } catch (e) {}
      renderForm();
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
    }).catch(function (e) { accountNote("session", e); return null; });
  }

  /* THE PERMALINK. /<game>/daily/<key> is one URL for one puzzle, forever —
     see functions/_lib/permalink.js for the shape and the server's half. The
     path IS the fact; nothing is injected into the page for the client to
     read, so there is one statement of which board this is. The server has
     already refused a key that is malformed or in the future, so what arrives
     here is a board this game can be asked for. */
  function permalinkKey() {
    var m = /\/daily\/([^/?#]+)\/?$/.exec(location.pathname || "");
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* ---- the landing ----------------------------------------------------- */
  function api(path) {
    return fetch("/api/hilo/" + path, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || String(r.status)); return j; }); });
  }
  function renderForm() {
    var el = $("homeRun"), title = $("homeRunTitle");
    if (!el || !window.XIChrome) return;
    var done = readResults().filter(function (r) { return r && r.day; })
      .sort(function (x, y) { return x.day < y.day ? -1 : 1; });
    if (!done.length) {
      title.textContent = "No run yet";
      el.innerHTML = window.XIChrome.formChips([]) + '<span class="run-none">Play today to start one.</span>';
      return;
    }
    var days = done.map(function (r) { return r.day; });
    var last = days[days.length - 1];
    var yest = serverDay ? new Date(Date.parse(serverDay + "T00:00:00Z") - 86400000).toISOString().slice(0, 10) : null;
    var run = 0;
    if (last === serverDay || last === yest) {
      run = 1;
      for (var i = days.length - 1; i > 0; i--) {
        var prev = new Date(Date.parse(days[i] + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
        if (days[i - 1] === prev) run++; else break;
      }
    }
    var best = 1, walk = 1;
    for (var k = 1; k < days.length; k++) {
      var back = new Date(Date.parse(days[k] + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      walk = days[k - 1] === back ? walk + 1 : 1;
      if (walk > best) best = walk;
    }
    title.textContent = run + " day run";
    el.innerHTML = window.XIChrome.formChips(done.map(function (r) { return r.score; })) +
      '<span class="run-best">best ' + best + "</span>";
  }
  function fillClubs() {
    var sel = $("homeClubSelect");
    if (!sel || !window.XI_CLUBS) return;
    var chosen = "";
    try { chosen = localStorage.getItem("xi.club") || ""; } catch (e) {}
    sel.innerHTML = '<option value="">Random club</option>';
    window.XI_CLUBS.forEach(function (c) { var o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
    sel.value = chosen;
    sel.onchange = function () { try { localStorage.setItem("xi.club", sel.value); } catch (e) {} };
  }
  function todayResult() {
    return readResults().find(function (r) { return r && r.day === serverDay; }) || null;
  }
  function renderHero() {
    if (!todayBoard) {
      $("startTitle").textContent = "No board today";
      $("startSub").textContent = "The calendar has a gap. The clubs are open.";
      $("startState").textContent = "";
      return;
    }
    $("startTitle").textContent = todayBoard.category;
    $("startSub").textContent = todayBoard.subtitle;
    var had = todayResult();
    $("startState").textContent = had
      ? "Played " + DOT + " " + had.score + " pts " + DOT + " " + ({ W: "Win", D: "Draw", L: "Loss" }[had.result] || "")
      : "Eleven calls " + DOT + " a clock on each";
  }
  /* THE BOARD OF THE WEEK: one club board, picked by the ISO week so everyone
     gets the same one and it turns over on Monday with nothing stored. */
  var featured = null;
  function weekIndex() {
    var d = new Date();
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 604800000);
  }
  function renderFeatured() {
    var all = [];
    (catalog || []).forEach(function (c) { c.boards.forEach(function (b) { all.push({ club: c.name, slug: c.slug, id: b.id, subtitle: b.subtitle }); }); });
    all.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    featured = all.length ? all[weekIndex() % all.length] : null;
    $("homeFeaturedName").textContent = featured ? featured.club : "—";
    $("homeFeaturedState").textContent = featured ? "Managers, earlier or later" : "";
    var n = all.length;
    $("homeThemedState").textContent = n ? n + " club boards" : "";
  }
  function renderLanding() {
    renderHero(); renderFeatured(); renderForm(); fillClubs();
    $("homePreviousCount").textContent = archiveDays
      ? (archiveDays.length ? archiveDays.length + (archiveDays.length === 1 ? " day so far" : " days so far") : "The first day is today")
      : "Every day so far";
  }

  /* ---- previous puzzles ------------------------------------------------ */
  function hideArchive() {
    $("archivePanel").classList.add("hidden");
    $("homePrevious").setAttribute("aria-expanded", "false");
  }
  function toggleArchive() {
    var panel = $("archivePanel");
    if (!panel.classList.contains("hidden")) { hideArchive(); return; }
    panel.classList.remove("hidden");
    $("homePrevious").setAttribute("aria-expanded", "true");
    renderArchive();
    if (panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
  }
  function dayLabel(day) {
    var d = new Date(day + "T00:00:00Z");
    if (isNaN(d.getTime())) return day;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }
  function renderArchive() {
    var list = $("archiveList");
    if (!list || !archiveDays) return;
    var played = {};
    readResults().forEach(function (r) { if (r && r.day) played[r.day] = r; });
    list.innerHTML = "";
    if (!archiveDays.length) {
      var empty = document.createElement("li"); empty.className = "arch-empty";
      empty.textContent = "The first day is today — come back tomorrow.";
      list.appendChild(empty); $("archiveSub").textContent = ""; return;
    }
    var left = 0;
    archiveDays.forEach(function (e) {
      var rec = played[e.day]; if (!rec) left++;
      var li = document.createElement("li");
      var b = document.createElement("button"); b.type = "button";
      b.className = "arch-row" + (rec ? " done" : "");
      b.setAttribute("data-day", e.day);
      var day = document.createElement("span"); day.className = "arch-day"; day.textContent = dayLabel(e.day);
      var theme = document.createElement("span"); theme.className = "arch-theme"; theme.textContent = e.category;
      var state = document.createElement("span"); state.className = "arch-state";
      state.textContent = rec ? (rec.score != null ? rec.score + " pts" : "Played") : "To play";
      b.appendChild(day); b.appendChild(theme); b.appendChild(state); li.appendChild(b); list.appendChild(li);
    });
    $("archiveSub").textContent = left === 0 ? "You have played every day so far." : left + (left === 1 ? " day" : " days") + " to play";
  }

  /* ---- opening a board ------------------------------------------------- */
  var pending = null;   /* a board opened and not yet kicked off */
  function show(id) {
    ["screenStart", "screenGame", "screenResults"].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }
  /* A board on its card, covered, the first clock waiting for Kick off. */
  function coverBoard(board, mode, meta) {
    pending = { board: board, mode: mode, meta: meta };
    hideArchive();
    drawBoard(freshRound(board, mode, meta));
    $("kickKicker").textContent = meta.kicker || "BOARD";
    $("kickTitle").textContent = board.category;
    $("kickNote").textContent = board.subtitle + (mode === "free" ? " " + DOT + " Free play, no run at stake." : "");
    $("kickCover").classList.remove("hidden");
    $("screenGame").classList.add("covered");
    show("screenGame");
  }
  function openDay(day, kicker) {
    api("daily?day=" + encodeURIComponent(day)).then(function (r) {
      if (!r.board) { toast("No board that day"); return; }
      coverBoard(r.board, day === serverDay ? "daily" : "free", { day: day === serverDay ? day : null, kicker: kicker });
    }, function () { toast("Board unavailable"); });
  }
  function openBoard(id, kicker) {
    api("board?id=" + encodeURIComponent(id)).then(function (r) {
      coverBoard(r.board, "free", { kicker: kicker });
    }, function () { toast("That board is not available"); });
  }
  function kickOff() {
    if (!pending) return;
    var p = pending; pending = null;
    $("kickCover").classList.add("hidden");
    $("screenGame").classList.remove("covered");
    startRound(p.board, p.mode, p.meta);
  }

  /* ---- the round ------------------------------------------------------- */
  function startRound(board, mode, meta) {
    g = freshRound(board, mode, meta);
    drawBoard(g);
    show("screenGame");
    playsStart();
    showCall();
  }
  function drawBoard(round) {
    var b = round.board;
    $("modeLabel").textContent = round.mode === "daily" ? "Today" : (round.kicker || "Free play");
    $("cat").innerHTML = "";
    var catText = document.createTextNode(b.category); $("cat").appendChild(catText);
    var small = document.createElement("small"); small.textContent = b.subtitle; $("cat").appendChild(small);
    $("srcLine").textContent = b.sourceLine || (b.trueAsOf ? "True as of " + b.trueAsOf + "." : "");
    var ladder = $("ladder"), sheet = $("sheet");
    ladder.innerHTML = ""; sheet.innerHTML = "";
    for (var i = 0; i < S.CALLS; i++) {
      var d = document.createElement("i"); d.textContent = i + 1; ladder.appendChild(d);
      var li = document.createElement("li");
      var n = document.createElement("b"); n.textContent = i + 1;
      var who = document.createElement("span"); var val = document.createElement("em");
      li.appendChild(n); li.appendChild(who); li.appendChild(val); sheet.appendChild(li);
    }
    /* Any earlier settled rows go; the live row stays. */
    Array.prototype.slice.call($("rows").querySelectorAll(".duel.settled")).forEach(function (r) { r.remove(); });
    g = g && g.board === round.board ? g : round;
    showPair(round, true);
    paint(round);
  }
  function rowContext(round, i) {
    if (i === 0) return round.board.rows[0].context || "";
    return (round.contexts && round.contexts[i]) || "";
  }
  function rowBorn(round, i) {
    if (i === 0) return round.board.rows[0].birthDate || "";
    return (round.born && round.born[i]) || "";
  }
  function showPair(round, quiet) {
    var b = round.board, L = b.rows[round.step], R = b.rows[round.step + 1];
    var left = $("left"), right = $("right");
    left.className = "player known"; right.className = "player";
    /* The known side shows what the server has released for it: the first
       row's context comes with the board, every later row's comes with its
       verdict. The hidden side shows its name and nothing else — a context
       is prose about the item and can carry the very date being asked for,
       which is how "In charge until 2026" stood beside a question mark on
       the live page. */
    var Lc = rowContext(round, round.step), Lb = rowBorn(round, round.step);
    left.querySelector(".who").textContent = L.name;
    left.querySelector(".sub").textContent = Lc + (Lb ? (Lc ? " " + DOT + " " : "") + bornText(Lb) : "");
    left.querySelector(".val").textContent = fmt(round.values[round.step], b.unit);
    left.querySelector(".val").className = "val";
    right.querySelector(".who").textContent = R.name;
    right.querySelector(".sub").textContent = "";
    right.querySelector(".val").textContent = "?";
    right.querySelector(".val").className = "val q";
    var f = faces(b), ref = fmt(round.values[round.step], b.unit);
    /* Name the subject and the reference, every call: the subject is the
       hidden item on the right, the reference the value on the left. */
    $("ask").innerHTML = "";
    var bb = document.createElement("b"); bb.textContent = R.name; $("ask").appendChild(bb);
    $("ask").appendChild(document.createTextNode(" — " + f.lo.toLowerCase() + " or " + f.hi.toLowerCase() + " than " + ref + "?"));
    $("higher").innerHTML = ""; $("lower").innerHTML = "";
    var hb = document.createElement("b"); hb.textContent = "▲ " + f.hi; var hs = document.createElement("small"); hs.textContent = "than " + ref;
    var lb = document.createElement("b"); lb.textContent = "▼ " + f.lo; var ls = document.createElement("small"); ls.textContent = "than " + ref;
    $("higher").appendChild(hb); $("higher").appendChild(hs); $("lower").appendChild(lb); $("lower").appendChild(ls);
    var canCall = !round.over && !round.awaitingNext && !quiet;
    $("higher").disabled = !canCall; $("lower").disabled = !canCall;
  }
  function showCall() {
    /* Painted here, after the step has moved, and not only when a call
       settles: painted then, the ladder's current mark stayed on the call
       just made, one behind the pair on screen, for the whole of the next
       call. */
    paint(g);
    showPair(g, false);
    startClock();
  }
  function paint(round) {
    Array.prototype.forEach.call($("ladder").children, function (d, i) {
      d.className = round.results[i] === true ? "ok" : round.results[i] === false ? "bad" : (i === round.step && !round.over ? "cur" : "");
    });
    Array.prototype.forEach.call($("sheet").children, function (li, i) {
      var r = round.results[i]; li.className = r === true ? "ok" : r === false ? "bad" : "";
      li.querySelector("span").textContent = r === undefined ? "" : round.board.rows[i + 1].name;
      li.querySelector("em").textContent = r === undefined ? "" : fmt(round.values[i + 1], round.board.unit);
      var old = li.querySelector(".src"); if (old) old.remove();
      var src = round.sources[i + 1];
      if (r !== undefined && src && (src.quote || src.url)) {
        var s = document.createElement("span"); s.className = "src";
        if (src.quote) s.appendChild(document.createTextNode("“" + src.quote + "” "));
        if (src.url) { var a = document.createElement("a"); a.href = src.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = src.publisher || "source"; s.appendChild(a); }
        li.appendChild(s);
      }
    });
    var right = 0; for (var i = 0; i < S.CALLS; i++) if (round.results[i] === true) right++;
    $("rightCount").textContent = right;
    $("banked").textContent = S.score(round.results, round.worths);
    Array.prototype.forEach.call($("subs").querySelectorAll("i"), function (dot, i) { dot.classList.toggle("spent", i < round.subsUsed); });
    var leftSubs = S.SUBS - round.subsUsed;
    $("subs").querySelector("span").textContent = leftSubs <= 0 ? "No substitutions left" : leftSubs + (leftSubs === 1 ? " substitution" : " substitutions");
  }

  /* ---- the clock, one per call ----------------------------------------- */
  function startClock() {
    stopClock();
    g.clockStart = Date.now();
    tick();
    g.ticker = setInterval(tick, 100);
  }
  function stopClock() { if (g && g.ticker) { clearInterval(g.ticker); g.ticker = null; } }
  function tick() {
    if (!g || g.over || g.awaitingNext) return;
    var elapsed = Date.now() - g.clockStart;
    var worth = S.worthAt(elapsed);
    $("callWorth").textContent = worth;
    var frac = Math.max(0, 1 - Math.max(0, elapsed - S.GRACE_MS) / (S.CLOCK_MS - S.GRACE_MS));
    $("clockBar").querySelector("i").style.width = (frac * 100) + "%";
    $("clockBar").classList.toggle("low", worth <= 3);
    if (elapsed >= S.CLOCK_MS) timeOut();
  }

  /* ---- a call ---------------------------------------------------------- */
  function call(which) {
    if (!g || g.over || g.awaitingNext || g.inflight) return;
    var elapsed = Date.now() - g.clockStart;
    stopClock();
    g.inflight = true;
    $("higher").disabled = true; $("lower").disabled = true;
    judge(which, function (v) {
      g.inflight = false;
      if (!v) { toast("Could not reach the server"); startClock(); showPair(g, false); return; }
      settle(v, v.right ? S.worthAt(elapsed) : 0, false);
    });
  }
  function timeOut() {
    if (!g || g.over || g.awaitingNext || g.inflight) return;
    stopClock();
    g.awaitingNext = true; g.inflight = true;
    $("higher").disabled = true; $("lower").disabled = true;
    judge("none", function (v) {
      g.inflight = false;
      if (!v) { toast("Could not reach the server"); g.awaitingNext = false; startClock(); showPair(g, false); return; }
      settle(v, 0, true);
    });
  }
  function judge(which, then) {
    var i = g.step + 1, token = g.token;
    fetch("/api/hilo/call", {
      method: "POST", headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ token: token, index: i, call: which }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { then(v && v.index === i ? v : null); })
      .catch(function () { then(null); });
  }
  function settle(v, worth, timedOut) {
    var b = g.board, L = b.rows[g.step], R = b.rows[g.step + 1];
    g.values[g.step + 1] = v.value;
    g.sources[g.step + 1] = v.source || null;
    g.contexts = g.contexts || {}; g.born = g.born || {};
    g.contexts[g.step + 1] = v.context || "";
    g.born[g.step + 1] = v.birthDate || "";
    g.results[g.step] = !!v.right;
    g.worths[g.step] = v.right ? worth : 0;
    if (!v.right) g.subsUsed++;
    /* The settled row: both values, a stamp, and what it cost. */
    var row = document.createElement("div");
    row.className = "duel settled " + (v.right ? "ok" : "bad");
    var l = document.createElement("div"); l.className = "player known";
    var lw = document.createElement("div"); lw.className = "who"; lw.textContent = L.name;
    var lv = document.createElement("div"); lv.className = "val"; lv.textContent = fmt(g.values[g.step], b.unit);
    l.appendChild(lw); l.appendChild(lv);
    var vs = document.createElement("div"); vs.className = "vs"; vs.textContent = "V";
    var r = document.createElement("div"); r.className = "player " + (v.right ? "ok" : "bad");
    var rw = document.createElement("div"); rw.className = "who"; rw.textContent = R.name;
    var rv = document.createElement("div"); rv.className = "val"; rv.textContent = fmt(v.value, b.unit);
    r.appendChild(rw); r.appendChild(rv);
    var st = document.createElement("div"); st.className = "stamp";
    var sb = document.createElement("b"); sb.textContent = v.right ? "Correct" : "Wrong";
    var ss = document.createElement("span");
    var born = v.birthDate ? bornText(v.birthDate) : "";
    ss.textContent = v.right
      ? ("+" + worth + (born ? " " + DOT + " " + born : ""))
      : ((timedOut ? "out of time " + DOT + " " : "") +
         (g.subsUsed > S.SUBS ? "over your substitutions, a draw at best" : "a substitution") +
         (born ? " " + DOT + " " + born : ""));
    st.appendChild(sb); st.appendChild(ss);
    row.appendChild(l); row.appendChild(vs); row.appendChild(r); row.appendChild(st);
    var rows = $("rows");
    rows.insertBefore(row, $("live"));
    rows.scrollTop = rows.scrollHeight;
    paint(g);
    g.elapsed = Math.round((Date.now() - g.startedAt) / 1000);
    if (g.step >= S.CALLS - 1) { fullTime(); return; }
    if (timedOut) {
      /* Only a timed-out call waits for a tap: someone who stepped away must
         not burn the calls that follow. */
      $("nextRow").classList.remove("hidden");
      $("callWorth").textContent = "0";
      return;
    }
    g.step++;
    showCall();
  }
  function nextCall() {
    if (!g || !g.awaitingNext || g.over) return;
    g.awaitingNext = false;
    $("nextRow").classList.add("hidden");
    g.step++;
    showCall();
  }

  /* ---- full time ------------------------------------------------------- */
  function fullTime() {
    if (!g || g.over) return;
    g.over = true; stopClock();
    $("higher").disabled = true; $("lower").disabled = true;
    $("nextRow").classList.add("hidden");
    var score = S.score(g.results, g.worths), res = S.result(g.results);
    var right = 0, wrong = 0;
    for (var i = 0; i < S.CALLS; i++) { if (g.results[i] === true) right++; else if (g.results[i] === false) wrong++; }
    var bonus = S.runBonus(g.results);
    var words = { W: "Win", D: "Draw", L: "Loss" };
    var squares = "";
    for (var k = 0; k < S.CALLS; k++) squares += g.results[k] === true ? SQ_ON : g.results[k] === false ? SQ_OFF : SQ_NONE;
    var share = "HiLo XI " + DOT + " " + g.board.category + "\n" + squares + "\n" +
      right + "/11 right " + DOT + " " + score + "/114 " + DOT + " " + words[res] + "\nthexigames.com/hilo";
    $("ftScore").textContent = score;
    var rr = $("ftRes"); rr.textContent = words[res]; rr.className = "res " + res;
    $("ftLine").textContent = right + " right, " + wrong + " wrong" + (bonus ? ", " + bonus + " for the runs" : "") +
      (g.mode === "daily" ? "." : " " + DOT + " Free play, not counted in your run.");
    $("shareText").value = share;
    if (g.mode === "daily" && g.day) {
      recordResult({ game: "hilo", day: g.day, boardId: g.board.id, score: score, right: right, wrong: wrong,
        bonus: bonus, result: res, elapsedSeconds: g.elapsed, at: Date.now() });
    }
    playsEnd(true);
    show("screenResults");
  }
  function goToMenu() {
    if (g && !g.over) playsEnd(false);
    stopClock(); g = null; pending = null;
    $("kickCover").classList.add("hidden");
    $("screenGame").classList.remove("covered");
    renderLanding();
    show("screenStart");
    location.hash = "";
  }

  /* ---- how far people get, through the family's helper ----------------- */
  function playsProgress() {
    var right = 0; if (g) for (var i = 0; i < S.CALLS; i++) if (g.results[i] === true) right++;
    return { solved: right, elapsed: g ? Math.round((Date.now() - g.startedAt) / 1000) : 0,
             detail: g ? { wrong: g.subsUsed, made: S.madeCount(g.results) } : {} };
  }
  function playsStart() {
    if (!window.XIPlays || !g) return;
    window.XIPlays.start({ game: "hilo", mode: g.mode === "daily" ? "daily" : "free",
      boardKey: g.mode === "daily" && g.day ? "hl:" + g.day : "hlb:" + g.board.id, total: S.CALLS }, playsProgress);
  }
  function playsEnd(completed) {
    if (window.XIPlays && window.XIPlays.active()) window.XIPlays.end(!!completed);
  }

  /* ---- odds and ends --------------------------------------------------- */
  var toastT;
  function toast(s) {
    var t = $("toast"); t.textContent = s; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 1800);
  }
  function copyShare() {
    var text = $("shareText").value;
    if (navigator.share) { navigator.share({ text: text }).catch(function () { copy(text); }); return; }
    copy(text);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Result copied"); }, function () { toast("Copy failed"); });
    } else toast("Copy failed");
  }

  /* ---- boot ------------------------------------------------------------ */
  function boot() {
    $("buildTag").textContent = BUILD;
    syncAccount();
    $("homeDaily").onclick = function () {
      if (!todayBoard) { toast("No board today — try the clubs"); return; }
      var had = todayResult();
      if (had) { toast("Today's board is played — " + had.score + " pts"); return; }
      startRound(todayBoard, "daily", { day: serverDay, kicker: "TODAY" });
    };
    $("homeFeatured").onclick = function () {
      if (!featured) { toast("No board this week"); return; }
      openBoard(featured.id, "BOARD OF THE WEEK " + DOT + " " + featured.club.toUpperCase());
    };
    $("homePrevious").onclick = toggleArchive;
    $("archiveList").onclick = function (ev) {
      var row = ev.target.closest ? ev.target.closest(".arch-row") : null;
      if (!row) return;
      var day = row.getAttribute("data-day");
      openDay(day, "PREVIOUS PUZZLE " + DOT + " " + dayLabel(day).toUpperCase());
    };
    $("kickBtn").onclick = kickOff;
    $("higher").onclick = function () { call("higher"); };
    $("lower").onclick = function () { call("lower"); };
    $("nextBtn").onclick = nextCall;
    document.addEventListener("keydown", function (ev) {
      if ($("screenGame").hidden || pending) return;
      if (ev.key === "ArrowUp" || ev.key === "h" || ev.key === "H") { call("higher"); ev.preventDefault(); }
      else if (ev.key === "ArrowDown" || ev.key === "l" || ev.key === "L") { call("lower"); ev.preventDefault(); }
      else if (ev.key === "Enter" && g && g.awaitingNext) { nextCall(); ev.preventDefault(); }
    });
    $("copyShare").onclick = copyShare;
    $("resultMenuBtn").onclick = goToMenu;
    $("navToday").onclick = function () { if ($("screenStart").hidden) goToMenu(); };

    api("daily").then(function (r) {
      serverDay = r.day; todayBoard = r.board;
      renderLanding();
      /* ?b= is the door from a club page: the board on its card, the first
         clock waiting for Kick off. Only a released board answers. */
      var q = (location.search.match(/[?&]b=([A-Za-z0-9_-]{1,40})/) || [])[1];
      if (q) openBoard(q, "FROM THE CLUBS");
      /* The permalink names a day. Opened as a previous puzzle, which is what
         it is unless it is today's; what counts towards a run is decided
         where it always was. */
      var perma = permalinkKey();
      if (perma && /^\d{4}-\d{2}-\d{2}$/.test(perma)) {
        openDay(perma, perma === serverDay
          ? "TODAY" : "PREVIOUS PUZZLE " + DOT + " " + dayLabel(perma).toUpperCase());
      }
    }, function () {
      $("startState").textContent = "Could not reach the server — check your connection.";
    });
    api("catalog").then(function (r) { catalog = r.clubs || []; renderFeatured(); }, function () {});
    api("archive").then(function (r) { archiveDays = r.days || []; renderLanding(); }, function () {});
  }

  /* A test hook. The journey suite drives the page through its buttons; the
     one thing it cannot do is wait twelve real seconds per call, so the
     time-out is reachable by name. Nothing here is a second way to play. */
  window.__hilo = { timeOut: timeOut, round: function () { return g; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
