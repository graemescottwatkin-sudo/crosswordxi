/* chrome_test.mjs — the furniture every game wears.
 *
 * The chrome exists because two games grew two chromes: a green bar with game
 * navigation and no way home, and a paper bar with family navigation and no
 * game navigation. Worse, the crossword's in-game view used a THIRD header
 * with no navigation at all, so opening a board stranded you on it.
 *
 * What this suite is for: the properties that make it one chrome rather than
 * two that currently look alike. Every one of them is a thing that drifted
 * apart before — the palette, the game's name, the build tag, the list of
 * games in a footer.
 *
 *   node crossword/chrome_test.mjs        (from the repo root)
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const chromeJs = fs.readFileSync("shared/xi-chrome.js", "utf8");
const chromeCss = fs.readFileSync("shared/xi-chrome.css", "utf8");
const tokens = fs.readFileSync("shared/xi-tokens.css", "utf8");

/* Render a page the way a browser does: the shared script, then look at what
   it built. Reading the HTML alone would only prove a placeholder exists. */
function render(path, url) {
  const dom = new JSDOM(fs.readFileSync(path, "utf8"),
    { runScripts: "outside-only", url });
  dom.window.eval(chromeJs);
  dom.window.XIChrome.init();
  return dom.window.document;
}

const cw = render("crossword/index.html", "https://www.thexigames.com/crossword/");
const ws = render("wordsearch/index.html", "https://www.thexigames.com/wordsearch/");

console.log("Every game wears the same bar");
for (const [name, doc] of [["crossword", cw], ["wordsearch", ws]]) {
  t(`${name}: the bar has a burger`, !!doc.querySelector(".xic-bar .xic-burger"));
  /* The wordmark goes home from EVERY view, including mid-board. This is the
     actual fix for being stranded on a puzzle. */
  t(`${name}: the wordmark goes home`,
    doc.querySelector(".xic-bar .xic-home") &&
    doc.querySelector(".xic-bar .xic-home").getAttribute("href") === "/");
  t(`${name}: the drawer is built`, !!doc.querySelector(".xic-drawer"));
  t(`${name}: the footer is built`, !!doc.querySelector(".xic-foot .xic-foot-in"));
}
/* The crossword has two views — a landing page and a board — and the board's
   header used to have no navigation whatsoever. Both must carry a bar. */
t("the crossword carries a bar in BOTH its views, so a board is never a dead end",
  fs.readFileSync("crossword/index.html", "utf8").split('class="xic-bar"').length - 1 === 2);

console.log("\nThe squad is declared once");
t("neither game's HTML lists the games itself", (() => {
  const raw = fs.readFileSync("crossword/index.html", "utf8") +
              fs.readFileSync("wordsearch/index.html", "utf8");
  /* A hand-written list of the family in markup is the thing this replaces:
     the crossword's old footer had one, and it linked to a subdomain that had
     been migrated away from and named two unreleased games. */
  return !/Wordsearch XI<\/(span|a)>/.test(raw);
})());
t("both games get the same eleven slots from it",
  cw.querySelectorAll(".xic-squad .xic-slot").length === 11 &&
  ws.querySelectorAll(".xic-squad .xic-slot").length === 11);
t("and the same released games, in the same order", (() => {
  const named = (d) => [...d.querySelectorAll("a.xic-slot span:last-child")]
    .map((e) => e.textContent).join("|");
  return named(cw) === named(ws) && named(cw).indexOf("Crossword XI|Wordsearch XI") === 0;
})());

console.log("\nAn unreleased game is never named");
/* The standing rule, and live_check enforces it on the hub only — which is how
   the crossword's landing footer named QuickFire XI and Scrambled XI, and
   privacy.html named five, on live indexed pages. */
const UNRELEASED = ["QuickFire", "Scrambled", "Missing XI", "Transfer XI",
                    "Player Chain", "Link XI", "Odd One Out"];
