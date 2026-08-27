# Crossword_v001o — answers pages, a live_check for Wordsearch, and catches that speak

Base: **v001n** (presented, burned — deploy THIS instead if v001n was not
pushed; it carries everything v001n did). No migrations.

| | result |
|---|---|
| 27 suites | **929 passed, 0 failed** (was 26 / 911) |
| `crossword/deploy_check.mjs` | **39 passed, 0 failed** |
| `wordsearch/deploy_check.mjs` | **28 passed, 0 failed** |
| Answers pages against the real 374-board bank, local D1, real server | exercised below |

## 1. Wordsearch answers pages — /wordsearch/answers/

**Why these can exist at all:** the crossword's answers are a secret the server
keeps; a word search's answers ship in every daily payload by construction. The
ONLY secret this game has is the schedule, and these pages leak nothing about
it.

- **Addressed by board, not by day.** 730 days map onto 374 boards; day
  addressing would publish the same board under two URLs.
- **The seal is the crossword's own constant** — `ANSWERS_AFTER_DAYS`, imported
  from `_lib/daily.js`. No second seven anywhere; the suite asserts the source
  contains no restated `7`.
- **One refusal for every kind of no.** Sealed, unknown and malformed ids are
  indistinguishable: 404, `no-store`, `noindex`, not one word about the board.
  A different answer for "sealed" versus "does not exist" would let the
  address book be probed.
- **Placements read 1-based** ("row 10, column 6, north-west"), converted from
  the 0-based wire — verified against the bank: Rulli round-trips exactly.
- Published pages are cacheable for a day and indexable; the index is in the
  sitemap. Static shell, no scripts — the page most likely to be opened from a
  search result on a slow connection renders with nothing else.

**Exercised for real:** the full bank loaded into a local D1 behind
`wrangler pages dev` — the index listed 231 boards (239 released minus the 8
inside the window: the arithmetic agrees), a published board served all 12
placements, today's board refused with `no-store` and zero leaked names, and a
garbage id got the same 404.

**New suite `wordsearch/answers_test.mjs`, 15 assertions**, running the real
handler against a stub D1 — wired into CI. Its own first draft had a vacuous
check: the "sealed board is refused" assertion passed because the stub had not
stocked the sealed board, so it 404d for being unfetchable. Fixed the stub,
then disabling the seal failed SIX assertions. A check is trusted after it
fails, not before.

## 2. `wordsearch/live_check.mjs` — run it after every deploy

    node wordsearch\live_check.mjs --expect v001h

The post-deploy verification the game never had. It checks: the page and its
build tag; `source:"d1"` on the daily — **a missing D1 binding serves samples
with a 200, and this is the only thing that would notice**; eleven answers and
0-based placements on the wire; the catalog carrying no grids; an unreleased
board refused with `no-store` and nothing said; the answers index listing,
a published board serving, today's refusing without naming a single player.

Two checks reach beyond this game:

- **The schema probe.** Signed-out `/api/account/results` must be **401**; a
  **500 means the query itself is broken** — which is exactly what months of
  "no such column: pauses" looked like while nothing was watching.
- **The unreleased-name rule, on live pages.** It was only ever enforced on
  the hub, which is how the crossword's footer and privacy page shipped seven
  unreleased names between them. Now checked on the game page, privacy and
  how-to-play as deployed.

## 3. The silent catches now speak

Every account failure logs through one `accountNote()` per game —
`[account] push failed: …` — and is still caught: the device's copy is intact,
the next sync carries it, the game never degrades. Migration 002 hid for
months behind `.catch(function () {})`; the arity bug hid behind mine for an
hour. Sign-out gets a note too, because a failed sign-out silently showing
"signed out" while the cookie lives is the one that misleads.

Three new assertions in `games_test` count the notes and forbid a bare catch
in either sync path — proven by silencing one: FAIL.

## Deploy

    cd C:\Users\graem\OneDrive\Documents\GitHub\crosswordxi
    node crossword\deploy_check.mjs
    node wordsearch\deploy_check.mjs
    git add -A
    git commit -m "Crossword_v001o: wordsearch answers pages, live_check, account catches speak"
    git push

**29 jobs** now — `answers_test` joins. Then:

    node crossword\live_check.mjs --expect v001o
    node wordsearch\live_check.mjs --expect v001h

Then bump `LAST_SHIPPED` to `"v001o"`, commit, push.

Worth a minute in a browser: `/wordsearch/answers/` and one board page —
the copy and the table are worth an eyeball no suite can give.

## Tags

crossword **v001n → v001o**; wordsearch **v001g → v001h**.
`LAST_SHIPPED` **v001m** (bump only after deploy). `LAST_PRESENTED` **v001n**.

## Still open

- In-progress board state does not sync between devices (feature, not bug).
- The wordsearch gate's own `LAST_SHIPPED` is still `v000` — its tag law is
  half-implemented; belongs with the cross-game contract suite.
- Legal review — more urgent now: the answers pages put player names on
  indexed pages grouped by club and competition.
- `headless_test.js` invisible to CI and the gate; `/wordsearch/` favicon 404;
  `actions/checkout` on deprecated Node 20.
