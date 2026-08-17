# Crossword XI — outstanding

**Build v11.** Carries forward §10 of `HANDOVER.md`; read that first, because
several things that look like bugs there are deliberate.

---

## What changed in v11

**The Themed section.** A third track alongside Daily and Practice: themed
boards, released on a schedule, everything already out stays playable.

- **Twelve boards at launch** — Manchester United #1 and #2, Liverpool #1 and
  #2, Arsenal #1 and #2, Chelsea #1, Spurs #1, Manchester City #1, plus
  Grounds #1, Nicknames #1 and Premier League #1 so somebody who supports none
  of the big six has something to open on day one.
- **One a Friday after that**, starting 21 August, with the five single-board
  clubs across the first five weeks. **Seven over Christmas week**, one a day
  from 21 to 27 December, taking in Christmas Eve, Christmas Day and Boxing
  Day. Stock runs to 28 May 2027.
- **59 boards built from the existing bank** by `tools/build_themes.js`. Every
  one validated for the eleven-answer invariant, duplicate answers, the
  transfer cap, self-answering and cross-naming.
- **The theme is never the answer.** `tools/themes.js` separates what a clue is
  *about* from what the theme *is*: a Manchester City board is about Maine
  Road, Shaun Goater, its transfers and its managers. Grounds and stands stay;
  the club's own name and nicknames are struck out of the pool, because a
  nickname is the club.
- **A third save slot.** `fcw.v04.theme`. Three modes now, and sharing the
  practice key would have meant opening a themed board destroyed a practice
  game in progress.
- **Readable share links.** `/?t=man-united-3`, and the share message names the
  board. The name comes from the server, so what is on the board and what is in
  the message cannot drift apart.
- **Requests are collected**, picklist rather than free text so the tally is a
  sortable number. Nothing sends mail; a marker in the section tells anyone who
  asked, the week their board lands. `notified_at` exists for when email does.

**Fixed while building it:** `buildPuzzle()` handles its own failures and
resolves, so the `.catch()` on both the `?p=` and `?t=` boot paths could never
fire — a link to a withdrawn or unreleased board left the player on a dead
screen with no way back to the menu. Both now check whether a puzzle actually
arrived.

**Not fixed, and it is a gap:** Everton has no board. Removing "Everton" and
"Toffees" leaves 26 clues, and the generator cannot reach eleven answers from
that. It needs roughly fifteen new clues, and it is the largest following in
the game with nothing to play.

---

## What changed in v10h

**Fixed: several windows open on the same game fought over the same two keys.**

`localStorage` is shared by every tab on the origin, and no tab knew the others
were there. Three windows meant three clocks and three ten-second saves writing
`fcw.v04.daily` and `fcw.v04.practice`, last write winning. Two consequences,
both seen: a cleared record came back within ten seconds because another window
still held a copy in memory, and a tab left open since the morning could
overwrite the board being typed into now.

- A `storage` listener. A tab that sees its own slot change underneath it stands
  down — stops the clock, stops writing, and says so — rather than arguing about
  who is right. Storage events are only delivered to *other* documents, so this
  cannot fire on the tab that wrote, and a lone tab never sees it.
- `stopClockSaves()`. The interval `startClockSaves()` opened was never cancelled
  by anything; `stopTimer()` clears only `timerId`, deliberately, because a
  paused game still wants its elapsed written.
- Both admin buttons stop writing before they clear and reload.
  `location.reload()` does not halt the page — the browser fetches the document
  while everything here keeps running — so a save could land after the
  `removeItem` calls and put the record straight back.

`tabs_test.mjs` is new: 13 checks, eight of which fail against v10g. Read the
note at the top of it about what it cannot prove — jsdom delivers no storage
events between windows, so the harness bridges two by hand. That exercises the
handler, not the browser. **Worth confirming on the live site with two real
tabs.**

Also repaired two checks in `frontend_test.mjs` that sliced the admin handlers
by character count (`+ 700`). Adding a comment above the code under test pushed
it out of the window and failed a check about code that had not changed — the
trap recorded in §5 of the handover. Both now slice to a real boundary.

---

## What changed in v11

**The Themed section.** A third track alongside Daily and Practice: themed
boards, released on a schedule, everything already out stays playable.

- **Twelve boards at launch** — Manchester United #1 and #2, Liverpool #1 and
  #2, Arsenal #1 and #2, Chelsea #1, Spurs #1, Manchester City #1, plus
  Grounds #1, Nicknames #1 and Premier League #1 so somebody who supports none
  of the big six has something to open on day one.
