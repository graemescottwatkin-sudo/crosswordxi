/* xi-season.js — one season, at the top level: the rule, and the device's record.
 *
 * THE OWNER'S RULE, in their words: "max of 1 win per day / finish a puzzle =
 * Draw / finish 2+ puzzles = win / start a puzzle and dont finish = loss
 * (unless you have 1+ already complete)".
 *
 *   finished 2 or more        W
 *   finished exactly 1        D
 *   started, finished none    L
 *   started nothing           no fixture — not a loss, not a blank result
 *
 * Finishing one and abandoning another is a DRAW. An unfinished puzzle only
 * counts against a day with nothing completed, which is what "unless you have
 * 1+ already complete" says.
 *
 * WHY THIS COUNTS FINISHES AND NOT POINTS. There is one season and it belongs
 * to the family, not to a game — and other kinds of quiz are coming that will
 * not use the 114 scoring. Nothing here knows what a puzzle is marked out of,
 * so a Friends crossword joins a season without changing a line of it. The
 * per-game LIVE TABLE is the other half and is football's alone: 114 = 38
 * matches at 3 points, and a Friends crossword cannot have a position in the
 * Premier League table.
 *
 * WHY THE RULE IS IN shared/ AND NOT IN functions/. Because there are two
 * branches and they must give one answer:
 *
 *   an account   the server reads season_play and answers /api/season
 *   no account   this file's own record, read by the hub, and the server
 *                never learns they played at all
 *
 * functions/_lib/season.js imports this file rather than restating it — the
 * same arrangement the games' scoring.js files already have with the Workers
 * that verify them. A rule written twice would be two answers about what a
 * Tuesday was, and the second one would be found by a player, not by a test.
 *
 * THE DAY ALWAYS COMES FROM THE SERVER. Every function here that stores
 * something takes the day as an argument and refuses without it. A device
 * clock is wrong often enough — a phone an hour behind, a traveller, a
 * deliberately wound-back tablet — that a season keyed on it would be a
 * different season on every device the player owns. /api/play answers with
 * the server's UTC day on the two calls that matter, and xi-plays.js hands
 * that day straight here. No day, no row: an unrecorded start is a small
 * loss, an invented one is a wrong season.
 *
 *   XISeason.noteStart(game, day) / noteFinish(game, day)  -> true if stored
 *   XISeason.days()          -> [{ day, started, finished }] newest first
 *   XISeason.season(days, today)                           -> the table
 */
