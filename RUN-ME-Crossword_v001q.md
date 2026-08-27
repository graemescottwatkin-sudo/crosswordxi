# Crossword_v001q — the review findings, closed

Base: **v001p** (presented; deploy THIS if v001p was not pushed — it carries
everything). No migrations. Response to `REVIEW-Crossword_v001m.md`; findings
3 and 7 were already closed in v001o/p (the wordsearch tag law now bites; all
five catches speak).

| | result |
|---|---|
| 28 suites | **966 passed, 0 failed** |
| `crossword/deploy_check.mjs` | **39 passed, 0 failed** |
| `wordsearch/deploy_check.mjs` | **28 passed, 0 failed** |

## Findings 1 + 2 — `functions/_middleware.js`, new

**HEAD 404d on every Function route** — every API endpoint and every answers
page in both games, including the sitemap-listed archive index. Pages routes
by method BEFORE middleware, so `next()` handed a rewritten GET cannot
re-route (proven: the 404 came back wearing the middleware's own header). The
fix is a depth-one self-fetch: HEAD → GET → status and headers back, no body.

**And `_headers` never reached a Function response** — the `/api/*` noindex
and the security headers decorated exactly that HEAD 404 and nothing else.
They are set in the middleware now, only where a handler has not said
something more specific.

Proven locally: HEAD 200 on `/wordsearch/answers/` and the API, empty body,
noindex landing on real API GETs.

**One caveat only production can prove:** the self-fetch is a same-zone
subrequest. So both live_checks now assert HEAD after every deploy — if
production refuses the pattern, the first `live_check` run says so loudly and
we change strategy. **Watch those lines on this deploy.**

## Finding 4 — the coverage check sees every game (and its reverse was vacuous)

The suite-coverage check read `crossword/` only; the word search could grow
suites that ran nowhere. It now scans `crossword/`, `wordsearch/` and
`tools/`. While widening it: **the reverse half — "every suite the workflow
names exists" — had matched nothing since it was written** (its regex had no
`/` in the class and every workflow entry is `node dir/suite.mjs`). Fixed;
both directions proven: an orphan wordsearch suite FAILs, a ghost workflow
entry FAILs.

## Finding 5 — journey_test and signin_test now run

Exempted from the offline job as browser suites, never added to the browser
job: they ran nowhere. The render job already has Chromium and the server;
they run there now. **This deploy has 32 jobs.** (`preview_test` keeps its
on-record note — exits 0 with no preview; fix or delete, not exempt forever.)

## Finding 8 — a flaky session call no longer signs the word search out

`syncAccount`'s catch nulled `account`, so one transient `/api/auth/session`
failure silently disabled sync for the page load. A network failure now leaves
what we knew in place; signed-out is only the server actually saying so.

## Findings 6, 9, 10, 11 — statements a reader would act on and be wrong

- **engine.js's penalty paragraph deleted**: it claimed constants were "kept
  because the breakdown, the share text and the server read them" — the gate
  enforces their deletion, and the stray "Zero, deliberately" described
  `MATCH_CLOCK_REAL_SECONDS: 1800`.
- **The FAQ window is value-checked**: `/seven days/` was a spelling test —
  `ANSWERS_AFTER_DAYS = 14` passed 30/30. The word form is derived from the
  constant now; proven, 14 FAILs it. The crossword answers_test tripwire
  (`=== 7`) now guards shape, not the pinned number.
- **The toolbar says "costs time"**, matching the rules page the suite
  polices. It said "costs points", the currency the deleted constants used.
- **Canonicals name the URL that serves**: Pages 308-redirects `.html`, so
  how-to-play and privacy declared canonicals that always redirected — and
  the sitemap listed them. Extensionless everywhere now (canonical, sitemap,
  chrome PAGES, in-page links), comments corrected, assertion re-pinned to
  the right form.

## Finding 12 — `dailyKey()` exists

`"daily:" + n` was composed in six places. `dailyKey()` now lives in
`_lib/daily.js` beside its parser; the server normaliser, both admin sites and
`record_test` ask it. The browser's one copy carries a signpost — a plain
script cannot import the module — and the SQL-literal check still guards the
wire format.

## Finding 13 — debt

Dead `seasonFloor()` deleted; `twitter:image` absolute like `og:image`;
how-to-play's `index.html` hrefs are `/crossword/` (with `howto_test`'s
link rule rewritten from "no leading slash" — a portability premise from the
subdomain era — to "no origin in an `<a>`", which is what local serving
actually needs). Left on the list, deliberately: the six `btn primary`s and
the practice-mode naming — copy decisions, yours.

## Deploy

    cd C:\Users\graem\OneDrive\Documents\GitHub\crosswordxi
    node crossword\deploy_check.mjs
    node wordsearch\deploy_check.mjs
    git add -A
    git commit -m "Crossword_v001q: middleware for HEAD+headers, review findings closed"
    git push

**32 jobs.** Then — and these runs are the production proof of the middleware:

    node crossword\live_check.mjs --expect v001q
    node wordsearch\live_check.mjs --expect v001j

Then bump both gates' `LAST_SHIPPED` (crossword `"v001q"`, wordsearch
`"v001j"`), commit, push.

## Tags

crossword **v001p → v001q**; wordsearch **v001i → v001j**.
`LAST_SHIPPED` crossword **v001o** / wordsearch **v001h** (bump after deploy).
`LAST_PRESENTED` crossword **v001p** / wordsearch **v001i**.

## Still open

- Game three lands today — `tools/aligned_test.mjs` is its checklist.
- Legal review ON HOLD.
- In-progress board sync; `preview_test`; repo rename; favicon; checkout@Node20.
