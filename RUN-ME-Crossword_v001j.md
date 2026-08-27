# Crossword_v001j — the migrate INSERT actually adds up

Base: **v001i** (live). One-line fix plus the assertion that should have
caught it. No migrations to run — 002 and 020 are both applied.

## Verified here, CI-shaped, from the repo root

| | result |
|---|---|
| 25 suites | **865 passed, 0 failed** |
| `crossword/deploy_check.mjs` | **38 passed, 0 failed** |
| `wordsearch/deploy_check.mjs` | **28 passed, 0 failed** |

## My bug

Adding `game`, `entry_key` and `detail` to the results INSERT meant three more
columns, three more binds and three more placeholders. I added two
placeholders.

    23 columns · 21 placeholders · 22 binds

D1 threw on every `/api/account/migrate` call, into a `.catch` that said
nothing — which is how it reached production without me noticing in a suite
that reported 864 green assertions.

It shipped because **every assertion about that statement was a regex looking
for words in it, and a regex cannot count.** `games_test` checked the insert
said `INSERT OR IGNORE`, that migrate composed no key of its own, that neither
endpoint kept a private list of games. All true, all passing, none of them
able to see that the statement could not execute.

**Fix:** one `?`.

**And a new assertion**, `the results INSERT has as many placeholders as
columns, and as many binds as placeholders`. It counts all three rather than
matching text, and splits the bind list on top-level commas only — counting
raw commas would treat `intOr(r.score, null)` as two arguments and "agree"
with the wrong number.

Proven to fail twice before being trusted: once with the placeholder removed
(the exact bug that shipped), once with a bind removed. Both FAIL, restored
both, back to green.

## What was also wrong, and is now fixed on the database

`migration 002-add-pause-tracking.sql` had **never been applied to
production**, despite its own header reading "applied 15 Aug 2026". Every
query touching `pauses` threw:

    D1_ERROR: no such column: pauses at offset 153

That is why `results` had been empty its whole life — not because there was
nothing to migrate, but because every write had been failing for months into
`afterSignIn`'s bare `.catch`. `pullAccountResults` failed the same way.

Applied now. `plays` was checked at the same time and is complete, so 002 on
`results` was a one-off rather than a pattern.

**Nothing in this project compares the migrations folder against the live
schema.** A comment claiming a migration was applied was the only record of it,
and it was wrong. That check belongs in `live_check`, which already talks to
production: assert every column the endpoints SELECT actually exists. Next
release, with the wordsearch `live_check`.

## Deploy

    cd C:\Users\graem\OneDrive\Documents\GitHub\crosswordxi
    node crossword\deploy_check.mjs
    node wordsearch\deploy_check.mjs
    git add -A
    git commit -m "Crossword_v001j: results INSERT arity, and the assertion that counts"
    git push
    node crossword\live_check.mjs --expect v001j

Then bump `LAST_SHIPPED` to `"v001j"`, commit, push.

## Then the test

On **thexigames.com/wordsearch/**, reload and:

    (() => {
      console.log("local:", JSON.parse(localStorage.getItem("xiws.results") || "[]").length);
      fetch("/api/account/results?game=wordsearch", {headers:{"X-XI-Games":"1"}, credentials:"same-origin"})
        .then(x => x.json()).then(a => console.log("account rows:", a.count));
    })()

`local: 1`, `account rows: 1`. Then:

    npx wrangler d1 execute crosswordxi --remote --command="SELECT game, entry_key, score, played_on FROM results"

`wordsearch`, `ws:2026-08-27`. Then the iPad, same account.

## Tags

crossword **v001i → v001j**; wordsearch **v001d → v001e**.
`LAST_SHIPPED` **v001i**. `LAST_PRESENTED` **v001i**.

## Still open

- **The two games push at different times.** Wordsearch pushes after every
  completed board; the crossword only at sign-in and code-claim, never after
  Full Time. My asymmetry, a few lines to even up.
- **Three `.catch` blocks swallow account failures silently** — in
  `afterSignIn`, `pullAccountResults` and my `pushResults`. Months of failure
  looked like nothing happening. At minimum they should log.
- The chrome: paper bar, drawer, wordmark home, footer games list.
- Wordsearch answers pages; `live_check` for wordsearch; schema-vs-migrations
  check; `headless_test.js` invisible to CI and the gate.
