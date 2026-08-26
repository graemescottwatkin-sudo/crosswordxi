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
const SITE = "https://www.thexigames.com/crossword";
const HUB = "https://www.thexigames.com";
const OLD = "https://crossword.thexigames.com";
const want = (() => {
  const i = process.argv.indexOf("--expect");
  return i > -1 ? process.argv[i + 1] : null;
})();

let pass = 0, fail = 0, warn = 0;
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
  const leaked = ["Word Search","QuickFire","Scrambled","Missing XI",
                  "Career Path","Link XI","Odd One Out"].filter((n) => html.includes(n));
  t("and names no unreleased game", leaked.length === 0,
    leaked.length ? "leaked: " + leaked.join(", ") : "squad numbers only");
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
const assetTags = [...home.text.matchAll(/[?&]v=(v\d+)/g)].map((m) => m[1]);
t("every asset URL carries a build tag", assetTags.length > 0,
  `${assetTags.length} tagged`);
t("and they all match the footer",
  assetTags.every((a) => a === tag),
  [...new Set(assetTags)].join(", "));

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
const future = await get("/api/daily?no=99999");
t("tomorrow's board is refused", future.res.status === 403,
  `HTTP ${future.res.status} — a 200 here would serve unreleased answers`);

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

console.log(`\n${pass} passed, ${fail} failed${warn ? `, ${warn} unknown` : ""}`);
process.exit(fail ? 1 : 0);
