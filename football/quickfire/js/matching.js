/* matching.js — forgiving but not loose answer matching.

   Normalisation: lowercase, strip accents, drop apostrophes and full stops,
   treat hyphens as spaces, collapse runs of whitespace, trim.

   "Paris Saint Germain"  matches  "Paris Saint-Germain"   (hyphen relaxed)
   "arsene wenger"        matches  "Arsène Wenger"         (accents stripped)
   "Man Utd"              does NOT match "Manchester United" unless listed as an alias.

   A space-free comparison is also accepted ("parissaintgermain") because dropped
   spaces are a common phone typo. Nothing else is relaxed — no fuzzy distance,
   no substring matching, no prefix matching.
*/
(function (root) {
  'use strict';

  function normalise(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['\u2019\u2018.]/g, '')
      .replace(/[-\u2010-\u2015_/]/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function squash(value) {
    return normalise(value).replace(/ /g, '');
  }

  function acceptedForms(answer, aliases) {
    var all = [answer].concat(aliases || []);
    var forms = [];
    all.forEach(function (item) {
      var n = normalise(item);
      if (n) forms.push(n);
    });
    return forms;
  }

  function isCorrect(input, answer, aliases) {
    var guess = normalise(input);
    if (!guess) return false;
    var forms = acceptedForms(answer, aliases);
    if (forms.indexOf(guess) !== -1) return true;
    var squashedGuess = guess.replace(/ /g, '');
    return forms.some(function (form) {
      return form.replace(/ /g, '') === squashedGuess;
    });
  }

  /* How much of a wrong guess is worth keeping in the box.
     Compares loosely — case, accents and punctuation are ignored — but returns
     a slice of what the player actually typed, so their own spelling survives. */
  function correctPrefix(input, answer) {
    var typed = String(input == null ? '' : input);
    var a = normalise(answer);
    var kept = 0;
    for (var i = 1; i <= typed.length; i++) {
      var candidate = normalise(typed.slice(0, i));
      // A trailing space normalises away, so treat it as still on track.
      if (candidate === a.slice(0, candidate.length)) kept = i;
      else break;
    }
    return typed.slice(0, kept);
  }

  var api = { normalise: normalise, squash: squash, isCorrect: isCorrect,
              acceptedForms: acceptedForms, correctPrefix: correctPrefix };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QFXMatching = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
