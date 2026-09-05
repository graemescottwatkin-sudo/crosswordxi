/* ws-public.js — what a word search board may say to a browser while it is
 * being played, and what it may not.
 *
 * THE BOARD USED TO TRAVEL WHOLE. /api/wordsearch/daily sent the grid, every
 * answer, every answer's exact start and end square, and the secret bonus word
 * — the one the player is meant to deduce from a clue. The page simply did not
 * draw the parts it was not ready to show. Anyone could read all of it in the
 * network tab, and no score the page reported could mean anything, because the
 * page knew the answers before the player did.
 *
 * So the daily now ships two things and withholds two:
 *
 *   grid          yes — it IS the puzzle
 *   the words     yes — a word search shows its list; that is the game
 *   placements    NO  — where each word sits is the whole of the solving
 *   the bonus     NO  — the ★ is deduced from a clue, so the clue travels
 *                       and the word does not, until it is found
 *
 * The server judges a selection instead (/api/wordsearch/find) and hands back
 * the placement of whatever that selection hit, so the page can strike it
 * through. A player learns a placement by finding it, one at a time, which is
 * what they were doing anyway.
 *
 * FREE PLAY IS NOT THIS. It keeps the whole board: it is unscored, it has help
 * cards that reveal squares outright, and it is not the board anybody is
 * competing on. `/api/wordsearch/puzzle` serves that, and now refuses today's
 * daily — which is what made this file's job possible rather than theatre.
 */

/* One answer, as the browser may have it before it is found. `display` is what
   the list shows; `grid` is the letters, which the list already gives away by
   showing the word, and which the page needs to key a found word by. `len` is
   implied by grid and is not sent twice. */
function publicAnswer(a) {
  return { display: a.display, grid: a.grid };
}

/* THE BONUS IS A CLUE, NOT A WORD. It ships with what the player is given —
   the clue and its category — and without the answer or where it is. `has`
   says a bonus exists at all, so a page can draw the ☆ without being told
   which word fills it. */
function publicBonus(b) {
  if (!b) return null;
  /* AND ITS LENGTH, because the length is part of the hunt and not part of
     the answer. The page says "seven letters · hidden in the grid" beside the
     clue, and its own comment argues for it: the clue and the length are what
     a player is hunting WITH. Knowing a word is seven long does not say which
     seven squares, which is the thing being withheld. */
  return { has: true, clue: b.clue, category: b.category, len: (b.grid || "").length };
}

/* The board a player is served while the clock is running. */
export function publicPuzzle(p) {
  if (!p) return null;
  return {
    id: p.id, theme: p.theme, category: p.category,
    status: p.status, hash: p.hash, version: p.version,
    share_key: p.share_key,
    grid: p.grid,
    answers: (p.answers || []).map(publicAnswer),
    bonus: publicBonus(p.bonus),
  };
}

/* AND WHAT A FOUND WORD IS TOLD. The server says which word a selection hit
   and where it sits, because the player has just found it — the placement is
   no longer a secret from them, and the page needs it to draw the line.
   Nothing else about the board comes with it. */
export function foundAnswer(item, isBonus) {
  return {
    display: item.display, grid: item.grid,
    placement: item.placement,
    ...(isBonus ? { bonus: true } : {}),
  };
}
