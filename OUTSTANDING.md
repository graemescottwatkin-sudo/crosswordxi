# Crossword XI — outstanding

**Build v10g.** Carries forward §10 of `HANDOVER.md`; read that first, because
several things that look like bugs there are deliberate.

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
18. An audit mode behind `?audit=1` — logs every write to the save slots with the
    stack that caused it and keeps the last non-empty record under
    `cxi.lastGood`. Not built, because the cause was found; worth having if
    anything like this recurs.
