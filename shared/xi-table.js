/* xi-table.js — the live league table, for every football game.
 *
 * WHAT IT IS. You pick a club; the board's running score IS that club's points
 * in a real historical season, and you move up and down a real table while you
 * play. Finish on 82 and you won the league in 1995/96. Finish on 34 and you
 * went down. The crossword has had this since the beginning and it is the best
 * thing in the game; the other four football titles had nothing.
 *
 * WHAT IT IS NOT. It is not the season. There is exactly one season and it
 * belongs to the hub — one result a day across the whole family, counted from
 * finishes rather than points (shared/xi-season.js). This is the per-BOARD
 * view, and the two must not be confused: a fake 38-game record derived from
 * one board's score is precisely what came out of the crossword on 5 Sep.
 *
 * IT IS FOOTBALL'S, NOT THE FAMILY'S. 114 = 38 matches at 3 points a win, and
 * a Friends crossword cannot have a position in the Premier League table. When
 * another theme lands it gets no table, and that is correct rather than a gap —
 * the half that spans themes is the season, which knows nothing about scoring.
 *
 *   XITable.mount(el, { score, max })   draw it, and return a handle
 *   handle.update(score)                the score moved; redraw
 *   handle.club()                       who the player picked
 *
 * THE CLUB IS FAMILY-WIDE, under `xi.club`. Somebody who supports Everton in
 * the crossword supports Everton in the word search, and asking again in every
 * game would be asking a settled question four more times.
 */
