# Crossword XI — deployment repository

**Crossword XI — The Football Crossword**, by The XI Games. Part of the
XI Games suite alongside Scrambled XI and Missing XI.

> **Status: complete and ready to upload.** The game, the API, the database
> schema and the tooling are all here and tested together — 441 checks across
> six suites. It runs as soon as you commit it, using the small development
> dataset, and switches to your real clue bank once you finish step F.

---

## A. What changed, and why

Until now the whole game was one `index.html` with all 2,948 clues and answers
inside it. Anyone could open the page source and read every answer, including
every future daily.

This version moves the bank to a private database. The browser is sent **one
puzzle at a time, with no answers in it** — just the grid shape and the clues.
Checking an answer and revealing a letter are now questions the browser asks the
server.

---

## B. Repository structure

```text
/
├── index.html              the game page
├── css/style.css
├── js/                     game code (public — code is not data)
├── functions/
│   ├── api/                the endpoints below
│   └── _lib/               server-only: database, answer stripping, sample data
├── data/
│   └── schema.sql          the database structure
├── tools/                  scripts you run on your own machine
├── functions_test.mjs, d1_test.mjs, frontend_test.mjs
├── _headers, robots.txt, 404.html
└── README.md
```

`index.html` and `functions/` are both at the root, which is what Cloudflare
Pages expects.

---

## C. Cloudflare Pages setup

| Setting | Value |
|---|---|
| Framework preset | None |
| Production branch | `main` |
| Build command | *(leave blank)* |
| Build output directory | `.` |

Pages picks up `functions/` automatically. There is no build step.

---

## D. The endpoints

| Endpoint | What it does |
|---|---|
| `GET /api/daily` | Today's puzzle. The **server** decides what day it is, so changing your device clock cannot open a future one. |
| `GET /api/practice` | A practice puzzle, chosen server-side from the pool. Optional `?category=`. |
| `GET /api/categories` | The topic filters practice mode can use. |
| `POST /api/check-answer` | Send a guess, get back `{ correct: true/false }` and which positions are wrong. |
| `POST /api/reveal` | Returns **one letter**, or one answer, only when the player has explicitly asked and paid for it. |

None of these ever return the clue bank, and none return an answer that has not
been explicitly requested.

---

## E. The D1 binding

The database binding must be named exactly:

```text
DB
```

There are no passwords or keys anywhere in this repository. Cloudflare connects
the database to the code by that name — nothing is hard-coded.

---

## F. Setting up the database — do this once

**Step 1 — install the Cloudflare tool.** In a terminal, in this folder:

```bash
npm install -g wrangler
npx wrangler login
```

A browser window opens; sign in to Cloudflare and approve.

**Step 2 — create the database.**

```bash
npx wrangler d1 create crosswordxi
```

It prints a block of text containing a `database_id`. Keep it for step 4.

**Step 3 — create the tables.**

```bash
npx wrangler d1 execute crosswordxi --remote --file=data/schema.sql
```

**Step 4 — connect the database to the site.** In the Cloudflare dashboard:

1. **Workers & Pages** → your Crossword XI project
2. **Settings** → **Bindings** → **Add** → **D1 database**
3. Variable name: `DB` (exactly this)
4. Database: `crosswordxi`
5. Save, then **Deployments** → **Retry deployment** so the binding takes effect

*This is the only step that must be done by hand in the dashboard.*

Until this step is done the site runs on `functions/_lib/sample-puzzles.js` — a
handful of puzzles, kept under `functions/` on purpose so it can never be
fetched as a public file the way anything in `data/` can.

**Step 5 — load your clues and puzzles.** These come from the project archive
(the folder with `data.json` and `engine.js`), which is **deliberately not in
this repository** — that is the whole point.

```bash
node tools/import_clues.js  --source ../crosswordxi-source
node tools/build_puzzles.js --source ../crosswordxi-source --days 365 --practice 500

npx wrangler d1 execute crosswordxi --remote --file=data/clues-production.sql
npx wrangler d1 execute crosswordxi --remote --file=data/puzzles-production.sql
```

Both generated `.sql` files contain answers and are already listed in
`.gitignore`. **Never commit them** — git keeps files in its history even after
you delete them.

Re-run step 5 whenever the clue bank changes.

---

## G. Why puzzles are pre-generated

Laying out a crossword takes about 900 milliseconds of processing and thirty
attempts. Cloudflare's free plan allows **10 milliseconds** per request. Doing
it live would be roughly a hundred times over budget, and slow for the player
even on a paid plan.

So `tools/build_puzzles.js` generates a year of dailies and a pool of practice
puzzles on your machine, and the site just looks one up. Serving a puzzle is a
single database read.

---

## H. Testing

```bash
npm install jsdom          # once, for the frontend suite

node functions_test.mjs    # 30 — the API contract
node d1_test.mjs           # 16 — database semantics against production row ids
node frontend_test.mjs     # 39 — the real game against the real API, and layout
node viewport_test.mjs     # 11 — overflow, keyboard fit, breakpoint cascade
node deploy_check.mjs      # 13 — the pre-upload checklist
```

`functions_test.mjs` checks puzzles come back playable, no cell carries a
solution letter, no entry carries answer text, a future daily is refused and bad
input is rejected.

`d1_test.mjs` runs against a stub database that reproduces production insert
order — daily rows first — because that is the only way to catch a token that
works against sample data and fails once deployed.

`frontend_test.mjs` serves the site and the real Functions over HTTP, loads the
page, plays it, and asserts the clue bank is nowhere in the browser.

