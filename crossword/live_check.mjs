/* What the live site is actually doing.
 *
 * The gap this fills: every suite in this repo runs against the working tree.
 * They tell you the code is right; they cannot tell you the deploy landed, the
 * migration took, or that the build being served is the one you pushed. Three
 * things this week were only findable on production — v148 shipping while v126
 * was still live, migration 017 being unapplied, and the browser storing its
 * own clock beside the server's score.
 *
 * Reads only. It never posts a score, never starts a play, never signs in.
 * Safe to run against production at any time.
 *
 *   node live_check.mjs
 *   node live_check.mjs --expect v150
 *
 * Anything it cannot see from outside is listed at the end rather than passed
 * over in silence — a check that quietly skips is worse than no check.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SITE = "https://www.thexigames.com/crossword";
const HUB = "https://www.thexigames.com";
const OLD = "https://crossword.thexigames.com";
const want = (() => {
  const i = process.argv.indexOf("--expect");
  return i > -1 ? process.argv[i + 1] : null;
})();

let pass = 0, fail = 0, warn = 0;

/* ---- the completion guard ----------------------------------------------- */
/* v001r: this file crashed at assertion 17 of 38 on a ReferenceError and
   printed a short list of green ticks with no summary at all. Nothing in the
   output said "incomplete" — a truncated run and a clean run differed only by
   an exit code nobody was reading. Two nets: the marker, set only by reaching
   the last line, catches a crash anywhere above it; the floor catches a block
   that goes quiet without crashing. Proven by EXECUTION, not by parse —
   node --check called the crashing file fine.
   The uncaughtException hook is load-bearing: a rejection out of top-level
   await terminates by a path that never runs 'exit' listeners, so a guard
   hung on 'exit' alone stays as silent as the bug it is meant to catch. */
