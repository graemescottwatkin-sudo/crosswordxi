/* The how-to-play page must describe the rules the game actually has.
 *
 * It drifted a whole scoring model behind — documenting point costs, free
 * per-difficulty substitutions and "not available on the daily" long after help
 * moved to the clock and substitutions became universal. Nothing read the page,
 * so nothing noticed.
 *
 * These assertions read SCORING and check the page agrees. A number changed in
 * engine.js and not here will now fail rather than mislead.
 */
import fs from "node:fs";
import { ANSWERS_AFTER_DAYS } from "../../functions/_lib/daily.js";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, "js/engine.js"), "utf8"), ctx);
const S = (ctx.FCW || ctx.window.FCW).SCORING;
const page = fs.readFileSync(path.join(DIR, "how-to-play.html"), "utf8");

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

console.log("\nThe numbers it quotes are the numbers in force");
t("the maximum score", page.includes(">" + S.MAX_SCORE + "<"), String(S.MAX_SCORE));
t("substitutions per board", page.includes(">" + S.SUBS_PER_BOARD + "<"), String(S.SUBS_PER_BOARD));
Object.keys(S.HELP_MINUTES).forEach((k) => {
  t("help cost: " + k, page.includes("+" + S.HELP_MINUTES[k] + "&prime;"),
    "+" + S.HELP_MINUTES[k] + "'");
});
[0, 30, 45, 90].forEach((m) => {
  const at = S.DECAY_CURVE.find((p) => p.minute === m);
  if (at) t("the curve at " + m + "'", page.includes(">" + at.score + "<"), String(at.score));
});
t("the real length of a match",
  page.includes("half an hour") && S.MATCH_CLOCK_REAL_SECONDS === 1800);

console.log("\nIt describes the model in force, not the one before it");
t("says help costs time", /They cost time|cost time/i.test(page));
t("says the score is what the clock has left", /clock has left/i.test(page));
t("explains spending all three is not a draw", /Spending all three/i.test(page));
t("explains going past them is", /becomes a draw/i.test(page));
t("names win, draw and loss", /<b>Win<\/b>/.test(page) && /<b>Draw<\/b>/.test(page) && /<b>Loss<\/b>/.test(page));
t("says a missed day is not a loss", /not a loss/i.test(page));
t("points at the archive", /Previous puzzles/i.test(page));

console.log("\nAnd not the old one");
t("no point costs for help",
  !/&minus;(2|3|9|12)\b/.test(page));
t("no per-difficulty substitution table",
  !/Easy/.test(page) && !/Medium/.test(page));
t("does not claim substitutions are unavailable on the daily",
  !/not available on the daily/i.test(page));
t("does not say the cost is shown before you confirm as a points figure",
  !/at \d+ points each/i.test(page));

console.log("\nStructure");
/* Root-relative, not document-relative. The old rule was "no leading slash,
   so the site can move" — written when the game lived on a subdomain that
   might. It lives at a fixed path in a monorepo now, the shared chrome links
   root-relative (/football/crossword/), and document-relative hrefs were what pointed
   this page's canonical at a URL Pages 308-redirects. What portability still
   requires is no hardcoded ORIGIN — pages dev serves the same paths at
   127.0.0.1 — so that is the assertion: no absolute http(s) href except the
   canonical and social meta, which must name the real origin. */
t("no <a> carries an origin, so local serving still works", (() => {
  const anchors = [...page.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  return anchors.length > 0 && anchors.every((h) => !/^https?:/.test(h));
})());
t("divs balance",
  (page.match(/<div/g) || []).length === (page.match(/<\/div>/g) || []).length);


/* The day of grace was settled ON THE CONDITION the page explains it — a
   rule players only discover when a run fails to move is a bug wearing a
   rule's clothes. If the sentence goes, the grace goes with it or this
   fails. */
{
  const flat = page.replace(/\s+/g, " ");
  t("the page says yesterday's board counts until the end of today",
    /Yesterday.{1,9}s board still counts/.test(flat) &&
    /before the end of today/.test(flat));
  t("and that anything older banks nothing",
    /does not bank a matchday or extend a run/.test(flat));
  t("and why — the answers pages make old scores untrustable",
    /answers are published/.test(flat));
}


/* The SEO layer: one canonical (both URL forms serve this document), and the
   FAQ markup that makes the page's answers eligible for rich results. The
   FAQ must agree with the page — a rich result contradicting the page it
   links to is worse than no rich result. */
{
  /* Extensionless, because that is the URL that actually serves: Pages
     308-redirects the .html form, so the old canonical named a URL that
     always redirects — and the sitemap listed it. External review, finding
     11; this assertion pinned the wrong form and now pins the right one. */
  t("the page declares its canonical, at the URL that serves",
    /rel="canonical" href="https:\/\/www\.thexigames\.com\/football\/crossword\/how-to-play"/.test(page) &&
    !/how-to-play\.html"/.test(page.match(/rel="canonical"[^>]+/)[0]));
  const m = page.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g) || [];
  let faq = null;
  for (const b of m) {
    const j = JSON.parse(b.replace(/<\/?script[^>]*>/g, ""));
    if (j["@type"] === "FAQPage") faq = j;
  }
  t("FAQ markup is present and parses", !!faq, (faq ? faq.mainEntity.length + " questions" : "none"));
  t("and the FAQ tells the same story as the page", (() => {
    if (!faq) return false;
    const all = JSON.stringify(faq);
    /* The word form is DERIVED from the constant in force, like every other
       number on this page. /seven days/ was a spelling test: setting
       ANSWERS_AFTER_DAYS = 14 passed 30/30 while the FAQ still told Google
       "seven". External review, finding 9. */
    const WORDS = ["zero","one","two","three","four","five","six","seven",
                   "eight","nine","ten","eleven","twelve","thirteen","fourteen"];
    const windowWord = WORDS[ANSWERS_AFTER_DAYS] || String(ANSWERS_AFTER_DAYS);
    return /114/.test(all) && /does not stop/.test(all) &&
           /before the end of today/.test(all) &&
           new RegExp(windowWord + " days").test(all);
  })(), "score, clock, grace and answers window all consistent");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
