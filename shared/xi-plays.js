/* xi-plays.js — how far people get, counted the same way in every game.
 *
 * Two anonymous events per attempt, posted to /api/play: a START when a board
 * opens (which game, which board, which mode, where the visit came from) and
 * an END when it is finished or abandoned (how many of the eleven, seconds,
 * and whatever the game wants to add). The play id is random per attempt and
 * forgotten when it ends; it pairs a start with its end and identifies
 * nobody. This lived in the crossword alone, so the other games could not say
 * whether a board that 140 people opened was finished by 12 or by 120.
 *
 * THE ABANDONED HALF IS THE INTERESTING HALF. A normal fetch is cancelled when
 * a tab closes, so the end is sent by sendBeacon on pagehide and when the page
 * goes hidden — the game hands over a progress() function at start and the
 * helper reads it at the moment the page is leaving. A game therefore calls
 * start() once and end(true) at full time; everything else is here.
 *
 *   XIPlays.start({ game, mode, boardKey, total, dailyNo, themeKey, phase }, progress, { keep })
 *   XIPlays.end(completed)              -> sends once; later calls are ignored
 *   XIPlays.current()                   -> { playId, playNo } for a save file
 *   XIPlays.resume(playId, playNo)      -> a restored game keeps its reference
 *   XIPlays.attribution()               -> the visit's campaign tags, if any
 *
 * progress() returns { solved, elapsed, checks, reveals, detail } — solved of
 * total is the universal number; detail is a small object the game owns,
 * stored as JSON, never read by the server.
 */
