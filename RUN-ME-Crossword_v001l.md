# Crossword_v001l — the crossword pushes when it finishes a board

Base: **v001k** (live). No migrations. Wordsearch unchanged at **v001e**.

| | result |
|---|---|
| 25 suites | **875 passed, 0 failed** |
| `crossword/deploy_check.mjs` | **38 passed, 0 failed** |
| `wordsearch/deploy_check.mjs` | **28 passed, 0 failed** |

## The asymmetry, closed

The crossword called `/api/account/migrate` in exactly two places: sign-in and
code-claim. A board finished while **already** signed in went to localStorage
and to `plays`, and nothing offered it to the account — which is why a
completed crossword on the PC did not appear on the iPad while a word search
did. Word search pushes after every completed board; the crossword did not.
One fact, two behaviours.

This is the crossword catching up, not the word search changing.

**And the call is now named once.** It was written out twice already; a
finished board needed a third. `pushResults()` sits next to
`pullAccountResults()`, returns null when signed out rather than posting to an
endpoint that answers 401, and all three sites ask it.

Push happens **after** `saveResults`, never before: a failed push must leave
the device's record exactly where it was.

**Four new assertions**, each proven to fail first — removing the push failed
two, moving it before the save failed one.

## What this does NOT do

**The grid in progress still does not sync.** Letters typed live in
localStorage on the device that typed them, in both games, and always have.
After this release the iPad will show a board as *played* once the PC finishes
it — it will not show your letters mid-solve. That is a much larger job:
server-side board state plus a rule for two devices typing at once. Worth
listing, not worth guessing at.

The clock is per-device too. Each browser starts its own when the board opens,
so a second device is behind by however long it opened later. Only the stored
figure comes from the server.

## Deploy

    cd C:\Users\graem\OneDrive\Documents\GitHub\crosswordxi
    node crossword\deploy_check.mjs
    node wordsearch\deploy_check.mjs
    git add -A
    git commit -m "Crossword_v001l: a finished daily pushes to the account"
    git push
    node crossword\live_check.mjs --expect v001l

Then bump `LAST_SHIPPED` to `"v001l"`, commit, push.

## Then the test

Finish today's daily on the PC while signed in, then:

    npx wrangler d1 execute crosswordxi --remote --command="SELECT game, entry_key, score, played_on FROM results ORDER BY game"

Two rows: `crossword` / `daily:2`, and `wordsearch` / `ws:2026-08-27`. Then
open the crossword on the iPad on the same account — the board should show as
played.

Note the board you already finished on the PC will not push by itself: the
push happens when a board is recorded, and that one was recorded under v001k.
Signing out and back in will carry it, or it will go up with the next board.

## Tags

crossword **v001k → v001l**; wordsearch stays **v001e**.
`LAST_SHIPPED` **v001k**. `LAST_PRESENTED` **v001k**.

## Still open

- **Three `.catch` blocks swallow account failures silently** — `afterSignIn`,
  `pullAccountResults`, `pushResults` in both games. Migration 002 hid behind
  them for months. At minimum they should log.
- **In-progress board sync** — new, larger, and now the honest answer to "why
  is the iPad empty".
- The chrome: paper bar, drawer, wordmark home, footer games list.
- Wordsearch answers pages; `live_check` for wordsearch; a schema-vs-migrations
  check; `headless_test.js` invisible to CI and the gate; `/wordsearch/`
  favicon 404.
