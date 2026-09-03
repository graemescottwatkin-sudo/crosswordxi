# CLAUDE.md — The XI Games monorepo

Read this before doing anything. It is the project's law, learned the hard way;
every rule below exists because its absence cost a real release.

## What this is

A family of football-themed daily puzzle games at **thexigames.com**, targeting
eleven titles. Live: **Crossword XI** (`/crossword/`) and **Wordsearch XI**
(`/wordsearch/`). Cloudflare Pages + D1 (database `crosswordxi`) + Functions at
the repo root, shared by all games. The hub is `/index.html`; shared assets in
`shared/` (tokens, chrome). No package.json in the repo — Pages must not build.

## The tag law (non-negotiable)

- Versions: `vNNN` majors, minors walk the alphabet (`v001a` … `v001z < v002`).
- Each game's `deploy_check.mjs` holds `LAST_SHIPPED` (what is live) beside
  `LAST_SHIPPED_ASSETS` (a hash of the bytes it names). **A tag is burned the
  moment it ships, and a tag never goes backwards.** `LAST_PRESENTED` was
  retired in v001v: it tracked packages handed over, the zips have stopped, and
  a constant nothing moves is a comparison against nothing — the sentinel fault
  under another name.
- **Never change a tag or a `LAST_*` constant without saying so explicitly.**
- After every deploy: bump `LAST_SHIPPED` in BOTH gates to what is now live,
  commit, push. Skipping this widens the range the gate cannot refuse.
- A tag equal to `LAST_SHIPPED` is the RESTING state and passes: the tree is
  what is live. The gate refuses a tag that goes BACKWARDS, and the paired
  asset-hash check refuses changed bytes under a tag that has not moved —
  which is the half that carries the law. Until 3 Sep 2026 the gate demanded
  the tag be strictly ahead, so every commit after a post-deploy bump was red
  on every game, including games it never touched, and that red was expected
  and therefore unread.

## The deploy sequence

1. `rmdir /s /q node_modules` if present — **gates must run with no
   node_modules, no package.json, no .wrangler in the tree** (the gate checks).
2. `node crossword\deploy_check.mjs` → expect **0 failed**.
3. `node wordsearch\deploy_check.mjs` → expect **0 failed**.
4. `git add -A && git commit && git push`. Watch the Actions run (30+ jobs).
5. `node crossword\live_check.mjs --expect vNNN` and
   `node wordsearch\live_check.mjs --expect vNNN` — including the HEAD
   assertions (production proof of `functions/_middleware.js`).
6. `node tools\post_deploy.mjs` to see what it would record, then
   `--write` to apply it; commit "LAST_SHIPPED …", push. The script DERIVES:
   it reads the tag from the live page, recomputes each game's asset hash from
   the tree, and refuses unless the live tag equals the tree's AND that game's
   live_check passes — so a bump cannot be recorded for a deploy that never
   landed. It refuses for ALL games if any one is refused. Step 5 is still
   worth running by eye; the script runs it again as evidence, not as theatre.

A red gate is a stop, not a speed bump. If a gate fails, name the failing check
and diagnose before anything ships. Never push past a red gate.

## Reviewing a deployment (what "check the deploy" means)

- Live build tags match `origin/main`: footer `buildTag`, `js/game.js?v=` on
  both games. Game assets must match the footer; `shared/` assets carry their
  own plain `vN` lifecycle and must NOT match the game tag.
- Both live_checks pass with `--expect`.
- `results`/`plays` sanity via wrangler if relevant:
  `npx wrangler d1 execute crosswordxi --remote --command="..."`.
  **Never run a migration that is already applied** — `ALTER TABLE` is not
  idempotent. Migration state: 001–020 applied (002 was applied late, 27 Aug).
- HEAD on `/api/daily` and both `/…/answers/` answers 200, empty body, and
  `/api/*` carries `X-Robots-Tag: noindex`.

## Tests and gates — the rules of evidence

- **Every new check must be proven to FAIL before it is trusted.** Sabotage the
  thing it guards, watch it fail, restore. Six vacuous checks have been found
  in this project's history; this rule exists because of them.
  Proven by EXECUTION, not by parse — `node --check` proves a file parses, not
  that it runs; the crossword live_check's HEAD block shipped referencing a
  variable from the other game's file and crashed on first contact with
  production. And a check's name must not be broader than its behaviour — a
  check that samples one row while claiming to check all of them is the same
  fault quieter.
- **The live_check floors are a contract, not a formality.** `MIN_ASSERTIONS`
  in each `live_check.mjs` is the SECOND net under the completion guard: the
  end-of-run marker catches a crash, the floor catches a block that goes quiet
  without crashing. It is set BELOW the run's real count on purpose, by the
  number of assertions that can legitimately skip (a branch with nothing to
  refuse). So when assertions are added, REVIEW the floor rather than raising
  it by reflex — a floor set to the exact count flaps on a legitimate skip, and
  a floor left alone for five releases stops being able to refuse anything.
  Both floors drifted once already, in the release that introduced them.
