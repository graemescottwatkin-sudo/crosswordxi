/* The preview must work from a file:// origin with no server at all — that is
   the whole point of it. Loading it from a string with no URL is the closest
   jsdom gets to opening it off disk. */
import fs from "node:fs";
import { JSDOM } from "jsdom";
const html = fs.readFileSync("../crosswordxi-preview-v09d.html", "utf8");
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const errors = [];
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
