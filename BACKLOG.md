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

**Vowels XI — go or no go.** The consonant cypher is landed and playable,
hidden behind `CONSONANTS_PUBLIC = false` in `scrambled/js/config.js`. Launch
takes the flag off, a shirt number (the next free one, taken AT launch), and a
row in `tools/aligned_test.mjs`. Nothing else is blocking.

**HiLo's 274 club subtitles.** Found 4 Sep. Every live HiLo board was written
by the re-import at 10:11 that day; 274 source files under `../Other/HiLoXI`
were rewritten at 11:44, an hour later, replacing each club board's descriptive
subtitle with a bare label — board 587 went from "The year he first took
charge, caretaker spells included…" to "Manager appointed". The 89 daily boards
are untouched and match live exactly. The old wording survives in the research
side's `preview/*.html`, so it was an edit to the board JSONs, not a generator
change. Live still shows the descriptive line.

Until this is settled: do NOT apply `data/hl-production.sql` (it is regenerated
from the new sources), and `functions/_lib/hl-sample.js` is deliberately left
matching production, which makes `node tools/import_hilo.js --check` refuse on
any machine that has the bank. CI is unaffected — the runner has no bank.

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

- **What does each game's live table rank?** The crossword's ranks YOU against
  a real league season by way of your chosen club. Rolling it out to the other
  three is a straight lift if it stays that; it is a different feature if it is
  meant to rank players against each other on the board at play, which is what
  the challenge tables in item 6 do. Confirm which before building three of
  them.
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

**Gap 2 — nothing on the site links to a board page.** Zero links to
`/crossword/daily/` on the hub, on `/crossword/`, or on `/crossword/answers/`.
Google has no route in.

TWO CORRECTIONS to how this was first written up, both from checking it:

- **It is four games, not one.** All four have working board pages off a single
  module — `/crossword/daily/12`, `/scrambled/daily/12`,
  `/wordsearch/daily/2026-09-03`, `/hilo/daily/2026-09-03`, all 200, all built
  by `functions/_lib/permalink.js`. Two games count matchdays and two schedule
  by date. The sitemap generator has to handle both key shapes, and the fix is
  worth four games rather than one.
- **The answers index cannot be the whole route.** It is the natural place and
  it is good for players — someone reading yesterday's answers is one click
  from playing it — but an answers page is sealed until `ANSWERS_AFTER_DAYS`
  past a board's first day, so `/crossword/answers/` lists exactly TWO boards
  today and `/wordsearch/answers/` lists NONE. Linking from there would give
  crawlers a path to two crossword boards. The sitemap is doing the real work;
  a crawlable per-game ARCHIVE index would be the on-site path to all of them,
  and no such page exists today.

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

- **5b. Scrambled's score, server-side** — scrambled v002g, migration 029,
  4 Sep. The server owns the clock and counts the board's own slots.
- **5a. HiLo's score, server-side** — hilo v001p, migration 028, 4 Sep.
- **Archive gating** — shared v18: today and the previous seven days are free,
  older asks for an account.
- **One share row in every game** — shared v19.
