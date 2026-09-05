/* ============================================================
   FOOTBALL CROSSWORD — ENGINE
   Modules: FCW.rng, FCW.select, FCW.gen, FCW.validate
   Pure JS, no DOM. Runs in browser and Node (for tests).
   ============================================================ */
var FCW = (function () {
  "use strict";

  /* ---------- Seeded RNG (mulberry32) ---------- */
  function makeRng(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* ---------- Candidate pool ----------
     Groups rows by Puzzle Group Key. The generator consumes at most
     ONE row per group (Max Per Puzzle = 1) — the hard club rule. */
  var MAX_DIM = 15; // hard grid bound (width and height)

  /* Content version for the question bank. A published Daily is reproducible
     from date + seed + this version. Bump it whenever the clue data changes in
     a way that could alter an already-published Daily puzzle. */
  var QUESTION_BANK_VERSION = "2026-08-v5";

  /* Eras played by default. The game has a deliberately modern feel, so
     Pre-1990 is opt-in rather than archived: the clues stay in circulation and
     the era selection decides, which keeps the bucket real and lets it grow. */
  var DEFAULT_ERAS = ["1990s", "2000s", "2010s", "2020s", "Timeless"];
  // Rotation: keep `share` of every `of` rows per daily window — uniform
  // freshness churn, deterministic (FNV-1a over id+window), no stored state.
  // It deliberately does NOT try to fight placement bias: resting more of
  // the bank was measured to simply crown new repeat champions among the
  // survivors. That fight happens inside the placer via HOT_PENALTY below.
  var ROTATION = { share: 3, of: 5 };
  // Per-day windows: an easy-fitting row rests ~40% of individual days
  // rather than clustering for a whole available week.
  function rotationWindow(dailyNo) { return dailyNo; }
  function rotationKeep(row, window) {
    var id = row && row.id !== undefined ? row.id : row;
    var s = String(id) + ":" + window;
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return (h % ROTATION.of) < ROTATION.share;
  }
  // Placement-propensity penalty. build_hot.js measures each ANSWER's share
  // of finished grids (short, common-letter words fit everywhere) and writes
  // it as a continuous weight `hw` on every row sharing the answer. The
  // placer docks score in proportion — one crossing (12 pts) at a 30% share
  // — so dominant answers only win slots nothing quieter can fill, without
  // simply promoting the next rank into dominance (measured failure of
  // discrete tier lists).
  var HOT_SCALE = 40;
  // Seed scores run on a much smaller scale (2-14) than placement scores,
  // so the same weight needs its own multiplier here.
  var SEED_HOT_SCALE = 12;

  /* A clue that gives away any significant part of its own answer is free.
     "The city where Hull City play" hands over HULL; "This team plays in Hull"
     hands over most of HULL CITY; "beating Atletico Madrid" narrows REAL MADRID
     to one word. ANY shared word of more than three letters disqualifies the
     pairing — the data is correct, it is the clue/answer combination that is
     unusable, so such rows are excluded rather than rewritten. */
  /* Generic components of football club names. Sharing one of these with the
     clue gives nothing away — "Manchester City and West Bromwich Albion ...
     -> Birmingham City" is a perfectly fair clue — so they are ignored when
     deciding whether a clue answers itself. */
  var GENERIC_NAME_WORDS = {
    CITY: 1, UNITED: 1, TOWN: 1, ROVERS: 1, ALBION: 1, WANDERERS: 1,
    ATHLETIC: 1, COUNTY: 1, WEST: 1, EAST: 1, NORTH: 1, SOUTH: 1
  };
  function isSelfAnswering(row) {
    var big = function (t) {
      return String(t || "").toUpperCase().replace(/[^A-Z ]/g, " ")
        .split(/\s+/).filter(function (w) {
          return w.length > 3 && !GENERIC_NAME_WORDS[w];
        });
    };
    // Distinctive words only. If the answer has none left, nothing about it can
    // be given away by a shared generic word.
    var answerWords = big(row.answer);
    if (!answerWords.length) return false;
    var clueWords = {};
    big(row.clue).forEach(function (w) { clueWords[w] = true; });
    return answerWords.some(function (w) { return clueWords[w]; });
  }

  /* Every whole-word run in a piece of text, normalised to grid form, so a
     clue can be tested for mentioning another entry's answer without the false
     positives of a substring match ("SON" inside "SUNDERLAND"). */
  var mentionCache = typeof WeakMap === "function" ? new WeakMap() : null;
  var rowMetaCache = typeof WeakMap === "function" ? new WeakMap() : null;
  /* subjectKey and isSelfAnswering are both called for every candidate row on
     every placement attempt; both are pure functions of the row, so compute
     once and keep. */
  function rowMeta(row) {
    if (!rowMetaCache) return { sk: subjectKey(row), self: isSelfAnswering(row) };
    var hit = rowMetaCache.get(row);
    if (!hit) {
      hit = { sk: subjectKey(row), self: isSelfAnswering(row) };
      rowMetaCache.set(row, hit);
    }
    return hit;
  }
  /* Cached per row: the mentions check runs for every candidate row on every
     placement attempt, and recomputing word runs from long prose clues each
     time dominated generation once the bank passed a few hundred rows. */
  function rowMentions(row) {
    if (!mentionCache) return mentionKeys(row.clue);
    var hit = mentionCache.get(row);
    if (!hit) { hit = mentionKeys(row.clue); mentionCache.set(row, hit); }
    return hit;
  }
  function mentionKeys(text, maxWords) {
    var words = String(text || "").toUpperCase().replace(/[^A-Z ]/g, " ")
      .split(/\s+/).filter(Boolean);
    var keys = {}, cap = maxWords || 4;
    for (var i = 0; i < words.length; i++) {
      var run = "";
      for (var j = 0; j < cap && i + j < words.length; j++) {
        run += words[i + j];
        keys[run] = true;
      }
    }
    return keys;
  }

  /* Normalised comparison key for a clue subject or answer. */
  function termKey(text) {
    return String(text || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  }
  /* The subject/answer namespace rule exists to stop an ENTITY term being used
     both as an answer and as the subject of another clue (LONDON as answer
     beside "this team plays in London"). It only applies where the Clue cell
     holds a term. Categories whose Clue is prose or a bare year — "1966",
     "Won the World Cup in 1966" — have no subject term, and must not be
     collapsed to one shared key, which would silently allow only one such
     clue per puzzle. Returns null when there is no comparable term. */
  function subjectKey(row) {
    var raw = String(row && row.clue || "").trim();
    if (!raw) return null;
    if (raw.split(/\s+/).length > 3) return null;   // prose, not a term
    var k = termKey(raw);
    return k.length >= 3 ? k : null;                // years and initials excluded
  }
  /* Terms that appear across several puzzle groups (LONDON spans 12 rows)
     dominate every grid because they cross well. For each puzzle a seeded
     rotation benches a share of them, so consecutive puzzles draw on
     different parts of the pool. Deterministic from the seed, so a given
     daily is identical for every player. */
  function buildRotation(rows, seed, config) {
    var cfg = config || {};
    var minShare = cfg.minRows || 3;      // "over-shared" threshold
    var benchOdds = cfg.benchOdds === undefined ? 0.5 : cfg.benchOdds;
    var counts = {};
    rows.forEach(function (r) {
      if (r.grid.length > MAX_DIM) return;
      counts[r.grid] = (counts[r.grid] || 0) + 1;
      // Count subject TERMS only — the same key the generator honours. Using
      // the raw clue text here would bench meaningless prose strings.
      var t = subjectKey(r);
      if (t && t !== r.grid) counts[t] = (counts[t] || 0) + 1;
    });
    var common = Object.keys(counts).filter(function (t) { return counts[t] >= minShare; }).sort();
    var rng = makeRng((seed ^ 0x9E37) >>> 0);
    var banned = {};
    common.forEach(function (t) { if (rng() < benchOdds) banned[t] = true; });
    return banned;
  }

  function buildPool(rows, filter) {
    var byPgk = {}, excluded = [], selfAnswering = [], archived = [], filtered = [], maxPer = {};
    rows.forEach(function (r) {
      // Grid form must be A–Z only (safety net over the prebuilt JSON)
      if (!/^[A-Z]+$/.test(r.grid)) throw new Error("Bad grid form for row " + r.id);
      // Max Per Puzzle 0 means the row is retained in the bank but is out of
      // circulation — the schema's own way to archive without deleting.
      if (r.maxPer === 0) { archived.push(r); return; }
      // Free-run filters: only rows in the chosen groups and eras stay in play.
      if (filter && filter.groups && filter.groups.indexOf(r.group) === -1) { filtered.push(r); return; }
      if (filter && filter.eras && filter.eras.indexOf(r.era) === -1) { filtered.push(r); return; }
      // Difficulty levels restrict the clue mix; null means the full mix.
      if (filter && filter.diffs && filter.diffs.indexOf(r.diff) === -1) { filtered.push(r); return; }
      // Practice recency: rows the player has just seen sit a puzzle out.
      if (filter && filter.excludeIds && filter.excludeIds[r.id]) { filtered.push(r); return; }
      // Daily rotation: a deterministic share of the bank rests each window,
      // identically for every player, so the same easy-fitting words cannot
      // be available day after day. No stored state — pure hash of id+window.
      if (filter && typeof filter.rotateWindow === "number" &&
          !rotationKeep(r, filter.rotateWindow)) { filtered.push(r); return; }
      if (r.grid.length > MAX_DIM) { excluded.push(r); return; }  // cannot fit 15x15
      if (rowMeta(r).self) { selfAnswering.push(r); return; }     // clue gives the answer away
      (byPgk[r.pgk] = byPgk[r.pgk] || []).push(r);
      // Max Per Puzzle is a property of the group; the strictest row wins.
      var m = typeof r.maxPer === "number" && r.maxPer >= 1 ? r.maxPer : 1;
      maxPer[r.pgk] = maxPer[r.pgk] === undefined ? m : Math.min(maxPer[r.pgk], m);
    });
    return { byPgk: byPgk, excluded: excluded, selfAnswering: selfAnswering,
             archived: archived, filtered: filtered, maxPer: maxPer };
  }

  /* ---------- Generator ----------
     Sparse-grid word-cross builder with strict crossword adjacency
     rules, placement scoring, and multi-restart layout selection. */

  var ACROSS = "A", DOWN = "D";

  function key(x, y) { return x + "," + y; }

  function Layout() {
    this.cells = {};      // "x,y" -> {ch, across: entryIdx|null, down: entryIdx|null}
    this.entries = [];    // {row, dir, x, y, len}
    this.minX = 0; this.maxX = 0; this.minY = 0; this.maxY = 0;
  }
  Layout.prototype.get = function (x, y) { return this.cells[key(x, y)] || null; };

  /* Validate a candidate placement under standard crossword rules:
     - crossing cells must match letters and cross a perpendicular entry only
     - non-crossing cells: both perpendicular neighbours must be empty
       (prevents illegal parallel words / accidental letter strings)
     - the cell before the start and after the end must be empty */
  function tryPlacement(layout, word, dir, x0, y0) {
    var dx = dir === ACROSS ? 1 : 0, dy = dir === ACROSS ? 0 : 1;
    var px = dir === ACROSS ? 0 : 1, py = dir === ACROSS ? 1 : 0; // perpendicular
    // Hard 15x15 bound: reject before any cell work.
    var endX = x0 + dx * (word.length - 1), endY = y0 + dy * (word.length - 1);
    if (Math.max(layout.maxX, endX) - Math.min(layout.minX, x0) + 1 > MAX_DIM) return null;
    if (Math.max(layout.maxY, endY) - Math.min(layout.minY, y0) + 1 > MAX_DIM) return null;
    var before = layout.get(x0 - dx, y0 - dy);
    var after = layout.get(x0 + dx * word.length, y0 + dy * word.length);
    if (before || after) return null;
    var crossings = 0;
    for (var i = 0; i < word.length; i++) {
      var x = x0 + dx * i, y = y0 + dy * i;
      var c = layout.get(x, y);
      if (c) {
        if (c.ch !== word[i]) return null;
        if (dir === ACROSS ? c.across !== null : c.down !== null) return null; // same-direction overlap
        crossings++;
      } else {
        if (layout.get(x + px, y + py) || layout.get(x - px, y - py)) return null;
      }
    }
    if (crossings === 0 && layout.entries.length > 0) return null; // must connect
    return crossings;
  }

  function commitPlacement(layout, row, dir, x0, y0) {
    var dx = dir === ACROSS ? 1 : 0, dy = dir === ACROSS ? 0 : 1;
    var idx = layout.entries.length;
    layout.entries.push({ row: row, dir: dir, x: x0, y: y0, len: row.grid.length });
    for (var i = 0; i < row.grid.length; i++) {
      var x = x0 + dx * i, y = y0 + dy * i;
      var k = key(x, y);
      var c = layout.cells[k] || (layout.cells[k] = { ch: row.grid[i], across: null, down: null });
      if (dir === ACROSS) c.across = idx; else c.down = idx;
      if (x < layout.minX) layout.minX = x;
      if (x > layout.maxX) layout.maxX = x;
      if (y < layout.minY) layout.minY = y;
      if (y > layout.maxY) layout.maxY = y;
    }
  }

  /* Score an individual candidate placement (higher = better). */
  function placementScore(layout, word, dir, x0, y0, crossings) {
    var dx = dir === ACROSS ? 1 : 0, dy = dir === ACROSS ? 0 : 1;
    var endX = x0 + dx * (word.length - 1), endY = y0 + dy * (word.length - 1);
    var nMinX = Math.min(layout.minX, x0), nMaxX = Math.max(layout.maxX, endX);
    var nMinY = Math.min(layout.minY, y0), nMaxY = Math.max(layout.maxY, endY);
    var w = nMaxX - nMinX + 1, h = nMaxY - nMinY + 1;
    var oldW = layout.maxX - layout.minX + 1, oldH = layout.maxY - layout.minY + 1;
    var growth = (w * h) - (oldW * oldH);
    var aspect = Math.max(w / h, h / w);
    return crossings * 12 - growth * 0.12 - (aspect - 1) * 4;
  }

  /* Build one candidate layout. Consumes at most one row per PGK. */
  function buildLayout(byPgk, opts, rng, maxPer) {
    var layout = new Layout();
    var pgks = shuffled(Object.keys(byPgk), rng);
    var used = {};           // pgk -> rows used so far
    function pgkAllowance(p) {
      var m = maxPer && maxPer[p] !== undefined ? maxPer[p] : 1;
      return (used[p] || 0) < m;   // Max Per Puzzle from the data, not hardcoded
    }
    // Subjects and answers share ONE namespace: a term used in a puzzle —
    // as an answer or as the subject of a clue — cannot be used again in
    // either role. Stops "the city where Chelsea play" (LONDON) sitting
    // beside "this team plays in London" in the same grid.
    var usedTerms = {};
    var usedGrids = {};        // answers placed so far
    var mentionedAnswers = {}; // terms named by clues placed so far
    var clueTextCount = {};  // cat|clue -> n   (max 2 identically-worded clues)
    function rowAllowed(r) {
      var sk = rowMeta(r).sk;
      if (usedTerms[r.grid] || (sk && usedTerms[sk])) return false;
      /* Cap clues of the same shape. Transfers are 63% of the bank, so an
         unconstrained puzzle drew 6.3 of its 11 from them and one drew 9 —
         eleven different answers, but the same question asked nine times. The
         cap is on the family ("Transfer", "City"), not the exact category, so
         Club Joined and Club Left count together: they read identically to a
         player. */
      if (opts.maxPerFamily) {
        var fam = r.cat.split(" \u2192")[0];
        var cap = opts.maxPerFamily[fam] || opts.maxPerFamily["*"];
        if (cap && (familyCount[fam] || 0) >= cap) return false;
      }
      // A clue must not name an answer already in the grid, and its own answer
      // must not already have been named by a clue in the grid. Descriptive
      // clues ("beating Brazil 3-0") would otherwise hand over another entry.
      if (mentionedAnswers[r.grid]) return false;
      var mk = rowMentions(r);
      for (var g in usedGrids) { if (mk[g]) return false; }
      if (opts.bannedTerms && (opts.bannedTerms[r.grid] || (sk && opts.bannedTerms[sk]))) return false;
      if ((clueTextCount[r.cat + "|" + r.clue] || 0) >= 2) return false;
      return true;
    }
    function noteRow(r) {
      usedTerms[r.grid] = true;
      usedGrids[r.grid] = true;
      var mk0 = rowMentions(r);
      for (var m in mk0) mentionedAnswers[m] = true;
      var sk0 = rowMeta(r).sk;
      if (sk0) usedTerms[sk0] = true;
      var k = r.cat + "|" + r.clue;
      clueTextCount[k] = (clueTextCount[k] || 0) + 1;
      var fam0 = r.cat.split(" \u2192")[0];
      familyCount[fam0] = (familyCount[fam0] || 0) + 1;
    }
    // Per-restart variety + speed: consider a sampled subset of each
    // group's rows (different clue mix every restart).
    var familyCount = {};
    var sampled = {};
    pgks.forEach(function (p) {
      sampled[p] = shuffled(byPgk[p], rng).slice(0, opts.rowsPerGroup || 3);
    });
    // Letter -> [ [x,y], ... ] index for anchor lookup, maintained on commit.
    var letterIndex = {};
    function indexEntry(e) {
      var dx = e.dir === ACROSS ? 1 : 0, dy = e.dir === ACROSS ? 0 : 1;
      for (var i = 0; i < e.len; i++) {
        var x = e.x + dx * i, y = e.y + dy * i;
        var c = layout.get(x, y);
        // Index every letter cell; tryPlacement rejects anchors whose
        // perpendicular direction is already occupied.
        (letterIndex[c.ch] = letterIndex[c.ch] || []).push({ x: x, y: y });
      }
    }

    // Seed word: a medium-long answer (good crossing potential without
    // an unwieldy footprint), from a random group.
    var seedPgk = null, seedRow = null, bestSeedScore = -1;
    pgks.slice(0, 8).forEach(function (p) {
      byPgk[p].forEach(function (r) {
        var sk1 = rowMeta(r).sk;
        if (opts.bannedTerms && (opts.bannedTerms[r.grid] || (sk1 && opts.bannedTerms[sk1]))) return;
        var L = r.grid.length;
        // The seed slot fills in EVERY puzzle, so it must carry the same
        // placement-propensity penalty as the main loop — otherwise damping
        // an answer elsewhere just hands it the guaranteed slot instead.
        var s = (L >= 8 && L <= 14 ? 10 : L >= 6 ? 6 : 2) + rng() * 4 -
                (r.hw || 0) * SEED_HOT_SCALE;
        if (s > bestSeedScore) { bestSeedScore = s; seedPgk = p; seedRow = r; }
      });
    });
    if (!seedRow) { // rotation benched every candidate in the sampled groups
      for (var pi = 0; pi < pgks.length && !seedRow; pi++) {
        var cand = byPgk[pgks[pi]];
        for (var ci = 0; ci < cand.length; ci++) {
          if (!opts.bannedTerms ||
              (!opts.bannedTerms[cand[ci].grid] && !opts.bannedTerms[termKey(cand[ci].clue)])) {
            seedPgk = pgks[pi]; seedRow = cand[ci]; break;
          }
        }
      }
      if (!seedRow) { seedPgk = pgks[0]; seedRow = byPgk[pgks[0]][0]; } // ignore the bench
    }
    commitPlacement(layout, seedRow, ACROSS, 0, 0);
    indexEntry(layout.entries[0]);
    used[seedPgk] = 1;
    noteRow(seedRow);

    var stalled = false;
    while (layout.entries.length < opts.target && !stalled) {
      var best = null;
      // Anchor each candidate word at grid cells sharing a letter,
      // via the letter index (avoids scanning every cell per word).
      for (var p = 0; p < pgks.length; p++) {
        var pgk = pgks[p];
        if (!pgkAllowance(pgk)) continue;
        var rowsForPgk = sampled[pgk];
        for (var ri = 0; ri < rowsForPgk.length; ri++) {
          if (!rowAllowed(rowsForPgk[ri])) continue;
          var row = rowsForPgk[ri];
          var word = row.grid;
          for (var wi = 0; wi < word.length; wi++) {
            var anchors = letterIndex[word[wi]];
            if (!anchors) continue;
            for (var ai = 0; ai < anchors.length; ai++) {
              var cx = anchors[ai].x, cy = anchors[ai].y;
              var cell = layout.get(cx, cy);
              // Placement direction is whichever this cell has free.
              var pdir = cell.across === null ? ACROSS : (cell.down === null ? DOWN : null);
              if (!pdir) continue;
              var x0 = pdir === ACROSS ? cx - wi : cx;
              var y0 = pdir === ACROSS ? cy : cy - wi;
              var crossings = tryPlacement(layout, word, pdir, x0, y0);
              if (crossings === null) continue;
              var s = placementScore(layout, word, pdir, x0, y0, crossings) + rng() * 2 -
                      (row.hw || 0) * HOT_SCALE;
              if (!best || s > best.s) best = { row: row, pgk: pgk, dir: pdir, x0: x0, y0: y0, s: s };
            }
          }
        }
      }
      if (best) {
        commitPlacement(layout, best.row, best.dir, best.x0, best.y0);
        indexEntry(layout.entries[layout.entries.length - 1]);
        used[best.pgk] = (used[best.pgk] || 0) + 1;
        noteRow(best.row);
      } else {
        stalled = true;
      }
    }
    return layout;
  }

  /* Whole-layout quality score. */
  function layoutScore(layout) {
    var n = layout.entries.length;
    var crossCells = 0, singleCross = 0;
    var crossCounts = layout.entries.map(function () { return 0; });
    Object.keys(layout.cells).forEach(function (k) {
      var c = layout.cells[k];
      if (c.across !== null && c.down !== null) {
        crossCells++;
        crossCounts[c.across]++;
        crossCounts[c.down]++;
      }
    });
    crossCounts.forEach(function (c) { if (c <= 1) singleCross++; });
    var w = layout.maxX - layout.minX + 1, h = layout.maxY - layout.minY + 1;
    var letters = Object.keys(layout.cells).length;
    var density = letters / (w * h);
    var ratio = w / h; // spec definition: width / height
    // Banded shape penalty: free inside 0.75-1.33, moderate to 0.65/1.55,
    // steep beyond (such layouts are last-resort only).
    var shapePen;
    if (ratio >= 0.75 && ratio <= 1.33) shapePen = 0;
    else if (ratio >= 0.65 && ratio <= 1.55) shapePen = 14;
    else shapePen = 60 + Math.abs(Math.log(ratio)) * 40;
    var avgCross = n ? (crossCells * 2) / n : 0;
    return n * 10 + crossCells * 6 + avgCross * 4 + density * 60
      - singleCross * 5 - shapePen - (w * h) * 0.05;
  }

  /* Normalise a layout into a renderable puzzle:
     0-based coords, numbering, clue lists. */
  function finalise(layout) {
    var offX = -layout.minX, offY = -layout.minY;
    var width = layout.maxX - layout.minX + 1;
    var height = layout.maxY - layout.minY + 1;
    var cells = {};
    Object.keys(layout.cells).forEach(function (k) {
      var parts = k.split(",");
      var x = +parts[0] + offX, y = +parts[1] + offY;
      var c = layout.cells[k];
      cells[key(x, y)] = { ch: c.ch, across: c.across, down: c.down, num: null };
    });
    var entries = layout.entries.map(function (e) {
      return {
        row: e.row, dir: e.dir, x: e.x + offX, y: e.y + offY, len: e.len,
        num: null, cells: []
      };
    });
    entries.forEach(function (e) {
      for (var i = 0; i < e.len; i++) {
        e.cells.push({ x: e.x + (e.dir === ACROSS ? i : 0), y: e.y + (e.dir === ACROSS ? 0 : i) });
      }
    });
    // Standard numbering: row-major scan; a cell numbers if it starts
    // an across and/or down entry (shared number where both).
    var num = 0;
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var c = cells[key(x, y)];
        if (!c) continue;
        var startsAcross = c.across !== null && entries[c.across].x === x && entries[c.across].y === y;
        var startsDown = c.down !== null && entries[c.down].x === x && entries[c.down].y === y;
        if (startsAcross || startsDown) {
          num++;
          c.num = num;
          if (startsAcross) entries[c.across].num = num;
          if (startsDown) entries[c.down].num = num;
        }
      }
    }
    var crossCells = 0;
    Object.keys(cells).forEach(function (k) {
      var c = cells[k];
      if (c.across !== null && c.down !== null) crossCells++;
    });
    return {
      width: width, height: height, cells: cells, entries: entries,
      stats: {
        answers: entries.length,
        intersections: crossCells,
        width: width, height: height, area: width * height,
        letters: Object.keys(cells).length
      }
    };
  }

  /* Public: generate the best layout from an adaptive search.
     Attempts up to opts.attempts candidates; stops early once a
     strong layout exists and a minimum share of the budget is spent. */
  function generate(rows, options) {
    var opts = Object.assign({
      /* Eleven answers, always — a crossword XI. Not a loose target: min and
         max are pinned to the same number so a puzzle can never quietly ship
         with ten or twelve. Measured cost against the old target of 12 is 1.2
         crossings (17.5 -> 16.3), which is worth paying for a game whose name
         is the number. */
      target: 11, minAnswers: 11, maxAnswers: 11,
      // Retuned as the bank grew past 900 rows. With ~100 puzzle groups,
      // sampling ONE row per group is both faster and better than two: breadth
      // across groups beats depth within them. Measured across the whole bank
      // and every topic filter: ~40% faster, 12.0 answers either way, and
      // crossings up from 17.2 to 18.5.
      attempts: 60, minAttempts: 30, earlyStopScore: 242,
      rowsPerGroup: 1, seed: (Math.random() * 1e9) | 0
    }, options || {});
    var pool = buildPool(rows, opts.filter);
    var byPgk = pool.byPgk;
    // Rotation is OFF by default: measured against the current 61-answer
    // pool it costs crossword quality (fewer answers, fewer crossings)
    // without reducing repetition, because the pool is too small for
    // benching to help. Turn it on (rotation: true) once the dataset is
    // large enough for variety to be a scheduling problem.
    if (opts.rotation === true && !opts.bannedTerms) {
      opts.bannedTerms = buildRotation(rows, opts.seed, opts.rotationConfig);
    }
    var best = null, bestScore = -Infinity, attempted = 0;
    var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    for (var r = 0; r < opts.attempts; r++) {
      attempted++;
      var rng = makeRng(opts.seed + r * 7919);
      var layout = buildLayout(byPgk, opts, rng, pool.maxPer);
      var n = layout.entries.length;
      if (n < opts.minAnswers || n > opts.maxAnswers) continue;
      var s = layoutScore(layout);
      if (s > bestScore) { bestScore = s; best = layout; }
      if (r + 1 >= opts.minAttempts && bestScore >= opts.earlyStopScore) break;
    }
    if (!best) { // rotation may have starved the pool — retry with the full pool
      var relaxed = Object.assign({}, opts, { bannedTerms: null });
      for (var r3 = 0; r3 < opts.attempts; r3++) {
        attempted++;
        var lr = buildLayout(byPgk, relaxed, makeRng(opts.seed + r3 * 6151), pool.maxPer);
        var nr = lr.entries.length;
        if (nr < opts.minAnswers || nr > opts.maxAnswers) continue;
        var sr = layoutScore(lr);
        if (sr > bestScore) { bestScore = sr; best = lr; }
      }
    }
    if (!best) { // last resort: keep the largest in-bounds attempt
      for (var r2 = 0; r2 < 20; r2++) {
        var rng2 = makeRng(opts.seed + 999 + r2 * 131);
        var l2 = buildLayout(byPgk, opts, rng2, pool.maxPer);
        if (!best || l2.entries.length > best.entries.length) best = l2;
      }
    }
    var t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    var p = finalise(best);
    p.meta = {
      seed: opts.seed, attempts: attempted,
      excludedByLength: pool.excluded.length,
      excludedSelfAnswering: pool.selfAnswering.length,
      excludedArchived: pool.archived.length,
      excludedByFilter: pool.filtered.length,
      selfAnsweringRows: pool.selfAnswering.map(function (r4) { return r4.id; }),
      excludedRows: pool.excluded.map(function (r3) { return r3.id; }),
      bestLayoutScore: Math.round(bestScore * 10) / 10,
      generationMs: Math.round(t1 - t0)
    };
    return p;
  }

  /* ---------- Validation (used by dev panel + automated tests) ---------- */
  function validatePuzzle(p) {
    var errors = [];
    // 0. Hard grid bounds and entry count
    if (p.width > MAX_DIM) errors.push("Grid width exceeds 15");
    if (p.height > MAX_DIM) errors.push("Grid height exceeds 15");
    if (p.entries.length < 10) errors.push("Fewer than 10 entries");
    if (p.entries.length > 14) errors.push("More than 14 entries");
    p.entries.forEach(function (e) {
      if (!/^[A-Z]+$/.test(e.row.grid)) errors.push("Non A-Z grid form: " + e.row.id);
      if (isSelfAnswering(e.row)) errors.push("Clue contains its own answer: " + e.row.id);
    });
    var seenAns = {}, seenClue = {};
    // No clue may name another entry's answer.
    var grids = {};
    p.entries.forEach(function (e) { grids[e.row.grid] = true; });
    p.entries.forEach(function (e) {
      var mk = mentionKeys(e.row.clue);
      Object.keys(grids).forEach(function (g) {
        if (g !== e.row.grid && mk[g]) {
          errors.push("Clue names another entry's answer: " + g);
        }
      });
    });
    p.entries.forEach(function (e) {
      if (seenAns[e.row.grid]) errors.push("Duplicate answer: " + e.row.grid);
      var ct = subjectKey(e.row);
      if (ct && seenAns[ct]) errors.push("Subject reused as answer or subject: " + ct);
      seenAns[e.row.grid] = true;
      if (ct) seenAns[ct] = true;
      var ck = e.row.cat + "|" + e.row.clue;
      seenClue[ck] = (seenClue[ck] || 0) + 1;
      if (seenClue[ck] === 3) errors.push("Clue text used more than twice: " + e.row.clue);
    });
    // 1. Puzzle Group Key allowance (Max Per Puzzle from the data; normally 1)
    var seen = {};
    p.entries.forEach(function (e) {
      seen[e.row.pgk] = (seen[e.row.pgk] || 0) + 1;
      var allowed = typeof e.row.maxPer === "number" && e.row.maxPer >= 1 ? e.row.maxPer : 1;
      if (seen[e.row.pgk] === allowed + 1) {
        errors.push("Puzzle Group Key over its Max Per Puzzle: " + e.row.pgk);
      }
    });
    // 2. Crossing letters match; no same-direction overlap
    var occ = {};
    p.entries.forEach(function (e, idx) {
      e.cells.forEach(function (c, i) {
        var k = key(c.x, c.y);
        var ch = e.row.grid[i];
        if (!occ[k]) occ[k] = { ch: ch, dirs: {} };
        else if (occ[k].ch !== ch) errors.push("Letter conflict at " + k);
        if (occ[k].dirs[e.dir]) errors.push("Same-direction overlap at " + k);
        occ[k].dirs[e.dir] = idx;
      });
    });
    // 3. Adjacency: every filled cell must belong to an entry in each
    //    direction it touches neighbours (no accidental parallel strings),
    //    plus no letter directly before/after an entry.
    function cellAt(x, y) { return p.cells[key(x, y)] || null; }
    Object.keys(p.cells).forEach(function (k) {
      var parts = k.split(","); var x = +parts[0], y = +parts[1];
      var c = p.cells[k];
      if (c.across === null && (cellAt(x - 1, y) || cellAt(x + 1, y))) errors.push("Illegal horizontal adjacency at " + k);
      if (c.down === null && (cellAt(x, y - 1) || cellAt(x, y + 1))) errors.push("Illegal vertical adjacency at " + k);
    });
    p.entries.forEach(function (e) {
      var dx = e.dir === ACROSS ? 1 : 0, dy = e.dir === ACROSS ? 0 : 1;
      if (cellAt(e.x - dx, e.y - dy)) errors.push("Letter before entry " + e.num + e.dir);
      if (cellAt(e.x + dx * e.len, e.y + dy * e.len)) errors.push("Letter after entry " + e.num + e.dir);
    });
    // 4. Connectivity (flood fill)
    var keys = Object.keys(p.cells);
    if (keys.length) {
      var visited = {}; var stack = [keys[0]];
      while (stack.length) {
        var k2 = stack.pop();
        if (visited[k2]) continue;
        visited[k2] = true;
        var pt = k2.split(","); var x2 = +pt[0], y2 = +pt[1];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nk = key(x2 + d[0], y2 + d[1]);
          if (p.cells[nk] && !visited[nk]) stack.push(nk);
        });
      }
      if (Object.keys(visited).length !== keys.length) errors.push("Grid not fully connected");
    }
    // 5. Numbering: recompute and compare
    var num = 0;
    for (var y3 = 0; y3 < p.height; y3++) {
      for (var x3 = 0; x3 < p.width; x3++) {
        var c3 = cellAt(x3, y3);
        if (!c3) continue;
        var sA = c3.across !== null && p.entries[c3.across].x === x3 && p.entries[c3.across].y === y3;
        var sD = c3.down !== null && p.entries[c3.down].x === x3 && p.entries[c3.down].y === y3;
        if (sA || sD) {
          num++;
          if (c3.num !== num) errors.push("Numbering mismatch at " + x3 + "," + y3);
        } else if (c3.num !== null) {
          errors.push("Spurious number at " + x3 + "," + y3);
        }
      }
    }
    return errors;
  }

  /* ---------- Normalisation self-test helpers ---------- */
  function normaliseAnswer(display) {
    var grid = display.toUpperCase().replace(/[^A-Z]/g, "");
    var breaks = []; var count = 0;
    // Hyphens are word boundaries as much as spaces: Stoke-on-Trent enumerates
    // (5,2,5), not (12). Apostrophes are not — St James' Park is two words.
    display.split(/[\s\-]+/).forEach(function (w) {
      var wl = w.replace(/[^A-Za-z]/g, "").length;
      if (!wl) return;
      count += wl; breaks.push(count);
    });
    breaks.pop();
    return { grid: grid, breaks: breaks };
  }

  /* ---------- Scoring: 38 matches x 3 points = 114 max ----------
     V0.3: front-loaded time decay, Reveal Letter (2), Reveal Answer (9),
     live table vs a benchmark ladder. All values are configuration. */
  var SCORING = {
    MAX_SCORE: 114,
    /* Substitutions decide the RESULT. The clock decides the SCORE.

       Three, for everyone, on every board — not a practice-difficulty setting.
       A revealed letter uses one, a revealed answer uses all three. Ask for
       help you cannot afford — a fourth letter, or an answer with two left —
       and the day becomes a draw however well you finish.

       Spending all three is not a draw. Exceeding them is. */
    SUBS_PER_BOARD: 3,
    SUBS_PER_LETTER: 1,
    SUBS_PER_ANSWER: 3,

    /* Help also costs match minutes, which is what makes it cost SCORE.

       Both currencies always apply. Subs alone would make three reveals free
       against the 114, and somebody playing for the leaderboard would take
       them every time. Time alone was what we had, and it could not express
       "you have had enough help to call this a draw".

       The two bite differently: subs are a hard limit you can exhaust, time is
       continuous and pushes you toward full time — which is itself a draw. So
       help late is riskier than help early, and that is the interesting part. */
    HELP_MINUTES: { check: 2, checkAll: 10, revealLetter: 3, revealAnswer: 14 },

    /* The penalty constants that once sat here are DELETED, not zeroed — the
       gate's "the deleted penalty constants have not returned" check enforces
       it. A comment survived them for four builds claiming they were "kept as
       named constants because the breakdown, the share text and the server all
       read them": nothing read them, and external review caught the comment
       describing MATCH_CLOCK_REAL_SECONDS below as "Zero, deliberately". A
       comment that outlives its code is a statement a future reader acts on
       and is wrong. */
    // Football match clock: 30 real minutes maps to 90 football minutes.
    MATCH_CLOCK_REAL_SECONDS: 1800,
    MATCH_CLOCK_MAX_MINUTES: 90,
    // Score decay is tied to the football clock. Points at each landmark
    // minute; values in between are interpolated. Decay stops at 90'.
    DECAY_CURVE: [
      { minute: 0,  score: 114 }, { minute: 10, score: 97 },
      { minute: 20, score: 86 },  { minute: 30, score: 78 },
      { minute: 45, score: 68 },  { minute: 60, score: 58 },
      { minute: 75, score: 47 },  { minute: 90, score: 36 }
    ],
    // Recent-form strip: five most recent displayed results.
    FORM_LENGTH: 5,
    /* Checking is verification, revealing is being told. The markers used to
       say the opposite — a check was a loss and a revealed letter a draw,
       which made doing your own work look worse than being given the answer. */
    FORM_MARKERS: {
      check: ["D"], revealLetter: ["L"],
      checkAll: ["L", "L", "L"], revealAnswer: ["L", "L", "L", "L"]
    },
    // Historical Premier League seasons supply the opposition. Loaded from
    // seasons.json (20-team era, 1995/96 onwards) and injected at boot.
    SEASONS: [],
    // Dynamic difficulty. Rather than distorting real historical points,
    // difficulty biases WHICH season you are dropped into: an easy puzzle
    // lands in a season where the title took more points, a hard one in a
    // season where it took fewer. The table itself stays authentic.
    DIFFICULTY: {
      map: { "Easy": 1, "Medium": 2, "Hard": 3 },
      baseline: 1.375,     // dataset-wide expected mean difficulty
      seasonBias: true     // false = pick the season purely at random
    },
    // Practice difficulty levels. The clue mix (diffs; null = full mix) feeds
    // the pool filter, and the season bias follows automatically because it
    // reads the puzzle's mean clue difficulty. Substitutions are free letter
    // reveals — no points, no draw on the season strip — capped per puzzle.
    // The Daily deliberately takes none of this: same puzzle, same
    // conditions, for everyone.
    LEVELS: {
      easy:   { label: "Easy",   diffs: ["Easy"],           subs: 5 },
      medium: { label: "Medium", diffs: null,               subs: 3 },
      hard:   { label: "Hard",   diffs: ["Medium", "Hard"], subs: 0 }
    },
    DEFAULT_LEVEL: "medium",
    // Football outcome messages by final position range (game rules).
    OUTCOMES: [
      { from: 1,  to: 1,  msg: "{club} are champions!" },
      { from: 2,  to: 4,  msg: "{club} qualified for the Champions League." },
      { from: 5,  to: 6,  msg: "{club} secured European football." },
      { from: 7,  to: 7,  msg: "{club} finished 7th." },
      { from: 8,  to: 16, msg: "{club} finished in mid-table." },
      { from: 17, to: 17, msg: "{club} survived the relegation battle." },
      { from: 18, to: 20, msg: "{club} were relegated." }
    ]
  };
  /* Football minute from real elapsed seconds. Runs past 90' as added time. */
  function matchMinute(elapsedSeconds) {
    var per = SCORING.MATCH_CLOCK_REAL_SECONDS / SCORING.MATCH_CLOCK_MAX_MINUTES;
    return Math.floor(Math.max(0, elapsedSeconds) / per);
  }
  /* "67'" or "90+4'" once the 90 is up. */
  /* Added time is shown up to a plausible fifteen minutes and then stops
     counting. The arithmetic was never wrong — the clock runs at three match
     minutes per real minute, so a tab left open overnight reads 90+1434' — but
     a number that large is not a football score, it is a stopwatch fault. Past
     the cap the score has floored anyway, so the exact figure means nothing.
     The elapsed line underneath still shows the real time. */
  var ADDED_TIME_SHOWN = 15;
  function matchClockLabel(elapsedSeconds) {
    var m = matchMinute(elapsedSeconds), max = SCORING.MATCH_CLOCK_MAX_MINUTES;
    if (m <= max) return m + "'";
    var extra = m - max;
    /* Past the cap, no apostrophe: the mark means minutes, so "90+'" reads as
       a number that failed to render. "90+" is how a broadcast clock shows
       unspecified added time and looks deliberate. */
    return extra <= ADDED_TIME_SHOWN ? max + "+" + extra + "'" : max + "+";
  }
  /* Points remaining on the clock alone, interpolated along DECAY_CURVE.
     Frozen at the final landmark once 90' is reached. */
  function scoreAtMinute(minute) {
    var c = SCORING.DECAY_CURVE, last = c[c.length - 1];
    if (minute >= last.minute) return last.score;
    for (var i = 1; i < c.length; i++) {
      if (minute <= c[i].minute) {
        var a = c[i - 1], b = c[i];
        var t = (minute - a.minute) / (b.minute - a.minute);
        return a.score + (b.score - a.score) * t;
      }
    }
    return last.score;
  }
  function timePenalty(elapsedSeconds) {
    return Math.round(SCORING.MAX_SCORE - scoreAtMinute(matchMinute(elapsedSeconds)));
  }
  /* THE FAKE 38-GAME RECORD IS GONE, and this note is here so it does not
     come back. seasonRecord() and seasonFromActions() factorised ONE board's
     score into an invented W/D/L split across 38 matches: 114 points is 38
     wins at 3, so any score resolves to exactly one split. It was arithmetic
     dressed as a season, and the word search refused to copy it for that
     reason.

     There IS a season now, and it is real: one result per DAY across the whole
     family, counted from finishes rather than points, on the hub. See
     shared/xi-season.js. A game showing a second, invented season beside it
     would be two answers to "how am I doing".

     What a single board is, in the owner's words, is "how many of the 114
     points did you retain" — a score, not a season. The LIVE TABLE stays:
     buildTable() puts that score into a real league season through the
     player's club, and every number in it comes from real data. */

  /* Form strip. Actions arrive in order: "revealLetter" | "check" | "revealAnswer".
     Presentation only — it never changes the numerical score. */
  function formStrip(actions) {
    var marks = [];
    (actions || []).forEach(function (a) {
      var m = SCORING.FORM_MARKERS[a];
      if (m) marks = marks.concat(m);
    });
    var n = SCORING.FORM_LENGTH;
    while (marks.length < n) marks.unshift("W");   // a perfect season so far
    return marks.slice(-n);
  }
  /* The clock alone, on the fixed curve.

     This used to take a floor and rescale the curve to it, so time alone left
     you bottom of whichever season you were shown. That was wrong for a reason
     that took two reviews to surface: pickSeason() draws from
     seasonsForClub(), so the season — and the floor — depended on the club you
     picked for flavour. Identical play scored 66 as Aston Villa and 76 as
     Blackpool.

     The parameter is gone rather than defaulted, so it cannot come back by
     accident. Where a score places you in a table is a table concern; what the
     score IS must be the same for everyone. */
  function timePenalty(elapsedSeconds) {
    return Math.round(SCORING.MAX_SCORE - scoreAtMinute(matchMinute(elapsedSeconds)));
  }
  function computeScore(elapsedSeconds, checksUsed, revealedLetters, revealedAnswers, checkAllsUsed) {
    /* The clock is the whole of it.

       Four penalty constants used to multiply the help counts here. They were
       set to zero when help moved to the clock, and kept "so the breakdown and
       the share text can read them" — which meant a missed reader printed a
       plausible 0 instead of failing. Deleted: a missed reader now prints
       undefined and is found in a minute.

       The counts stay as arguments because the server tallies them and the
       breakdown lists them; they no longer change the score. */
    var tp = timePenalty(elapsedSeconds);
    return { score: Math.max(0, SCORING.MAX_SCORE - tp), timePenalty: tp };
  }
  /* How much of the grid is wrong, without saying where. Used for the free
     "grid is full but something's off" report: a count is enough to stop the
     player hunting a phantom error; locations still have to be paid for. */
  function gridErrors(puzzle, letters) {
    var wrongCells = 0, filled = 0, total = 0;
    Object.keys(puzzle.cells).forEach(function (k) {
      total++;
      var typed = letters[k];
      if (typed) {
        filled++;
        if (typed !== puzzle.cells[k].ch) wrongCells++;
      }
    });
    var wrongEntries = 0;
    puzzle.entries.forEach(function (e) {
      var complete = true, bad = false;
      e.cells.forEach(function (c, i) {
        var typed = letters[c.x + "," + c.y];
        if (!typed) complete = false;
        else if (typed !== e.row.grid[i]) bad = true;
      });
      if (complete && bad) wrongEntries++;
    });
    return {
      wrongCells: wrongCells, wrongEntries: wrongEntries,
      filled: filled, total: total, full: filled === total
    };
  }
  /* The groups and eras present in a bank, with counts, for the free-run
     picker. Archived rows are ignored — they are out of circulation. */
  function groupOptions(rows) {
    var groups = {}, eras = {};
    (rows || []).forEach(function (r) {
      if (r.maxPer === 0 || r.grid.length > MAX_DIM || isSelfAnswering(r)) return;
      groups[r.group || "England"] = (groups[r.group || "England"] || 0) + 1;
      eras[r.era || "Timeless"] = (eras[r.era || "Timeless"] || 0) + 1;
    });
    return { groups: groups, eras: eras };
  }
  /* Minimum a free-run selection must reach before it can be played. A puzzle
     needs 10-14 answers from distinct puzzle groups, so the group count is the
     binding constraint; the row minimum gives the generator enough choice to
     lay out a decent grid rather than the first thing that fits. */
  // Measured, not guessed: across 127 selections, every one with 13 or fewer
  // subjects failed to reach 10 answers, and every one with 16 or more
  // succeeded. 16 subjects / 20 clues is the line, with the row minimum set
  // just above the smallest successful case.
  var FILTER_MINIMUMS = { groups: 16, rows: 20 };
  /* Can a selection actually fill a grid? Returns what is available and what
     is still needed, so the UI can say so before generating. */
  function filterViability(rows, filter, minimums) {
    var min = minimums || FILTER_MINIMUMS;
    var pool = buildPool(rows, filter);
    var pgks = Object.keys(pool.byPgk);
    var usable = 0;
    pgks.forEach(function (p) { usable += pool.byPgk[p].length; });
    return {
      rows: usable, groups: pgks.length,
      needRows: min.rows, needGroups: min.groups,
      shortRows: Math.max(0, min.rows - usable),
      shortGroups: Math.max(0, min.groups - pgks.length),
      enough: pgks.length >= min.groups && usable >= min.rows
    };
  }

  /* Canonical clue schema. Every row of every category uses these fields;
     new categories add rows, never a bespoke structure. */
  var SCHEMA = {
    required: ["id", "cat", "clue", "answer", "grid", "enum", "breaks",
               "entity", "diff", "pgk", "maxPer"],
    optional: ["notes", "group", "era"],
    difficulties: ["Easy", "Medium", "Hard"]
  };
  /* Clues that read identically AND share an enumeration but have different
     answers. A shared nickname is not a problem in itself — "Red Devils" is
     Manchester United (10,6) and Belgium (7), and the enumeration tells them
     apart — and where the enumeration matches too, crossing letters still
     resolve it, which is ordinary crossword practice. So this is a REPORT for
     the dev panel, not a validation error: it shows where a solver would need
     the crossers rather than where the data is wrong. */
  function ambiguousClues(rows) {
    var byKey = {};
    (rows || []).forEach(function (r) {
      if (r.maxPer === 0) return;
      var k = r.cat + "|" + String(r.clue).toUpperCase() + "|" + r.enum;
      (byKey[k] = byKey[k] || []).push(r);
    });
    var out = [];
    Object.keys(byKey).forEach(function (k) {
      var group = byKey[k];
      var answers = {};
      group.forEach(function (r) { answers[r.grid] = true; });
      if (Object.keys(answers).length > 1) {
        // Carry a sample row so a caller can render the clue as the player
        // sees it. The Clue cell holds the source term ("London"), not the
        // sentence, so reporting it raw is misleading.
        out.push({ clue: group[0].clue, enum: group[0].enum, cat: group[0].cat,
                   sample: group[0], answers: Object.keys(answers) });
      }
    });
    return out;
  }

  /* Validate a dataset against the canonical schema. Returns an array of
     human-readable problems (empty means the data is usable). */
  function validateDataset(rows) {
    var errors = [], ids = {};
    if (!rows || !rows.length) return ["Dataset is empty"];
    rows.forEach(function (r, i) {
      var where = "row " + i + " (ID " + (r.id === undefined ? "?" : r.id) + ")";
      SCHEMA.required.forEach(function (f) {
        if (r[f] === undefined || r[f] === null || r[f] === "") {
          errors.push(where + ": missing required field '" + f + "'");
        }
      });
      if (ids[r.id]) errors.push(where + ": duplicate ID");
      ids[r.id] = true;
      if (r.grid !== undefined && !/^[A-Z]+$/.test(r.grid)) {
        errors.push(where + ": grid form is not A-Z only");
      }
      // Answers must be plain A-Z. Accented characters are never
      // transliterated — such a row is ineligible rather than converted.
      if (r.answer !== undefined && /[^\x00-\x7F]/.test(String(r.answer))) {
        errors.push(where + ": answer contains non A-Z letters - not eligible as an answer");
      }
      if (r.answer !== undefined && r.grid !== undefined) {
        var n = normaliseAnswer(r.answer);
        if (n.grid !== r.grid) errors.push(where + ": grid form disagrees with answer");
        if (JSON.stringify(n.breaks) !== JSON.stringify(r.breaks || [])) {
          errors.push(where + ": word breaks disagree with answer");
        }
      }
      if (r.enum !== undefined && r.grid !== undefined) {
        var nums = (String(r.enum).match(/\d+/g) || []).map(Number);
        var sum = nums.reduce(function (a, b) { return a + b; }, 0);
        if (!nums.length || sum !== r.grid.length) {
          errors.push(where + ": enumeration " + r.enum + " does not match " + r.grid.length + " letters");
        }
      }
      if (r.diff !== undefined && SCHEMA.difficulties.indexOf(r.diff) === -1) {
        errors.push(where + ": Difficulty '" + r.diff + "' is not Easy/Medium/Hard");
      }
      if (r.maxPer !== undefined && !(typeof r.maxPer === "number" && r.maxPer >= 0)) {
        errors.push(where + ": Max Per Puzzle must be 0 (archived) or a positive integer");
      }
    });
    return errors;
  }
  /* Dataset shape report: categories, entities, groups, exclusions. */
  function datasetReport(rows) {
    var cats = {}, entities = {}, pgks = {}, tooLong = 0, archivedCount = 0, byDiff = {};
    rows.forEach(function (r) {
      cats[r.cat] = (cats[r.cat] || 0) + 1;
      entities[r.entity] = true;
      pgks[r.pgk] = (pgks[r.pgk] || 0) + 1;
      byDiff[r.diff] = (byDiff[r.diff] || 0) + 1;
      if (r.grid.length > MAX_DIM) tooLong++;
      if (r.maxPer === 0) archivedCount++;
    });
    var thin = Object.keys(pgks).filter(function (p) { return pgks[p] < 3; });
    return {
      rows: rows.length, categories: cats, difficulties: byDiff,
      entities: Object.keys(entities).length,
      groups: Object.keys(pgks).length,
      excludedByLength: tooLong, archived: archivedCount, thinGroups: thin
    };
  }

  /* Mean difficulty of a puzzle's entries (1 easy .. 3 hard). */
  function puzzleDifficulty(p) {
    var cfg = SCORING.DIFFICULTY, sum = 0, n = 0;
    p.entries.forEach(function (e) {
      var v = cfg.map[e.row.diff];
      if (v) { sum += v; n++; }
    });
    return n ? sum / n : cfg.baseline;
  }
  /* ---------- Historical seasons ---------- */
  function loadSeasons(seasons) {
    SCORING.SEASONS = (seasons || []).slice();
    return validateSeasons(SCORING.SEASONS);
  }
  /* Every season must be a complete 20-club, 38-match-era table. */
  function validateSeasons(seasons) {
    var errors = [], seen = {};
    if (!seasons || !seasons.length) return ["No historical seasons loaded"];
    seasons.forEach(function (s) {
      var where = "season " + (s.season || "?");
      if (!s.season) errors.push("A season is missing its label");
      if (seen[s.season]) errors.push(where + ": duplicate season");
      seen[s.season] = true;
      var yr = parseInt(String(s.season).slice(0, 4), 10);
      if (!(yr >= 1995)) errors.push(where + ": before the 20-team era (1995/96 onwards)");
      if (!s.table || s.table.length !== 20) {
        errors.push(where + ": needs exactly 20 clubs, found " + (s.table ? s.table.length : 0));
        return;
      }
      var clubs = {}, prev = Infinity;
      s.table.forEach(function (row) {
        if (!row.club) errors.push(where + ": a row has no club");
        if (clubs[row.club]) errors.push(where + ": duplicate club " + row.club);
        clubs[row.club] = true;
        if (typeof row.points !== "number" || row.points < 0 || row.points > 114) {
          errors.push(where + ": " + row.club + " has invalid points " + row.points);
        }
        if (row.points > prev) errors.push(where + ": table is not in descending points order");
        prev = row.points;
      });
    });
    return errors;
  }
  /* Seasons in which a club actually played. */
  function seasonsForClub(club) {
    return SCORING.SEASONS.filter(function (s) {
      return s.table.some(function (r) { return r.club === club; });
    });
  }
  /* Pick the season a puzzle is played in. Deterministic from the seed, so a
     daily puzzle drops every player into the same season. Prefers seasons the
     club played in; difficulty biases towards a higher or lower title bar. */
  function pickSeason(club, seed, difficulty) {
    var pool = seasonsForClub(club);
    if (!pool.length) pool = SCORING.SEASONS;
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    var cfg = SCORING.DIFFICULTY;
    if (cfg.seasonBias && typeof difficulty === "number") {
      // Sort by title-winning points, then bias the pick by difficulty:
      // easier puzzle -> tougher season (higher bar), harder -> lower bar.
      var sorted = pool.slice().sort(function (a, b) { return a.table[0].points - b.table[0].points; });
      var t = (difficulty - 1) / 2;                    // 0 = all easy, 1 = all hard
      t = Math.max(0, Math.min(1, t));
      var span = Math.max(1, Math.ceil(sorted.length / 2));
      var lo = Math.round((1 - t) * (sorted.length - span));
      var window = sorted.slice(lo, lo + span);
      return window[Math.floor(makeRng((seed ^ 0x51E4) >>> 0)() * window.length)];
    }
    return pool[Math.floor(makeRng((seed ^ 0x51E4) >>> 0)() * pool.length)];
  }
  /* Every club that appears in any stored season — the full set a player
     may choose from, not just the current top flight. */
  /* The clubs of the most recently stored season. Used to put the sides
     somebody is likely to support at the top of a list of forty-nine, and
     derived from the data so it moves on by itself when a season is added. */
  function latestSeason() {
    var all = SCORING.SEASONS || [];
    return all.length ? all[all.length - 1] : null;
  }
  function historicalClubs() {
    var seen = {};
    SCORING.SEASONS.forEach(function (s2) {
      s2.table.forEach(function (r) { seen[r.club] = true; });
    });
    return Object.keys(seen).sort();
  }
  /* Random mode, per spec: choose an eligible season first, then draw the
     player's club from that season. Deterministic from the seed, so a daily
     puzzle gives every player the same season and club. */
  function pickSeasonAndClub(seed, difficulty) {
    var pool = SCORING.SEASONS;
    if (!pool.length) return null;
    var rng = makeRng((seed ^ 0x2C9F) >>> 0);
    var season;
    var cfg = SCORING.DIFFICULTY;
    if (cfg.seasonBias && typeof difficulty === "number" && pool.length > 1) {
      var sorted = pool.slice().sort(function (a, b) { return a.table[0].points - b.table[0].points; });
      var t = Math.max(0, Math.min(1, (difficulty - 1) / 2));
      var span = Math.max(1, Math.ceil(sorted.length / 2));
      var lo = Math.round((1 - t) * (sorted.length - span));
      var win = sorted.slice(lo, lo + span);
      season = win[Math.floor(rng() * win.length)];
    } else {
      season = pool[Math.floor(rng() * pool.length)];
    }
    var club = season.table[Math.floor(rng() * season.table.length)].club;
    return { season: season, club: club };
  }

  /* Build the live/final table: the player's club carries the player's score,
     every other club keeps its real historical points. If the club did not
     play that season, the player takes the bottom club's place. */
  function buildTable(club, liveScore, season) {
    if (!season) return [];
    var rows = [], replaced = false;
    season.table.forEach(function (r) {
      if (r.club === club && !replaced) { replaced = true; return; } // player takes their own slot
      rows.push({ club: r.club, points: r.points, isPlayer: false });
    });
    if (!replaced) rows.pop(); // club absent that season: displace the bottom club
    rows.push({ club: club, points: liveScore, isPlayer: true });
    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0); // player wins ties
    });
    rows.forEach(function (r, i) { r.pos = i + 1; });
    return rows;
  }

  function playerPosition(table) {
    for (var i = 0; i < table.length; i++) if (table[i].isPlayer) return table[i].pos;
    return table.length;
  }
  function outcomeMessage(club, pos) {
    for (var i = 0; i < SCORING.OUTCOMES.length; i++) {
      var o = SCORING.OUTCOMES[i];
      if (pos >= o.from && pos <= o.to) return o.msg.replace("{club}", club);
    }
    return club + " finished " + ordinal(pos) + ".";
  }
  /* ---------- Daily result records ----------
     One record per completed Daily. Everything on the Stats and History
     screens derives from these, so the shape is deliberately complete and
     flat enough for a future account/cloud sync to consume unchanged. */
  function makeResultRecord(o) {
    return {
      v: 1,
      date: o.date,                       // ISO yyyy-mm-dd, local calendar day
      /* WHEN it was finished, to the millisecond. The date above is a day and
         a day is too coarse for the streak rule: yesterday's board counts only
         if it was finished within the grace period after midnight, and
         "23:55 or 09:00 the next morning" cannot be told apart from a date.
         Legacy rows have no `at`; they fall back to strict same-day. */
      at: o.at,
      dailyNo: o.dailyNo,
      /* Eight readers filter results on `mode === "daily"` — mergeResults,
         renderHome, alreadyPlayedElsewhere, nextUnplayedDaily,
         renderPreviousCount and the calendar among them. The field was never
         built here, so every one of them matched only rows pulled down from an
         account and never a row this device wrote. renderPreviousCount not
         falling after an archive board was blamed on the "today only" guard in
         recordDaily and fixed there; this was the second cause and outlived it.

         Defaulted rather than required: this function has only ever built
         dailies, themed boards keep their own store, and a row that reaches a
         reader without a mode is invisible rather than wrong-looking. */
      mode: o.mode || "daily",
      /* What FCW.outcome() reads first. Without it every stored result — a
         114 in five minutes included — resolved to "L", which is why nothing
         could be built on outcome() yet.

         Defaults true because recordDaily is reached only from the two Full
         Time paths, so every record ever written here was a finished board.
         It is stored rather than assumed because a loss is "started and not
         finished", and whatever ends up banking one needs somewhere to say so.
         Deriving it would make that impossible to express. */
      complete: o.complete !== false,
      /* The attempt this row came from, so a verified score can replace its own
         row rather than being refused as a duplicate. This function builds an
         explicit shape, so a field not named here is dropped in silence. That
         is deliberate — it keeps junk out of a record that syncs — but the
         silence is what hid `mode` and `complete` for as long as it did.
         record_test.mjs reads recordDaily's call site out of game.js and fails
         if it passes a field this shape does not carry. */
      playId: o.playId || null,
      seed: o.seed,
      bankVersion: o.bankVersion || QUESTION_BANK_VERSION,
      club: o.club,
      season: o.season,                   // historical season label
      score: o.score,
      position: o.position,
      elapsedSeconds: o.elapsedSeconds,
      matchMinute: o.matchMinute,
      checks: o.checks,
      revealedLetters: o.revealedLetters,
      revealedAnswers: o.revealedAnswers,
      pauses: o.pauses || 0,
      pausedSeconds: o.pausedSeconds || 0,
      completedAt: o.completedAt || new Date(now()).toISOString()
    };
  }
  /* ---------- Trusted time (spec §19: device-clock cheating) ----------
     Every date the game reasons about — which Daily is today, what a result is
     stamped with — reads through now(), never Date.now() directly, so a single
     sync point governs all of them. The shell reads the Date header off its own
     HTTP response and calls setTrustedTime(); offline, opened as a local file,
     or before
     hosting exists, nothing calls it and the device clock is used exactly as
     before. Elapsed match time deliberately stays on the raw clock: it measures
     a duration, not a date, and must not jump when a sync lands mid-play.

     What this does NOT fix, and should not be claimed to: the trusted instant
     is still interpreted in the device's own timezone, so a player who changes
     timezone can still roll over early. Fixing that means pinning the puzzle
     day to a single zone, which breaks the local-midnight rollover the Daily is
     built around — a product decision, not a bug fix. */
  var timeOffsetMs = 0;          // trusted - device, at the moment of sync
  var timeSource = "device";     // "device" | "server"

  function now() { return Date.now() + timeOffsetMs; }

  function setTrustedTime(ms) {
    var t = typeof ms === "string" ? Date.parse(ms) : ms;
    // A header that is absent, unparseable or absurd is worse than no sync:
    // reject it and stay on the device clock rather than corrupt the date.
    if (typeof t !== "number" || !isFinite(t) || t < 946684800000) return false;
    timeOffsetMs = t - Date.now();
    timeSource = "server";
    return true;
  }
  function clearTrustedTime() { timeOffsetMs = 0; timeSource = "device"; }
  function timeState() {
    return { source: timeSource, offsetMs: timeOffsetMs, now: now(),
             trusted: timeSource === "server" };
  }

  function localDateKey(d) {
    var t = d || new Date(now());
    return t.getFullYear() + "-" +
      ("0" + (t.getMonth() + 1)).slice(-2) + "-" +
      ("0" + t.getDate()).slice(-2);
  }
  /* What counts: a board's own day, and the whole of the day after.

     A board finished on its own day counts. Yesterday's board still counts
     if it is finished before the end of TODAY — the player who opens the app
     in the morning and clears yesterday first is playing the game as meant.
     Midnight tonight is the line: anything older banks NOTHING here — not
     the run, not the season, not points. The Full Time card still scores a
     late play; it is a friendly against the past, not a matchday.

     Why the line exists at all: past seven days the archive is open-book by
     design (the answers pages), and a late score can never be told from a
     looked-up one. A record that cannot be trusted is worse than one that is
     simply not kept.

     Considered at one hour past midnight; settled at the full day after, ON
     THE CONDITION that the page says so — how-to-play carries the sentence,
     and howto_test pins it. A rule this consequential that players only
     discover when a run fails to move is a bug wearing a rule's clothes.

     ONE rule. streaks() and seasonStats() both consume it; C4's season index
     must too. The record's `at` timestamp is kept — it is a true fact,
     costs nothing, and day arithmetic uses it when present; legacy rows
     fall back to their date, where next-day is within the grace and counts. */
  var GRACE_DAYS = 1;
  function onTimeResult(r) {
    if (!r || typeof r.dailyNo !== "number") return false;
    var own = dailyDate(r.dailyNo);
    if (typeof r.at === "number") {
      return r.at < own.getTime() + (1 + GRACE_DAYS) * 86400000;
    }
    if (!r.date) return true;   // pre-date legacy: the archive did not exist
    return r.date === localDateKey(own) ||
           r.date === localDateKey(new Date(own.getTime() + 86400000));
  }
  /* Streaks run on consecutive Daily numbers. Practice never appears here,
     because only Daily completions are recorded. */
  function streaks(records, todayNo) {
    var nums = records.filter(onTimeResult)
      .map(function (r) { return r.dailyNo; })
      .sort(function (a, b) { return a - b; });
    if (!nums.length) return { current: 0, longest: 0 };
    var longest = 1, run = 1;
    for (var i = 1; i < nums.length; i++) {
      if (nums[i] === nums[i - 1]) continue;              // defensive
      run = nums[i] === nums[i - 1] + 1 ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    // The current run counts only if it reaches today or yesterday: finishing
    // an older Daily after the next has begun does not revive a streak.
    var last = nums[nums.length - 1];
    var current = 0;
    if (todayNo === undefined || last === todayNo || last === todayNo - 1) {
      current = 1;
      for (var j = nums.length - 1; j > 0; j--) {
        if (nums[j - 1] === nums[j]) continue;          // defensive, as above
        if (nums[j - 1] === nums[j] - 1) current++; else break;
      }
    }
    return { current: current, longest: longest };
  }
  /* Career summary in football language. Derived only from stored results —
     nothing is assumed about days that were never played. */
  /* Which record a result belongs to. Friendlies are played, scored and kept,
     but they are their own competition: a pre-season streak is a real thing to
     build, and it ending on Matchday 1 is the point rather than a loss. */
  function resultPhase(rec) {
    if (rec && rec.phase) return rec.phase;
    return dailyPhase(rec && rec.dailyNo).phase;   // older records predate the field
  }
  /* Two buckets, three phases. Anything that is not a friendly goes in the
     second one — a daily played before a season starts is still a real result
     and still builds a run, so it belongs with the season records rather than
     nowhere. When a season does start, its matchdays join them.

     The split is friendly / not friendly, which is the line that matters:
     pre-season is its own competition and its streak ends when it does. */
  function splitByPhase(records) {
    var pre = [], season = [];
    (records || []).forEach(function (x) {
      (resultPhase(x) === "preseason" ? pre : season).push(x);
    });
    return { preseason: pre, season: season };
  }

  function seasonStats(records, todayNo) {
    /* The season counts what the streak counts — onTimeResult, one rule. A
       deep-archive play banks nothing here: no played, no points, no average.
       The Full Time card still scores it; it is a friendly against the past,
       not a matchday. */
    var r = (records || []).filter(onTimeResult);
    var n = r.length;
    var st = streaks(r, todayNo);
    var out = {
      played: n, completed: n,
      currentStreak: st.current, longestStreak: st.longest,
      bestScore: null, averageScore: null,
      bestFinish: null, titles: 0, topFour: 0, european: 0, relegations: 0,
      fastestSeconds: null, averageSeconds: null
    };
    if (!n) return out;
    var scoreSum = 0, timeSum = 0;
    r.forEach(function (x) {
      scoreSum += x.score; timeSum += x.elapsedSeconds;
      if (out.bestScore === null || x.score > out.bestScore) out.bestScore = x.score;
      if (out.bestFinish === null || x.position < out.bestFinish) out.bestFinish = x.position;
      if (out.fastestSeconds === null || x.elapsedSeconds < out.fastestSeconds) out.fastestSeconds = x.elapsedSeconds;
      if (x.position === 1) out.titles++;
      if (x.position <= 4) out.topFour++;
      if (x.position <= 6) out.european++;
      if (x.position >= 18) out.relegations++;
    });
    out.averageScore = Math.round(scoreSum / n);
    out.averageSeconds = Math.round(timeSum / n);
    return out;
  }

  /* Daily puzzle: number and seed derive from the LOCAL calendar date,
     so everyone in a timezone gets the same puzzle and it rolls over at
     local midnight (Wordle-style). Deterministic hash -> seed. */
  /* THE LAUNCH DATE. Daily #1 falls the day after this.
     Written in two files and they must agree: this one, and EPOCH in
     functions/_lib/daily.js (which stores day #1 itself, in UTC). If they drift
     apart the browser asks for puzzle N while the server thinks it is N±1, and
     every reveal and check is refused with a 403 — for everybody. epoch_test.mjs
     checks the pair on real dates.
     Any date before #1 clamps to #1, so testing before launch never eats into
     the stored days. */
  var DAILY_EPOCH = { y: 2026, m: 7, d: 25 }; // day before launch; 2026-08-26 = Puzzle #1
  /* Four weeks of friendlies before the season proper. The stored sequence is
     unbroken — days 1-28 are pre-season, day 29 is Matchday 1 on 13 September
     2026 — so nothing about generation or storage changes. What changes is what
     a day is called and whether it counts.
     The point is a record that starts clean: bugs found in the opening weeks
     cannot spoil anybody's streak, and the season has a real first day rather
     than the site merely existing one morning. */
  /* Ten, not twenty-eight. Twenty-eight friendlies is a month before anything
     counts, and the season table — the thing the game is built around — stays
     empty that whole time. Ten is enough to learn the format and short enough
     that Matchday 1 is a fortnight away rather than a month.

     Exported below, so this is the only place it is stated. */
  var PRESEASON_DAYS = 1;
  /* The daily number the first season starts on, or null while there is not
     one yet.

     Three phases, not two. Pre-season is friendlies — played, scored, kept, not
     counted. Then the daily proper: a real puzzle with a real score, but no
     season to put it in. Then a season, once there is a reason to start one.

     It was two phases, so the day after pre-season was automatically Matchday 1
     — which committed to a season before there was any evidence anyone would
     play thirty-eight of them. Null keeps the daily running indefinitely and
     lets the decision wait.

     To start a season: set this to the daily number of its first matchday. */
  var SEASON_START = null;

  /* An override, for trying a season before starting one.

     Client-side, and it cannot be otherwise — this file runs in the browser. So
     it is not a gate and is not presented as one. What it can do is limited:
     the phase decides labels and whether this device's own table counts. The
     server has no notion of phases at all, so somebody who found it would see
     "Matchday 1" early on their own screen and nothing else would follow.

     Set from owner tools, or by hand:
        localStorage.setItem("fcw.seasonStart", "11")
        localStorage.removeItem("fcw.seasonStart")

     One real consequence: results recorded while it is set carry
     phase: "season", and those go to the account on sign-in. Clear it before
     playing a daily you want recorded honestly. */
  function seasonStart() {
    try {
      var v = localStorage.getItem("fcw.seasonStart");
      if (v !== null && v !== "") {
        var n = parseInt(v, 10);
        if (isFinite(n) && n > 0) return n;
      }
    } catch (e) { /* storage blocked: the real value stands */ }
    return SEASON_START;
  }

  /* What a finished board is worth: "W", "D" or "L".

     One function, so the finish screen, the season table, the form chips and
     the server can never disagree about what happened. Everything they need is
     already recorded on a result.

       W  solved before full time, without exceeding three subs
       D  solved, but late or over-subbed
       L  started and not finished

     Absence is not a loss. Missing a day costs the streak and nothing else —
     the season measures how you played, the streak measures whether you turned
     up, and mixing them is what made a missed week able to kill a season. */
  function outcome(rec) {
    if (!rec) return "L";
    if (!rec.complete && !rec.completed) return "L";
    var mins = matchMinute(rec.elapsedSeconds || rec.elapsed || 0);
    if (mins >= SCORING.MATCH_CLOCK_MAX_MINUTES) return "D";
    if (subsExceeded(rec)) return "D";
    return "W";
  }

  /* Did they ask for help they could not afford?

     Spending all three is a win. A fourth letter, or an answer with fewer than
     three left, is not — the allocation was exceeded, and that is the line. */
  function subsSpent(rec) {
    return (rec.revealedLetters || 0) * SCORING.SUBS_PER_LETTER +
           (rec.revealedAnswers || 0) * SCORING.SUBS_PER_ANSWER;
  }
  function subsExceeded(rec) { return subsSpent(rec) > SCORING.SUBS_PER_BOARD; }
  function subsRemaining(rec) {
    return Math.max(0, SCORING.SUBS_PER_BOARD - subsSpent(rec));
  }
  function outcomePoints(o) { return o === "W" ? 3 : o === "D" ? 1 : 0; }

  function dailyPhase(n) {
    var no = n || dailyNumber();
    var start = seasonStart();
    /* The override is tested before pre-season, not after.

       It was after, so setting it during pre-season did nothing at all — the
       friendly branch returned first and the season never appeared. That is the
       one time you would want to try a season: before starting one. An explicit
       start date wins over the calendar. */
    if (start !== null && no >= start) {
      return { phase: "season", number: no - start + 1,
               label: "Matchday " + (no - start + 1), counts: true };
    }
    if (no <= PRESEASON_DAYS) {
      /* No number in the label.

         A count that only goes up is an invitation to feel late: somebody
         arriving on #59 reads fifty-eight they missed, when every daily is
         standalone and there is nothing to catch up on. The number still exists
         — results are keyed by it and the admin panel reports the range — it
         just is not said to the player.

         Matchdays keep theirs, because "Matchday 12 of 38" describes where a
         season has got to against a finite total, and under the season model
         everybody starts at their own Matchday 1 anyway. The number reappears
         exactly when it stops being discouraging. */
      return { phase: "preseason", number: no,
               label: "Pre-season friendly", counts: false };
    }
    if (start === null || no < start) {
      /* Numbered from the end of pre-season, so the first real daily is #1
         rather than #11 — the friendlies were their own run. */
      var d = no - PRESEASON_DAYS;
      return { phase: "daily", number: d, label: "Today's puzzle", counts: false };
    }
    return { phase: "season", number: no - start + 1,
             label: "Matchday " + (no - start + 1), counts: true };
  }
  function dailyNumber(at) {
    /* Which DAY the trusted instant falls in is a second question after
       which instant it is — and it was answered differently on each side:
       the server counts UTC days, this counted device-local days of the
       same synced clock. Every UK summer night between twelve and one the
       two named different boards; the server's clamp stopped that killing
       the daily, but the hero tile, the calendar and the save slot still
       spent an hour on a board the server would not serve.

       When the clock is trusted — it came from the server — the day is
       counted the server's way: UTC, same arithmetic, DAILY_EPOCH.d + 1
       being the UTC epoch the server stores (#1's day; the local form keeps
       the day BEFORE, a difference epoch_test pins). Local calendar days
       remain for two cases only: an explicit `at` (the archive calendar
       maps its cells through local dates, and the grace rule reasons about
       local days deliberately), and an untrusted clock, where local is all
       there is. So the disagreement window exists only offline, where the
       server cannot contradict anyone anyway. */
    if (!at && timeSource === "server") {
      var d = new Date(now());
      var mid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      var utcEpoch = Date.UTC(DAILY_EPOCH.y, DAILY_EPOCH.m, DAILY_EPOCH.d + 1);
      return Math.max(1, Math.floor((mid - utcEpoch) / 86400000) + 1);
    }
    var t = at || new Date(now());
    var today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    var epoch = new Date(DAILY_EPOCH.y, DAILY_EPOCH.m, DAILY_EPOCH.d);
    return Math.max(1, Math.round((today - epoch) / 86400000));
  }
  /* The inverse of dailyNumber: which date a board belongs to.

     Beside it deliberately, and built from the same DAILY_EPOCH, so the two
     cannot drift. A calendar that disagreed with the puzzle by a day would be
     worse than no calendar — you would tap the 14th and get the 13th. */
  function dailyDate(number) {
    var epoch = new Date(DAILY_EPOCH.y, DAILY_EPOCH.m, DAILY_EPOCH.d);
    return new Date(epoch.getTime() + Math.max(1, number) * 86400000);
  }

  function dailySeed(number) {
    var str = "fcw-daily-" + number, h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ---------- Daily answer repetition: a hard ban, not a score penalty ----------
     Measured history: weighting schemes (row tiers, answer tiers, continuous
     weights, fixed-point calibration) all failed, because the placer takes the
     best-scoring candidate and a penalty only moves the crown to the next
     easy-fitting answer. A ban cannot be out-competed.

     Day D bans every answer used on days D-1 .. D-LOOKBACK. Knowing those
     answers means generating those puzzles, and each day's puzzle depends on
     the bans of the days before it, so the chain is walked ONCE by
     build_daily_bans.js and shipped as a table. Runtime cost is a table lookup.

     Degradation is deliberate and silent-safe: no table, a day before the
     table starts, or a day past its end all yield null — the Daily then
     behaves exactly as it did before this feature existed.

     LOOKBACK is a measured trade-off, not a guess. Over 60 dailies, banning
     the last N days' answers costs crossings because the placer has fewer
     good fits (mean bans is roughly N x 10.5 answers out of ~760 rotating):

       N    crossings   distinct answers   worst single answer
       0      18.33            206               28.3%
       5      17.63            226               13.3%
       7      17.48            233               11.7%
      10      16.82            253               10.0%
      14      15.48            266                6.7%

     7 is the knee: 60% of the repetition gone for 4.6% of the crossings, and
     "no answer twice in a week" is a promise a player can hold. 14 buys the
     last stretch at three times the quality cost. Changing this constant means
     rebuilding daily_bans.json — the table records the lookback it was built
     with and dailyBans() honours that, so the two cannot silently disagree. */
  var DAILY_LOOKBACK = 7;
  var DAILY_BANS = null;

  function loadDailyBans(table) {
    DAILY_BANS = (table && table.days && table.days.length) ? table : null;
    return DAILY_BANS;
  }

  /* table: omit to use the shipped one; pass explicitly when rolling the chain
     forward (the builder hands in the days written so far and nothing more). */
  function dailyBans(dailyNo, table) {
    var t = table === undefined ? DAILY_BANS : table;
    if (!t || !t.days || !t.days.length) return null;
    var from = t.from || 1;
    var lookback = t.lookback || DAILY_LOOKBACK;
    var idx = dailyNo - from;
    // end never includes the day itself: a day is not generated against its
    // own answers. Past the table's end we ban what tail is still in range,
    // so the guarantee fades over LOOKBACK days rather than falling off.
    var end = Math.min(idx, t.days.length);
    var start = Math.max(0, idx - lookback);
    if (end <= start) return null;
    var out = null;
    for (var i = start; i < end; i++) {
      var day = t.days[i];
      if (!day) continue;
      for (var j = 0; j < day.length; j++) {
        var a = t.answers[day[j]];
        if (a) { out = out || {}; out[a] = true; }
      }
    }
    return out;
  }

  /* The Daily's filter and full generate options in one place. The builder and
     the game both read these, so a table cannot be built against settings
     other than the ones played. */
  function dailyFilter(dailyNo) {
    return { groups: null, eras: DEFAULT_ERAS, rotateWindow: rotationWindow(dailyNo) };
  }
  function dailyOptions(dailyNo, table) {
    return {
      seed: dailySeed(dailyNo),
      filter: dailyFilter(dailyNo),
      bannedTerms: dailyBans(dailyNo, table)
    };
  }

  function ordinal(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return n + "th";
    return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  }

  return {
    makeRng: makeRng,
    MAX_DIM: MAX_DIM,
    SCORING: SCORING,
    timePenalty: timePenalty,
    matchMinute: matchMinute,
    matchClockLabel: matchClockLabel,
    scoreAtMinute: scoreAtMinute,
    formStrip: formStrip,
    computeScore: computeScore,
    gridErrors: gridErrors,
    loadSeasons: loadSeasons,
    validateSeasons: validateSeasons,
    seasonsForClub: seasonsForClub,
    pickSeason: pickSeason,
    pickSeasonAndClub: pickSeasonAndClub,
    historicalClubs: historicalClubs,
    latestSeason: latestSeason,
    SCHEMA: SCHEMA,
    termKey: termKey,
    subjectKey: subjectKey,
    mentionKeys: mentionKeys,
    isSelfAnswering: isSelfAnswering,
    buildRotation: buildRotation,
    validateDataset: validateDataset,
    ambiguousClues: ambiguousClues,
    groupOptions: groupOptions,
    FILTER_MINIMUMS: FILTER_MINIMUMS,
    filterViability: filterViability,
    datasetReport: datasetReport,
    puzzleDifficulty: puzzleDifficulty,
    QUESTION_BANK_VERSION: QUESTION_BANK_VERSION,
    DEFAULT_ERAS: DEFAULT_ERAS,
    LEVELS: SCORING.LEVELS,
    DEFAULT_LEVEL: SCORING.DEFAULT_LEVEL,
    ROTATION: ROTATION,
    rotationKeep: rotationKeep,
    rotationWindow: rotationWindow,
    makeResultRecord: makeResultRecord,
    localDateKey: localDateKey,
    now: now,
    setTrustedTime: setTrustedTime,
    clearTrustedTime: clearTrustedTime,
    timeState: timeState,
    streaks: streaks,
    onTimeResult: onTimeResult,
    seasonStats: seasonStats,
    timePenalty: timePenalty,
    // Exported so tests can be written against the launch date rather than
    // hard-coding it — it has moved once and will move again.
    DAILY_EPOCH: DAILY_EPOCH,
    PRESEASON_DAYS: PRESEASON_DAYS,
    dailyPhase: dailyPhase,
    outcomePoints: outcomePoints,
    subsRemaining: subsRemaining,
    subsExceeded: subsExceeded,
    subsSpent: subsSpent,
    outcome: outcome,
    SEASON_START: SEASON_START,
    seasonStart: seasonStart,
    resultPhase: resultPhase,
    splitByPhase: splitByPhase,
    dailyNumber: dailyNumber,
    dailyDate: dailyDate,
    dailySeed: dailySeed,
    DAILY_LOOKBACK: DAILY_LOOKBACK,
    loadDailyBans: loadDailyBans,
    dailyBans: dailyBans,
    dailyFilter: dailyFilter,
    dailyOptions: dailyOptions,
    buildTable: buildTable,
    playerPosition: playerPosition,
    outcomeMessage: outcomeMessage,
    ordinal: ordinal,
    buildPool: buildPool,
    generate: generate,
    validatePuzzle: validatePuzzle,
    normaliseAnswer: normaliseAnswer,
    ACROSS: ACROSS, DOWN: DOWN
  };
})();

if (typeof module !== "undefined") module.exports = FCW;
