/* sc-names.js — Scrambled XI: turning what somebody typed into something
 * comparable, and nothing else.
 *
 * TWO DIFFERENT JOBS, DELIBERATELY NOT THE SAME FUNCTION
 *
 * 1. Board data is authored in English form and never contains a diacritic.
 *    Every player row carries a name written out in plain A-Z — MODRIC, not
 *    Modric with the acute — and tools/build_scrambled.js refuses an XI where
 *    it does not match NAME_SHAPE. That string is what gets scrambled and what
 *    the enumeration is counted from.
 *
 *    The gate is not there for exotic characters; English usage supplies the
 *    plain spelling for almost every name worth putting on a board. It is
 *    there for the mundane failure: somebody authors a board by pasting a name
 *    off a squad list, the accented character rides along, and the scramble is
 *    built from a different letter multiset than the one on screen. Caught at
 *    build time, loudly, rather than on a live board.
 *
 * 2. Input is normalised on the way in, and DOES strip diacritics. A player on
 *    a Spanish keyboard typing the correct spelling of a man's name has not
 *    got it wrong, and a game that refuses it is worse than one that is
 *    slightly too generous.
 *
 * Conflating these into one function is how you get something that half-works
 * in both directions: strip on the way in and you accept everything you
 * should; strip on the way out and you silently mangle the puzzle.
 *
 * THIS FILE IS SERVER-ONLY ON PURPOSE. The browser never normalises a name,
 * because the browser never marks one — it posts the guess and is told yes or
 * no. That is the whole reason there is no second copy of any of this to drift
 * against the first.
 */

/* Letters, apostrophes, hyphens, spaces. Nothing else reaches a board. */
export const NAME_SHAPE = /^[A-Z][A-Z' -]*$/;

export function isEnglishForm(displayName) {
  return NAME_SHAPE.test(String(displayName || "").toUpperCase());
}

/* Forgiving, never fuzzy. Case, spacing, apostrophes, hyphens and diacritics
   all fall away; letters do not. A near-miss is still wrong, because a game
   that accepts one cannot tell the player they were close. */
export function normalise(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // combining marks
    .replace(/[\u00D8\u00F8]/g, "O")   // O-slash has no decomposition
    .replace(/[\u00C6\u00E6]/g, "AE")
    .replace(/[\u00DF]/g, "SS")        // and this one changes the letter count
    .replace(/[\u0110\u0111]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/* A slot is solved by its authored name or by any alias authored for it —
   surname alone, a known short form, the spelling a broadcaster uses. */
export function matchesSlot(typed, slot) {
  const t = normalise(typed);
  if (!t) return false;
  if (t === normalise(slot.name)) return true;
  return (slot.aliases || []).some((a) => normalise(a) === t);
}

/* The multiset of letters a scramble is built from. Two strings scramble to
   the same tiles only if this agrees, which is what makes a derangement
   checkable and what makes two indistinguishable slots detectable. */
export function letterBag(name) {
  return normalise(name).split("").sort().join("");
}

/* Word lengths, for the enumeration under the tile: VAN DIJK -> [3, 4].
   Counted from the authored string with normalise applied per word, so a
   hyphen or an apostrophe does not inflate the count the player is shown. */
export function enumerationOf(name) {
  return String(name).trim().split(/\s+/).map((w) => normalise(w).length);
}