(function () {
  "use strict";
  var ATTR_KEY = "xi.attr", ATTR_LEGACY = "fcw.attr";
  var ATTR_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  var meta = null, progress = null, playId = null, playNo = null, sent = false;

  /* One slug rule for every value that will be grouped on: a report split
     across Reddit, reddit.com, r/reddit and reddit-social cannot be repaired
     afterwards. The crossword's rule, moved here unchanged. */
  function slugify(v) {
    var x = String(v || "").toLowerCase()
      .replace(/^https?:\/\//, "")        // reddit.com/r/gunners -> reddit.com...
      .replace(/^www\./, "")
      .replace(/\.(com|co\.uk|org|net|io)\b.*$/, "")   // ...-> reddit
      .replace(/^r\//, "")                // r/gunners -> gunners
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return x || null;
  }
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /* WHERE THE VISIT CAME FROM. Campaign tags on the URL start a new
     attribution for the session; a plain arrival keeps whatever the session
     had, so moving from the landing into a board does not lose it. ?r=a1 is
     the short form: it fills the campaign with source "ref". The referrer is
     kept as a host only — a full URL can carry a query that names a person.
     Session-scoped and family-wide: xi.attr, with the crossword's old key
     read as a fallback so a visit already tagged there is not lost. */
  function attribution() {
    var have = null;
    try { have = JSON.parse(sessionStorage.getItem(ATTR_KEY) || sessionStorage.getItem(ATTR_LEGACY)); } catch (e) {}
    var q;
    try { q = new URLSearchParams(location.search || ""); } catch (e) { return have || null; }
    var fresh = {}, any = false;
    ATTR_FIELDS.forEach(function (f) {
      var v = slugify(q.get(f));
      if (v) { fresh[f] = v; any = true; }
    });
    var short = slugify(q.get("r"));
    if (short && !fresh.utm_campaign) {
      fresh.utm_campaign = short;
      if (!fresh.utm_source) fresh.utm_source = "ref";
      any = true;
    }
    if (!any) return have || null;
    try {
      var ref = document.referrer || "";
      if (ref) fresh.referrer = slugify(new URL(ref).hostname);
    } catch (e) {}
    try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }

  function post(payload, beacon) {
    var body = JSON.stringify(payload);
    if (beacon) {
      try {
        if (navigator.sendBeacon &&
            navigator.sendBeacon("/api/play", new Blob([body], { type: "application/json" }))) return null;
      } catch (e) {}
    }
    try {
      return fetch("/api/play", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body, keepalive: !!beacon,
      });
    } catch (e) { return null; }
  }

  /* start: opts.keep says a restored game brings its own id back, so the
     sitting continues rather than becoming a second attempt; the server hands
     the same number back for an id it has seen. Returns a promise of the
     play number, which is the reference a player can quote. */
  function start(m, fn, opts) {
    meta = m || {}; progress = typeof fn === "function" ? fn : null;
    var keep = !!(opts && opts.keep);
    if (!keep || !playId) { playId = newId(); playNo = null; }
    sent = false;
    var body = {
      event: "start", playId: playId, game: meta.game, mode: meta.mode || "daily",
      boardKey: meta.boardKey || null, total: meta.total || 11,
      dailyNo: meta.dailyNo || null, themeKey: meta.themeKey || null,
      phase: meta.phase || null, attribution: attribution(),
    };
    var p = post(body, false);
    if (!p) return Promise.resolve(null);
    return p.then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.playNo) playNo = d.playNo;
        noteSeason("noteStart", d);
        return playNo;
      })
      .catch(function () { return null; });     /* never let counting break the game */
  }

  /* THE DEVICE'S OWN SEASON, written at the same two moments the server writes
     the account's. Which is the point: one event, two records, and no game
     has to know a season exists.
     The day is the SERVER'S, read back off its answer — see xi-season.js. A
     reply that carries no day (rate-limited, offline, a beacon that has no
     reply at all) writes nothing, and a start that went unrecorded is a far
     smaller wrong than one filed under a day a device clock invented. */
  function noteSeason(which, d) {
    try {
      if (!d || !d.day || !meta || !meta.game) return;
      if (window.XISeason && typeof window.XISeason[which] === "function") {
        window.XISeason[which](meta.game, d.day);
      }
    } catch (e) {}
  }

  /* end: once per attempt. completed says the board was finished; the rest
     comes from progress(), read now. Sent by beacon when the page is leaving,
     because that is the send a closing tab would cancel. */
  function end(completed, leaving) {
    if (!playId || sent || !meta) return;
    /* A finish is final. An abandon is not: a phone that switched apps and
       came back is still playing, and its later finish must overwrite the
       abandon it sent on the way out — the server's end is an update, so
       the last word wins and the earlier one costs nothing. */
    if (completed) sent = true;
    var p = {};
    try { p = (progress && progress()) || {}; } catch (e) { p = {}; }
    var body = {
      event: "end", playId: playId, game: meta.game, mode: meta.mode || "daily",
      solved: p.solved || 0, completed: !!completed, elapsed: p.elapsed || 0,
      checks: p.checks || 0, reveals: p.reveals || 0,
      detail: p.detail && typeof p.detail === "object" ? p.detail : null,
    };
    var r = post(body, !!leaving);
    /* Only a FINISH is worth waiting for a reply to. An abandon is the absence
       of a finish — the start is already written, and the season reads what is
       missing — so a beacon that answers nothing has nothing to tell us. */
    if (completed && r && r.then) {
      r.then(function (res) { return res.json(); })
        .then(function (d) { noteSeason("noteFinish", d); })
        .catch(function () {});
    }
  }

  function current() { return { playId: playId, playNo: playNo }; }
  function resume(id, no) {
    if (id) { playId = String(id); playNo = no || null; sent = false; }
  }
  function active() { return !!(playId && meta && !sent); }

  /* The abandoned half: the page leaving mid-board is an end with completed
     false. Both events, because a phone switching apps fires only the second
     and a closing tab may fire only the first. */
  window.addEventListener("pagehide", function () { if (active()) end(false, true); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && active()) end(false, true);
  });

  window.XIPlays = {
    start: start, end: end, current: current, resume: resume, active: active,
    attribution: attribution, slugify: slugify,
  };
})();
