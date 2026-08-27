# Crossword_v001p — the contract, signed before game three arrives

Base: **v001o** (live). No migrations. Built because game three lands
tomorrow, and every shared fact that could drift between two games triples its
opportunities on the day it becomes three.

| | result |
|---|---|
| 28 suites | **966 passed, 0 failed** (was 27 / 929) |
| `crossword/deploy_check.mjs` | **39 passed, 0 failed** |
| `wordsearch/deploy_check.mjs` | **28 passed, 0 failed** |

## 1. `tools/aligned_test.mjs` — the cross-game contract, 37 assertions

One GAMES table:

    { dir: "crossword",  name: "Crossword XI",  prefix: "fcw"  }
    { dir: "wordsearch", name: "Wordsearch XI", prefix: "xiws" }

**Game three is a row in this table.** Every check runs identically for every
row: page/gate/live_check/_headers/workflow present; the tag law constants
real, not sentinels; script tag and BUILD agreeing; tokens loaded before
chrome, a bar placed, no private `.xic-` rules; the name identical across
title, og:title, JSON-LD and h1 and equal to the team-sheet name; canonical;
the shared footer mounted; localStorage keys under the game's own prefix or
the family's; family-wide: squad list, sitemap, one CSRF rule, the server's
game list agreeing with the table, no private copies of shared files.

**Proven to fail three separate ways before being trusted:** a sentinel tag
constant (1 FAIL), a game writing another's key (2 FAILs), and — the rehearsal
that matters — **adding a `quickfire` row with no game behind it fails 5
checks, which is exactly tomorrow's checklist.** Wired into CI as job 30.

**It caught a real fault on its first run:** the word search has stored the
theme under `fcw.theme` — the crossword's prefix — since the day it shipped.

## 2. The theme moves to the family key

The intent was right (dark mode set once should hold everywhere); the home was
wrong (a family fact under one game's namespace). It is `xi.theme` now, in
both games. The legacy key is **read as a fallback and never written**, so
nobody's setting resets and the fallback retires itself one tap at a time.
`frontend_test` asserts both halves: stored under `xi.theme`, and `fcw.theme`
never written. The contract's rule is now: a game writes under its own prefix
or the family's `xi.`, and never under another game's.

## 3. The wordsearch tag law is real

`LAST_SHIPPED = "v000"` had compared every build against nothing since the
game shipped — a check that could not fail, wearing the crossword's discipline
as a costume. Constants are real now (`v001h` / `v001h`), the gate checks
both, **and it immediately bit**: this release's wordsearch changes forced the
bump to v001i. A check that fails the moment it becomes real is the proof it
is real. The contract asserts neither game's constants are sentinels again.

## 4. The live_check lifecycles fix

Last night's run: `FAIL and they all match the footer — v1, v001o`. Shared
assets carry their own `?v=v1` lifecycle — bumping every game's tag to
redeploy one shared file would burn tags for nothing — and the check asserted
every tag matched the footer. **Same wrong assumption as the gate's tag check,
fixed there hours earlier and missed here.** Now: the game's own assets must
match the footer; `shared/` assets must carry a plain `vN`.

## Deploy

    cd C:\Users\graem\OneDrive\Documents\GitHub\crosswordxi
    node crossword\deploy_check.mjs
    node wordsearch\deploy_check.mjs
    git add -A
    git commit -m "Crossword_v001p: cross-game contract, family theme key, real wordsearch tag law"
    git push

**30 jobs.** Then:

    node crossword\live_check.mjs --expect v001p
    node wordsearch\live_check.mjs --expect v001i

Then bump BOTH gates: crossword `LAST_SHIPPED` to `"v001p"`, wordsearch
`LAST_SHIPPED` to `"v001i"`. Commit, push.

## Tomorrow, when game three arrives

1. Add its row to `tools/aligned_test.mjs` — dir, team-sheet name, prefix.
2. Run `node tools\aligned_test.mjs`. The failures ARE the integration list.
3. Work through them; when the contract is green, the game is family-shaped.
4. Add its `href` to the squad list in `shared/xi-chrome.js` — the drawer,
   the footer and the hub checks flow from that one line.
5. Its results sync is one prefix in `functions/_lib/games.js` `entryKey()`
   — a line in GAMES, a key rule, no schema change.

## Tags

crossword **v001o → v001p**; wordsearch **v001h → v001i** (its own gate
demanded it). `LAST_SHIPPED` crossword **v001o** / wordsearch **v001h**
(bump both after deploy). `LAST_PRESENTED` crossword **v001o** / wordsearch
**v001h**.

## Still open

- Legal review — ON HOLD per Graeme. Noting once: the answers pages put
  player names on indexed pages; when it resumes, start there.
- In-progress board sync between devices.
- `headless_test.js`; `/wordsearch/` favicon; `actions/checkout` Node 20;
  repo rename to `thexigames`.