(function (root) {
  "use strict";

  var RESULTS = { WIN: "W", DRAW: "D", LOSS: "L" };

  /* What a day comes to, from the two numbers that describe it.
     Returns null for a day with no play at all — which is NOT a loss and not
     a blank: it is a day the player did not turn up, and a season that counted
     those as defeats would punish a holiday. */
  function dayResult(started, finished) {
    var s = Math.max(0, Number(started) || 0);
    var f = Math.max(0, Number(finished) || 0);
    if (s === 0 && f === 0) return null;
    if (f >= 2) return RESULTS.WIN;
    if (f === 1) return RESULTS.DRAW;
    return RESULTS.LOSS;
  }

  /* Is this day finished, or still being played? A day in flight is shown as
     provisional — the result it WOULD be — and is not counted into the season
     until the day is over, because its loss could still become a draw. */
  function daySettled(day, today) {
    return !!day && !!today && String(day) < String(today);
  }

  /* THE POINTS A RESULT IS WORTH. Football's own: three, one, none. The
     season is a league table of days. */
  function pointsFor(result) {
    if (result === RESULTS.WIN) return 3;
    if (result === RESULTS.DRAW) return 1;
    return 0;
  }

  /* The season, from days the server has settled. `days` is a list of
     { day, started, finished }, newest or oldest first — it is sorted here, so
     the caller cannot change the answer by changing the order.
     `today` is the server's UTC day; the day matching it is the one in flight
     and is reported separately rather than counted. */
  function season(days, today) {
    var rows = (days || []).slice()
      .filter(function (d) { return d && d.day; })
      .sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });

    var played = [];
    var inFlight = null;
    rows.forEach(function (d) {
      var result = dayResult(d.started, d.finished);
      if (!daySettled(d.day, today)) {
        /* Today, or a day the server has not passed yet. Reported as what it
           would come to if it ended now, and not counted. */
        if (result) {
          inFlight = { day: d.day, provisional: result,
            started: Number(d.started) || 0, finished: Number(d.finished) || 0 };
        }
        return;
      }
      if (result) played.push({ day: d.day, result: result });
    });

    var won = played.filter(function (p) { return p.result === RESULTS.WIN; }).length;
    var drawn = played.filter(function (p) { return p.result === RESULTS.DRAW; }).length;
    var lost = played.filter(function (p) { return p.result === RESULTS.LOSS; }).length;
    return {
      played: played.length,
      won: won, drawn: drawn, lost: lost,
      points: won * 3 + drawn,
      /* Oldest first, so a form strip reads left to right like a fixture list. */
      marks: played.map(function (p) { return p.result; }),
      days: played,
      inFlight: inFlight,
      /* HAS THIS SEASON STARTED AT ALL? Not "are there results" — a player who
         kicked off an hour ago has a season under way with nothing settled in
         it, and telling them to start one would be wrong. The invitation is
         for a player with no PLAY, which is what this says. */
      started: played.length > 0 || inFlight !== null,
    };
  }

  /* What the hub says when there is no season yet. Owner, 5 Sep: "there should
     be a message to play your 1st game to start your season." Kept here beside
     the rule that decides when it is shown, rather than in the markup, so the
     condition and the sentence cannot drift apart. */
  var NO_SEASON_YET = "Play your first game to start your season.";

  /* ---- THE DEVICE'S OWN RECORD -----------------------------------------
     Family-wide, so it lives under `xi.` — a season spans the games and
     belongs to none of them, and filing it under any one game's prefix would
     make that game's storage the season's home.

     WHY THIS EXISTS AT ALL. The games' results lists hold FINISHES: a board
     abandoned halfway leaves a save file, not a result. So a season computed
     from them could never see a loss, and every day a player turned up would
     read as a draw or a win. The two facts the rule needs — how many started,
     how many finished — are only both known at the moment they happen, which
     is where this is written from.

     Games are NAMED rather than counted, which makes a double start free:
     a reload, a double tap and a resumed round all add "crossword" to a set
     that already contains it. That is the same reason the server's table has
     a primary key on (user, day, game) rather than a counter. */
  var KEY = "xi.season.v1";
  var KEEP_DAYS = 200;
  var GAME = /^[a-z][a-z0-9-]{0,23}$/;
  var DAY = /^\d{4}-\d{2}-\d{2}$/;

  function readAll() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") return {};
      return raw.days;
    } catch (e) { return {}; }
  }

  function writeAll(days) {
    /* Oldest days fall off the back. A season is read as a table and a form
       strip; two hundred days is more than a year of either, and storage that
       grows without a limit is storage that one day throws. */
    var keys = Object.keys(days).sort();
    while (keys.length > KEEP_DAYS) delete days[keys.shift()];
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, days: days })); return true; }
    catch (e) { return false; }
  }

  function add(game, day, field) {
    var g = String(game || "").toLowerCase();
    var d = String(day || "");
    /* Refused rather than repaired, the same rule the play endpoint uses on a
       board key: a value that had to be cleaned up will not group with the
       others, and here that would be one game counted as two. */
    if (!GAME.test(g) || !DAY.test(d)) return false;
    var days = readAll();
    var rec = days[d] && typeof days[d] === "object" ? days[d] : { s: [], f: [] };
    if (!Array.isArray(rec.s)) rec.s = [];
    if (!Array.isArray(rec.f)) rec.f = [];
    /* A FINISH IMPLIES A START, even when no start was seen: somebody whose
       start never reached the server, or who came back to a board begun
       yesterday, has still played today. A day with a finish in it is never
       a day with nothing started. */
    if (rec.s.indexOf(g) === -1) rec.s.push(g);
    if (field === "f" && rec.f.indexOf(g) === -1) rec.f.push(g);
    days[d] = rec;
    return writeAll(days);
  }

  function noteStart(game, day) { return add(game, day, "s"); }
  function noteFinish(game, day) { return add(game, day, "f"); }

  /* The days this device has played, newest first, in the shape the rule
     wants: { day, started, finished }. The same shape the server's daysFor()
     returns, so the hub feeds either into season() without knowing which
     branch it is on. */
  function days() {
    var all = readAll();
    return Object.keys(all).filter(function (d) { return DAY.test(d); })
      .sort().reverse()
      .map(function (d) {
        var rec = all[d] || {};
        return {
          day: d,
          started: (rec.s || []).length,
          finished: (rec.f || []).length,
        };
      });
  }

  /* Forgetting. Offered because a record kept about somebody must be one they
     can drop; the hub's account branch does not use it. */
  function forget() {
    try { localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  var api = {
    RESULTS: RESULTS,
    NO_SEASON_YET: NO_SEASON_YET,
    KEY: KEY,
    dayResult: dayResult,
    daySettled: daySettled,
    pointsFor: pointsFor,
    season: season,
    noteStart: noteStart,
    noteFinish: noteFinish,
    days: days,
    forget: forget,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.XISeason = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
