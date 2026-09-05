/* config.js — every tunable in Scrambled XI lives here and nowhere else.
   Change a number, reload the page, play again. No build step needed.
*/
(function (root) {
  'use strict';

  var CONFIG = {
    /* --- The clock ---------------------------------------------------
       Ninety match minutes mapped onto real seconds. This number is the
       per-game half of scoring and is NOT shared: Crossword XI sits at 1800
       and Wordsearch XI at 600, because a crossword and a word search take
       different amounts of real time. Eleven anagrams is quicker than a
       crossword and slower than a word search. */
    MATCH_CLOCK_REAL_SECONDS: 900,

    /* THE ANAGRAM CLOCK, AND THE THING MATCH_CLOCK IS SET BACK TO.
       MATCH_CLOCK_REAL_SECONDS is the clock of the board IN PLAY: scoring.js
       reads it, and the page assigns it every time a board opens. That means
       it cannot also be the anagram's constant — written over once by a
       consonant board it would never come back, and since a board can now be
       opened without reloading the page, the next anagram board would be
       played on the consonant clock and scored on it. Two names, so one of
       them can be current and the other can be true. */
    ANAGRAM_CLOCK_REAL_SECONDS: 900,

    /* THE CONSONANT BOARD'S CLOCK. Ninety match minutes in five real ones:
       the same board and the same curve, read rather than unscrambled, and
       reading eleven names is quicker than solving eleven anagrams. Applied
       over MATCH_CLOCK_REAL_SECONDS at boot, when the payload says which
       cypher it gave, so scoring.js still takes the number from one place. */
    CONSONANT_CLOCK_REAL_SECONDS: 300,

    /* Filling in one blank, priced at the anagram's revealed letter. A match
       minute buys the same points in both games, and the family rule is that
       a point costs the same everywhere; the shorter clock already makes help
       dearer in real seconds without charging more for it. */
    REVEAL_VOWEL_COST: 2,
    PAUSE_ON_TAB_HIDDEN: true,

    /* --- The bench: help a player asks for and pays for ---------------
       Priced against Crossword XI's equivalents so a point costs the same
       across the family. Revealing a name ends that slot the way revealing an
       answer ends an entry, so it carries the same nine. */
    REVEAL_HINT_COST: 3,
    REVEAL_LETTER_COST: 2,
    REVEAL_NAME_COST: 9,

    /* --- The team talk -----------------------------------------------
       Free, automatic, at half time: every hint is given.

       This is the floor that makes a board finishable. Eleven anagrams have no
       intersections, so unlike a crossword NOTHING GETS EASIER AS YOU SOLVE:
       what is left at the end is by definition what you had no route into, and
       without this the clock charges you for time you cannot convert into
       progress. Set to null to turn it off and feel the difference. */
    HALF_TIME_MINUTE: 45,

    /* Set true to also drip a letter into every unsolved name from half time
       onward — the second half of the team-talk design, deliberately off until
       the first half has been played against. */
    SECOND_HALF_LETTERS: false,

    /* --- Storage -----------------------------------------------------
       The namespace is PREFIX in game.js, which is where aligned_test reads it
       from. This is the rest of the key, not a second copy of the prefix. */
    STORAGE_KEY: 'board.v1'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  root.SCX_CONFIG = CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
