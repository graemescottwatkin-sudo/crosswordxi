# Crossword_v001h — accounts across the family

Base: **v001g** (live and green). This is the accounts half of the work; the
chrome is v001i and deliberately separate — see "Why this is split" below.

## Verified here, CI-shaped, from the repo root

| | result |
|---|---|
| 25 suites | **864 passed, 0 failed** (was 24 / 831) |
| `crossword/deploy_check.mjs` | **38 passed, 0 failed** |
| `wordsearch/deploy_check.mjs` | **28 passed, 0 failed** |
| `render_test` spot-check (desktop, macbook, phone-small) | geometry all passed |

The only render failures here were `ERR_CERT_AUTHORITY_INVALID` — this sandbox
blocks fonts.googleapis.com, CI does not. Not run here: the other thirteen
viewports, `journey_test`, `signin_test`, `preview_test`, `live_check`.

## What this fixes

The session cookie has been scoped `Domain=.thexigames.com` since accounts
existed, so a player signed in on the crossword was **already** signed in on
the word search. There was nothing for that to carry: `results` was keyed on
`daily_no`, a crossword idea, and word search scores lived in `localStorage`.
Sign in, play on a phone, open an iPad — gone.

## Migration 020 — run BEFORE deploying

    npx wrangler d1 execute crosswordxi --remote --file=data\migrations\020-results-game.sql

Adds `game`, `entry_key` and `detail` to `results`, backfills the key from
`daily_no`, then constrains it.

**The key is the design decision.** Crossword rows deduplicate on `daily_no`;
a word search has no daily number, it has a day. Special-casing per game is
how "the entrant key computed in four places" happened, so there is ONE key,
composed in `functions/_lib/games.js` and nowhere else:

    crossword    daily:2
    wordsearch   ws:2026-08-27

`UNIQUE(user_id, game, entry_key)`. **Game three adds a prefix, not a column.**

Two details worth knowing:

- **The backfill runs before the index.** A unique index over a column that is
  NULL on every existing row does not constrain anything; the backfill is what
  makes the constraint describe the data already there. Asserted by order in
  `games_test`, not by hope.
- **The insert is `OR IGNORE`.** The old SELECT-then-INSERT let two devices
  migrating the same history at once pass both checks. The rule now lives in
  the schema, not only in the order two statements happen to run.

Game-specific facts go in `detail` as JSON. `checks` and `substitutions` are
crossword ideas; `foundCount` and `bonusFound` are word search ideas. Adding
eleven columns per game is the duplication fault written into the schema,
where it is far more expensive to undo.

## Also changed

**`functions/_lib/games.js`** — new. The list of games and the key rule, in one
file. `games_test` asserts neither endpoint keeps a private copy of the list.

**`csrfOk`** now accepts `X-XI-Games` as well as `X-Crossword-XI`. New callers
send the family name; the original stays accepted because a browser holding a
cached `game.js` is still sending it and must not start failing mid-session.

**Wordsearch signs in.** Reads `/api/auth/session` at boot, pushes its local
results, then pulls the account's. Push-then-pull, same order as the crossword
— the other way round fetches, merges, then pushes rows the account already
had. Fire and forget: signed out, offline and failed all reach the board at
the same speed.

**Admin's day-delete is now `AND game = 'crossword'`.** It takes a day number,
which is a crossword idea; unqualified it would reach any row whose `daily_no`
matched.

**`crossword/games_test.mjs`** — new suite, 33 assertions, wired into
`checks.yml`. The rules that only exist once there are two games.

Two existing suites were updated because they pinned the old schema:
`auth_test`'s D1 stub keyed on `daily_no` (a double modelling a schema the
endpoint had stopped using makes a passing suite a statement about nothing),
and `admin_test` pinned the unqualified DELETE.

## Why this is split from the chrome

v001i rewrites markup that `render_test`, `viewport_test` and `frontend_test`
all pin. Shipped together, a red job could be the schema or the layout with no
way to tell. `render_test` only started telling the truth an hour ago; it is
worth keeping the signal clean.

## Deploy

    cd C:\Users\graem\OneDrive\Documents\GitHub\crosswordxi
    npx wrangler d1 execute crosswordxi --remote --file=data\migrations\020-results-game.sql
    rmdir /s /q node_modules
    node crossword\deploy_check.mjs
    node wordsearch\deploy_check.mjs
    git add -A
    git commit -m "Crossword_v001h: results by game, one entry key, wordsearch signs in"
    git push
    node crossword\live_check.mjs --expect v001h

Then bump `LAST_SHIPPED` to `"v001h"`, commit, push.

**Worth checking by hand after:** sign in on the crossword, play a word search,
open it on another device signed into the same account, and confirm the row
followed you. That is the whole point of the release and no suite can see it.

## Tags

crossword **v001g → v001h**; wordsearch **v001c → v001d**.
`LAST_SHIPPED` **v001g**. `LAST_PRESENTED` **v001g**.

## Next

- **v001i — the chrome.** Paper bar on both games, hamburger drawer listing the
  squad, wordmark home from everywhere including mid-board, footer games list,
  and the crossword's green masthead retired so green means a correct answer
  again.
- Wordsearch answers pages (SEO + the bonus word), sealed on the same
  seven-day rule the crossword uses, learned from the API.
- `headless_test.js` still invisible to CI and the gate.
- No `live_check.mjs` for wordsearch.