for (const [label, file] of [
  ["the crossword page", "crossword/index.html"],
  ["the word search page", "wordsearch/index.html"],
  ["how-to-play", "crossword/how-to-play.html"],
  ["privacy", "crossword/privacy.html"],
  ["the hub", "index.html"],
]) {
  if (!fs.existsSync(file)) continue;
  /* Comments are not markup: an explanation of why a name was removed must be
     allowed to mention it, or the record of the fix cannot be kept next to it. */
  const markup = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const found = UNRELEASED.filter((n) => markup.indexOf(n) > -1);
  t(`${label} names none`, found.length === 0, found.join(", "));
}
/* The count is derived from the squad rather than written down: hard-coding 9
   means this assertion has to be edited every time a game ships, and an
   assertion nobody remembers to edit is the next frozen constant. */
/* Scoped to the squad list. Unscoped, this also counts the drawer footer’s
   How to play / Answers / Privacy links, which are .xic-slot too. */
const releasedSlots = cw.querySelectorAll(".xic-squad .xic-slot[href]").length;
t("the drawer shows unbuilt slots as a number and a status, never a name",
  [...cw.querySelectorAll(".xic-slot.soon")].every((e) =>
    e.querySelector(".xic-shirt") && e.querySelector(".xic-status")) &&
  cw.querySelectorAll(".xic-slot.soon").length === 11 - releasedSlots,
  `${releasedSlots} released, ${cw.querySelectorAll(".xic-slot.soon").length} unbuilt`);

console.log("\nOne palette, and the chrome defines none of it");
t("xi-chrome.css sets no colour of its own",
  !/#[0-9a-fA-F]{3,8}\b/.test(chromeCss.replace(/\/\*[\s\S]*?\*\//g, "")),
  "every value comes from the tokens");
t("and every variable it uses is defined in xi-tokens.css", (() => {
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = [...new Set([...chromeCss.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  const missing = used.filter((v) => !defined.has(v));
  return missing.length === 0;
})());
/* This one is not theoretical: the crossword carried a private copy of the
   palette missing --tint, --tap and --xi-ink, so width:var(--tap) was invalid
   and render_test measured the burger at 20px. Both games must load the shared
   tokens, and load them BEFORE the chrome that depends on them. */
for (const [name, file] of [["crossword", "crossword/index.html"],
                            ["wordsearch", "wordsearch/index.html"]]) {
  const html = fs.readFileSync(file, "utf8");
  const iTok = html.indexOf("xi-tokens.css");
  const iChrome = html.indexOf("xi-chrome.css");
  t(`${name} loads the shared tokens before the chrome`,
    iTok > -1 && iChrome > -1 && iTok < iChrome);
}

console.log("\nThe green means a correct answer, not furniture");
/* --pitch on a masthead is why a correct answer had to shout. The bar is
   paper; the only furniture still allowed green is the marker for the tab you
   are on, which is a fact about state rather than decoration. */
t("the shared bar is paper, not pitch",
  /\.xic-bar\s*\{[^}]*background:\s*var\(--paper\)/.test(chromeCss));
t("and the crossword's masthead strip no longer paints itself green",
  !/\.site-head\s*\{\s*background:\s*var\(--pitch\)\s*\}/.test(
    fs.readFileSync("crossword/css/style.css", "utf8")));

console.log("\nThe controls are the size of their targets");
/* render_test measures the element's own box, and it is right to: a hit area
   faked with a pseudo-element is invisible to assistive tech. Reported as
   "xic-burger:34" on every viewport, then "xic-burger:20" when --tap did not
   resolve. Both are fixed; this keeps them fixed. */
t("the burger and the close button are var(--tap), not a pseudo-element",
  /\.xic-burger\s*\{[^}]*width:\s*var\(--tap\)/.test(chromeCss) &&
  /\.xic-close\s*\{[^}]*width:\s*var\(--tap\)/.test(chromeCss) &&
  !/\.xic-burger::after/.test(chromeCss));
t("--tap is a token, so no page can disagree about the floor",
  /--tap\s*:\s*44px/.test(tokens));

console.log("\nThe drawer can be left");
t("escape closes it", /key === "Escape"/.test(chromeJs));
t("the scrim closes it", /scrim\.addEventListener\("click", close\)/.test(chromeJs));
t("focus moves into it on open and back to the opener on close",
  /first\.focus\(\)/.test(chromeJs) && /opener\.focus\(\)/.test(chromeJs));
t("and it respects a player who asked for no animation",
  /prefers-reduced-motion/.test(chromeCss));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
