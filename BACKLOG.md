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

**STATE, 5 Sep 2026. Two of the three parts are done; one is left.**

- ✅ **The hub season.** Live. One result per DAY across the family, counted
  from finishes: two puzzles done is a win, one a draw, turning up and
  finishing none a defeat. The rule is `shared/xi-season.js` and
  `functions/_lib/season.js` imports that same file, so the account branch
  (server, `season_play`) and the device branch (the browser's own record)
  cannot give two answers about what a Tuesday was. `tools/season_test.mjs`,
  `season_store_test.mjs`, `season_device_test.mjs`.
- ✅ **The fake 38-game strip is out of the crossword** (v002y). It
  factorised one board's score into an invented W/D/L record across 38
  matches — exact arithmetic, still a fiction, and with a real season on the
  hub it was the second answer to "how am I doing". Gone from the engine, the
  in-play panel, the Full Time card and the CSS; the share picture is now ten
  squares showing how much of the 114 was kept. `headless_test.js` asserts the
  engine cannot export either function again.
- ✅ **The live table is shared, and Wordsearch has one** (ws v002j,
  SHARED_TAG v23). `shared/xi-table.js` is the one implementation and the
  crossword's engine delegates to it — `table_test.mjs` compares 840 tables
  between the two and they agree everywhere, so the ladder a crossword player
  watches did not change on the way out. The thirty seasons moved to
  `shared/xi-seasons.js`: 66KB fetched once for the whole family instead of
  per game. The club is `xi.club`, family-wide, so picking Everton in one
  game picks it in all of them.
- ✅ **Scrambled and Vowels have one** (sc v002i, vw v001d). Vowels is
  generated from Scrambled by `tools/build_vowels.js`, so it inherited the
  table from the same edit. The SEED IS THE BOARD'S TOKEN, not its number:
  the two games read one bank half a ring apart, so on any day they are
  different elevens sharing a number 12 — seeding on the number gave both the
  same historical season and made the two games feel like one. Owner spotted
  it before it shipped; `table_test.mjs` now checks fourteen days of both.
- ✅ **HiLo has one too** (v001t) — and it is the one game that CLIMBS.
  Every other board opens on 114 and loses points to the clock; HiLo banks up
  from nothing, so the ladder rises under the player instead of sinking.
  Eleven right at full value plus the run bonus is 114, which is why it
  belongs on the same ladder. It needed a `liveScore()` written first: the
  score was computed inline wherever it was wanted and existed nowhere by
  name.

**ITEM 11 IS DONE.** One season at the top level, no invented 38-game strip
anywhere, and a live league table in all five football games.

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

**WHOSE SEASON IS IT.** Owner, 5 Sep: "Per account if registered, per device
if not, unless they linked their 2 accounts with the code in settings."

That last clause resolves itself, and the resolution is worth writing down so
nobody builds a third mode for it. The device code is not an alternative to an
account — `POST /api/account/code` turns a code INTO one, `provider = 'code'`
with the code as the provider id, and `users`, `sessions` and the results pull
all work unchanged. Entering the same code on a second device makes both
devices sessions of ONE account. So "linked with the code" IS the registered
case, and the rule has two branches:

  an account   the season is the account's, from results and plays on the
               server, and it follows the player to any device they sign in on
  no account   the season is this device's, from localStorage, and it is the
               only season that device can honestly show

WHAT HAPPENS WHEN A DEVICE REGISTERS. The family already has this rule and it
is not re-invented here: first result banked wins, the account's row wins
outright on pull, unpushed local rows survive. A player with three days on a
device who then enters a code keeps those three days.

WHAT THIS COSTS TO BUILD. The hub reads five localStorage blocks today, one per
game, written out longhand — enough to dim a shirt, not enough for a season. A
season has to outlive a device, so the account branch needs the day rule applied
SERVER-side against `plays` and `results`, both already keyed per game in
`functions/_lib/games.js`. That is the new endpoint; the device branch is the
same rule applied to what the browser already has.

One fact, one place: the day rule goes in ONE module read by both the hub and
the server. It must not be written once for the page and once for the API —
and with two branches reading it, that stops being a principle and starts being
the only way the two can agree about what a Tuesday was.

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

### 14. Automated testing against the live site

**STATE, 5 Sep 2026.**

- ✅ **14a, /api/preflight.** Live. Walks the next fortnight of every game's
  schedule and answers with verdicts, never boards. `.github/workflows/
  nightly.yml` asks it at 01:10 UTC. **NEEDS ONE MANUAL STEP: set
  `PREFLIGHT_SECRET` as a Cloudflare Pages environment variable AND as a
  GitHub repository secret.** Until both exist the endpoint refuses everybody
  (by design — no secret configured is no access) and the nightly job fails
  loudly rather than passing on nothing.
- ✅ **14b, the bot's reasoning half.** `tools/bot_solve.mjs`, proved by
  `bot_solve_test.mjs` against real boards AND against production's own
  judge: 33 words located from the grid a browser is given, in 1ms, with no
  placements in the payload. The claim that no bot needs to be told anything
  is now checked rather than asserted — which is what keeps the bank out of
  CI on a public repo.
- ✅ **14b, the driver.** `tools/play_bot.mjs` plays ten sessions — complete
  and abandon, per game — signing in first and refusing to run if it cannot.
  **NEEDS TWO MANUAL STEPS: create a bot account from any game's Settings
  device code, put that code in the repository secret `XI_BOT_CODE`, then
  uncomment the `schedule` in `.github/workflows/playbot.yml`.** It is
  dispatch-only until then, so nothing runs red nightly while it waits.
- ⚠️ **The bot cannot produce a LOSS, and the spec assumed it would.**
  season_play is keyed (user_id, day, game), so the abandon session and the
  completion for the SAME game on the SAME day collapse into one row and the
  completion wins. Confirmed against production on the first run: ten sessions
  in, five rows out, all finished — the bot's day is a Win. The abandon still
  exercises the unfinished row in `plays`, which is what it was written for,
  but the season's loss condition is untouched by it. Exercising that needs a
  day on which the bot ONLY abandons — a weekly variant, or a second bot
  account that never finishes anything. Worth doing before anything is built
  on the loss branch; season_test.mjs proves the RULE, so what is missing is
  proof of the wiring, not of the arithmetic.
- ⬜ **Not yet: the cheating probes.** "Claim a score, claim a smaller board,
  replay a word, omit the CSRF header" — every one of those is already proved
  offline in the games' `verified_test.mjs` suites against the real handlers.
  Doing it again over the wire proves the deployment rather than the rule, so
  it is worth having and is not urgent.
- ⬜ **Not yet: a browser session.** The bot drives the API, which is what
  proves the wiring. Whether the PAGE plays is `journey_test`'s question and
  it still runs against `wrangler pages dev` rather than production.


Raised by the owner on 5 Sep: "can agent or automation be made to test the game
when these updates go live where the aim is to see if the game breaks".

**WHAT EXISTS AND WHAT DOES NOT.** Five `live_check.mjs` hit production but only
READ — grepped, they contain zero clicks and zero drags between them.
`journey_test` and `render_test` play, in a real browser for the second, but
against `wrangler pages dev` with sample data. CI runs on push and
pull_request; there is no schedule. So nothing plays the live site and nothing
runs unless somebody pushes.

**AND DEPLOYS ARE NOT THE MAIN RISK.** Every game serves a different board at
midnight UTC with no deploy at all. A malformed board, a hole in a schedule, a
board whose bonus is missing — none of that involves a code change and nothing
would catch it. On 5 Sep the HiLo journey went red at 00:06 because a new board
came round with a one-sentence subtitle; that was a fault in the check rather
than the board, but it is the class exactly: the site's behaviour changes daily
on its own.

**TWO QUESTIONS, AND ONLY ONE OF THEM NEEDS A BROWSER.**

*Are the upcoming boards good?* is a DATA question. Answer it where the data
already is: `/api/preflight`, gated by a shared secret, walking the next N days
of every game's schedule and applying the shape rules the importers already
enforce. **It returns verdicts, never boards** —

    { "checked": 70, "days": 14,
      "problems": [ { "game": "hilo", "day": "2026-09-12", "why": "no board" } ] }

no grid, no answer, no name. If that secret leaked, an attacker learns whether
the next fortnight is well-formed and nothing else. This is the higher-value
half — it catches a bad board BEFORE a player sees it — and it needs no browser
at all. Build it first.

*Does the game play?* is a browser question, and it is asked of TODAY's board,
because that is what a player gets.

**NO BOT NEEDS TO BE TOLD ANYTHING.** Every game can reach full time unaided:

  wordsearch    solves the grid — both halves are public and must be, the grid
                IS the puzzle and a word search shows its list. Demonstrated:
                all eleven located in milliseconds from the live payload.
  hilo          calls higher/lower; a wrong call still settles the row
  scrambled     buys a name reveal per slot
  vowels        the same
  crossword     reveal answer per entry, or a published answers page

Withholding the placements never made the board unsolvable by a machine. It
made the SERVER the judge, which is what makes the score mean something. A bot
that solves the grid and drags is a bot playing the game properly.

**TEN SESSIONS A NIGHT.** Per game: one that fouls a few times and then
completes, and one that starts and abandons. The first covers the escalation,
the reset and a clean finish in a single play; splitting them doubles the cost
for no coverage. The second is the only way to exercise an unfinished board —
and the LOSS condition of item 11. Roughly 20-40 seconds each, 5-7 minutes of
Actions time. Cheating is probed without a browser at all: claim a score, claim
a smaller board, replay a word, omit the CSRF header.

**SCORE VARIETY IS FREE; LOW SCORES ARE NOT.** Fouls and the bonus move the
score without moving the clock — 113 with the bonus, 103 clean, 100 with six
minutes of fouls, 93 with fifteen, all in twenty seconds. Reaching 71 means
five real minutes of play and reaching 0 means ten, per game. But the curve is
arithmetic and is already proven offline in milliseconds; what a live bot
uniquely proves is the WIRING — that production applies that rule to a real
play, on a clock it kept, against fouls it recorded. One play proves the
wiring; ten prove it ten times. So: the bot computes its expected score from
the SAME shared module the server uses and asserts production agrees to the
point. A slow run for the bottom of the curve is worth having weekly, not
nightly.

**THE BOT'S PLAYS MUST BE EXCLUDABLE FROM THE START.** Ten sessions a night is
~3,650 rows a year and half of them carry a real `srv_score` — the kind that
would sit in a challenge table once item 6 lands. One bot account, created by
DEVICE CODE rather than Google (no name, no email — exactly the "a code holds a
random string and some scores" case `functions/api/account/code.js` describes),
and every play signed in as it. Then excluding them is one `user_id`, forever,
in any table ever built. Decided before the first run, because retro-fitting it
means working out which historical rows were bots.

**REJECTED: giving a bot admin.** The owner asked whether bots could hold admin
so they could play future boards. Admin is not a "see future boards" flag — the
route also serves `plays.csv` and `reports.csv` (player data, exportable) and
accepts `featured-set`, `challenge-hide`, `reports/clear` and `replay-day`
(mutations). That credential in Actions secrets on a PUBLIC repo is one leak
away from the forward bank, a player-data export and write access. The
preflight endpoint above serves the same goal — knowing a future board is sound
— and gives up nothing if it leaks.

**REJECTED: several bots guessing differently to discover answers.**
Unnecessary, since every game completes unaided, and a fleet submitting wrong
guesses at volume against the rate limits is indistinguishable from an attack
on the service — the one traffic pattern worth being able to block cleanly.

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

### A shipped tag is unguarded until post_deploy catches up

Found 5 Sep 2026, the hard way. The asset-hash gate refuses changed bytes
under a tag that has not moved — but only while the tag EQUALS
`LAST_SHIPPED`. Between a tag shipping and `post_deploy` recording it, that
game's assets can be changed again under the same tag and nothing objects.

It happened to HiLo the same day: v001u shipped with the board re-import, the
next commit fixed its body margin without bumping, and `?v=v001u` went on
serving the old stylesheet from every cache that already had it. The origin
had the fix; nobody who had loaded the game that day would have seen it. The
gate was green throughout.

The window is small and the consequence is a player pinned to old bytes,
which is the exact fault the tag law exists to prevent. Options: have the
gate hash assets whenever the tag is at or ahead of `LAST_SHIPPED` and keep a
second hash for "the tag as last built", or make `post_deploy` run
automatically after every deploy so the window closes itself.

### Small

- `data/migrations/README.md` points at `data/schema.sql`, which does not exist.

- **`football/crossword/headless_test.js` cannot load and runs nowhere.** It
  `require`s `./engine.js`, `./data.json` and `./seasons.json` — three paths
  the theme move invalidated — so it throws MODULE_NOT_FOUND on the first
  line. It is not in `checks.yml`, and its `.js` extension means the roster
  gate (which collects `*_test.mjs`) cannot see it either. About 1,500 lines
  of assertions that have not run since 5 Sep. Fix the three paths and add it
  to CI under its real name, or delete it — a test nobody runs is a comment,
  and this one is worse than a comment because it looks like coverage. Found
  5 Sep while taking the 38-game strip out; its season cases were updated in
  place so the file is correct when somebody revives it.

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
- **5c. The word search's score, server-side** — wordsearch v002i, migration
  031, 5 Sep. The server judges every selection now; the board no longer
  travels with its placements and the secret no longer travels at all. Closed
  two live leaks with it: today's board was served whole by the free-play
  route, and the bonus word shipped before it was found.
- **5b. Scrambled's score, server-side** — scrambled v002g, migration 029,
  4 Sep. The server owns the clock and counts the board's own slots.
- **5a. HiLo's score, server-side** — hilo v001p, migration 028, 4 Sep.
- **Archive gating** — shared v18: today and the previous seven days are free,
  older asks for an account.
- **One share row in every game** — shared v19.
