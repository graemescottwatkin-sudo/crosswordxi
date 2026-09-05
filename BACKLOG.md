# Backlog — The XI Games

What is queued, what is waiting on the owner, and what is done. One list, in
the repo, because a queue that lives in a chat session dies with it.

Rules of this file: an item says what it is, why, and what is UNDECIDED. An
open question written down is worth more than a plan built on a guess. Move an
item to **Shipped** with its tag when it lands; delete nothing.

THE NUMBERS ARE THE ORDER THINGS WERE ADDED, not an order to do them in, and
they never change. Item 5 was "move the scoring server-side" and 5a, 5b and 5c
were its three games. The gaps are the shipped ones. A number that moves is a
reference that rots — a commit message or a note saying "item 9" has to still
mean item 9 next month — so they are left alone and the list is reordered by
moving the items, not by renumbering them.

---

## Waiting on the owner

Nothing. Every open question has been answered — the last was where the source
press counts get read, and the answer was a table and a query until the admin
panel (item 9) has somewhere to show them.

---

## Queued

### 11. One season, at the top level — and a live table in each game

**There is ONE season and it belongs to the hub.** Decided 4 Sep, correcting an
earlier reading of this item: a game does not have a season of its own.

**The 38-match strip comes out of every game.** Today the crossword turns one
board's score into a fake 38-game record — 114 points is 38 matches at 3 a win,
so any score resolves to a unique W/D/L split (`seasonRecord` /
`seasonFromActions` in `football/crossword/js/engine.js`, the `#seasonPanel` strip in
`football/crossword/index.html`, and about twenty other references). All of it goes. The
word search already refused to do this and left the reason in a comment beside
its share text — "v4.3 factorised one board's score into a fake 38-game strip;
that is the fault Crossword's season rules retire, not a convention to keep."
Scrambled and HiLo never had one.

**What each game keeps instead is a live table for the board at play.** The
crossword already has it: pick your club and the board's running score moves
you up and down a real league table while you play (`#tablePanel`,
`renderLeagueRows`). That is the per-game view, and it wants rolling out to the
other three.

**What is new is one result a DAY, across the family, on the hub:**

| the day | result |
|---|---|
| finished 2 or more puzzles | **Win** |
| finished exactly 1 | **Draw** |
| started a puzzle and did not finish it, with none finished | **Loss** |
| started nothing | no fixture |

At most one win a day. Finishing one and abandoning another is still a Draw,
not a Loss — an unfinished puzzle only counts against a day with nothing
completed.

What has to be decided before this is built:

- ~~What does each game's live table rank?~~ **ANSWERED 4 Sep: it is all
  personal.** Every game scores a board out of 114, and that score gives the
  player a table position in a random season, from that one game. Nobody is
  ranked against anybody. So it is the crossword's existing mechanism lifted
  into the other four, not the challenge tables of item 6 — those stay their
  own thing. The hub is where the season lives, and the season is the daily
  W/D/L below.
- **When does a day settle?** A loss cannot be known until the day is over, so
  the result is provisional while the day runs and final at midnight UTC. The
  server decides what day it is (project law); nothing about this may be
  computed on the device.
- **What counts as started, and as finished?** The honest sources already exist
  — a play row is a start, a result row is a finish, and both are keyed per
  game in `functions/_lib/games.js`. Signed-out players have only their own
  device, so a signed-out day can only ever be that device's day.
- **Out of how many?** Four games are live, so "2 or more" is 2 of 4 today and
  2 of 5 the day a fifth launches. The rule as written does not change when a
  game launches, which is probably right, but it does get easier.

**BEFORE THERE IS A SEASON, THE HUB INVITES ONE.** Owner, 5 Sep: "there should
be a message to play your 1st game to start your season."

A player with no results has no season, and the honest empty state is not a
blank strip or a row of zeros — it is the sentence that says what starting one
takes. The season BEGINS with the first game played, so the hub says so, and
the invitation is gone the moment there is anything to show.

Three states, and the middle one is the one that is easy to forget:

  nothing played ever      "Play your first game to start your season."
  played today, no result   the day is in flight — provisional, not a fixture
                            yet, because a loss cannot be known until the day
                            is over
  a settled day or more     the season, as W/D/L

The second is why this cannot be "do they have any results": a player who
started a puzzle an hour ago has a season under way and no settled day in it,
and telling them to start one would be wrong. The invitation is for a player
with no PLAY, not for one with no result.

One fact, one place: the day rule goes in ONE module read by both the hub and
the server. It must not be written once for the page and once for the API.