- **One a Friday after that**, starting 21 August, with the five single-board
  clubs across the first five weeks. **Seven over Christmas week**, one a day
  from 21 to 27 December, taking in Christmas Eve, Christmas Day and Boxing
  Day. Stock runs to 28 May 2027.
- **59 boards built from the existing bank** by `tools/build_themes.js`. Every
  one validated for the eleven-answer invariant, duplicate answers, the
  transfer cap, self-answering and cross-naming.
- **The theme is never the answer.** `tools/themes.js` separates what a clue is
  *about* from what the theme *is*: a Manchester City board is about Maine
  Road, Shaun Goater, its transfers and its managers. Grounds and stands stay;
  the club's own name and nicknames are struck out of the pool, because a
  nickname is the club.
- **A third save slot.** `fcw.v04.theme`. Three modes now, and sharing the
  practice key would have meant opening a themed board destroyed a practice
  game in progress.
- **Readable share links.** `/?t=man-united-3`, and the share message names the
  board. The name comes from the server, so what is on the board and what is in
  the message cannot drift apart.
- **Requests are collected**, picklist rather than free text so the tally is a
  sortable number. Nothing sends mail; a marker in the section tells anyone who
  asked, the week their board lands. `notified_at` exists for when email does.

**Fixed while building it:** `buildPuzzle()` handles its own failures and
resolves, so the `.catch()` on both the `?p=` and `?t=` boot paths could never
fire — a link to a withdrawn or unreleased board left the player on a dead
screen with no way back to the menu. Both now check whether a puzzle actually
arrived.

**Not fixed, and it is a gap:** Everton has no board. Removing "Everton" and
"Toffees" leaves 26 clues, and the generator cannot reach eleven answers from
that. It needs roughly fifteen new clues, and it is the largest following in
the game with nothing to play.

---

## What changed in v10h — the banner, the table and the clue strip

**The banner.** The three groups now share one box treatment — same border,
padding, radius and label — so the row scans as a dashboard rather than three
different shapes with white space between them. `justify-content` was
`space-between`, which pushed the groups to the edges and put the gap in the
middle; it is `flex-start` now. Readouts lost their border and card face and
controls kept theirs, so what is pressable is visible without pressing it, and
the game buttons share a `min-width` so they are one size.

**The league table** is under the board at exactly the board's width, taken from
`--board-w`. That value is *calculated* by `fitCells()` from the puzzle's own
dimensions rather than measured off the painted board, so the two edges cannot
drift apart. It used to be a banner panel that script moved below the board on
phones; `placeTable()` is deleted and `.below-board` is simply what the panel is
rather than a state it gets put into.

**The clue strip** reserves a fixed column for the letter slots, so they start in
the same place on every clue instead of beginning wherever the sentence ended.
The reservation is derived — `15 * --bank-cell + 14 * --bank-gap + 27px` — from
`MAX_DIM = 15` in `engine.js`, which is the hard bound on grid width and so on
the longest answer that can ever be placed. A test asserts the two agree, so
raising `MAX_DIM` fails loudly rather than silently overflowing the card. Long
clues now shrink rather than scroll: `overflow-y:auto` inside a 96px card meant
the longest ones could only be read by scrolling, which nobody discovers. Below
900px the slots take their own row, because a sentence and fifteen boxes will
not sit side by side on a phone.

**Needs your eyes before deploying.** `render_test.mjs` and `journey_test.mjs`
are the only suites that measure a real browser, and neither could run here —
the Playwright browser download is blocked by the network allow-list. Everything
below is verified against stylesheet rules and jsdom, which cannot do layout.
Run both locally, and look at a phone, a tablet in both orientations and a wide
monitor before this goes out.

---

## What changed in v10g

**Fixed: a saved game could be destroyed by changing your club on the menu.**

The landing screen's *Play as* control fires `applyClubChoice()`, which ends in
`saveSoon()`. On that screen no puzzle has been built, so `letters` is `{}` and
`elapsed` is `0` — and `save()` had no guard for it. The write that produced was
a complete, well-formed, entirely empty record landing on top of a game in
progress. `mode` resets to `"daily"` on every page load, so whatever you were
last playing, the landing screen wrote to the **daily** slot.

The damage was invisible when it happened: `renderHome()` does not re-run after
a club change, so the card carried on saying *In progress · 2:43* while the
record behind it was already empty. The next render was the first sight of it,
which made the refresh look like the culprit.