const MIN_ASSERTIONS = 37;
let reachedEnd = false, announced = false;
function incomplete() {
  if (announced) return;
  announced = true;
  console.log(`\nFAIL  the run did not complete — ${pass + fail + warn} assertion(s) ` +
    `ran, floor ${MIN_ASSERTIONS}. A crash mid-file is a failed run, not a ` +
    `short green list.`);
  process.exitCode = 1;
}
process.on("uncaughtException", (e) => {
  console.log("\n" + ((e && e.stack) || e));
  incomplete();
  process.exit(1);
});
process.on("unhandledRejection", (e) => { throw e; });
process.on("exit", () => { if (!reachedEnd) incomplete(); });
const t = (n, ok, d) => { ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const w = (n, d) => { warn++; console.log(`  ??  ${n}${d ? "  — " + d : ""}`); };

/* Source fetched for assertions is comment-stripped first.
   Three checks in this codebase have now matched the comment explaining why
   something was removed and reported the explanation as the thing. Comments
   here are long and quote the code they replaced, so any check reading shipped
   source has to read code. Trailing // is left alone: stripping it truncates
   any line holding a URL, which is the worse failure. */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

/* SITE is the game; the API is at the repository root, because functions/ is.
   Asking SITE + "/api/daily" gave /crossword/api/daily and a 404 — the check
   was wrong, not the site. Anything starting /api/ goes to the root. */
const get = async (path) => {
  const base = path.startsWith("/api/") ? HUB : SITE;
  const res = await fetch(base + path, { headers: { "accept": "*/*" } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { res, text, json };
};

console.log(`\n${SITE}\n`);

/* ---- the old address still reaches the game ----
   Checked first, because it is the one thing here that can be silently wrong.
   The original test for this asked a person to confirm the query string was
   still in the address bar after the redirect — which is true when the
   redirect works AND true when nothing happens at all, so it could not tell
   success from total failure. It reported a pass while crossword.thexigames.com
   was serving the hub and every shared link was dead.

   This follows the redirect and reads where it actually landed. A shared
   result is /?token= and a challenge invite is /?c=, so the query surviving is
   the whole point rather than a detail. */
{
  const url = OLD + "/?token=practice:2";
  const res = await fetch(url, { redirect: "follow" });
  const landed = res.url;
  t("the old subdomain still reaches the game",
    landed.startsWith("https://www.thexigames.com/crossword"),
    landed);
  t("and a shared link keeps its token across the move",
    landed.includes("token=practice:2"),
    landed.includes("?") ? landed.slice(landed.indexOf("?")) : "query dropped");
}

/* ---- the apex redirects to www ---- */
{
  /* Verified live during the v153 review: thexigames.com answered 200 and
     served the whole site — two hostnames, identical content, the day
     indexing switched on. The _redirects apex rule died of the same
     paths-only limitation as the subdomain one. This asserts the zone
     Redirect Rule that replaces it. */
  const res = await fetch("https://thexigames.com/crossword/", { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  t("the apex redirects to www rather than serving a second copy",
    res.status >= 301 && res.status <= 308 && loc.startsWith("https://www.thexigames.com"),
    res.status === 200 ? "HTTP 200 — apex is serving content directly" : `${res.status} -> ${loc}`);
}

/* ---- the hub ---- */
{
  const hub = await fetch(HUB + "/");
  const html = await hub.text();
  t("the hub is served", hub.ok, `HTTP ${hub.status}`);
  t("and it shows eleven shirts",
    (html.match(/class="shirt/g) || []).length === 11,
    `${(html.match(/class="shirt/g) || []).length} found`);
  /* The roster must not name unreleased games — two of them are built under
     names live competitors already hold. */
  /* Word Search left this list when shirt 2 went live — a released game's
     name on the hub is the point, not a leak. */
  /* QuickFire XI is BUILT but not launched — it stays on this list until it
     has a bank and a squad-list slot. Career Path is now Transfer XI, and
     Player Chain was missing here while the word search listed it: one set,
     both games. */
  /* Case-insensitively, and not counting the href of the route in. The old
     test was html.includes(n): exact case, and it would have counted the
     "/quickfire/" in the number-four card's link as the hub naming the game
     while missing "quickfire xi" written out in lower case. What a reader
     sees is still searched; where a link points is not. */
  const hubClean = html
    .replace(/\b(?:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  const leaked = ["QuickFire","Missing XI","Transfer XI",
                  "Player Chain","Link XI","Odd One Out"]
    .filter((n) => new RegExp(n, "i").test(hubClean));
  t("and names no unreleased game", leaked.length === 0,
    leaked.length ? "leaked: " + leaked.join(", ") : "squad numbers only");
  /* Every link the hub's own markup carries must resolve. The first hub
     shipped with /account, /how-to-play and /privacy in its chrome — all
     404 — and nothing noticed, because this script checked those pages under
     the game path and never clicked the front door's own links. */
  const hrefs = [...new Set([...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]))];
  let dead = [];
  for (const h of hrefs) {
    const r = await fetch(HUB + h, { redirect: "follow" });
    if (!r.ok) dead.push(`${h} -> ${r.status}`);
  }
  t("every link on the hub resolves", dead.length === 0,
    dead.length ? dead.join(", ") : `${hrefs.length} checked`);
}

/* ---- the answers pages hold the line ----
   The security property, checked against production: today's board must be
   refused with nothing cached, and the index must serve. The first released
   page appears on day nine; until then the index's empty state is the
   correct answer, not a fault. */
{
  const idx = await fetch(HUB + "/crossword/answers/");
  t("the answers index is served", idx.ok, `HTTP ${idx.status}`);
  const dailyRes = await fetch(HUB + "/api/daily", { headers: { accept: "application/json" } });
  const day = dailyRes.ok ? await dailyRes.json() : null;
  if (day && day.dailyNo) {
    const sealed = await fetch(HUB + "/crossword/answers/" + day.dailyNo);
    t("today's answers are refused", sealed.status === 404, `HTTP ${sealed.status}`);
    t("and the refusal is not cacheable",
      /no-store/.test(sealed.headers.get("cache-control") || ""),
      "a cached refusal would outlive its release date");
    const sealedBody = await sealed.text();
    t("and the refusal names no clue", !/class="ans"/.test(sealedBody));
  }
}

/* ---- which build is being served ---- */
const home = await get("/");
const tag = (home.text.match(/id="buildTag">([^<]+)</) || [])[1];
t("the site responds", home.res.ok, `HTTP ${home.res.status}`);
t("a build tag is in the footer", !!tag, tag || "none found");
if (want) t(`the build is ${want}`, tag === want, `serving ${tag}`);
else console.log(`      serving ${tag} — pass --expect vNNN to assert it`);

/* Every asset must carry the same tag, or a browser holding a cached CSS or JS
   from the previous build will pair it with the new HTML. */
/* v001e: /v\d+/ stopped at the digits, so ?v=v001d captured "v001" and the
   comparison with the footer's "v001d" failed on every lettered build. The
   tag scheme grew a letter; this regex did not. Both sides now read the same
   shape. */
/* Two lifecycles on one page, deliberately. The GAME's assets carry the game's
   build tag and must match the footer; SHARED assets (../shared/xi-*) carry
   their own plain vN, because bumping every game's tag to redeploy a shared
   file would burn tags for nothing. The first draft of this check asserted
   every tag matched the footer, which failed the moment the shared chrome
   shipped — the same wrong assumption the gate's tag check had, fixed there
   and missed here. One assumption, two checks, found separately. */
const tagged = [...home.text.matchAll(/(?:src|href)="([^"]+)\?v=(v[0-9a-z]+)"/g)]
  .map((m) => ({ path: m[1], tag: m[2] }));
const own = tagged.filter((a) => !/shared\//.test(a.path));
const shared = tagged.filter((a) => /shared\//.test(a.path));
t("every asset URL carries a build tag", tagged.length > 0,
  `${tagged.length} tagged`);
t("the game's own assets all match the footer",
  own.length > 0 && own.every((a) => a.tag === tag),
  [...new Set(own.map((a) => a.tag))].join(", "));
t("shared assets carry their own plain vN lifecycle",
  shared.every((a) => /^v\d+$/.test(a.tag)),
  [...new Set(shared.map((a) => a.tag))].join(", ") || "none on this page");

/* ---- the bytes behind the tag, which the gate cannot see ---------------- */
/* The gate proves the tag moved when the assets changed. It cannot prove the
   DEPLOY landed: a push that never built, or a CDN still serving the previous
   file under the same ?v=, is indistinguishable from success by tag alone —
   and the tag is all anything was checking. So compare the bytes.
   Only comparable when the live tag and this checkout agree; when they do not
   the run says so rather than skipping quietly, because a check that goes
   silent is the fault this suite exists to catch. */
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const localJs = fs.readFileSync(path.join(here, "js/game.js"), "utf8");
  const localTag = (localJs.match(/BUILD\s*=\s*"(v\d+[a-z]?)"/) || [])[1] || "";
  const sum = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
  if (!tag || !localTag || tag !== localTag) {
    w("the deployed game.js is the file in this checkout",
      `not comparable — live ${tag || "?"}, this checkout ${localTag || "?"}`);
  } else {
    const r = await fetch(SITE + "/js/game.js?v=" + tag);
    const body = r.ok ? await r.text() : "";
    t("the deployed game.js is the file in this checkout",
      r.ok && sum(body) === sum(localJs),
      r.ok ? `live ${sum(body)} vs local ${sum(localJs)}` : `HTTP ${r.status}`);
  }
}

/* ---- HEAD, which every Function route 404d until v001q ---------------- */
/* Pages routes by method BEFORE middleware, so handlers exporting only
   onRequestGet never saw HEAD; it fell to the static handler and 404d — on
   every API route and every answers page, including the sitemap-listed index.
   The fix is a middleware self-fetch, and the self-fetch has one caveat that
   only production can prove: a same-zone subrequest. These assertions ARE that
   proof, run after every deploy. */
/* v001r: this block referenced a BASE that this file never defined, so it
   threw ReferenceError on the first HEAD and took the whole tail of the run
   with it — the middleware proof and 18 assertions after it. It was shipped
   without ever being run; node --check proves parsing, not execution. The
   base is HUB: both paths are hub-relative and SITE already ends /crossword. */
for (const p of ["/api/daily", "/crossword/answers/"]) {
  const r = await fetch(HUB + p, { method: "HEAD", redirect: "manual" });
  t(`HEAD ${p} answers like its GET`, r.status === 200, "HTTP " + r.status);
  const body = await r.text();
  t(`and carries no body`, body.length === 0, body.length + " bytes");
}
{
  const r = await fetch(HUB + "/api/daily", { method: "HEAD", redirect: "manual" });
  t("HEAD /api/daily carries the API noindex",
    (r.headers.get("x-robots-tag") || "").indexOf("noindex") > -1,
    "the _headers rule never reached a Function response before the middleware");
}


/* ---- caching ---- */
const cc = home.res.headers.get("cache-control") || "";
t("index.html is not stored, so nobody is pinned to an old build",
  /no-store|no-cache|max-age=0/.test(cc), cc || "no cache-control");

/* ---- the daily ---- */
const daily = await get("/api/daily");
t("the daily endpoint answers", daily.res.ok, `HTTP ${daily.res.status}`);
if (daily.json) {
  const p = daily.json;
  /* entries live on p.puzzle, not on p. Written against the wrong shape first
     time and caught by running it — which is the argument for this file. */
  const entries = (p.puzzle && p.puzzle.entries) || [];
  t("it returns a board", p.dailyNo != null, "daily #" + p.dailyNo);
  t("with a token, so the board can be checked and revealed", !!p.token);
  t("with clues", entries.length > 0, `${entries.length} entries`);
  t("eleven of them, which is the whole premise", entries.length === 11);
  /* The one thing that must never be true. Checked against the whole payload
     rather than a field, because the fault would be a field nobody expected. */
  const raw = JSON.stringify(p).toLowerCase();
  t("and no answer anywhere in the payload",
    !/"answer"|"solution"|"grid"\s*:\s*\[/.test(raw));
  t("the daily is not cacheable",
    /no-store|no-cache|max-age=0/.test(daily.res.headers.get("cache-control") || ""),
    daily.res.headers.get("cache-control") || "none");
}

/* ---- the archive boundary ---- */
/* A future ask is CLAMPED to today, not refused — the 403 dead-ended UK
   players nightly between local midnight and the UTC one. The guard that
   matters is asserted directly: whatever is asked, the board that comes
   back is today's or earlier, so nothing unreleased ever leaves. */
const future = await get("/api/daily?no=99999");
{
  const served = future.json && future.json.dailyNo;
  const todayNo = daily.json && daily.json.dailyNo;
  t("a future ask is answered with today's board, not a dead end",
    future.res.status === 200 && served === todayNo,
    `asked #99999, served #${served} (today is #${todayNo})`);
}

/* ---- what the browser is told about the clock ---- */
/* Cannot be exercised without finishing a board, which would post a score.
   Checked statically instead: does the shipped game.js read the field? */
const js = await get(`/js/game.js?v=${tag}`);
t("the deployed game.js is reachable", js.res.ok, `HTTP ${js.res.status}`);
if (js.res.ok) {
  const jsCode = codeOnly(js.text);
  t("the shipped build takes the server's clock, not its own",
    /verifiedElapsed = r\.elapsedSeconds/.test(jsCode),
    "v150 and later; before that the record stored the browser's figure");
  t("and one function decides what goes in the record",
    /function recordedElapsed\(\)/.test(jsCode));
  t("the season tile reads FCW.outcome, not its own score bands",
    /FCW\.outcomePoints\(FCW\.outcome\(r\)\)/.test(jsCode) &&
    !/score >= 76 \? 3 :/.test(jsCode),
    "v149 and later");
  t("the stored record carries mode and complete",
    /mode: "daily",/.test(jsCode) && /complete: true,/.test(jsCode),
    "v149 and later");
}

/* ---- pages that must exist, because the footer links to them ---- */
for (const p of ["/how-to-play.html", "/privacy.html"]) {
  const r = await get(p);
  t(`${p} is served`, r.res.ok, `HTTP ${r.res.status}`);
}

/* ---- what the phase model says today ---- */
const eng = await get(`/js/engine.js?v=${tag}`);
if (eng.res.ok) {
  const pre = (eng.text.match(/PRESEASON_DAYS = (\d+)/) || [])[1];
  const ep = eng.text.match(/DAILY_EPOCH = \{ y: (\d+), m: (\d+), d: (\d+) \}/);
  if (pre && ep) {
    const first = new Date(Date.UTC(+ep[1], +ep[2], +ep[3] + 1));
    const today = new Date();
    const no = Math.max(1, Math.floor((Date.UTC(today.getFullYear(),
      today.getMonth(), today.getDate()) - first.getTime()) / 86400000) + 1);
    const boundary = new Date(first.getTime() + (+pre) * 86400000);
    console.log(`\n      today is daily #${no}; ` +
      (no <= +pre
        ? `pre-season, ${+pre - no + 1} day(s) left — the phase changes on ` +
          boundary.toISOString().slice(0, 10)
        : "past the pre-season boundary"));
  }
}

/* ---- what this cannot see ---- */
console.log(`
      Not checked from outside, and still needs a person:
        finishing a board            /api/finish, and whether the note reads
                                     verified — it sits BELOW the league table
        reveal letter and answer     +3' and +14' on the clock, subs dropping
        the Season tile counting     needs a season-phase result to exist
        cross-device sign-in         needs two devices
        srv_elapsed_secs populating  wrangler d1, not HTTP`);

/* The floor, for a block that goes quiet without crashing. */
const ran = pass + fail + warn;
if (ran < MIN_ASSERTIONS) {
  fail++;
  console.log(`FAIL  the run is short — ${ran} assertion(s) ran, floor is ${MIN_ASSERTIONS}`);
}
reachedEnd = true;
/* ---- the permalink: one URL, one puzzle, forever ---------------------- */
/* The whole contract a linking bot depends on, checked against production:
   /crossword/daily lands on a dated address, that address serves the game, and a
   board that does not exist yet is not a page. Here rather than only in the
   offline suite because the route is a Function, and the offline suite runs
   in node, which has no Workers runtime to run one in. */
{
  const hop = await fetch(HUB + "/crossword/daily", { redirect: "manual" });
  const loc = hop.headers.get("location") || "";
  const key = loc.split("/").filter(Boolean).pop() || "";
  t("/crossword/daily sends you to a dated address",
    hop.status === 302 && new RegExp("/crossword/daily/.+").test(loc), `${hop.status} -> ${loc}`);
  t("and never lets that answer be cached",
    (hop.headers.get("cache-control") || "").includes("no-store"));

  const page = await fetch(HUB + "/crossword/daily/" + key, { redirect: "manual" });
  const html = page.status === 200 ? await page.text() : "";
  t("the permalink serves the game itself",
    page.status === 200 && html.includes("js/game.js"), String(page.status));
  /* Every asset on the page is relative and the page is served one level
     deeper than it lives. Without this the board is a blank screen. */
  t("with a base, so its relative assets still resolve",
    html.includes('<base href="/crossword/">'));
  t("naming the board in its title and its canonical",
    /<title>[^<]+ \u00b7 /.test(html) && html.includes("/crossword/daily/" + key + '"'));
  t("and offered to a crawler with a line of its own",
    !/noindex/.test(html) && /name="description" content="[^"]*\d{4}"?/.test(html));

  /* THE ONLY CRAWLABLE LINK A PERMALINK HAS. These pages are indexable by
     the owner's decision, and nothing else on the site points at one — an
     answers page is where a reader who wants to play that board is, and it
     is a page that is already indexed. */
  const ans = await fetch(HUB + "/crossword/answers/1");
  const ansHtml = ans.status === 200 ? await ans.text() : "";
  t("a published answers page links the board it is about",
    ansHtml.includes('href="/crossword/daily/1"'), String(ans.status));

  const future = await fetch(HUB + "/crossword/daily/99999", { redirect: "manual" });
  t("a board that does not exist yet is not a page", future.status === 404, String(future.status));
}

console.log(`\n${pass} passed, ${fail} failed${warn ? `, ${warn} unknown` : ""}`);
process.exit(fail ? 1 : 0);
