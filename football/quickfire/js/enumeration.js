/* enumeration.js — shared utility.
   Converts an answer into crossword/quiz enumeration.

   Rules:
     - words are separated by spaces        -> joined with ", "
     - hyphenated parts count separately    -> joined with "-"
     - apostrophes count as a character     -> O'Neill = (7)
     - any other punctuation is ignored

   Manchester United    -> (10, 6)
   Alan Shearer         -> (4, 7)
   Istanbul             -> (8)
   Paris Saint-Germain  -> (5, 5-7)
   O'Neill              -> (7)

   Used by QuickFire XI and available unchanged to Pitchword.
*/
(function (root) {
  'use strict';

  function countable(part) {
    // Keep letters, digits and apostrophes; drop everything else.
    return part.replace(/[^\p{L}\p{N}'\u2019]/gu, '').length;
  }

  function enumerate(answer) {
    if (!answer || !String(answer).trim()) return '';
    var words = String(answer).trim().split(/\s+/);
    var groups = words.map(function (word) {
      return word
        .split(/[-\u2010-\u2015]/)
        .map(countable)
        .filter(function (n) { return n > 0; })
        .join('-');
    }).filter(Boolean);
    if (!groups.length) return '';
    return '(' + groups.join(', ') + ')';
  }

  var api = { enumerate: enumerate, countable: countable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QFXEnumeration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
