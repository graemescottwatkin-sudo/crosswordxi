# V113 — run me

**Full release.** `Deployment\` is the complete site — copy the whole folder
over the repo and let git show you what differs.

Edge taps for prev/next, jump-to-clue on the label, clue number top left, auto-advance. Includes everything in V51 to V57.

---

## Full Time: the breakdown folds away

Six rows sat between the score and the buttons, five of them usually reading
"None &minus;0". They are now behind **"How that was scored"**, closed by
default, with the total on the summary line so the number is still visible
without opening anything.

A `<details>` rather than a scripted panel: it opens with a click or the
keyboard, works before any JavaScript runs, and cannot get stuck open if a
render throws.

**The total inside the panel is gone.** It was the third appearance of the same
number on that screen — `1ST — 90 PTS`, `90 / 114`, and `FINAL SCORE 90 / 114`.
The summary carries it now.

**One helper writes it.** Three code paths set the final score — the local
calculation, the server's verified score, and the re-render after verification —
and there are two elements showing it. Three writes became six the moment there
were two places, which is how a total drifts from the rows explaining it.
`setFinalScore()` writes both.

**A test caught the refactor**, correctly: it asserts the breakdown and the total
are replaced together, and it was grepping for `$("rFinal")` inside
`verifyScore`. The property is unchanged, so the assertion now looks for
`setFinalScore(` instead.

**Still open on this screen:** the 38-square season strip projects a whole
season from one puzzle, which contradicts the model where a season is 38 played
dailies. And the league table sits between the result and the actions. Neither
is touched here.

---

## A finished board could be finished twice

Reported as "the time reads NaN:aN". The NaN was a symptom; the cause is worse.

**`complete` was never restored from the save.** The flag resets when a board
loads and was only ever set by finishing one, so reopening a completed puzzle
left it `false`. Delete a letter, put it back, and `checkComplete()` ran the
whole Full Time path again: **another `/api/finish`, another recorded result,
another Full Time screen** — with the breakdown missing, which is where the
`NaN:aN` came from.

So a player revisiting a finished daily and touching one square could record it
twice. `complete` now comes back from the save and the guard holds.

**Two stale strings on the same screen, both caught in the screenshot.**

*"The season table starts on Matchday 1, 13 September"* was hardcoded. The epoch
has moved and `SEASON_START` is null, so there is no Matchday 1 date to name. A
sentence stating a date it cannot know is worse than one that does not.

*"{club} are Premier League champions!"* survived the trademark pass two
releases ago because it lives in `engine.js` rather than in the interface
strings. Now "{club} are champions!".

**The Full Time redesign is not in this build.** These were bugs sitting inside
it; the layout question is still open.

---

## A Season tile on the landing screen

Appears **only while the season test override is on**, which is an owner-tools
switch — so in practice it is on your screen and nobody else's. Hidden by
default, and it disappears again when you turn the test off.

It reads where the run has got to: *"Today is Matchday 3 of 38"*, and below,
*"2 games played · 4 points"*. Tapping it opens My Season, the table that
already exists.

**It is not a separate mode**, and building it as one would have been the wrong
shape. The season is the daily, counted — this is a readout and a way in, so
you can judge how the thing reads before committing to any of it.

Points use the same mapping as the table: a score resolves to one result, three
for a win and one for a draw.

**To see it:** owner tools → Season test on → back to the landing screen.

---

## Season test, in owner tools

**Owner tools → "Season test: off".** Press it and tomorrow's daily becomes
Matchday 1, running to Matchday 38. Press again and the labels go back.

Tomorrow rather than today, so the first matchday is one puzzle away instead of
retroactively renaming what has already been played.

**It is not a gate, and is not presented as one.** `engine.js` runs in the
browser, so the override is reachable by anyone who looks. What it can do is
small enough that that is fine: the phase decides labels and whether *this
browser's* table counts, and the server has no notion of phases at all. Somebody
who found it would see "Matchday 1" early on their own screen and nothing would
follow.

**One real consequence.** Results recorded while it is on carry `phase:
"season"`, and those go to the account on sign-in. Turn it off before playing a
daily you want recorded honestly — the button says so when you switch it on.

**Three mistakes while building this, all mine.**

The override was tested *after* the pre-season check, so during pre-season it
did nothing at all — which is the one time you would want it.

`renderHome()` and `renderStreak()` throw without a puzzle loaded, and the
exception skipped the label update, leaving the button reading "off" while the
setting was written.

And the handler was never attached: I anchored the edit on
`on("adminReports", "click", function () {` when the real line is
`on("adminReports", "click", loadReports)`. The replace matched nothing and I
reported it as done without asserting — so `seasonTestLabel()` was being called
from `refreshAdmin()` and had never been defined. A ReferenceError waiting for
the next admin to open the panel.

---

## Three phases: pre-season, daily, season

The daily had two phases, so the day after pre-season became Matchday 1
automatically — committing to a season before there was any evidence anyone
would play thirty-eight of them.

| | |
|---|---|
| #1–#10 | **Pre-season friendly** — played, scored, kept, not counted |
| #11 onward | **Daily #1, #2 …** — a real puzzle and a real score, no season yet |
| from `SEASON_START` | **Matchday 1, 2 …** — counts toward the table |

`PRESEASON_DAYS` was already 10, so pre-season runs from today to **2
September** and the daily proper starts on the **3rd**. The daily renumbers from
1 there, because the friendlies were their own run.

**`SEASON_START` is `null`**, which is what keeps the season waiting. To start
one, set it in `js/engine.js` to the daily number of its first matchday —
nothing else needs touching, and the matchday numbering follows from it.

**A daily played before a season starts still builds your run.** `splitByPhase`
divides friendly from not-friendly, so those results sit with the season records
and the streak counts them. Only the table waits.

**Three tests asserted the two-phase model** and now test the boundary rather
than the labels — that pre-season ends where it says, that the next day is a
fresh run, and that an old record lands on the right side of the friendly line.
One of them already carried a warning about hardcoding `28` in three places; the
same shape caught the next person along.

**And one place recomputed the matchday** from `PRESEASON_DAYS` rather than
asking `dailyPhase()` — right while the season began the day pre-season ended,
wrong the moment it did not, and it had no label at all for the third phase.

---

## Correcting a finished word no longer jumps to the next clue

**A word that was already complete advanced on every keystroke**, so a spelling
could not be fixed at all: type one letter, the answer is still full, move to
the next clue.

My bug, introduced when auto-advance was changed to check whether the *word* was
finished rather than whether the cursor had run off the end. That fixed the real
case — a crossing supplying the last letter — and broke this one, because on an
already-full answer `entryFilled()` is true after every letter.

The advance now requires the word to have been **incomplete before the
keystroke**. That separates finishing a word from editing a finished one:

| | |
|---|---|
| Word already full, correcting one square | stays, cursor moves one right |
| Word has one gap, typing it | advances |
| Word half empty, typing mid-word | stays |

Correcting the last square of a word now stays on it rather than running past
the end.

**The skip-filled exemption was already right** and is unchanged — tapping any
square exempts that whole answer until the selection moves on, so typing walks
through the rest of the word whatever the setting says. It never got a chance to
work, because the advance fired first.

---

## Pre-season is ten days

`PRESEASON_DAYS` drops from 28 to 10. Twenty-eight friendlies is a month before
anything counts, and the season table — the thing the game is built around —
stays empty that whole time.

With the epoch at 24 August:

| | |
|---|---|
| #1 | 24 August, Pre-season friendly #1 |
| #10 | 2 September, last friendly |
| #11 | **3 September, Matchday 1** |
| #48 | 10 October, Matchday 38 |

So Matchday 1 is a fortnight away rather than a month, and a full 38-game season
runs to mid-October. Worth noticing that a one-a-day season does not line up
with a real football calendar, and probably should not try to.

**One definition, exported** — so unlike the epoch there was no second copy in
the source to keep in step.

**But two in the tests.** `frontend_test.mjs` hardcoded 28 in one assertion and
29/148 in another. Both failed, and the first read as "the season starts in the
wrong place" when the code was right and the fixture was stale — the same shape
as the epoch copy found in `save_test.mjs` last release.

Both now read `PRESEASON_DAYS` and assert the property rather than the number:
the last pre-season day does not count, the next is Matchday 1, and matchday
numbering is an offset from the boundary while the stored day keeps counting
through it. Changing the length again will not break them.

---

## The daily restarts at #1 today

The epoch moves from 16 August to **24 August 2026**, so today is Puzzle #1
rather than #9.

**This pushes Matchday 1 from 13 September to 21 September**, because pre-season
is 28 dailies and it now restarts from today. That is the date the season table,
the streak phases and the whole 38-game structure hang off, so it is worth
knowing rather than discovering.

| | |
|---|---|
| #1 | 24 August 2026 |
| #28, last friendly | 20 September 2026 |
| #29, Matchday 1 | 21 September 2026 |

**Two epochs had to move together** — `EPOCH` in `functions/_lib/daily.js` and
`DAILY_EPOCH` in `js/engine.js`. If they disagree the browser asks for one
puzzle and the server judges another, and check and reveal return 403.
`epoch_test.mjs` exists to catch exactly that and confirms they now agree.

**A third copy turned up.** `save_test.mjs` had its own hardcoded
`Date.UTC(2026, 7, 16)` to build a fixture. Moving the epoch broke two of its
assertions, and the failure read as "the menu stopped showing games as in
progress" when the code was right and the fixture was stale. The comment above
that line already warned that an expiring fixture reports a fault in the code
when the fault is in the fixture — it expired a different way. It now reads the
epoch from source rather than restating it.

**Anyone with a daily part-way through loses the "in progress" line**, because
their save records the number it was started under and today is a different
number. Two plays, so not worth solving.

---

## The daily is back on, and its tile now follows the flag

**`DAILY_OPEN` is `true` in this build.** Import the 290 boards before deploying
it, or the tile opens onto a puzzle that is not there.

**Two bugs fixed, both mine, both from writing state into markup.**

The `soon` class was hardcoded on the tile in `index.html`, so it stayed dimmed
whatever the flag said — setting `DAILY_OPEN = true` would have left the daily
looking unclickable next to Practice. It is now applied from the flag.

And the **Coming soon badge never appeared at all**: the line that writes the
phase label sets the whole title as `textContent`, which silently removed the
badge span on every render. So the tile was dimmed with nothing saying why —
which is exactly what the screenshot showed.

The note had the same shape and is now written from the flag too, so the
suspension message and the phase message cannot both be true at once.

Verified in both states: closed gives a dimmed tile reading "Pre-season friendly
#9 Coming soon" with the rebuild note; open gives a normal tile with the phase
note and no badge.

---

## The plays funnel has a time window

**It had none.** The query was `ORDER BY started_at DESC LIMIT 2000` — not a
period at all. Two thousand rows is about a fortnight at the current rate and a
couple of days once a post lands, so the same number covered a different span
every week. "50 finished" read as recent and could have been a month old.

Now **72 hours by default**, and the panel says so: *"How far players got — last
3 days. The CSV covers everything."* Three days because traffic arrives in
bursts from a post, and that window covers one without blurring it into the
last.

`?hours=` overrides it — `?hours=24` for a single day, `?hours=168` for a week —
capped at a year so a typo cannot ask for everything.

**The CSV is deliberately not windowed.** It already went to 20,000 rows against
the panel's 2,000, so the split you wanted was half-built: the panel is the
recent view, the export is the whole record.

The window is returned in the payload rather than assumed by the browser, so the
label can never disagree with the query behind it.

---

## Signing in now actually works across devices

**It did not before, and the sign-in offer said it did.** `migrate.js` was only
half the job: the browser posted what it had in localStorage and nothing ever
came back. Play the daily on a laptop, sign in on an iPad, and the iPad showed
an empty history — the rows were on the account the whole time with nowhere to
go. Its own comment said "the foundation, not the finished article".

**New: `GET /api/account/results`.** Returns everything the account has, in the
shape the browser keeps, newest first, capped at 400 like migrate. Read-only, so
calling it twice costs nothing.

**Merged, not replaced.** A player can finish a puzzle signed out and sign in
afterwards, so the local copy can hold something the account has not seen —
overwriting would throw that away. A daily keys on its number, which is what
migrate already relies on to top up rather than duplicate.

**Two things I got wrong while building it, both caught by testing rather than
by reading.**

The pull was first hung off migrate, which only runs when a *guest* signs in —
so somebody already signed in, opening on a second device, never fetched
anything. That is exactly the case it was built for. It now runs on every load
where a session exists.

And `apiGet` does not exist; I invented it. `apiAuth` with no body is a GET and
carries the session cookie and the CSRF header the endpoint checks.

**The Full Time wording is corrected.** It said "Across every device you play
on", which was a promise the code did not keep — my words, in a release not yet
deployed. It now reads "Your results follow you to any device you sign in on".

Verified across three cases: a fresh device pulls the account's history, a
device with its own unsynced result keeps it and gains the rest, and an
overlapping daily does not duplicate.

---

## "Premier League" is out of the interface

Six places, none of them clue text.

| where | was | now |
|---|---|---|
| Strapline | Premier League &middot; Puzzle | **Football Crossword** |
| Daily open | Premier League &middot; Matchday 3 | **Season &middot; Matchday 3** |
| Practice | Premier League &middot; Practice | **Training** |
| Club group 1 | Premier League 2024/25 | **Top flight clubs** |
| Club group 2 | Other Premier League clubs | **Other clubs** |
| Club group 3 | Football League clubs | **Other clubs**, merged |

**The strapline was the wrong claim as well as the wrong mark.** It was never a
Premier League puzzle — the bank spans European Cups, World Cups, internationals
and clubs from outside the top flight.

**The season is gone from the club labels.** The season you are scored against
is drawn from the puzzle seed whichever club you pick, so naming one in a club
list read as "pick from this season" and implied a link that does not exist.
There is a note in `populateClubSelect` that was written to avoid exactly that
confusion; the label was reintroducing it.

**Groups 2 and 3 are merged.** "Football League" is a mark too, and the only
distinction a player cares about is whether a club is in the current twenty.

**The 95 clues that name the Premier League are untouched.** "Man Utd won the
Premier League in 1995/96, but who finished second?" is a factual reference to a
named competition. That is what a trademark is for, and there is no honest way
to ask the question without it. The exposure was the mark appearing as the
product's own identity, not factual reference.

**Two tests asserted on the old wording** and both now test the property rather
than the words: that the current twenty lead the list and number twenty, and
that lower-league clubs come after them rather than in a group of their own.

**Noted, not fixed:** the newest season in `seasons.js` is 2024/25 and it is
August 2026. "Current top flight clubs" is therefore two seasons out of date,
and promoted clubs will not appear until the season data is brought forward.

---

## Daily is suspended

The tile reads **Coming soon** and refuses the click; the toolbar menu item is
greyed with a **Soon** badge. Left on screen rather than removed, on the same
reasoning as Practice: a track that vanishes reads as something broken, a track
marked as coming says what is actually happening.

**Anyone part-way through today's can still finish it.** Stranding a half-played
board to enforce a suspension costs a real player something and saves nobody
anything — the puzzle is already on their device.

**One flag, `DAILY_OPEN`, read in all three places** — the tile, the menu item,
and the Full Time prompt added in V94. That prompt pushes people at the daily,
and a prompt advertising a mode the tile refuses to open would be worse than
either on its own. Set it to `true` to bring the daily back; nothing else needs
touching.

**Four test suites entered the game through the daily tile** and stopped working
when it started refusing: `render_test`, `frontend_test`, `tabs_test` and
`save_test`. All four now drive `#dailyBtn`, the control underneath the tile —
hidden in the flex layout, never removed. What those suites need is a loaded
puzzle, not a particular way of asking for one.

Worth knowing that route exists: the daily is closed at every entry point a
player can see, not disabled in the engine.

---

## The selected clue is brought into view

Answering 1 Down and moving to 3 Down left the highlight two scrolls down the
side panel, which is no highlight at all.

**This was switched off on purpose, and the reason no longer applies.** There is
a note in `updateSelection()` explaining it: in the classic layout the clue list
sits BELOW the board, so revealing an item in it scrolls the page and the
crossword appears to jump — especially on an iPad with the keyboard open. In the
flex layout the list is in its own scrolling panel beside the board, so moving
it moves nothing else.

Guarded three ways so the old problem cannot come back: only in the flex layout,
only when the panel actually scrolls, and `block: "nearest"` rather than
`center` — so the panel moves when the clue is off it and stays still when the
clue is already there. A clue shuffling under the eye on every letter typed
would be worse than not scrolling at all.

The classic path is untouched.

---

## Five rows in the Full Time table

It was `34vh`, which is eleven rows on a tall phone, seven on a short one and
fifteen on a tablet — the same table a different length depending on the
handset, with ten rows of a twenty-team league pushing the buttons below it down
the card.

Now five rows, sized in rows rather than viewport height so it is the same
everywhere. Enough to see where you landed and who is either side, which is what
the table is for at Full Time. The rest is still there by scrolling.

**And a bug found while capping it.** The table renders twice: once when Full
Time opens, and again when the server confirms the score. The first render
scrolls your row into view; the second did not, and re-rendering throws the
scroll back to the top. It barely showed at ten rows deep — at five it would
have left you looking at the top of the league instead of at where you finished.
Both renders now re-centre on your row.

---

## Telling people Follow word exists

A one-time tip over the bottom of the board: **"Follow word zooms to the answer
you are typing, one at a time."** with **Try it** and a dismiss. Either answer is
remembered; a tip that returns is an advert.

**Four conditions, all about the moment rather than the person:** the flex
layout, Fit board mode, cells under 32px, and three letters already typed. The
last one matters most — somebody who has just arrived is looking at the puzzle,
not at a tip, and a hint read by nobody is an interruption for nothing.

**It will not fire often, and that is deliberate.** On the boards measured, a
ten-column puzzle renders at 46px on a phone, well clear of the threshold. It
starts firing around fifteen columns, where a wide board on a small screen
genuinely is cramped. The wide-board case is the one where Follow word earns its
place.

**The wording changed while building it.** The first version opened "Squares
looking small?" — which diagnoses a problem the player has not noticed and may
not have. It says what the mode does instead. The board is fine; this is an
option.

---

## Everyone arrives on the whole board

Phones defaulted to Follow word, which since the modes were coupled also hides
everything except the answer being typed. That is a good way to solve and a bad
way to arrive: most people reach this from a link somebody sent them, and a
first screen showing one word does not tell them they have a crossword.

The default is now the whole board on every screen, with **Follow word** offered
on the button. Show them the thing, let them narrow it.

Still a first-run default rather than a rule — anybody who has chosen Follow
word keeps it. Verified across all four cases: first visit on a phone and on a
laptop both give the whole board, and a stored preference wins either way.

---

## The gate was polluting the play figures

`render_test.mjs` plays a real puzzle on the real site at sixteen viewports and
never finishes one. Untagged, a day of runs landed as **49 daily plays with zero
completions** on a day the daily had one genuine player — a number that reads as
a broken daily rather than as a test suite.

`by_owner` does not catch it: that flag is set from the session and the gate is
not signed in.

It now tags itself with `?r=gate`, the short campaign tag added in V90, so the
rows carry `utm_campaign='gate'`. Exclude them with:

```sql
WHERE by_owner = 0 AND (utm_campaign IS NULL OR utm_campaign <> 'gate')
```

`CHECKING-PLAYS.md` has it alongside the other reporting queries.

**Rows already in the table cannot be tagged retrospectively** — anything before
this release stays untagged. The 49 on 21 August are the gate; the daily figures
for that day should be read as roughly zero.

---

## Seeing what the gate sees

```
set BASE=https://crossword.thexigames.com
set SHOTS=1
node render_test.mjs
```

Writes a PNG per viewport into `shots/`. Sixteen images of the exact page the
assertions were measured against.

A gate that only reports numbers asks you to trust that its assertions describe
what a player sees. A picture beside the numbers lets you check that they do —
and catches the whole class of defect nobody thought to assert on.

`shots/` is gitignored: useful to look at, not useful to keep.

**One image worth opening first: `phone-landscape-lg.png`.** It passes, and it
reports a 6.6px cell. The rotate prompt should be covering it — below 18px in
landscape it asks for a rotation — but the gate asserts nothing about that
prompt, so a board nobody can read and a prompt telling them to turn the phone
look identical in the output. The screenshot settles which it is.

---

## The daily, offered at Full Time

Full Time offered Challenge, Share, New puzzle and View grid — every one of them
about the board just played. Somebody arriving from a shared link could finish,
enjoy it, and leave without ever learning there is one a day. "New puzzle" gives
them another board; it does not give them a reason to come back tomorrow.

There is now a prompt above the sign-in offer, and **the wording changes with
what they have already done**, because the reason to come back is different in
each case:

- **never played a daily** — "Today's daily — #6. One a day, the same puzzle for
  everyone. Play tomorrow's too and you have a run going."
- **played, on a run** — "Your run is 3 days. Today's is #6. Miss it and the run
  goes back to nothing."
- **played, no run** — "You have played 4 dailies. Two days running starts a new
  run."

The streak is the strongest of the three and it is already tracked, so this is
surfacing something that existed rather than building a mechanic.

**Hidden when today's daily is already done, and when the daily IS what they
just played.** Offering somebody a puzzle they have finished reads as a game
that has not noticed what they did.

The button drives `dailyBtn`, the control that already loads today's puzzle — no
second implementation of it, which is the rule that four sign-in routes broke
two releases ago.

---

## The last four gate failures, and one it did not catch

Six failures became four. The frame-height problem is fixed — phone-small now
clears the floor and the landscape sizes are handled. **The four that remained
were self-inflicted.**

**44px tap targets.** My short-screen rule dropped the toolbar buttons to 40px
to buy height, and render_test refused it at four viewports. Correctly: a
mis-tap on Reveal costs points, and a small screen is where mis-taps happen. The
height comes back from padding and type size instead — neither of which anybody
has to hit.

**And one the gate did not fail but should worry you.** phone-landscape-lg
reported `cell 6.9px`. The frame was 160px, which cleared my 150px floor, so the
check passed — and drew a board nobody can read. The right question answered
correctly against the wrong measure.

The rotate prompt is now judged on the cell it would produce rather than the
frame height: below 18px in landscape, ask for a rotation. Eighteen is the same
floor the classic layout used, where a letter and a clue number stop fitting.
All three landscape sizes now trigger it; phone-small is portrait and stays,
since rotating makes it worse.

**Re-run the gate after deploying.** Sixteen viewports, no ONLY:

```
set BASE=https://crossword.thexigames.com
set ONLY=
node render_test.mjs
```

---

## Small and landscape screens had no board

`render_test` in CI measured the frame at four viewports and found there was
barely one:

```
phone-small        320x568   106px
phone-landscape-lg 915x412    68px
phone-landscape    844x390    54px
phone-landscape-sm 568x320    20px
```

At 20px there is no board. Two of them also put the square being typed into
outside the visible frame, which is worse than a small board — it is typing into
something you cannot see.

**Landscape: the rotate prompt never fired.** It lives in the classic half of
`fitCells()`, which `fitFlex()` returns before ever reaching — so nothing told a
landscape player to turn the phone. Asked for now on the same terms: there is no
room, and turning the device is what fixes it. That covers three of the four.

**320x568 is portrait**, so rotating makes it worse. The chrome gives the room
back instead: a shorter header with the strapline dropped, a tighter toolbar and
letter bank, and a two-line clue card rather than three. Roughly 106px of frame
becomes 236px.

Everything there is smaller, not missing — a control that disappears on a small
screen is a feature that phone does not have.

**The keyboard is deliberately untouched.** `--osk-h` is
`clamp(34px, 5.4vh, 52px)`, so on a 568px screen it is already at its 34px
floor; an override would only push keys below what a thumb can hit.

**Re-run the gate after deploying** — these are measurements, and the fix is
only proven by measuring again:

```
BASE=http://127.0.0.1:8788 node render_test.mjs
```

---

## CI failure in check-answer

`blank_test.mjs` threw `TypeError: e.cells is not iterable` on the grid-check
path, which failed the whole workflow.

The `wrongEntries` count iterates every entry's cells to work out how many
answers are complete but wrong. An entry with no `cells` array cannot be judged
either way, and iterating it threw — a 500 on a check the player has already
been charged points for, which is a worse failure than the malformed entry that
caused it. Those entries are now skipped.

Real puzzles always carry cells, so this was only reachable from the test's stub
in practice. It is still worth guarding: the endpoint should not fall over on a
shape it can simply ignore.

Whole CI chain verified locally afterwards — functions, status, play, blank,
circulation, d1, epoch, auth, admin and themes: 227 passing.

---

## Short link tags

`?r=a1` is a short alias for a campaign tag.
`utm_source=reddit&utm_campaign=arsenal-match-thread` is fifty characters of
machinery hanging off a link somebody is deciding whether to click, and a long
ugly URL is one people skip.

It fills the campaign field with the code and marks the source as `ref`, so a
short-link arrival is distinguishable from a fully tagged one. Works alone or on
a challenge link: `?c=k3f9p2&r=g7`.

**What the code means is a note you keep**, not something the site knows. A
lookup table in the code would be a second place to maintain for no gain.

An explicit `utm_campaign` still wins, so this is shorthand rather than a
replacement. Codes are lowercased and non-alphanumerics become hyphens.

`CHECKING-PLAYS.md` has the reporting query and a note that Reddit sends
noreferrer on outbound links — so the tag is the only signal you get from there.

---

## The challenge card cannot grow past the screen

With thirty-two finishers on one board the standings table pushed the name
field, Play, and the way out below the fold — a card whose controls cannot be
reached is a dead end, on the one screen somebody lands on from a link a friend
sent them.

The card is now capped to the space the overlay gives it, and the standings
table is the one thing inside allowed to scroll. Everything else — the heading,
the name field, Play, the note, the way out — holds still and stays reachable.

The table's own heading sticks to the top and the price key sticks to the
bottom, so a long table still says whose challenge it is and what `1L 1A` means
without scrolling to find out.

**Full Time had the same shape** and is capped the same way: a twenty-row league
table under a score, with nothing stopping the card growing past the screen.
Found while fixing this rather than after somebody met it.

`LAST_SHIPPED` is now `v88`, so the next release is checked against what is
actually live.

---

## New layout, behind a toggle

**Footer: `layout: classic` / `layout: flex`.** Off by default. The classic
layout is untouched behind it.

## The league table: tablet and laptop only

**On a tablet or a laptop** it sits in the right-hand panel, below the Across and
Down lists, and **holds still while they scroll**. The lists take the scrolling
rows of that column and the table takes the last one, so it is a readout rather
than something you have to scroll back to find.

**On a phone it is not shown.** Two attempts — stacked under the letter bank,
which cost the board a whole row of height, and beside the clock as a second
grid track, which did not lay out cleanly. Neither earned its space next to a
board that is the whole point of that screen. Worth another go another day, not
at the cost of the board.

**So the score chip stays on phones.** `has-table` means a club has been chosen,
not that the table is on screen — hiding the chip on that class alone would
leave a phone player with a club and no score anywhere, which is the regression
the chip exists to fix. The rule is scoped to the width where the table actually
renders.

Phone: the chip, always. Wide: the table when a club is set, the chip when not.

---

## The running score is back

**The score was the league table.** There is a comment in `updateScoreUI()`
saying a chip repeating the position and running score "was saying the same thing
twice" — so it was removed, and the table became the only place the number
appeared. Hiding the table in the flex layout took the score with it, and 114
counting down as the clock runs is most of what the scoring is.

It now sits beside the clock and the progress count in the letter bank strip:
`0'  ·  0/11  ·  114 pts`. It falls with a short flash, because falling is the
point — suppressed under `prefers-reduced-motion`.

**Updated whether or not a club has been chosen.** `updateScoreUI()` returns
early without one, since everything after that point is the league table, so the
number needed its own path. `tick()` already calls it on each football-minute
change, which is when the score actually moves.

Only in the flex layout — the classic one still shows the table, where the
number already lives.

The league table itself is still hidden in flex. Worth deciding whether it
belongs in the clue panel on a wide screen; on a phone there is no room for it.

---

## The Google button was missing from four of five routes

Opening the account sheet is not only adding a class. `accountToggle` also calls
`loadGoogle()`, which fetches Google's script and renders the sign-in button
into `#googleBtn`.

Four routes opened the sheet themselves and skipped that — my two new ones,
`tbSignIn` and the Full Time offer, and two that predate them on the landing
screen, `homeAccount` and `homeSignIn`. The sheet appeared with an empty space
where the button should be, and only worked once something else had loaded the
script. Which is why the cog worked and the toolbar did not.

All five now press `accountToggle`. Verified by counting script injections: each
route opens the sheet **and** requests the Google script.

"It is only one line" is exactly how a second implementation starts. The same
principle the settings menu already follows — drive the control that does the
job — should have applied here from the beginning.

**Worth running `signin_test.mjs` after this.** It needs Playwright, so it does
not run in the environment this was built in:

```
set BASE=https://crossword.thexigames.com
node signin_test.mjs
```

---

## Letter separators on the selected word

The squares in the answer being typed ran together into one bar — you could not
see where one letter ended and the next began.

`--cell-line` is tuned for a white cell, where it measures 1.30:1: quiet on
purpose, because a grid of hard boxes is not what a crossword should look like.
Against the deepened selection it fell to **1.06:1**, a six percent difference,
which is not a faint line so much as no line.

A separate `--sel-line` now draws the borders inside the selection: **2.05:1**,
still a hairline rather than a box, but one you can see. The active square has a
darker fill again, so its own separators are darker still at 6.01:1 — the ring
already marks the square, this is only about seeing its edges.

The cell to the right of the selection draws the border between itself and the
last selected square, so that one is included too — otherwise the final
separator of every word would be the only faint one.

Third pass on this area, and each one was caused by the last: deepening the
selection weakened the word-break marker, and then the cell separators. Both
shared a hue with the thing that got darker.

---

## The clue list opens, and the whole card changes clue

**The list was being clipped out of existence.** It sat inside `.nc-main`, which
is `overflow:hidden` so a long clue cannot spill out of the fixed-height card —
and that clipped the list too, whichever direction it opened. It has been
rendering correctly all along and never had anywhere to appear.

Moved to a sibling of `.nc-main`, a direct child of the card, where nothing
clips it. The upward-opening fix from v70 was right and was simply never
visible.

**The flag sits above the zones.** It was a static element while the zones are
absolutely positioned with a z-index, so the right half painted over it and a
tap meant for the flag stepped to the next clue instead. Raised above them,
widened to 44px, and given a hover background so it reads as a control on the
card rather than part of the sentence.

It occupies the far right of the right half, so that corner flags rather than
steps. It only appears when signed in, so most players see the full half.

**The tap zones are half the card each, and invisible.** They were 40px strips
at the extreme edges with a faint chevron: a small target at the very edge of a
phone, easy to miss. Now the left half is the previous clue and the right half
is the next, with nothing drawn — the target is the half of the card you are
already looking at.

The sentence no longer takes pointer events, or it would swallow the tap for
whichever half it covers, which is most of the card. The clue label still sits
above both halves and still opens the list.

---

## Word breaks are visible on the selected answer

Caused by the previous release. `--wordbreak` is a green, and deepening the
selection made it a green too — so on the answer being typed the divider stopped
reading as a divider and became part of the highlight. Exactly where it matters
most: knowing where "(5,4)" stops being five letters and starts being four.

Measured: 6.47:1 on a plain cell, but 4.68:1 on the selected word and **3.11:1
on the active square**.

The marker is now ink rather than green on selected cells — 11.9:1 and 7.9:1 —
and a different hue from everything around it rather than a darker shade of the
same one. Unselected cells are unchanged, where the green was never the problem.

Worth checking dark mode too: the same collision exists there, 4.43:1 and
3.29:1, and the same fix applies.

---

## Focus is part of the mode

**Follow word turns focus on. Fit board turns it off.** The separate focus
switch is gone from the footer and the settings menu.

Following the answer and hiding everything else are the same intent stated
twice, and two switches for one idea is two things a player has to line up
before either does what they meant. Fit board shows the whole board, so hiding
most of it there was a contradiction the interface allowed.

I had unbundled these earlier without being asked. Coupling them is the simpler
design and it was the right call.

**Two boot calls had gone missing.** The regex that removed the old focus block
took the restore of the fit mode and the call to `setLayout()` with it —
`setLayout` ended up defined and never called. The layout still looked correct,
because the CSS default carries it, so nothing looked wrong; but the stored fit
mode was ignored and the button label never matched the state.

A function that is defined and never called passes a syntax check and every test
that does not assert on its effect. `grep -c` on a definition is not the same
question as whether anything runs it — worth remembering as a shape.

Verified across all four combinations: phone with nothing stored gives Follow
word with focus on, a wide screen gives Fit board with focus off, and a stored
preference wins over both.

---

## The gate found something real

Run against the live site it failed at both phone sizes, and it was right:

```
controls meet 44px — tbMode:34, tbCheck:34, tbReveal:34,
                     tbSignIn:34, tbSettings:34, ncMeta:23 (+3 more)
```

**Every control I added to the toolbar was 34px tall**, and the clue label — the
thing that opens the clue list — was 23px. Comfortable with a mouse, a mis-tap
on glass. On this game a mis-tap on Reveal costs points.

All of them are 44px now: the toolbar buttons, the cog, the zoom and fit
controls on the frame, and the clue label. The label uses padding with a
matching negative margin rather than a min-height, so the box grows around the
text without pushing the sentence down the fixed-height card.

**The good news in the same output:** 46.3px cells on a 390px phone. The old
layout gave 18px on the same board.

One 34px control remains, in the owner-tools report panel. It predates this work
and is not on the path a player walks.

---

## The gate tests the layout people actually see

`render_test.mjs` asserted things that stopped being true when the board started
scrolling by design — "grid ends within viewport" would now fail on every puzzle
that used the space it was given.

Replaced, for the flex layout, with what must actually hold:

- the board **frame** starts on screen and ends within the viewport
- the frame has usable height — under 140px the board has nowhere to go
- **the square being typed into is inside the frame**, which is the real
  question a panning board raises
- the toolbar is on screen
- the clue card is on screen

Everything else it checked still applies and is untouched: runtime errors,
horizontal overflow, square cells, cell overflow, clipped clues, the keyboard
not covering the active square, 44px controls, the result exit.

The old board-fit assertions still run on the classic path, so both are covered
while both exist.

**The first version of it threw.** `activeBox` was already measured a few lines
above and the new code declared it again, so every viewport reported
`SyntaxError: Identifier 'activeBox' has already been declared` — the gate
failing as a page failure, which is what a gate should do with a broken gate.
Fixed, and the measure function is now executed against a stub DOM before
shipping rather than only read.

**It still needs running on real hardware.** Chromium cannot be installed where
this was written. Run it against the live site — no local wrangler needed, and
no D1 binding to arrange:

```
npm install --save-dev playwright
npx playwright install chromium
set BASE=https://crossword.thexigames.com
set ONLY=phone
node render_test.mjs
```

Command Prompt, not PowerShell — the execution policy blocks `npm.ps1`. Drop
`ONLY=phone` for all sixteen viewports once four are passing.

`OUTSTANDING.md` carries the deletion as the next job, gated on that run.

---

## Migrated for good

**There is no layout choice any more.** Flex is what everybody gets, including
anybody who picked classic during the opt-in — the stored preference is ignored
rather than honoured, so nobody is left behind on it. The toggle is gone from
the footer and from the settings menu.

**The classic code is still in the file.** That is deliberate, not an oversight.
The Playwright gate — sixteen viewports — is the only automated check either
layout has, and it tests classic. Deleting the path it covers before it covers
the new one would leave nothing watching at all.

So two jobs, in this order, both now in `OUTSTANDING.md`:

1. Rewrite the gate against the flex layout
2. Then delete the classic CSS and the classic half of `fitCells()`

Doing them the other way round is how a working layout quietly stops working.

---

## Sign in, offered where it means something

**At Full Time**, under the verified score: "This score is saved on this device
only — sign in to keep it, across every device you play on", with a link to the
privacy policy.

Offered there rather than on the landing screen, which is the point of lowest
willingness: nothing has happened yet, so "keep your results" is a promise about
results that do not exist. At Full Time the score is on the page and the offer
is about something real.

**In the toolbar**, one control either way. Signed out it reads **Log in /
register**, outlined in the accent because it is an invitation. Signed in it
reads **your name**, with a small green dot and no accent — a name on screen is
a readout, not something anybody needs to press.

Showing the name is worth the room. It answers "am I saving this?" without
opening anything, and it is how somebody notices they are signed in as the wrong
person on a shared device. Pressing it opens the account sheet either way.

The name comes from `accountName()`, which already falls back to the part of the
email before the @, so a signed-in player always has something to be called.

Both are hidden when accounts are not configured, because offering a sign-in
that cannot happen is worse than not offering one. Both open the account sheet,
which is where signing in already happens: no second implementation of it.

Both follow the same state from `renderAccount()`, the one place that already
knows whether there is an account.

---

## Tapping a filled square overrides skip-filled

Skipping over letters already in the grid is right while an answer is being
filled — it is what the setting is for. It is wrong the moment somebody taps a
filled square, because the only reason to do that is to change what is there,
and skipping past it puts the correction somewhere else entirely.

A deliberate tap now exempts **that answer only**, and only until the selection
moves on. Stepping to another clue, picking one from the list, or auto-advancing
all put it back. The setting itself is untouched and nothing has to be restored.

Revealed letters are still skipped either way — those are locked and typing is
not meant to reach them.

---

## Both clue controls work on a phone

Same root cause for both: **the clue card moved to the bottom of the screen and
neither control followed it.**

**The jump list opened downward**, with `top:100%` — which at the bottom of the
column is behind the keyboard and off the screen. It had been rendering all
along, just nowhere anybody could see it. In the flex layout it now opens
upward.

**The edge taps had been collapsed by one line.** `align-self:center` was
applied to the arrows along with the flag, and on an absolutely positioned box
align-self overrides `top`/`bottom` — so instead of a full-height zone down each
edge there was a centred glyph with nothing around it to press. The flag keeps
the middle; the arrows no longer do.

The clue text block also sat above the zones and could swallow a tap meant for
one. It now only catches pointers on its own children, and keeps 42px clear of
each edge.

**Three guards added while tracing it.** Tapping the label, either edge, or
pressing Tab before a puzzle had loaded threw on `puzzle.entries`. Because the
throw happened before the list was unhidden, the symptom was a control that did
nothing rather than an error anybody would see — the same shape as the bug
above. `stepClue` is guarded once rather than at each of its four call sites.

---

## The selected clue is visible now

**It was 1.13:1 against a plain cell** — a thirteen percent difference in
brightness, which on a board of white squares is not a highlight. The square
being typed into was 1.05:1 against the rest of its own word: a five percent
difference, effectively nothing.

Deepened to **1.38:1** for the word and **1.50:1** for the active square, which
reads at a glance. The typed letter still sits at 11.9:1 and 7.9:1 against its
own background, well clear of the 4.5:1 a letter needs.

**The ring on the active square is thicker.** Colour and a ring, not colour
alone: a fill difference is the first thing lost to a dim screen, sunlight, or
colour vision deficiency, and the ring carries the same information as a shape.

**Dark mode needed a second pass.** The first values put the letter at 4.18:1
on the active square, under the 4.5 minimum. The active green is darker now and
the letter sits at 6.0:1.

---

## Settings is a menu

The cog opens a dropdown rather than sliding the whole footer up. Account, My
Season, Owner tools, Theme, Letter bank, Pitch, Skip filled, Focus, Layout,
Reset clues, Privacy — each with its current state beside it.

**Built from the footer's own controls, every time it opens.** Each row is a
live mirror: its state is read from that control's label, and pressing the row
presses that control. One place a setting lives and one place its label is
written. A second list would be two things to keep in step, which is a shape
this codebase has got wrong before.

Rows whose control is hidden are left out, so Owner tools and Reset clues appear
only when they apply.

**Changing a setting does not close the menu.** Theme and letter bank are things
people try two or three times in a row, and a menu that shuts after each one
makes that three round trips. Anything that opens a sheet — Account, My Season,
Owner tools — does close it, because the menu would otherwise sit behind the
sheet.

**A bug worth recording:** driving a footer control synthesises a click on it,
and that click bubbles to the document, where the handler that closes menus
lives. So pressing a setting closed the menu it was pressed in — the opposite of
the intent. A flag now makes the synthesised click invisible to the closer.

The header's more button is gone; the menu replaces it.

---

## Menu items that are not available say so

**Practice** in the mode menu is greyed with a **Soon** badge. It was selectable
while the mode is suspended, so choosing it did nothing and looked broken. Left
in the menu rather than removed, on the same reasoning as the Coming soon tile
on the landing screen: a missing item reads as a feature that does not exist, a
greyed one reads as a track that is coming.

**Free substitution** in the Reveal menu is greyed and reads **Practice only**
outside practice, or **None left** when they are used up. It is a practice-level
feature — the comment on `updateSubUI()` says so — and it was appearing in modes
it does not apply to.

Both are shown rather than hidden, and both say why they cannot be used.

---

## Migrated: flex is the layout

**Anyone arriving now gets the new layout.** Classic is still there, still
complete, and one press away in the settings panel.

Only an explicit `classic` opts out, so anybody who chose it during the opt-in
period keeps it rather than being overridden by the default changing under them.
Verified all three cases: nothing stored gives flex, a stored `classic` stays
classic, a stored `flex` stays flex.

**On a phone the board is the whole screen.** The clue lists are gone below
860px — the jump list on the clue label does their job without scrolling past
the board — and the resting mode is **Follow word**, so the answer being typed
stays framed. On a tablet or laptop the lists are beside the board and the
resting mode is the whole board instead, because there is room to see all of it.

That is a first-run default, not a rule: whatever was last chosen wins.

The phone column reads menu, board, letter bank, message row, clue, keyboard —
with the clue against the keyboard, its label opening the list of unanswered
clues, and the card's left and right edges stepping between them.

---

## Toolbar above the board

In the flex layout the control rows below the board are replaced by one strip
above it: where you are on the left, what you can do to the puzzle on the right.

**Every item drives the button that already does the job.** Nothing here
reimplements checking, revealing or scoring — a second implementation is two
things that have to agree forever, and this codebase has met that shape more
than once.

**Mode menu** — Daily, Practice, Clubs & themes, New puzzle, Back to menu. The
label says which you are in.

**Check** — Selected word (&minus;3), Full board (&minus;9).

**Reveal** — Selected letter (&minus;2), Selected word (&minus;9), and
**Everything left**, priced at nine a word: the same as revealing them one at a
time, because it is a shortcut and not a discount. It shows the running total —
"7 answers at 9 points each: a 63 point deduction" — and asks before doing it.
Framed as a deduction rather than a hint, because it ends the puzzle and it sits
one press below two harmless items. A free substitution appears here only when
one is available.

**Clear** — practice only. A daily or a themed board can be sent as a challenge,
and wiping one is a way to lose a run somebody else is measuring against.
Revealed letters stay; nothing is scored for it.

**Cog** — opens the settings panel, which is the footer. One list rather than a
second panel that has to be kept in step with it.

There is no rebus. That is an NYT thing — a square holding more than one letter,
like HEART in a single cell — and this grid is one letter per square.

**Where it sits.** A sibling of `.grid-panel`, not a child. It started inside
and `frontend_test` caught it: that test pins the panel's child order, guarding
against a toolbar that used to be relocated at runtime. Outside the panel that
order is untouched and the strip spans the full width above both the board and
the clue list.

---

## Fixes: the footer was unreachable in flex

**Everything in the footer disappeared** — the layout switch itself, the privacy
link, sign-in, owner tools, My Season, the display toggles. v61 hid the footer
in the flex layout because the column had no room for it, which stranded all of
them, including the one control that switches back.

There is now a **more button in the top right of the header**, shown only in
flex. It slides the footer up as a panel over the board, with everything on it,
and a tap anywhere else closes it. No height is spent while it is shut.

If you are stuck in flex on a build without this fix: run
`localStorage.setItem("fcw.layout","classic")` in the console and refresh, or
clear the site data.

**Nothing has been migrated.** Flex is still opt-in and classic is still the
default for anyone who has not switched. The toggle was hidden, not removed.

---

## The clue sits against the keyboard

**It was above the controls**, which put two rows of buttons between the clue
and the thumb — near the bottom rather than at it. The whole reason for moving
the clue off the top of the screen is that the eye and the thumb should not have
to travel between reading it and typing the answer, and a control row in between
undoes most of that.

Order is now board, letter bank, game controls, help controls, message row,
clue, keyboard — in both the phone column and the wide layout.

---

## Fixed from v61

**The wide layout was missing entirely.** v61 shipped only the phone column, so
an iPad or a laptop got board, then bank, clue and controls stacked below it —
not the board-left, clues-right arrangement that was the point. Above 860px the
clue lists now sit in a scrolling panel to the right of the board, full height.
Below that width the panel goes away and the phone column takes over.

**The bank, clue and controls sat in a narrow column down the left.** They were
still capped to `--board-w`, which is the classic layout's measure — the board's
own width, so everything below lines up with it. In flex the frame is the whole
screen, so the cap left them in a column two-thirds the width, and the `margin:0`
I set had removed the auto-centring that was hiding it. They are full width now.

**The nudge row is back.** I had hidden it in the wide layout; it is where a
wrong letter is reported, and a game that stops telling you when you are wrong
is worse than one with an empty strip in it.

---

**What flex does.** The page becomes a fixed-height column — header, board
frame, letter bank, clue card, controls, keyboard. The board sits in the frame
and pans and zooms inside it, so it no longer has to fit above the keyboard.
That constraint is what forces an 18px cell on a phone; fit-to-width in the
frame gives about 39px on the same board.

**It is a whole layout, not a partial one.** Real puzzles, real scoring, save
and restore, pause, check, reveal, Full Time, challenges and themed boards all
run through it. Only the layout and the gestures differ; the puzzle state, the
typing, the timer and the API calls are shared, so the two paths cannot drift.

`fitCells()` hands over at its first line rather than running and being
ignored — a sizing function computing a cell size nothing reads is the sort of
thing that comes back later looking like a bug.

**Three ways for the board to sit**, cycled by the button bottom right of the
frame:

- **Fit board** — the whole puzzle in the frame, every white square visible
- **Follow word** — the answer you are typing into is kept framed as you move
  between clues
- **manual** — wherever you last put it. Zooming by hand drops into this, so a
  deliberate zoom is not undone by the next thing that moves the board

**Follow word fits the answer to its own axis and centres it on the other.** A
down answer fills the frame top to bottom and sits centred left to right; an
across answer fills it left to right and sits centred top to bottom. The word
being typed is always as large as it can be and always in the same place,
whichever way it runs.

The zoom therefore changes between clues — a nine-letter down entry lands at
31px cells, an eight-letter across at 47px — and moving between them visibly
rescales. That is the cost of the mode and it is also the point of it:
predictable placement in exchange for a changing zoom.

One limit, and it only bites on very short answers. Filling 393px with four
letters means 98px squares, which is wall tiles rather than a crossword, so the
cell is capped at 92px. Five letters and up fill their axis exactly; three and
four letter answers are centred at the cap.

It is deliberately not clamped to the board edges in this mode. An answer on
the top row centred vertically needs the board to hang past the frame, and
clamping it back would put the word off centre — which is the one thing the
mode exists to guarantee.

**Footer: `focus: off` / `focus: on`.** Its own switch, independent of the fit
mode and of the layout. On, everything outside the current answer is hidden and
the board becomes one entry sitting on the turf.

It costs nothing a solver uses. A crossing letter lives in a cell belonging to
BOTH entries, so it is part of the active word and never leaves the screen —
7A and 4D crossing at one square means that square is one of 7A's own cells.
What disappears is only the cells the active word does not touch, and those say
nothing about the clue in hand.

Hooked to `updateSelection()`, which every route to a new clue passes through —
stepping, the jump list, a tap on a square, auto-advance. One hook rather than
six that can drift apart.

**Gestures.** Pinch the board and only the board moves. Ctrl+scroll, or a
trackpad pinch, does the same with a pointer, anchored on the cursor. `−` and
`+` bottom left; **Fit board** bottom right, which always shows the whole
puzzle whatever the resting mode. Pinch anywhere outside the board still zooms
the page, for anyone who needs the clue text bigger.

Fit measures the rectangle the white squares occupy, not the whole grid.
Blocked squares are transparent, so rows and columns of solid block at the
edges were being fitted as though they were board.

**Hidden in flex, not deleted:** the clue lists, the season table and the
standings. The jump list on the clue label does the clue list's job without
scrolling past the board; the others are a sheet away. All return the moment
the toggle is off.

**No DOM is moved** — the column order is CSS only, which is what makes turning
it off a genuine revert rather than a rebuild. The setting persists, so a
refresh mid-puzzle does not throw you back.

**The Playwright gate still tests the classic layout only.** It can only test
one at a time, so while flex is opt-in it is covered by real use on real
devices and nothing else. That is the point of the week.

---

## The All clues heading

**It sat at the page edge while the columns it heads started hundreds of pixels
to the right** — a label pointing at nothing, on a tablet in both orientations.

`.clues` capped itself to the board width and centred; the heading took whatever
width the block around it had. Two ideas about the same column measure, and they
disagreed.

The heading is now capped and centred on exactly the same measure as the
columns, so the two cannot drift apart whatever the block does. The block itself
is a centred column too, rather than relying on a single margin rule.

Verified by the viewport suite, but layout is the one thing that cannot be
confirmed from a test runner — worth a look on the iPad in both orientations.
The harness now includes the clue list for exactly this.

---

## Fixes a crash in v58

**Tapping Practice threw `ReferenceError: inProgress is not defined`.**

`inProgress()` was declared inside `renderHome()`, and the Practice handler —
which needs it so somebody can finish a puzzle started before the mode was
suspended — is bound at load time, outside that scope. Every tap threw.

It is now declared at the top level beside the other helpers. Verified by
clicking the button in a real DOM rather than by reading the code, and the whole
file was swept for other functions used outside the scope they are defined in.
There are none.

`LAST_SHIPPED` in `deploy_check.mjs` is now `v58`, so this release is checked
against what is actually live.

**Noted, not fixed:** `kickAltBtn` is wired in `game.js` but has never existed in
the markup, including in v48. `on()` warns and skips, so nothing breaks. Worth
tidying whenever that area is next touched.

---

## A note on version numbers

My folder names and the build tags drifted apart over the last few releases —
I labelled a zip V85 while the files inside were tagged v87. Nothing you
deployed was wrong, because the tag inside the file is what the badge reads and
what `deploy_check` verifies, and those were always consistent with each other.
But the labels were not, and the deploy check compares against `LAST_SHIPPED`,
which still says `v61`.

Everything is now `v88` in all three places. **Set `LAST_SHIPPED` to `v88` after
this deploy** so the next release is checked against something true.

---

## Read this first

**V54 to V58 all shipped tagged `v50`.** The packaging step copied files from a
working folder still on v50, then ran a find-and-replace for the previous
version which matched nothing. Every deploy check passed, because all three
places agreed — they just agreed on the wrong number.

That is why the badge stayed at v50 however many times you deployed. It was the
package, not you, and not the cache.

It had a second effect worth knowing: `?v=v50` is a URL your browser genuinely
cached when v50 was live, so it could serve the old script back. If the site has
looked unchanged, that is why.

**This zip is correctly tagged v58**, and `deploy_check.mjs` now has a
twenty-fourth check that the tag has *moved*, not merely that it is consistent.
It reads `LAST_SHIPPED` at the top of that file — bump it to `v58` after this
deploy so the next release is checked against the right number.

After deploying, if the badge still reads v50: hard refresh, then try a private
window. `index.html` is served `no-store` so it should not persist, but a
service-worker-free hard refresh is the quickest way to be certain.

---

## Order

1. Copy the whole of `Deployment\` over
   `OneDrive\Documents\GitHub\crosswordxi\`.
2. `node deploy_check.mjs` — 23 checks, build tag should read **v113**.
3. `git status`, then commit and push.
4. Hard refresh. Badge must read **v113**.
5. **No migration.** Both endpoints read tables that already exist.

---

## The XI mark

**XI is now a chip — white on dark green** — wherever the name appears: the
masthead, the strapline, the footer and the privacy page. It is the mark the
whole suite shares, so it should look the same in every game.

**Colour alone could not do it.** Anything dark enough to read on light paper is
too dark to separate from the word beside it: CROSSWORD is pitch-deep, and
violet, blue and green all measured under 2:1 against it. Gold reads well
against the word and is invisible on paper, at 1.45:1. The chip decouples the
two — the letters get their own background, so the hue no longer has to survive
the paper.

The box is sized to the **cap height**, not to the em. At `line-height:1` the
content box is a full em tall while uppercase occupies about .72em of it —
roughly .13em of ascender space above the caps and .15em of descender space
below the baseline that XI never uses. That is three times the padding and it is
there before any padding is added, which is why tightening padding alone barely
moved it.

White on pitch-deep is 12.5:1, the strongest separation available, and the chip
edge reads at 11.4:1 against the paper. In dark mode it inverts to green on
white, same figure.

It also separates by shape and lightness rather than hue alone, so it holds for
a colour-blind player.

For a new game, wrap the mark in `<span class="xi">XI</span>` and it inherits.

**The harness has four alternatives on a cycle button** — gold chip, outline,
gold text, amber text — plus a toggle for pure white paper, in case the
background is what wants changing rather than the mark.

---

## The clue card

**The arrows are now the edges of the card.** Tap the left 40px for the previous
clue, the right 40px for the next. It wraps: previous from the first clue takes
you to the last. They take no width from the sentence, because they sit over the
card rather than beside it.

They are the same buttons as before, restyled — so they stay keyboard-focusable
and keep their aria-labels. A control invisible to the eye is still announced to
a screen reader.

**Not fully invisible.** A chevron sits at 22% opacity on each edge: enough to
notice by the second or third clue, quiet enough to read as part of the card
edge. It brightens on hover for anything with a pointer. If you want them truly
invisible that is one number; if this turns out to be undiscoverable, the same
number goes the other way.

**Two conflicts worth knowing were handled.** The clue label sits top left,
which is exactly where the previous zone is — the card content sits above the
zones, so the label still opens the clue list rather than stepping backwards.
And while that list is open, an edge tap closes it and does nothing else: a tap
that both dismisses a list and moves you somewhere did two things you only asked
one of.

The sentence keeps 34px clear of both edges, so a tap meant for a word does not
land on a zone.

**The clue label is now the jump control.** Tap `3A (8)` and it lists every
clue that has no answer in yet; tap one and it moves there, cursor on the first
empty square. Escape or a tap anywhere else closes it.

The label is the control because it costs no width — it was already on the card
and already named the clue, and width is what the sentence was short of. The
full clue list under the board is untouched; on a phone that is a scroll past
the whole grid, which is the friction this removes rather than duplicates.

Unanswered only. A list including what you have already filled is a list you
read past to find what you want.

**The clue number sits top left**, on its own line, with the sentence beneath at
the card's full width. It used to be inline, so the first line of every clue
began wherever the label happened to end — `3A (8)` and `11D (4,6)` started the
sentence in different places and the eye had to find it each time.

---

## Moving between clues

**Auto-advance was already there, and was firing less than it looked.**
`advanceToNextEntry()` moves to the next *unfilled* clue when a word is
finished — but it was triggered by the cursor running off the end of the word,
not by the word being complete. With skip-filled off, which is the default, the
cursor walks through cells a crossing answer already filled. So the ordinary
case — typing the fourth letter of a five where the fifth arrived from a
crossing — left you sitting on a completed word with nothing happening.

It now checks whether the entry is filled after every letter. Same behaviour,
fired reliably.

One limit worth knowing: the browser holds no answers, so this can only know
*filled*, not *correct* — a wrong word advances too. That is the usual crossword
behaviour, and the alternative is worse, because staying put on a wrong answer
would tell the player it was wrong.

**The clue arrows are now phone-only.** `Tab` and `Shift+Tab` already stepped
between clues and `Enter` already advanced — that has been in the keydown
handler all along. With a pointer there is also the full clue list on screen and
a click on any square, so on anything with a keyboard the arrows were a third
route to somewhere you could already get, taking width from the sentence.

They stay on phones, where there is no Tab key. Auto-advance now handles the
ordinary case, so they are the fallback rather than the route — worth reviewing
again once that has been used in anger.

**On phones the arrows are narrower still**, 26px rather than 44px, but the same
44px tall. That is 278px for the clue text on a 393px screen against 150px
before. The sentence has to be read; the arrows only have to be hit.

---

## Phone layout

**Everything below the masthead now takes the full screen width on phones.**

Every block was capped to `--board-w`, the board's own computed width. On a
desktop that is the point — one measure down the page rather than each element
finding its own edge. On a phone it was the opposite: a board narrower than the
screen pulled the clue card, the letter bank and the controls in with it, so a
393px screen was reading a clue in about 250px and wrapping a one-line sentence
to four lines.

Below 560px the cap comes off. The board keeps its own width, because its cells
are sized by `fitCells()` and stretching them is a different decision.

**The clue arrows were 44px wide each** — 88px of a 393px screen taken from the
sentence before any gaps. Narrowed to 30px but kept 44px tall, so the touch
target stays comfortable in the direction the thumb actually travels and still
clears the 24px minimum under WCAG 2.5.8.

Together that takes the clue text from roughly 150px to 266px on a 393px
screen. A clue that wrapped to four lines should now sit in two.

The card also gives 14px of height back to the board, since three lines is
enough.

**Worth checking on the phone that showed the problem** — and on a tablet, where
the cap still applies and nothing should have moved.

---

## Privacy policy

`privacy.html` is new, at the site root, reachable from three places:

- the footer, next to the build tag
- the landing screen, under the sign-in button
- the account sheet, directly beneath the Google sign-in button, saying what
  signing in shares

Three routes rather than one because the footer alone is where a thing goes
when nobody is meant to find it, and signing in is the one moment somebody
hands over an identity.

**No cookie banner is needed.** The Data (Use and Access) Act 2025 added an
exception, in force since 5 February 2026, for storage whose sole purpose is
remembering how a user wants a service to look — which is what the appearance
preference is. First-party analytics used solely to improve the service are
also exempt, and Cloudflare Web Analytics sets no cookies at all. You must
still say clearly what is stored and offer a free way to opt out, which the
policy does.

**One correction since V54:** the policy said attribution persists. It does
not — it is in `sessionStorage` and is cleared when the tab closes, as
`play_test.mjs` asserts. The page now says so.

**What the policy says is stored** was checked against the code rather than
assumed, and three things in the first draft were wrong. The appearance
preference is in localStorage, not a cookie, and is therefore per-origin rather
than shared across thexigames.com. Attribution persists rather than being
session-only. And there is a per-device identifier used so a challenge counts
one entry per device — which is sent to the server and is now disclosed.

The only cookie is `cxi_session`, set when you sign in.

**Still to add:** the ICO registration number, once the confirmation arrives.
Section 1 currently omits the line entirely rather than showing a placeholder.
It is a one-line edit.

**The page is standalone.** It carries its own copy of the fonts and palette
rather than loading the game's stylesheet, because a legal notice that depends
on the app's assets is one that can fail to appear. It follows the appearance
you chose in the game if you have chosen one, and never writes that setting —
opening a legal notice should not change a preference.

**Links are relative, not root-relative.** `deploy_check` enforces this and
caught the first version using `href="/"`. It is what lets the whole site run
unchanged at `crossword.thexigames.com` today and `thexigames.com/crossword`
later.

---

## Practice is now Coming soon

The Practice tile stays on the landing screen, dimmed, labelled **Coming soon**,
with the note "Being rebuilt alongside the new club boards."

Left on screen rather than removed: a track that vanishes reads as something
broken, and a track marked as coming says what is actually happening.

**Anybody already part-way through a practice puzzle can still finish it.** The
tile opens normally when there is one in progress, and the state line says so.
Stranding a half-finished board to enforce a suspension costs a real player
something to save nobody anything — and the puzzle is already on their device,
so letting them finish takes nothing off the shelf.

**Shared practice links and `/api/practice` are untouched.** A link somebody
sent still opens. This closes the front door, not the building. Say the word if
you want those closed too, but it would break links already sent.

Nothing was deleted. The 300 practice puzzles are still in the database, so
turning this back on is a markup change, not a rebuild.

---

## Board of the day leaderboard

Finish the featured board and Full Time now says where you came:

```
Board of the day: 3rd of 11 scores today
```

**Scoped to attempts started today**, not to the board's whole life. A featured
board has usually been playable for weeks before its turn comes round, so an
all-time table would be topped by somebody who played it in September and
nobody arriving today could catch them. Day-scoped makes it the same offer for
everyone — and somebody who played it weeks ago and comes back today starts
level, which is what you asked for.

**Anonymous — a rank and a count, no names.** A named table would read better,
and it is what made the challenge links work. But a challenge table is entered
by somebody who chose to type a name for a group they know; this is a public
page everybody lands on. Publishing names here by default is a wider step, and
it is waiting on the privacy policy rather than on code.

Your own attempts are excluded, same as everywhere else.

The line only appears on the featured board. Every other board is playable
whenever, so a day-scoped table on one would be comparing people who happened
to pick the same afternoon.

**It is drawn after the server verifies the score**, not on a timer, so the
rank always includes the score just posted.

---

## Per-board scores, for you

**Alt-click any board chip** in Clubs and themes. Instead of opening the board
it opens owner tools with every attempt at it: score, time, help used, and
which were yours.

Not scoped to today — this is for seeing how a board plays over its life, which
is the opposite question to the leaderboard.

**It cannot tell you who.** Plays are anonymous by design: `play_id` is random
per attempt, so two goes by one visitor are indistinguishable from two
visitors, and there is no name stored to show. This answers how a board plays —
how many finish, what they score, how much help they need. Names live in the
challenge tables, where somebody typed one on purpose.

An earlier version of this joined `results` to put a name on each row. `results`
has no `theme_key` — it keys on `puzzle_token` — so the query would have thrown,
which in a Pages function reaches the browser as an HTML error page rather than
anything readable. Dropped rather than repaired: a user who replays has two
`results` rows, so joining on token alone multiplies the play rows, and joining
on time as well is guesswork.

---

## Also fixed, from V51

The board-of-the-day override threw on any change after the first — the insert
used `ON CONFLICT ... DO UPDATE`, which worked on the first set and failed
whenever the conflict path was actually taken. Now a `DELETE` then `INSERT` in
one batch, with both routes wrapped so anything unhandled comes back as JSON
the panel can print.

---

## Worth testing

- Finish the featured board, check the rank line appears
- Finish it again — the second attempt should count and re-rank
- Alt-click a chip, check the scores panel opens
- Owner tools → Board of the day: set, **change on the same date**, clear
- Practice tile reads Coming soon; if you have one in progress, check it still opens
- Open the privacy policy from all three links, and check it renders in dark mode
- Send a test to privacy@thexigames.com and confirm it still arrives
- On a phone: clue card, letter bank and controls should reach both edges
- On a tablet: nothing should have changed
- Play a full puzzle end to end in the new layout — score, check, reveal, Full Time
- Pinch, ctrl+scroll, the +/- buttons and Fit board
- Refresh mid-puzzle: the layout and the puzzle should both survive
- Toggle back to classic and confirm nothing is left behind
- Tap the left and right edges of the clue card: previous and next, wrapping
- Check the faint chevrons are findable but not distracting
- Tap the clue number while a zone is under your thumb — the list should open
- With the list open, tap an edge: it should close, not navigate
- Tap the clue number: the list should show only unanswered clues
- Pick one: it should jump there with the cursor on the first empty square
- Answer everything but one, open the list, check it reads sensibly
- Fill a word where a crossing supplied the last letter — it should move on
