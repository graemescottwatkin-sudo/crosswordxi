/* The preview must work from a file:// origin with no server at all — that is
   the whole point of it. Loading it from a string with no URL is the closest
   jsdom gets to opening it off disk. */
import fs from "node:fs";
import { JSDOM } from "jsdom";
/* Find the newest preview rather than naming one. A hard-coded build number
   here goes stale on the next build and the suite then fails on a file that no
   longer exists — which is what it had been doing, still pointing at v10f. */
const previewDir = "..";
const previewFile = fs.readdirSync(previewDir)
  .filter((f) => /^crosswordxi-preview-.*\.html$/.test(f))
  .map((f) => ({ f, t: fs.statSync(previewDir + "/" + f).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0];
if (!previewFile) {
  console.log("  --  no preview built; run tools/build_preview.js");
  process.exit(0);
}
console.log(`Testing ${previewFile.f}\n`);
const html = fs.readFileSync(previewDir + "/" + previewFile.f, "utf8");
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const errors = [];
/* Did the stylesheet survive? A single unclosed brace swallows every rule
   after it and the page renders bare, which this suite happily passed because
   it only ever asked whether the game worked. Cheap to check here, where the
   CSS is inlined and can be counted directly. */
const inlineCss = (/<style>([\s\S]*?)<\/style>/.exec(html) || [, ""])[1];
const bareCss = inlineCss.replace(/\/\*[\s\S]*?\*\//g, "");

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
    w.addEventListener("error", (e) => errors.push(e.message || String(e.error)));
  },
});
await new Promise((r) => setTimeout(r, 6000));
const d = dom.window.document, w = dom.window;
/* The web fonts stay on their CDN: they are a font, not the game, and the CSS
   falls back to system faces offline. Everything else must be inline or the
   file will not run from disk. */
t("it is one file — no local css or js references", (() => {
  const links = [...d.querySelectorAll("link[rel=stylesheet]")].map((n) => n.getAttribute("href"));
  return !d.querySelector("script[src]") &&
    links.every((h) => h.startsWith("https://fonts.googleapis.com"));
})(), [...d.querySelectorAll("link[rel=stylesheet]")].length + " external stylesheet(s), fonts only");
t("the game boots with no server", !!w.FCW && !!w.CROSSWORDXI_BUILD, w.CROSSWORDXI_BUILD);

/* The landing screen loads nothing until a mode is chosen, so choose one — the
   preview exists to prove the game runs from a file, and it cannot prove that
   sitting on a menu. */
t("it opens on the choice, not on a puzzle",
  !!d.getElementById("homeOverlay") && d.querySelectorAll("#grid .cell").length === 0);
d.getElementById("homeDaily").dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 2500));
t("the grid renders", d.querySelectorAll("#grid .cell").length > 50, d.querySelectorAll("#grid .cell").length + " cells");
t("clues render", d.querySelectorAll("#acrossList li").length + d.querySelectorAll("#downList li").length >= 10);
t("the league table renders three rows",
  [...d.querySelectorAll("#leagueBody tr")].filter((r) => !r.classList.contains("faroff")).length === 3);
t("no uncaught errors", errors.length === 0, errors[0]);
t("the reveal endpoint answers, so play works", await (async () => {
  const r = await w.fetch("/api/reveal", { method: "POST", body: JSON.stringify({ token: "daily:1", entry: 0 }) });
  const j = await r.json();
  return /^[A-Z0-9]+$/.test(j.answer || "");
})());
t("it is clearly marked as a preview", /DO NOT UPLOAD/.test(html) && !!d.querySelector('meta[name=robots]'));
/* The sample data is generated separately from the production puzzles, so it
   can silently fall behind the engine — it sat at twelve answers after the game
   moved to eleven, and the preview showed 0/12 while the live site showed
   0/11. */
const { SAMPLE_PUZZLES } = await import("./functions/_lib/sample-puzzles.js");
const sizes = [...SAMPLE_PUZZLES.daily, ...SAMPLE_PUZZLES.practice]
  .map((p) => p.puzzle.entries.length);
t("the development samples have eleven answers, like every other puzzle",
  sizes.every((n) => n === 11), [...new Set(sizes)].join(", ") + " answers");

t("the preview carries a stylesheet at all", inlineCss.length > 10000,
  inlineCss.length + " chars");
t("and its braces balance, so no rule is swallowed",
  (bareCss.match(/\{/g) || []).length === (bareCss.match(/\}/g) || []).length,
  (bareCss.match(/\{/g) || []).length + " open, " + (bareCss.match(/\}/g) || []).length + " close");
t("the board and the clue strip are actually styled", (() => {
  return /\.now-clue\{/.test(bareCss) && /\.grid\{/.test(bareCss);
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