**THE TWO HALVES SPLIT BY THEME, and that decides where each one lives.**
Recorded 4 Sep, when the owner said other themes are coming — Friends, Game of
Thrones — and that they will drop the 114 scoring for something more
appropriate. XI is a triple meaning and none of them is football: eleven clues,
eleven games, eleven players to a team.

- The HUB SEASON counts finishes, not points: two puzzles done is a win, one a
  draw. Nothing in that rule knows what a puzzle scores out of, so it works
  whatever a Friends crossword is marked on. It is the family-wide half.
- The PER-GAME LIVE TABLE does not. It is 114 = 38 matches at 3 points a win
  (`MAX_SCORE: 114` and `SEASON_GAMES: 38`, both in `football/crossword/js/engine.js`),
  and it puts the player in a real league season by way of their chosen club. A
  Friends crossword cannot have a position in the Premier League table.

So the live table is a FOOTBALL-THEME feature, not a family-wide one, and it
should be built as one — rolled out to the four football games and not assumed
of whatever comes next. The half that spans themes is the half that does not
depend on scoring, which is a good sign it is the right half to make universal.

### 5c. The word search's score, server-side — and two live leaks it closes

The last of the four. Its loop has to be inverted: the page is shipped
`answers` with full coordinates and judges every drag itself, so the server
never learns what the player found and NO word search score can be verified as
things stand. The client must send the selection and the server say what it
hit.

TWO THINGS ARE LIVE NOW, both confirmed against production on 4 Sep, and
neither is patchable on its own because the page needs the placements to judge:

- **Today's daily board is served whole by the free-play route.**
  `/api/wordsearch/puzzle?id=<today's id>` returns all eleven answers with
  exact coordinates, to anyone. `released()` passes any board first scheduled
  today or earlier, and the archive gate sees `daysBack = 0`. So withholding
  placements from `/api/wordsearch/daily` alone would be theatre.
- **The secret bonus word ships before it is found.** The ★ the player is meant
  to deduce from a clue rides down as `bonus.display` in the daily payload
  every player loads. The page simply does not draw it until full time; it is
  readable in the network tab.

The work, in order:

1. Today's daily is not served whole anywhere else: out of the free-play
   catalogue, and `/puzzle` refuses its id with the same identical 404 an
   unreleased board gets.
2. The daily ships the grid and the word list, not the placements — and not the
   bonus word until it is found.
3. `round` / `find` / `finish`, with `ws_round` + `ws_find` (migration 030 or
   whatever is free by then). The server judges each selection, times it, and
   prices the fouls; the daily has no help cards, so time, fouls and the bonus
   are the whole score.
4. The page sends the selection and draws what comes back.

THE PRICE, worth deciding with eyes open: every find becomes a round trip, so
the daily stops being playable offline. Free Play is unaffected — it keeps its
whole board and its four help cards, and it is not scored competitively.

### 12. The board permalink pages are orphaned

The pages themselves are right and nothing about them needs fixing: each board
has a unique dated title, a unique description and a self-referencing
canonical; unreleased and future boards 404 rather than serving a thin page;
and `/football/wordsearch/daily` canonicalises to its dated URL instead of competing
with it. They simply cannot earn anything, because nothing points at them.

Both gaps verified against production, 4 Sep:

**Gap 1 — no board is in the sitemap.** `sitemap.xml` carries the same 12 URLs
it had before the board pages shipped, and not one of them is a board. It has
to be GENERATED rather than hand-kept, because a new board appears every day:
a build step that writes it from the released boards, or a Function that serves
it. Either way it must exclude unreleased and future boards, which is the rule
the pages already keep — so it reads that rule from `permalink.js` rather than
restating it.

**Gap 2 — almost nothing on the site links to a board page.** CORRECTED 4 Sep:
the first write-up of this said "zero links anywhere", and so did my own check,
because neither of us looked at an answers DETAIL page. `/football/crossword/answers/1`
and `/football/crossword/answers/2` each link the board they are about — the crossword's
live_check has an assertion for it. Everything else is bare: zero on the hub,
on `/football/crossword/`, on `/football/crossword/answers/`, on `/football/crossword/clubs/`, on a club
page, on `/football/hilo/clubs/` and on `/football/wordsearch/answers/`.

So a crawl path exists and reaches exactly TWO boards, because an answers page
is sealed until `ANSWERS_AFTER_DAYS` past a board's first day and only two are
published. It is the shape of the fix, at 2 boards out of hundreds.