- **Regexes cannot count and cannot catch rule-bugs.** Anything about SQL
  arity, merge behaviour, or ordering must EXECUTE the real code.
- Totals only from CI-shaped runs: suites run **from the repo root**, after
  `npm install -D jsdom acorn --no-save`, and node_modules removed again before
  gates. Suite roster is in `.github/workflows/checks.yml`; the gate asserts
  every `*_test.mjs` in `crossword/`, `wordsearch/`, `tools/` is named there.
- `tools/aligned_test.mjs` is the cross-game contract. **A new game is a row in
  its GAMES table** (dir, team-sheet name, storage prefix); its failures are
  the integration checklist. Run it first when integrating a game.
- Browser suites (`render_test`, `journey_test`, `signin_test`) run in the CI
  render job, not offline. `render_test` needs
  `BASE=http://127.0.0.1:8788/crossword/` against `wrangler pages dev`.

## One fact, one place (the project's core principle)

Every major bug traced to a value computed or stored twice that drifted.
Where facts live — extend these, never copy them:

- Games list + entry keys + `played_on`: `functions/_lib/games.js`
  (`daily:N` / `ws:YYYY-MM-DD`; a new game adds a prefix, never a column;
  game-specific facts go in `results.detail` as JSON).
- Daily key composition: `dailyKey()` in `functions/_lib/daily.js`, beside
  `ANSWERS_AFTER_DAYS` (the ONE answers window — never restate the number).
- CSRF: `csrfOk`/`CSRF_HEADER` in `functions/_lib/auth.js` (`X-XI-Games`;
  legacy `X-Crossword-XI` accepted).
- Palette: `shared/xi-tokens.css`. Chrome (bar/drawer/footer + squad list):
  `shared/xi-chrome.{css,js}`. Games must not define `.xic-` rules or restate
  tokens — the gates check.
- localStorage: each game under its own prefix (`fcw.` / `xiws.`); family-wide
  facts under `xi.` (e.g. `xi.theme`). Never write another game's prefix.
- Merge rule (both games): **first result banked wins; the account's row wins
  outright on pull; unpushed local rows survive.**
- Account sync failures: log via `accountNote()`, stay caught, never surface
  to the player. A transient session failure is NOT signed-out.

## Shirt numbers

- A game takes the **next free number when it LAUNCHES**. Only a launched
  game holds a number; a game that is in build, on the drawing board or in
  testing does not, and moves down when a game ships past it. HiLo XI went
  out on 10 (its build brief said so), was renumbered to 9, and is 4 — the
  fourth game to launch — from 3 Sep 2026. Launched games are 1 to 4 and the
  rest queue behind them.
- The reorder is cheap and stays cheap: the number lives in the squad list in
  `shared/xi-chrome.js`, and the hub carries the strip, the card, the kit
  colour and the played-today check. Nothing else may hold a shirt number.
- Kit colours follow the GAME, not the number — `--kit-NN` is defined for the
  number a game actually wears.

## Content and safety rules

- **An unreleased game is named NOWHERE in served markup** (HTML comments
  exempt). Enforced by `chrome_test`, `aligned_test` and both live_checks.
  Unbuilt games appear only as shirt numbers + status.
- **The banks are secret.** `bank.json`, `ws-production.sql`, daily SQL files
  are gitignored and live OUTSIDE the repo
  (`..\crosswordxi-source`, `..\wordsearchxi-source`). Never commit them,
  never print answers into anything that ships. The D1 database is the only
  authoritative copy of the crossword bank — treat it accordingly.
- Answers pages: sealed until `ANSWERS_AFTER_DAYS` past a board's FIRST
  scheduled day; sealed/unknown/malformed ids get one identical 404
  (no-store, noindex, zero content).
- Date/time: the SERVER decides what day it is, in UTC. Never compute a date
  client-side and send it up.

## Working style

- Root cause before solution: name the failure pattern, then fix it.
- Findings over vibes: five specific findings beat a general assessment.
- Honest failure reports — including when a check turns out vacuous.
- The repo may live at different paths per machine (OneDrive on one, `C:\Users\graem\repos\` on another); never hardcode either — resolve from the repo root.
- OneDrive hosts the repo: transient file locks happen; retry before diagnosing.
- Real-device checks (iPhone/iPad rotation) find bugs suites cannot; treat
  them as real.

## Known open items (do not "fix" without asking)

- Legal review: ON HOLD by owner decision.
- In-progress board sync: SHIPPED and confirmed on two devices (v001u).
- `preview_test` exits 0 with no preview (on record; fix or delete, not exempt).
