/* sitemap_test.mjs — what the sitemap lists, and what it must never list.
 *
 *   node tools/sitemap_test.mjs        (from the repo root)
 *
 * A sitemap is the only route search has into a board page: nothing on the
 * site links to one except an answers page, and only a handful of those are
 * published. The file this replaced held thirteen URLs and not one board,
 * months after the permalinks shipped, because a hand-kept list of pages that
 * appear DAILY was never going to hold them.
 *
 * The two properties that matter pull against each other. It must be COMPLETE
 * — every board that exists — and it must be TRUE: a sitemap listing a URL
 * that answers 404 spends crawl budget on nothing and teaches a crawler to
 * trust it less. So every check here is one or the other.
 */
import { onRequestGet as sitemap } from "../functions/sitemap.xml.js";
import { permalinkRoute, todayKeyFor, PERMA_GAMES } from "../functions/_lib/permalink.js";
import fs from "node:fs";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A schedule with holes in it, which is the shape that matters: the days a
   dated game ran are not every day since it started. */
const RAN = {
  ws_schedule: ["2026-09-03", "2026-09-01", "2026-08-30"],
  hl_schedule: ["2026-09-03"],
};
const tableOf = (sql) => (/ws_schedule/.test(sql) ? "ws_schedule"
  : /hl_schedule/.test(sql) ? "hl_schedule" : null);
const env = {
  DB: {
    prepare: (sql) => ({
      bind: (arg) => ({
        all: async () => {
          const tbl = tableOf(sql);
          return { results: tbl ? RAN[tbl].map((day) => ({ day })) : [] };
        },
        first: async () => {
          const tbl = tableOf(sql);
          return tbl && RAN[tbl].includes(arg) ? { n: 1 } : null;
        },
      }),
    }),
  },
  ASSETS: {
    fetch: async (req) => {
      const game = new URL(req.url || req).pathname.split("/").filter(Boolean)[0];
      return new Response(fs.readFileSync(`${game}/index.html`, "utf8"),
        { headers: { "Content-Type": "text/html" } });
    },
  },
};

const res = await sitemap({ env });
const xml = await res.text();
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

console.log("It is a sitemap");
t("served as XML", (res.headers.get("Content-Type") || "").includes("xml"));
t("and cached at the edge rather than rebuilt per hit",
  /s-maxage=\d+/.test(res.headers.get("Cache-Control") || ""),
  res.headers.get("Cache-Control"));
t("one urlset, well formed enough to parse as pairs",
  /<urlset[^>]*>/.test(xml) && /<\/urlset>/.test(xml) &&
  locs.length === (xml.match(/<url>/g) || []).length, locs.length + " urls");
t("every url is absolute and on the site",
  locs.length > 0 && locs.every((u) => u.startsWith("https://www.thexigames.com/")));
t("and no url is listed twice", new Set(locs).size === locs.length,
  locs.length - new Set(locs).size + " duplicates");

console.log("\nComplete: every board that exists is in it");
for (const game of Object.keys(PERMA_GAMES)) {
  const kind = PERMA_GAMES[game].kind;
  const want = kind === "number"
    ? Array.from({ length: Number(todayKeyFor(game)) }, (_, i) => String(i + 1))
    : RAN[game === "wordsearch" ? "ws_schedule" : "hl_schedule"];
  const missing = want.filter((k) => !locs.includes(`https://www.thexigames.com/${game}/daily/${k}`));
  t(`${game}: all ${want.length} of its boards are listed`, missing.length === 0,
    missing.length ? "missing " + missing.slice(0, 4).join(", ") : want.length + " boards");
}
t("and each game's own front page is there",
  Object.keys(PERMA_GAMES).every((g) => locs.includes(`https://www.thexigames.com/${g}/`)));

console.log("\nTrue: nothing in it answers 404");
/* THE CHECK THAT PULLS THE OTHER WAY. Every board URL listed is fetched
   through the real route with the same schedule the sitemap was built from —
   so a sitemap that listed a day the game never ran would be caught here
   rather than by a crawler. */
{
  const boards = locs.filter((u) => u.includes("/daily/"));
  const bad = [];
  for (const u of boards) {
    const [, game, , key] = new URL(u).pathname.split("/");
    const r = await permalinkRoute({
      request: new Request(u), env, params: { path: [key] },
    }, game);
    if (r.status !== 200) bad.push(`${game}/${key} -> ${r.status}`);
  }
  t(`every one of the ${boards.length} board urls is served by the route`,
    bad.length === 0, bad.slice(0, 4).join(", ") || "all 200");
}

console.log("\nAnd what it must never carry");
{
  const future = Object.keys(PERMA_GAMES).map((g) => {
    const k = todayKeyFor(g);
    return `https://www.thexigames.com/${g}/daily/${
      PERMA_GAMES[g].kind === "number" ? String(Number(k) + 1) : "2099-01-01"}`;
  });
  t("tomorrow's board is not named", future.every((u) => !locs.includes(u)),
    "the future is shut, and a sitemap naming it leaks the schedule");
  /* A day inside the range but not scheduled: the hole in RAN above. */
  t("a day a dated game did not run is not named",
    !locs.includes("https://www.thexigames.com/wordsearch/daily/2026-09-02"),
    "2026-09-02 sits between two days that DID run");
  const UNRELEASED = ["quickfire", "missing", "transfer", "kit", "manager", "stadium"];
  t("no unreleased game appears",
    !UNRELEASED.some((g) => locs.some((u) => u.includes("/" + g + "/"))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