TWO CORRECTIONS to how this was first written up, both from checking it:

- **It is four games, not one.** All four have working board pages off a single
  module — `/football/crossword/daily/12`, `/football/scrambled/daily/12`,
  `/football/wordsearch/daily/2026-09-03`, `/football/hilo/daily/2026-09-03`, all 200, all built
  by `functions/_lib/permalink.js`. Two games count matchdays and two schedule
  by date. The sitemap generator has to handle both key shapes, and the fix is
  worth four games rather than one.
- **The answers pages cannot be the whole route, and already are the route.**
  A detail page already links its board; the index does not, and the word
  search's answers index lists nothing at all. But an answers page is sealed
  until `ANSWERS_AFTER_DAYS` past a board's first day, so this path can never
  reach more than the published few however it is wired. The sitemap is doing
  the real work; a crawlable per-game ARCHIVE index would be the on-site path
  to all of them, and no such page exists today.

**Graeme's call, not mine: where the board links sit.** Whether the answers
index gets a "play this board" link beside each entry, whether a crawlable
archive page is added per game, or both.

Verify after:

```
curl -s https://www.thexigames.com/sitemap.xml | grep -c "/daily/"
curl -s https://www.thexigames.com/football/crossword/answers/ | grep -c 'football/crossword/daily/'
```

Both should be greater than zero, and the first should equal the number of
released boards across the four games.

### 6. Challenge tables, switched on per game

As each game's score becomes the server's. HiLo and Scrambled now write
`plays.srv_score`, which is what every challenge endpoint already reads.

### 9. A universal admin panel

### 10. The shared sheet/calendar CSS lift

Debt recorded in `football/scrambled/css/style.css`.

### A suite can fail at UTC midnight, and did

Found 5 Sep 2026 at 00:06 UTC, while the theme move was being checked. Two
suites went red on a tree that had changed nothing about them.

`football/crossword/save_test.mjs` fixes its day number ONCE, at module load,
from `Date.now()`; the page under test asks the SERVER, which computes it later
in the run. Across midnight those two disagree by one, the seeded save no
longer matches the board that loads, and the menu shows nothing. It failed
three times running at 23:5x-00:0x and passed again at 00:06 with both sides on
the same day. CI has never caught it because a run has to straddle the
boundary — which it will, eventually, and then it will look like a real fault
in the save code.

The fix is for the suite to take ONE reading of the day and hand it to both
sides, rather than each asking separately. Not done here: it wants a careful
look at how many suites do the same thing, and it should not ride along with a
URL migration.

Worth checking at the same time: any suite that computes a day, a board number
or a schedule position independently of the server it is testing.

### Small

- `data/migrations/README.md` points at `data/schema.sql`, which does not exist.

---

## Shipped

- **13. The theme segment in the URL** — 5 Sep, every game moved to
  /football/<game>/, old paths 301'd with their tails, /football/ 302 to the
  hub. Where a game lives is gamePath/gameDir in permalink.js and nowhere else.
- **Sources behind a register wall** — crossword v002w, migration 030, 4 Sep.
  Needs an account, fifty a day, counted per account per UTC day.
- **Vowels XI launched** — shirt 5, `/football/vowels/`, 4 Sep. The same eleven names
  and the same bank as Scrambled, with the letters left in their own order and
  the vowels taken out. Its page, stylesheet and script are GENERATED from
  Scrambled's by `tools/build_vowels.js`, gated by `--check`, because two
  hand-maintained copies of one engine is the fault this project has paid for
  most. QuickFire moved to 6: a game in testing does not hold a shirt.
- **Sources behind a register wall** — crossword v002w, migration 030, 4 Sep.
- **HiLo's club boards, re-imported** — hilo v001q and v001r, 4 Sep. The owner
  shortened all 274 club subtitles and took the as-at date out of them, so the
  club page now carries the date once at the top and one rule per family; the
  importer refuses a club board with no `trueAsOf`; a row is a set of boards
  rather than one board, so no label is written twice; and the server stopped
  printing a row's source quote when that quote is a slice of JSON, which it is
  for every board sourced from the league's data endpoint.
- **5b. Scrambled's score, server-side** — scrambled v002g, migration 029,
  4 Sep. The server owns the clock and counts the board's own slots.
- **5a. HiLo's score, server-side** — hilo v001p, migration 028, 4 Sep.
- **Archive gating** — shared v18: today and the previous seven days are free,
  older asks for an account.
- **One share row in every game** — shared v19.
