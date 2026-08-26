# V150 — run me

Six files over a v149 tree. **Build tag is bumped to v150 already; you do not
need to edit it.** `deploy_check.mjs` is included with `LAST_SHIPPED = "v149"`
already set, so that step is done too.

```
js/game.js                       overwrite
index.html                       overwrite   (build tag only)
record_test.mjs                  overwrite
deploy_check.mjs                 overwrite   (LAST_SHIPPED -> v149)
.github/workflows/checks.yml     overwrite
live_check.mjs                   new, repo root
```

**Gate 31/31 (`now v150, live v149`). 501 assertions across thirteen suites**,
record_test at 27.

```
npm install jsdom acorn --no-save
node deploy_check.mjs
node record_test.mjs
```

Install both packages in one command. There is no `package.json` in the repo,
so npm walks up to `C:\Users\graem\package.json` and reconciles against it —
installing one name prunes the other.

---

## The clock and the score came from different places

`/api/finish` returns `elapsedSeconds` — the same figure it writes to
`plays.srv_elapsed_secs`. The browser received it and threw it away.
`recordDaily` and `recordThemed` both stored `elapsedSeconds: elapsed`, their
own local variable, even on the verified rewrite. So the stored record carried
**the server's score beside the browser's clock.**

Measured live: `srv_elapsed_secs` **3086**, stored record **3229**. 143 seconds.

They are two independent computations of one quantity. The server measures
`started_at` to now plus its own help tally; the browser ticks its own clock,
adds `chargeHelp`, and charges capped away-gaps on restore. They agree by luck.

The comment beside the server's return describes this exact fault as solved —
"Reporting bare elapsed meant the Full Time screen showed a time that did not
produce the score beside it". The server was fixed to report the right figure.
Nothing was changed to make the browser use it.

### Why it had to be fixed before the season

Cosmetic today: both figures were past full time, both floored at 36, nothing
on screen was wrong.

Not cosmetic in stage 3b. `FCW.outcome()` reads `elapsedSeconds` to decide win
against draw at the 90′ line, and **143 seconds is seven match minutes**. A
board finishing at 89′ is a win; the same board 143 seconds adrift is 96′ and a
draw. The season would have recorded outcomes the server disagreed with.

### The change

`verifiedElapsed` alongside `verifiedScore` and `verifiedBreakdown`, set from
`r.elapsedSeconds` where the score is captured, reset with them per board. One
reader — `recordedElapsed()` — returns the server's figure once it has answered
and the browser's until then, so a finished board always says how long it took
even with nothing reachable. Both record paths call it; neither reads `elapsed`
directly any more.

Read off `r`, not `r.breakdown`: breakdown is `computeScore`'s return, which
carries `score` and `timePenalty` only.

Six new assertions in `record_test.mjs`, including the 89′/96′ flip as a
regression.

---

## A correction: the `.verified` class was never broken

I said the verified note was invisible because `.verify-note.verified` was
never applied, and that was wrong. There are **two** success branches. The
first sets both text and class:

```js
note.textContent = "verified by the server";
note.className = "verify-note verified";
```

The second, which only runs when the verified score differs from the shown one,
replaces the text with the longer "verified — timed from when the board was
opened, which does not pause" — and does not touch the class, because it does
not need to. It is already right.

So the one-line "fix" was a no-op, and its comment asserted something untrue.
It has been removed rather than left in. In a codebase where a confidently
wrong comment has already caused a real fault, a comment that is wrong is worse
than no comment.

**Why you could not see the note:** it sits *below* the league table on the
Full Time card, and in the common case — server and browser agreeing — it reads
**"verified by the server"**, not the longer sentence I told you to look for.
Small, uppercase, letter-spaced, green. Scroll the Full Time card down.

---

## live_check.mjs — what the live site is actually doing

```
node live_check.mjs
node live_check.mjs --expect v150
```

Every other suite runs against the working tree. They prove the code is right;
they cannot prove the deploy landed, the migration took, or that the build
being served is the one you pushed. Three faults this week were only findable
on production: v148 shipping while v126 was live, 017 unapplied, and the clock
above.

**Read-only.** Never posts a score, starts a play, or signs in. Safe against
production at any time.

It checks: which build is served and whether every asset tag matches the
footer; that `index.html` is not stored; that the daily returns eleven entries
and a token and no answers anywhere in the payload; that a future board is
refused with 403; that the *deployed* `game.js` contains the v149 and v150
changes; that the footer's linked pages exist. It also prints today's daily
number and how long pre-season has left.

Run against production just now it returned **19 ok and 2 fail** — the two
failures being the v150 changes correctly reported as not yet deployed. That is
the script doing its job.

It ends with a list of **what it cannot see**, rather than passing over it:
finishing a board, the reveals, the Season tile counting, cross-device sign-in,
and `srv_elapsed_secs` populating. Those still need a person and, for the last,
wrangler.

Named in `checks.yml` so gate check 19 passes, but commented out — on a pull
request it would report the build that is live rather than the one proposed.

### It caught its own bugs on first run

Two, worth recording because both are general:

**Entries are at `p.puzzle.entries`, not `p.entries`.** Written against the
wrong shape, reported "0 entries", fixed. Which is the argument for the file
existing.

**An assertion matched the comment explaining the thing it checked for.** The
negative check `!/score >= 76 \? 3 :/` failed against the live v149 build,
because the v149 comment *quotes the code it replaced*. That is now the third
time in this codebase — twice in `record_test.mjs`, once here. Any check
reading source now strips comments first. Trailing `//` is deliberately left:
stripping it truncates any line holding a URL.

---

## After deploying

```
node live_check.mjs --expect v150
```

Expect 21 ok, 0 fail. Then the things it cannot see:

- **Finish a board.** Scroll the Full Time card below the league table. Green
  "verified by the server".
- **Then check the clock landed.** `My Season` time for that board should now
  match `srv_elapsed_secs` in D1 exactly, not 143 seconds out:

```
npx wrangler d1 execute crosswordxi --remote --command="SELECT daily_no, srv_score, srv_elapsed_secs, ended_at FROM plays WHERE completed=1 ORDER BY started_at DESC LIMIT 3;"
```

That match is the whole point of the release.

Then `LAST_SHIPPED = "v150"`.

---

## Still open, unchanged by this

- **3 September** — daily #11, pre-season ends, eight days out.
- **`streaks()` does not guard the longest run** — archive farming reads 290.
- **The pinch handler counts pointers twice** — `n` and `pts` drift; still
  throwing at `game.js:5857` in every `frontend_test` run.
- **`frontend_test`'s uncaught-error check is scoped to boot**, which is why
  the above prints a stack trace inside a suite reporting 185/0.
- **Client and server disagree about which day it is** — local components
  against UTC. Before anyone outside the UK plays.
- **Cross-device saves.** Results sync; the board in progress does not. The
  clock makes it a real piece of work, not a small one.
