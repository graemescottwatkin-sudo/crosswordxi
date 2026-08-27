# Crossword_v001i — v001h plus the gate that could not run on Windows

Base: **v001g** (live). Supersedes v001h, which was presented and burned.
Everything v001h did, plus the fix below. **Migration 020 is already applied —
do not run it again** (ALTER TABLE ADD COLUMN is not idempotent; a second run
fails and rolls back harmlessly, but there is no reason to).

## Verified here, CI-shaped, from the repo root

| | result |
|---|---|
| 25 suites | **864 passed, 0 failed** |
| `crossword/deploy_check.mjs` | **38 passed, 0 failed** |
| `wordsearch/deploy_check.mjs` | **28 passed, 0 failed** |

## The gate check that has never run on Windows

`deploy_check.mjs` parses every Functions file by piping it to Node, because
the Pages bundler parses too and a deploy-time parse failure cost a release at
v124. It called:

    execSync(process.execPath + " --input-type=module --check", ...)

`execSync` hands that string to `cmd.exe`. On Windows `process.execPath` is
`C:\Program Files\nodejs\node.exe` — unquoted, so cmd reads the program name
as `C:\Program` and fails with an **empty stderr**. The catch then printed the
first stderr line matching `/Error/`, found none, and printed `undefined`.

**All 43 files failed, on every Windows run, for as long as the check has
existed.** CI passed throughout, because `/usr/bin/node` has no space in it.
Confirmed by walking the whole tree rather than stopping at the first failure:

    functions\api\account\code.js exit=1
    ... all 43 ...

Same family as the five checks that returned true on folders that were not
there — a check that does not measure what it claims — only this one failed
loudly instead of passing quietly, which is why it surfaced at all.

**Two changes.**

1. `execFileSync(process.execPath, ["--input-type=module", "--check"], ...)`.
   Arguments as an array, binary spawned directly, no shell parses the path.

2. When there is no parse error to report, the failure now prints the exit code
   and the raw stderr instead of `undefined`. An environment fault should read
   as an environment fault. This one cost six commands to identify.

Proven to still catch a real fault: a deliberate syntax error in
`functions/_lib/games.js` produced

    FAIL  every Functions file parses ... — functions/_lib/games.js — SyntaxError: Unexpected end of input

## Everything v001h contained

- **Migration 020** — `game`, `entry_key`, `detail` on `results`; backfill
  before the unique index; `UNIQUE(user_id, game, entry_key)`. Applied.
- **`functions/_lib/games.js`** — the list of games and the one key rule,
  in one file. `daily:2` / `ws:2026-08-27`. Game three adds a prefix.
- **`INSERT OR IGNORE`** — the rule lives in the schema, not only in the order
  two statements happen to run.
- **`csrfOk` accepts `X-XI-Games`** as well as the crossword's original header.
- **Wordsearch signs in** — session at boot, push then pull, fire and forget.
  It pushes on every completion, so it will populate `results` before the
  crossword does (see below).
- **Admin day-delete scoped** to `game = 'crossword'`.
- **`crossword/games_test.mjs`** — 33 assertions, wired into `checks.yml`.
- `auth_test`'s D1 stub and `admin_test`'s DELETE assertion updated: both
  pinned the pre-020 schema.

## Deploy

    cd C:\Users\graem\OneDrive\Documents\GitHub\crosswordxi
    node crossword\deploy_check.mjs
    node wordsearch\deploy_check.mjs
    git add -A
    git commit -m "Crossword_v001i: results by game, one entry key, wordsearch signs in, gate runs on Windows"
    git push
    node crossword\live_check.mjs --expect v001i

**27 jobs** in Actions now — `games_test` is wired in. Then bump
`LAST_SHIPPED` to `"v001i"`, commit, push.

The crossword gate should read **38 passed, 0 failed on your machine** for the
first time. If the Functions-parse check still fails, it will now say why.

## Then the test no suite can run

Play today's word search to completion signed in, and:

    npx wrangler d1 execute crosswordxi --remote --command="SELECT game, entry_key, score, played_on FROM results"

One row, `wordsearch`, `ws:2026-08-27`. Then open it on the iPad on the same
account and confirm the score followed. `results` has been empty its whole
life — 147 daily plays, no browser ever holding history at sign-in — so this
will be the first time the account has actually carried anything.

## Known and not fixed here

**The two games push at different times.** Wordsearch pushes after every
completed board; the crossword only pushes at sign-in and at code-claim, never
after Full Time. So a crossword result waits for the next sign-in while a word
search result goes straight up. One fact, two behaviours. A few lines to fix —
worth its own small release, or fold it into the chrome.

## Next

- **The chrome** — paper bar on both games, hamburger drawer listing the squad,
  wordmark home from everywhere including mid-board, footer games list, the
  crossword's green masthead retired so green means a correct answer again.
- Wordsearch answers pages, sealed on the same seven-day rule.
- `headless_test.js` still invisible to CI and the gate.
- No `live_check.mjs` for wordsearch.