(function (root) {
  "use strict";

  var CLUB_KEY = "xi.club";
  /* The crossword's own key, read once if the family one is empty. A player
     who chose a club before this existed keeps it rather than being asked
     again on a game they have played for months. */
  var LEGACY_CLUB_KEY = "fcw.club";

  function seasons() {
    var s = root.XI_SEASONS || root.FCW_SEASONS;
    return Array.isArray(s) ? s : [];
  }

  /* Seasons in which a club actually played. */
  function seasonsForClub(club) {
    return seasons().filter(function (s) {
      return s.table && s.table.some(function (r) { return r.club === club; });
    });
  }

  /* A small deterministic hash, so a board number or a day string picks the
     same season for everybody. Not a random: two players on the same board
     must see the same ladder, or comparing scores means nothing. */
  function seedOf(v) {
    var s = String(v == null ? "" : v), h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /* The season a board is played in. Prefers seasons the club actually played,
     falls back to all of them for a club that never made the top flight.
     No difficulty bias here: that is the crossword's own idea and stays in the
     crossword's engine, where the difficulty lives. */
  function pickSeason(club, seed) {
    var pool = seasonsForClub(club);
    if (!pool.length) pool = seasons();
    if (!pool.length) return null;
    return pool[seedOf(seed) % pool.length];
  }

  /* THE TABLE. The player's club carries the player's score; every other club
     keeps its real historical points. If the club did not play that season the
     player takes the bottom club's place, so the ladder is always twenty.
     Lifted out of the crossword's engine unchanged — it was already the one
     implementation, it just lived where only one game could reach it. */
  function buildTable(club, liveScore, season) {
    if (!season) return [];
    var rows = [], replaced = false;
    season.table.forEach(function (r) {
      if (r.club === club && !replaced) { replaced = true; return; }   // player takes their own slot
      rows.push({ club: r.club, points: r.points, isPlayer: false });
    });
    if (!replaced) rows.pop();                    // club absent that season: displace the bottom club
    rows.push({ club: club, points: liveScore, isPlayer: true });
    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0);              // player wins ties
    });
    rows.forEach(function (r, i) { r.pos = i + 1; });
    return rows;
  }

  function playerPosition(table) {
    for (var i = 0; i < table.length; i++) if (table[i].isPlayer) return table[i].pos;
    return table.length;
  }

  /* ---- what the player picked ------------------------------------------ */

  function savedClub() {
    try {
      return localStorage.getItem(CLUB_KEY) ||
        /* Reading another game's prefix is allowed and writing it is not — the
           family rule. This reads the crossword's old key and, if it finds
           one, writes it to the FAMILY key, never back. */
        localStorage.getItem(LEGACY_CLUB_KEY) || "";
    } catch (e) { return ""; }
  }

  function saveClub(club) {
    try { localStorage.setItem(CLUB_KEY, String(club || "")); } catch (e) {}
  }

  function clubs() {
    if (Array.isArray(root.XI_CLUBS) && root.XI_CLUBS.length) return root.XI_CLUBS.slice();
    /* Derived from the tables when the club list is not loaded, so a game that
       has the seasons has everything it needs. */
    var seen = {};
    seasons().forEach(function (s) {
      (s.table || []).forEach(function (r) { seen[r.club] = true; });
    });
    return Object.keys(seen).sort();
  }

  /* ---- drawing ---------------------------------------------------------- */

  /* THE ROWS SHOWN. Twenty is a wall on a phone, so the player and their
     neighbours are what is drawn and the rest carry a class the CSS hides —
     rendered rather than dropped so the table is complete for a screen reader
     and for anybody who wants the lot. The crossword's own arrangement. */
  function renderRows(tbody, table, around) {
    if (!tbody) return;
    var pos = playerPosition(table);
    var near = Math.max(1, Number(around) || 1);
    var html = "";
    table.forEach(function (r) {
      var far = Math.abs(r.pos - pos) > near;
      html += '<tr class="' + (r.isPlayer ? "you" : "") + (far ? " faroff" : "") + '">' +
        '<td class="pos">' + r.pos + "</td>" +
        '<td class="club">' + escapeHtml(r.club) + "</td>" +
        '<td class="pts">' + r.points + "</td></tr>";
    });
    tbody.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---- the panel --------------------------------------------------------- */

  /* Build the whole thing into an element: a club picker, a table and a label
     naming the season. The game supplies a score and says when it changes;
     everything else is here, so adding the table to a game is a div and a call
     rather than a hundred lines of copied markup.
     opts.seed    what picks the season — a board number or a day, so everyone
                  on that board sees the same ladder
     opts.score   the score now
     opts.onClub  told when the player picks, for a game that wants to redraw */
  function mount(el, opts) {
    var o = opts || {};
    if (!el) return null;
    var score = Number(o.score) || 0;
    var club = savedClub();
    var list = clubs();
    if (!list.length) return null;                 // no seasons loaded: draw nothing
    if (!club || list.indexOf(club) === -1) club = "";

    el.innerHTML =
      '<div class="club-bar"><label>Your club ' +
      '<select class="xit-club" title="Choose your club (optional)"></select></label></div>' +
      '<table class="league"><tbody class="xit-body"></tbody></table>' +
      '<span class="tb-label tb-season">League table <span class="season-tag xit-season"></span></span>';

    var select = el.querySelector(".xit-club");
    var tbody = el.querySelector(".xit-body");
    var label = el.querySelector(".xit-season");
    select.innerHTML = '<option value="">Pick a club…</option>' +
      list.map(function (c) {
        return '<option value="' + escapeHtml(c) + '"' + (c === club ? " selected" : "") +
          ">" + escapeHtml(c) + "</option>";
      }).join("");

    var season = null;

    function draw() {
      /* NO CLUB, NO TABLE. It is optional, and a ladder with a blank name in
         it says less than no ladder at all. */
      if (!club) {
        el.classList.add("xit-empty");
        tbody.innerHTML = "";
        label.textContent = "";
        return;
      }
      el.classList.remove("xit-empty");
      season = pickSeason(club, o.seed);
      var table = buildTable(club, score, season);
      renderRows(tbody, table, o.around);
      label.textContent = season ? season.season : "";
    }

    select.addEventListener("change", function () {
      club = select.value;
      saveClub(club);
      draw();
      if (typeof o.onClub === "function") { try { o.onClub(club); } catch (e) {} }
    });

    draw();

    return {
      update: function (next) { score = Number(next) || 0; draw(); },
      club: function () { return club; },
      season: function () { return season; },
      position: function () {
        return club ? playerPosition(buildTable(club, score, season)) : null;
      },
    };
  }

  var api = {
    CLUB_KEY: CLUB_KEY,
    seasons: seasons,
    seasonsForClub: seasonsForClub,
    pickSeason: pickSeason,
    buildTable: buildTable,
    playerPosition: playerPosition,
    savedClub: savedClub,
    saveClub: saveClub,
    clubs: clubs,
    renderRows: renderRows,
    mount: mount,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.XITable = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
