# Backlog — The XI Games

What is queued, what is waiting on the owner, and what is done. One list, in
the repo, because a queue that lives in a chat session dies with it.

Rules of this file: an item says what it is, why, and what is UNDECIDED. An
open question written down is worth more than a plan built on a guess. Move an
item to **Shipped** with its tag when it lands; delete nothing.

---

## Waiting on the owner

**Sources behind a register wall.** Sources are shown; the ask is to hide them
behind a "Need to register" button and to be able to see who presses one and
how often — sharing sources is fine, mass-scraping by one account is not.
Three answers needed:

- Any sources at all without an account? (recommended: no)
- A daily cap per account? (recommended: 50)
- Where do the numbers get read — a table plus a query, or a page?

Needs a migration (next free number is 030) and changes the citations feature
that shipped 3 Sep.

---

## Queued

### 11. One season, at the top level — and a live table in each game

**There is ONE season and it belongs to the hub.** Decided 4 Sep, correcting an
earlier reading of this item: a game does not have a season of its own.

**The 38-match strip comes out of every game.** Today the crossword turns one
board's score into a fake 38-game record — 114 points is 38 matches at 3 a win,
so any score resolves to a unique W/D/L split (`seasonRecord` /
`seasonFromActions` in `crossword/js/engine.js`, the `#seasonPanel` strip in
`crossword/index.html`, and about twenty other references). All of it goes. The
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
  (`MAX_SCORE: 114` and `SEASON_GAMES: 38`, both in `crossword/js/engine.js`),
  and it puts the player in a real league season by way of their chosen club. A
  Friends crossword cannot have a position in the Premier League table.

So the live table is a FOOTBALL-THEME feature, not a family-wide one, and it
should be built as one — rolled out to the four football games and not assumed
of whatever comes next. The half that spans themes is the half that does not
depend on scoring, which is a good sign it is the right half to make universal.

### 13. A theme segment in the URL — /football/crossword/daily/1

Raised by the owner on 4 Sep: other kinds of quiz are coming, so should the
path carry the theme? Recommended YES, and the argument is TIMING rather than
shape.

**The window is open and closing.** Board permalinks shipped 3 Sep. The sitemap
listed no boards at all until 4 Sep, and the whole site has two on-site links
to any board page. So there is essentially nothing indexed to invalidate.
Restructuring now costs nothing in search; in three months it costs a redirect
map over hundreds of URLs and a re-crawl. It gets more expensive every day.

**Cost in code, measured:** 20 `_headers` blocks, 18 hard-coded links in served
HTML, 24 references in `shared/`, 10 files under `functions/_lib`, 6
canonicals. Mechanical, and every one of them is already covered by a check
that would go red if it were missed.

**Theme first, not game first.** `/football/crossword/` groups by what a
visitor came for, and gives each theme a landing page and a sitemap section
that match search intent. `/crossword/football/` would treat themes as content
inside products, which is the weaker read now that the theme carries real
BEHAVIOUR — see item 11: the scoring and the league table are football's, not
the family's.

Two conditions:

- Move football on the same day. A flagship left at `/crossword/` while new
  themes sit under a theme segment is two conventions kept forever.
- 301 the old paths permanently. The permalinks promise one URL, one puzzle,
  forever; a 301 keeps that promise and a 404 breaks it.

**REJECTED: `/1/daily/1`, the shirt number as the path.** A shirt number is not
a stable identifier — this project's have moved three times. CLAUDE.md records
"HiLo XI went out on 10, was renumbered to 9, and is 4", and QuickFire moved
from 5 to 6 on 4 Sep when Vowels launched. Putting a reassignable number in the
path reintroduces, one level up, the exact fault `permalink.js` exists to end:
"a link posted on the 3rd pointed at a different puzzle by the 10th". It is
also unreadable (two numbers meaning different things), gives search no words,
and has no room for the theme that prompted the question. A shirt number's home
is the strip on the hub, which is precisely why reordering it is cheap.

Do it as its own piece of work: it touches every game, so it wants its own
gates and its own deploy rather than riding along with something else.

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
and `/wordsearch/daily` canonicalises to its dated URL instead of competing
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
because neither of us looked at an answers DETAIL page. `/crossword/answers/1`
and `/crossword/answers/2` each link the board they are about — the crossword's
live_check has an assertion for it. Everything else is bare: zero on the hub,
on `/crossword/`, on `/crossword/answers/`, on `/crossword/clubs/`, on a club
page, on `/hilo/clubs/` and on `/wordsearch/answers/`.

So a crawl path exists and reaches exactly TWO boards, because an answers page
is sealed until `ANSWERS_AFTER_DAYS` past a board's first day and only two are
published. It is the shape of the fix, at 2 boards out of hundreds.

TWO CORRECTIONS to how this was first written up, both from checking it:

- **It is four games, not one.** All four have working board pages off a single
  module — `/crossword/daily/12`, `/scrambled/daily/12`,
  `/wordsearch/daily/2026-09-03`, `/hilo/daily/2026-09-03`, all 200, all built
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
curl -s https://www.thexigames.com/crossword/answers/ | grep -c 'crossword/daily/'
```

Both should be greater than zero, and the first should equal the number of
released boards across the four games.

### 6. Challenge tables, switched on per game

As each game's score becomes the server's. HiLo and Scrambled now write
`plays.srv_score`, which is what every challenge endpoint already reads.

### 9. A universal admin panel

### 10. The shared sheet/calendar CSS lift

Debt recorded in `scrambled/css/style.css`.

### Small

- `data/migrations/README.md` points at `data/schema.sql`, which does not exist.

---

## Shipped

- **Vowels XI launched** — shirt 5, `/vowels/`, 4 Sep. The same eleven names
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