Two guards, in `save()`:

1. Nothing is written when no puzzle is loaded.
2. A record holding letters or time is never replaced by one holding neither.
   Deliberately not conditioned on mode or on how the empty board arose, because
   every route to one has the same wrong answer. Only an explicit reset clears a
   save, and both of those go through `removeItem`, which does not come through
   `save()`.

`save_test.mjs` is new: 13 checks, seeding a game in progress into storage before
the page loads and then trying to destroy it. Three of them fail against v10f.

**Not changed, and worth recording:** the stacked-listener problem reported
during the investigation does not exist. `populateClubSelect()` opens with
`if (sel.options.length) return;`, so the binding happens once. The invariant is
now held by a test rather than assumed.

---

## Found during the investigation, not yet fixed

1. **The client and the server disagree about which day it is.** `dailyNumber()`
   in `js/engine.js` reads *local* date components; `functions/_lib/daily.js`
   reads *UTC*. Measured across 48 hours: Europe/London disagrees for the 00:00
   hour (client a day ahead), America/New_York for 20:00–23:59 **every evening**
   (client a day behind). Inside that window `renderHome()` blanks a good
   in-progress daily, and `chooseMode("daily")` passes `restore = null`, rebuilds
   and — before v10g — overwrote the save. Guard 2 above now stops the data loss,
   but the daily still *appears* unplayed and the board comes back empty.

   The fix is to take the day number from the daily response, which already
   carries it, rather than recomputing locally. Note this is the product decision
   flagged in the engine comment: pinning the puzzle day to one zone breaks the
   local-midnight rollover the Daily is built around. **Worth settling before
   anyone outside the UK plays.**

2. **`New puzzle` discards an in-progress practice game without asking.** The
   confirm guards only the board on screen, not the saved practice game it is
   about to replace. Measured: a practice game showing *One in progress · 0:01*
   became blank after one press.

3. **`New puzzle` leaves a daily below 25% with no confirmation at all.** One tap
   on the largest green button on screen moves you out of a scored daily. The
   save survives, but it does not look like it does.

4. **`fcw.mode` is written in three places and read in none.** Either honour it
   on boot or drop it; as it stands it is a promise the code does not keep, and
   it is why the landing screen always addressed the daily slot.

---

## Before Matchday 1 (13 September)

5. **Make the exported master the real source.** The export is not yet fit for
   it: `crosswordxi-master-bank.xlsx` holds 2,889 of the 3,406 rows in
   `data.json` — missing all 515 `V3xxxx` imports plus `FA2023` and `FA2024` —
   and every row carries `Max Per Puzzle = 1`, including the 1,251 that are
   archived. Adopting it as-is would lose 517 clues and un-archive the entire
   playability filter. Clue text itself is faithful: zero drift on clue, answer,
   category or era across all shared ids.

   `crosswordxi-clue-review.xlsx` is the better base — 2,891 rows, a strict
   superset, `In play?` matching `data.json` on every row, and a `Why archived`
   column. Still missing the 515 imports. Plan: review file + imports, then a
   round-trip test that rebuilds `data.json` from the spreadsheet and asserts an
   exact match before anything becomes canonical.

6. Review the 98 flagged clues; the 31 city-ambiguous ones first (23 plain,
   4 with `— not` disambiguation, 4 more combined, 3 with truncation).
7. Finish the validation audit on the 515 imported questions.
8. Remove the gold badge and move "What's live" into owner tools.
9. Check the EFL club list — written from memory, may have clubs in the wrong
   division.
10. Privacy policy (an email and display name are stored).

## During the season

11. More puzzles before 10 January — the badge turns red a fortnight out.
12. `og:image` (1200×630) so shared links preview properly.
13. Whether clue-circulation tracking resets at Matchday 1.

## Accepted

14. No public leaderboard until scoring can be recomputed server-side.
15. Google Fonts is an external request (self-hosting costs ~270KB).

## Offered, not built

16. A self-answering check in the generator.
17. EFL league tables.
18. Themed boards have never run against a real D1 — only a stub and the
    sample data. The release guard, the token round-trip through check-answer
    and the schedule query are all first contact on deploy.
19. Everton clues, so it can join the rotation. Then Sunderland, Forest and
    the other large followings with nothing.
20. An audit mode behind `?audit=1` — logs every write to the save slots with the
    stack that caused it and keeps the last non-empty record under
    `cxi.lastGood`. Not built, because the cause was found; worth having if
    anything like this recurs.
