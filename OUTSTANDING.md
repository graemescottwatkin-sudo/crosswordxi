# Crossword XI — outstanding

Current as of **v150**, 26 August 2026. Live is v149.

The previous version of this file described v10g and v11, with the v11 section
duplicated verbatim, and had been superseded by RUN-ME notes for twenty-odd
releases. Replaced rather than appended to.

The full ruleset for the season is in `SEASON-RULES.md`; the ordered plan with
who does what is in `TASK-ORDER.md`. This file is the fault list.

---

## Dated

**3 September — daily #11, pre-season ends.** Day 1 is 24 August and
`PRESEASON_DAYS = 10`, so #10 falls on 2 September. On the 3rd every label
stops saying "Pre-season friendly", friendly records stop accumulating, and
because `SEASON_START` is null the game enters the middle phase: a real daily
with a real score and no season to put it in.

That is the three-phase design working, not a fault. But it is a visible change
to everyone playing, and nobody has seen it. **Test the phase model against 3
September specifically, not against today**, and decide what the tile should
say when there is no matchday number.

---

## Live faults

**`streaks()` does not guard the longest run.** The current run is guarded —
"finishing an older Daily after the next has begun does not revive a streak" —
but `longest` loops over every number in the record with no such check. Play
the archive end to end and best run reads 290.

**The pinch handler counts pointers twice.** `js/game.js`, the flex-layout
gesture block. `n` and `pts` are two representations of one fact — how many
pointers are down — and they drift: `n++` is unconditional on `pointerdown`
while `pts[ev.pointerId]` overwrites when an id repeats. A touch released
outside `.grid-wrap` never fires wrap's `pointerup`, so the entry leaks in
both; the next touch reusing that id makes `mid()` return one element and
`a[1].x` throws. If the id differs instead, no throw — a phantom pinch against
a stale finger position, and the board jumps. Either way `startD` and
`startMid` never get assigned, so the board stops panning until pointers clear.

Fix is to delete `n` and derive the count from `pts`. Same principle as `board`
in v145. It throws in every `frontend_test` run and has done since at least
v148 — check `git diff` against v126 before assuming it is new.

**Client and server disagree about which day it is.** The client reads local
date components; the server reads UTC. Europe/London disagrees for the 00:00
hour, America/New_York every evening. `epoch_test` compares dates at fixed
times, not times, so it passes throughout. Settle **before anyone outside the
UK plays** — and it is a product decision, not a bug fix, because pinning the
puzzle day to one zone breaks the local-midnight rollover the Daily is built
around.

---

## Test gaps

**`frontend_test`'s uncaught-error check is scoped to boot.** That is why the
pinch fault above prints a full stack trace inside a suite reporting 185 passed,
0 failed. Widening it to the whole run would catch that and would have caught
the v146 `bulkReveal` fault, which is the same shape — cheaper and broader than
`names_test.mjs` alone.

**Three checks have now matched a comment instead of the code.** Twice in
`record_test.mjs`, once in `live_check.mjs`. Comments here are long and quote
the code they replaced, so anything asserting against source must strip
comments first. Both files now do. Trailing `//` is deliberately left alone —
stripping it truncates any line holding a URL.

---

## Environment

**The gate contradicts its own instructions.** `npm install jsdom --no-save`
puts `node_modules` on disk and check 31 fails on its presence, though
`.gitignore` means it can never reach the package.

It happens not to bite because there is no `package.json` in the repo, so npm
walks up to `C:\Users\graem\package.json` and installs there. Two consequences:
every suite prints a `MODULE_TYPELESS_PACKAGE_JSON` warning, and **installing
one dependency prunes the others** — `npm install acorn --no-save` removed
jsdom and broke three suites. Always install both names in one command.

Adding `{ "type": "module" }` to the repo silences the warning and fixes the
pruning, and breaks check 31. Pick one.

---

## Not built

**Cross-device saves.** Completed results sync through
`/api/account/results`; the board in progress does not — letters, clock and
help are `localStorage` only, and no server path touches a save slot.

Harder than results sync because the clock runs: two devices with one board
open are two clocks and two sets of letters, with no `storage` event across
devices the way there is across tabs. The multi-tab stand-down machinery exists
because concurrent writers corrupt state; cross-device is that problem without
the detection.

What happens today is less broken than it sounds. Opening today's board on a
second device gives a fresh board and a new `play_id`; the outstanding-board
rule keys on `dailyNo` so no loss banks; and `recordDaily` refuses a second
result for a number it already holds, so whichever device finishes first wins.
You lose typed work on a device switch, not your day or your streak.

The cheap partial, if it becomes a complaint: the server already knows the open
`play_id`, so device B could say *"this board is in progress on another
device"* rather than handing over a blank grid. That is a message, not a sync.

**The season.** Decided in full, entirely unbuilt. `FCW.outcome()` is correct,
tested, and read only by the Season tile as of v149. See `SEASON-RULES.md` and
items 7–14 of `TASK-ORDER.md`.

**`seasonFromActions()` is a third W/D/L rule** and the one on screen at Full
Time. It factorises one board's score into a fake 38-game record. Retire it
**with** the season, not after — otherwise Full Time shows "12W 3D 23L" for
today's board beside a real record of "3W 1D 0L".

---

## Product and admin

- **how-to-play is live and already describes the season** — "Missing a day is
  not a loss", 38 matches, a table against a real season. It is indexed. The
  page promises something the game does not yet do.
- **The landing screen implies every archive board counts** towards the season.
  Under the settled rule a catch-up day banks two results and "one game a day"
  is no longer literally true. Needs a line.
- **Search Console still says `PASTE_TOKEN_HERE`.** Verify the **domain**
  property by DNS TXT, not URL-prefix, so it survives a move to
  `thexigames.com/crossword/`.
- **Rename Missing XI and Career Path** before either has a URL.
  playfootball.games has established pages under both names.
- **Device codes** need rate limiting on `/api/account/code`, a retention line
  in the privacy policy, a rotate button, and must never be logged. Bearer
  token.
- **Legal review** — naming, competition references, player name usage, and
  terms-of-service constraints on data sources.

---

## Content

Ahead of all of the above on impact. Roughly two people a day finish a board; a
league table is what brings someone back on day thirty and does nothing about
almost nobody arriving on day one.

- **More clubs.** Four clubs across several subreddits outperformed one club in
  one thread — the strongest signal available.
- **Everton has no board.** Removing "Everton" and "Toffees" leaves 26 clues and
  the generator cannot reach eleven answers. Largest following in the game with
  nothing to play. Then Sunderland, Forest, and the other large followings.
- **Season boards** — "Premier League 2023/24". Club-neutral, so they post to
  r/soccer rather than one club sub, and their clues promote naturally into the
  daily bank.
- **A `dailyEligible` flag on new club clues** — a judgement made when the clue
  is written and expensive to reconstruct later.
- **Source CSVs are behind `data.json`.** A rebuild from source would lose
  changes that exist only in the master spreadsheet.
