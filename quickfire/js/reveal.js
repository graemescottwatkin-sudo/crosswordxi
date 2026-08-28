/* reveal.js — deterministic progressive reveal.

   Every player gets the same reveal for the same clue, because the order is
   derived from a seeded shuffle of the clue id — no stored revealOrder needed.
   (A hand-authored revealOrder array is still honoured if a clue supplies one.)

   Letters are NOT revealed left to right. Revealable indices are grouped by
   word, shuffled within each word, then drawn round-robin across words in
   proportion to word length, so the shape of the whole answer emerges evenly.
*/
(function (root) {
  'use strict';

  var REVEALABLE = /[\p{L}\p{N}]/u;

  function hashSeed(text) {
    var h = 2166136261 >>> 0;
    var s = String(text);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function revealableIndices(answer) {
    var out = [];
    for (var i = 0; i < answer.length; i++) {
      if (REVEALABLE.test(answer[i])) out.push(i);
    }
    return out;
  }

  /* Ordered list of character indices, first revealed first. */
  function buildRevealOrder(answer, seedText) {
    var rand = mulberry32(hashSeed(seedText || answer));
    var words = [];
    var current = null;
    for (var i = 0; i < answer.length; i++) {
      if (/\s/.test(answer[i])) { current = null; continue; }
      if (!REVEALABLE.test(answer[i])) continue;
      if (!current) { current = []; words.push(current); }
      current.push(i);
    }

    var queues = words.map(function (w) { return shuffle(w, rand); });
    var taken = queues.map(function () { return 0; });
    var totals = queues.map(function (q) { return q.length; });
    var remaining = totals.reduce(function (a, b) { return a + b; }, 0);
    var order = [];

    while (remaining > 0) {
      // Draw from whichever word is furthest behind its share, ties to the longer word.
      var best = -1, bestScore = -Infinity;
      for (var w = 0; w < queues.length; w++) {
        if (taken[w] >= totals[w]) continue;
        var score = (1 - taken[w] / totals[w]) + totals[w] / 1000;
        if (score > bestScore) { bestScore = score; best = w; }
      }
      order.push(queues[best][taken[best]]);
      taken[best] += 1;
      remaining -= 1;
    }
    return order;
  }

  /* How many characters are revealed at a given match minute. */
  function revealCountAt(minute, totalRevealable, checkpoints) {
    var fraction = 0;
    for (var i = 0; i < checkpoints.length; i++) {
      if (minute >= checkpoints[i].minute) fraction = checkpoints[i].fraction;
    }
    var count = Math.round(fraction * totalRevealable);
    // Never fully reveal before Full Time — at least one character must be earned.
    var cap = Math.max(0, totalRevealable - 1);
    return Math.min(count, cap);
  }

  /* Display string: revealed characters, underscores, and visible punctuation. */
  function maskAnswer(answer, order, revealedCount) {
    var shown = {};
    for (var i = 0; i < revealedCount && i < order.length; i++) shown[order[i]] = true;
    var out = '';
    for (var c = 0; c < answer.length; c++) {
      var ch = answer[c];
      if (!REVEALABLE.test(ch)) out += ch;
      else out += (shown[c] ? ch : '_');
    }
    return out;
  }

  var api = {
    hashSeed: hashSeed,
    mulberry32: mulberry32,
    revealableIndices: revealableIndices,
    buildRevealOrder: buildRevealOrder,
    revealCountAt: revealCountAt,
    maskAnswer: maskAnswer
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QFXReveal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