The engine's own 330 logic tests live in the project archive with `engine.js`.

**The whole site locally:**

```bash
npx wrangler pages dev .
```

Open the address it prints. This runs the real Functions, so the API behaves as
it will in production.

---

## I. What is actually protected

- the **2,948-clue bank never leaves the server** — the browser receives one
  puzzle at a time, with no solution letters in it
- **future dailies are never sent**, and `/api/reveal` and `/api/check-answer`
  refuse any daily token that is not today's
- **answers arrive one at a time, only when explicitly requested** and paid for
- everything the browser is told about correctness is a verdict, not a letter

An earlier draft also sent a salted hash of each answer so the browser could
judge itself. Those are gone. With every check going to the server they bought
nothing, and short football answers from a known domain are exactly the case
where an offline hash attack is cheap.

**Scoring is still client-side.** Someone editing their own browser can award
themselves points. Fixing that needs accounts and a server-side game session,
which is a much larger change for a puzzle with no login — worth doing only if
you ever add a shared leaderboard.

## I2. Seeing a build without deploying it

```bash
node tools/build_preview.js
```

Writes `crosswordxi-preview-<build>.html` one level up: one file, everything
inlined, with the API answered from the development puzzles. Open it in any
browser on any device — no server, no deploy, no Cloudflare.

**Never upload a preview.** The shim has to answer `check-answer` and `reveal`,
so the answers are inside the file — exactly what moving the bank to D1 removed.
It carries a red banner and a `noindex` tag, it is gitignored, and
`deploy_check.mjs` fails if one is ever found in the package.

Two things differ from the deployed site: puzzles come from the handful of
development samples rather than D1, and the fonts still load from Google, so it
looks slightly different offline. Layout, CSS and game code are identical.

## I3. Turning on accounts (optional)

Accounts are **off until you configure them**, and the game works without them.
A guest plays the daily, practice, picks a club and keeps a local streak. What
an account adds is the same player across devices.

There are **no passwords anywhere** in this project. Identity comes from Google,
verified server-side against Google's public keys.

**Step 1 — get a Google client ID.** In the Google Cloud console: create a
project → APIs & Services → Credentials → Create credentials → OAuth client ID →
Web application. Under *Authorised JavaScript origins* add:

```text
https://crossword.thexigames.com
```

Copy the client ID (it ends `.apps.googleusercontent.com`).

**Step 2 — tell Cloudflare.** Workers & Pages → your project → Settings →
Variables → add:

```text
GOOGLE_CLIENT_ID = <the client ID>
```

It is not a secret — the browser needs it — but it lives in Cloudflare rather
than the repository so it can differ between environments.

**Step 3 — create the account tables.**

```bash
npx wrangler d1 execute crosswordxi --remote --file=data/schema.sql
```

⚠️ `schema.sql` drops and recreates every table, including `users`. Fine before
launch; once real people have accounts, run only the new `CREATE TABLE`
statements instead.

**Step 4 — check it.** The footer says *sign in*. Signing in should show your
name, and any daily results already on that device move to the account.

### What is deliberately not built yet

Phase 1 is the foundation only. Apple sign-in, email links, streaks and
statistics from the server, and leaderboards are Phases 2–5 in the requirements
doc. The `results` table exists now so guest history has somewhere to go and the
shape is settled before anything depends on it.

**On leaderboards:** scoring is still done in the browser, so a submitted score
cannot be trusted. `results` records the *actions* a score was made of — times,
checks, reveals — so the server can recompute one later without rebuilding the
account system. Do not open a public leaderboard until that recomputation is in
place.

## J. Checking what is live

Tap the gold badge in the top-right corner. It opens a panel showing the build,
whether the puzzles are coming from D1 or the development samples, the clue and
puzzle counts, how many dailies remain, and whether sign-in is configured.

`/api/status` returns the same as JSON if you prefer a URL.

**The badge alone was not enough.** It tells you which frontend is running; it
cannot tell you the database never got bound — and a site serving three
development samples looks exactly like one serving a full clue bank.

## J2. Checking which build is live

Every release tags its asset URLs (`css/style.css?v=v06g`) and prints the build
to the console. Three ways to confirm what is actually being served:

- the footer shows the build tag
- the browser console logs `Crossword XI build v06g` on load
- `window.CROSSWORDXI_BUILD` in the console returns it

**If the footer tag is not the build you just uploaded, the deploy has not
landed — not the layout.** Before this was added, `index.html` revalidated but
`css/` and `js/` had no cache rule, so browsers kept serving stale stylesheets
after a deploy and the site looked unchanged however many times it was
re-uploaded.

**Bump the tag in `index.html` on every release.** Four places: the stylesheet
link, the three script tags, and `var BUILD` in `js/game.js`. `deploy_check.mjs`
fails if they disagree.

## J2. Known limits

- **Era filters are gone from practice.** Pools are built per topic, so era is
  not something the server can filter on, and a control that silently does
  nothing is worse than none. They can return when pools are built per era too.
- **Practice topics are one at a time**, because `/api/practice` takes a single
  category. Multi-select would need pools per combination.
- **Re-run step 5 whenever the clue bank changes**, or the site keeps serving
  puzzles built from the old bank.
- **The layout is verified structurally, not visually.** There is no browser in
  the build environment, so the tests prove the DOM order, the column rules and
  that nothing can force horizontal overflow — they cannot judge how it looks.
  Worth your eye at tablet portrait, where the clue columns stack.
