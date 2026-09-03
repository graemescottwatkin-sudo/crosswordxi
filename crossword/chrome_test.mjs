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
const themeJs = fs.readFileSync("shared/xi-theme.js", "utf8");
const chromeCss = fs.readFileSync("shared/xi-chrome.css", "utf8");
const tokens = fs.readFileSync("shared/xi-tokens.css", "utf8");

/* Render a page the way a browser does: the shared script, then look at what
   it built. Reading the HTML alone would only prove a placeholder exists. */
function render(path, url) {
  const dom = new JSDOM(fs.readFileSync(path, "utf8"),
    { runScripts: "outside-only", url });
  dom.window.eval(themeJs);
  dom.window.eval(chromeJs);
  dom.window.XIChrome.init();
  return dom.window.document;
}

const cw = render("crossword/index.html", "https://www.thexigames.com/crossword/");
const ws = render("wordsearch/index.html", "https://www.thexigames.com/wordsearch/");
/* THE WHOLE SITE WEARS IT, not the games alone. The hub had its own
   masthead and footer and the two static pages their own, so the front door
   and a policy page read as different sites from the games they belong to. */
const sc = render("scrambled/index.html", "https://www.thexigames.com/scrambled/");
const hub = render("index.html", "https://www.thexigames.com/");
const priv = render("crossword/privacy.html", "https://www.thexigames.com/crossword/privacy.html");
const htp = render("crossword/how-to-play.html", "https://www.thexigames.com/crossword/how-to-play.html");

console.log("Every page wears the same bar");
for (const [name, doc] of [["crossword", cw], ["wordsearch", ws], ["scrambled", sc],
                           ["the hub", hub], ["privacy", priv], ["how to play", htp]]) {
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
const UNRELEASED = ["QuickFire", "Missing XI", "Transfer XI",
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
  /* Case-insensitively, and with href and src values removed: "quickfire xi"
     in lower case used to walk past a check called "names none", and the
     route in to a game in testing is a path, not a name. */
  const markup = fs.readFileSync(file, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\b(?:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  const found = UNRELEASED.filter((n) => new RegExp(n, "i").test(markup));
  t(`${label} names none`, found.length === 0, found.join(", "));
}
/* The count is derived from the squad rather than written down: hard-coding 9
   means this assertion has to be edited every time a game ships, and an
   assertion nobody remembers to edit is the next frozen constant. */
/* Scoped to the squad list. Unscoped, this also counts the drawer footer’s
   How to play / Answers / Privacy links, which are .xic-slot too.

   RELEASED IS NAMED, not merely linked. A game in testing is a link as well
   now, so counting [href] counted it as released and left the arithmetic one
   short — which is this check doing its job on the day the third state
   arrived. Released slots are the ones that are not .soon. */
const releasedSlots = cw.querySelectorAll(".xic-squad .xic-slot[href]:not(.soon)").length;
t("the drawer shows unbuilt slots as a number and a status, never a name",
  [...cw.querySelectorAll(".xic-slot.soon")].every((e) =>
    e.querySelector(".xic-shirt") && e.querySelector(".xic-status")) &&
  cw.querySelectorAll(".xic-slot.soon").length === 11 - releasedSlots,
  `${releasedSlots} released, ${cw.querySelectorAll(".xic-slot.soon").length} unbuilt`);

console.log("\nA game in testing is reachable, and still not named");
/* The third state. Built and playable but not launched: the owner asked for
   those to be reachable from the front door, under "the rest of the XI". What
   they get is a way in — the drawer slot opens, and the hub's dashed card
   opens — while the name stays off every served page, which is the standing
   rule and the checks above still hold it. */
const testingSlots = [...cw.querySelectorAll(".xic-squad .xic-slot.soon[href]")];
t("the slot for a game in testing opens", testingSlots.length === 1,
  testingSlots.map((e) => e.getAttribute("href")).join(", "));
t("and says only its number and its status, never a name", (() => {
  const e = testingSlots[0];
  if (!e) return false;
  const status = e.querySelector(".xic-status");
  return !!e.querySelector(".xic-shirt") && !!status && /testing/i.test(status.textContent) &&
    /* The whole of its text is the shirt and the status: nothing else has
       crept in, which is the property "never a name" actually needs. */
    e.textContent.replace(/\s+/g, " ").trim() === `5${status.textContent}`;
})());
t("the route in is marked nofollow, so it is not an announcement",
  !!testingSlots[0] && testingSlots[0].getAttribute("rel") === "nofollow");
/* The footer lists games by NAME. A slot with a href and no name put an
   empty link into the footer of every page on the site. */
t("the footer names released games only, with no empty link", (() => {
  const links = [...cw.querySelectorAll(".xic-foot-in a")];
  return links.length > 0 && links.every((a) => a.textContent.trim().length > 0) &&
    !links.some((a) => a.getAttribute("href") === "/quickfire/");
})());
t("the hub carries the same route in, on a card under the rest of the XI", (() => {
  const card = hub.querySelector(".soon-grid a.soon-card");
  if (!card) return false;
  const strip = hub.querySelector(".xi-strip");
  return card.getAttribute("href") === "/quickfire/" &&
    card.getAttribute("rel") === "nofollow" &&
    /in testing/i.test(card.textContent) &&
    /Number five/i.test(card.textContent) &&
    /* Not in Out now, and not promoted to a live shirt in the roll-call. */
    !card.closest("section").textContent.includes("Out now") &&
    !!strip && strip.querySelectorAll("a.shirt.live").length === 4;
})());

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
t("escape closes it", (() => {
  /* Executed, not read: this matched the source for one phrase and went red
     when the handler grew to close the sheet and the menu as well. */
  const doc = render("scrambled/index.html", "https://www.thexigames.com/scrambled/");
  const win = doc.defaultView;
  doc.querySelector(".xic-burger").click();
  const opened = doc.querySelector(".xic-drawer").classList.contains("open");
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
  return opened && !doc.querySelector(".xic-drawer").classList.contains("open");
})());
t("the scrim closes it", /scrim\.addEventListener\("click", close\)/.test(chromeJs));
t("focus moves into it on open and back to the opener on close",
  /first\.focus\(\)/.test(chromeJs) && /opener\.focus\(\)/.test(chromeJs));
t("and it respects a player who asked for no animation",
  /prefers-reduced-motion/.test(chromeCss));


console.log("\nThe account and the settings are universal");
/* They were the crossword's: a Sign in / Account / Settings trio in its bar,
   an account sheet of its own and a settings menu built from its footer.
   Every other game had a sign-in row in the drawer and no settings. The
   owner's rule is that they are universal, so the chrome draws them into
   every bar and no page writes them. */
const hilo = render("hilo/index.html", "https://www.thexigames.com/hilo/");
for (const [name, doc] of [["crossword", cw], ["wordsearch", ws], ["scrambled", sc], ["hilo", hilo],
                           ["the hub", hub], ["privacy", priv], ["how to play", htp]]) {
  const bars = [...doc.querySelectorAll(".xic-bar")];
  t(`${name}: every bar carries Sign in, Account and Settings`,
    bars.length > 0 && bars.every((b) => b.querySelector(".xic-right .xic-signin") &&
      b.querySelector(".xic-right .xic-account") && b.querySelector(".xic-right .xic-settings")));
}
t("the crossword's two bars both carry them, and the page itself writes none",
  cw.querySelectorAll(".xic-bar .xic-signin").length === 2 &&
  !/id="homeSignIn"|id="homeAccount"|id="homeSettings"/.test(fs.readFileSync("crossword/index.html", "utf8")));
t("a bar filled twice has one burger, not two", (() => {
  const doc = render("wordsearch/index.html", "https://www.thexigames.com/wordsearch/");
  doc.defaultView.XIChrome.init();
  return doc.querySelectorAll(".xic-bar .xic-burger").length === 1 &&
    doc.querySelectorAll(".xic-bar .xic-settings").length === 1;
})());
t("the sign-in controls stay hidden until the session is known",
  hilo.querySelector(".xic-signin").hidden && hilo.querySelector(".xic-account").hidden);
t("no page carries an account sheet of its own", (() => {
  const raw = ["crossword/index.html", "wordsearch/index.html", "scrambled/index.html", "hilo/index.html", "index.html"]
    .map((f) => fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "")).join("");
  return !/id="accountSheet"|id="googleBtn"|accounts\.google\.com\/gsi/.test(raw);
})());

{
  const doc = hilo, win = doc.defaultView, X = win.XIChrome;
  t("the account sheet is built on the first ask, once", (() => {
    if (doc.querySelector(".xic-sheet")) return false;
    X.account.open(); X.account.close(); X.account.open();
    return doc.querySelectorAll(".xic-sheet").length === 1 && !doc.querySelector(".xic-sheet").hidden;
  })());
  const sheet = doc.querySelector(".xic-sheet");
  t("it offers Google, a device code both ways, a name, and sign out",
    !!sheet.querySelector(".xic-gsi") && !!sheet.querySelector(".xic-code-mine") &&
    !!sheet.querySelector(".xic-code-in") && !!sheet.querySelector(".xic-name") &&
    !!doc.getElementById("xicAcctSignOut") && !!doc.getElementById("xicAcctClose"));
  t("the device code is twelve characters from the family key",
    /^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/.test(sheet.querySelector(".xic-code-mine").textContent) &&
    win.localStorage.getItem("xi.deviceCode").length === 12);
  t("and it says what signing in shares, beside the button",
    /name and email/.test(sheet.querySelector(".xic-out").textContent) && !!sheet.querySelector('.xic-out a[href*="privacy"]'));
  t("no password field exists in it", sheet.querySelectorAll("input[type=password]").length === 0);
  t("Escape closes it", (() => {
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
    return sheet.hidden;
  })());

  /* The menu: the family's theme row, then whatever the game adds. */
  let pressed = 0, shown = true;
  X.addSetting({ label: "Letter bank", state: () => (pressed % 2 ? "off" : "on"), press: () => { pressed++; }, shown: () => shown });
  const btn = doc.querySelector(".xic-bar .xic-settings");
  X.settings.open(btn);
  const pop = doc.querySelector(".xic-pop");
  const rows = () => [...pop.querySelectorAll(".xic-row")].map((r) => r.textContent);
  t("the settings menu opens under the bar's button with the theme row first",
    !!pop && !pop.hidden && /^Theme/.test(rows()[0]) && btn.getAttribute("aria-expanded") === "true");
  t("a row a game adds appears with its state", rows().some((r) => r === "Letter bankon"));
  t("pressing it presses the game's control and the menu stays open, restated", (() => {
    [...pop.querySelectorAll(".xic-row")].find((r) => /Letter bank/.test(r.textContent)).click();
    return pressed === 1 && !pop.hidden && rows().some((r) => r === "Letter bankoff");
  })());
  t("the theme row cycles the family theme and announces it", (() => {
    let heard = null;
    doc.addEventListener("xi:theme", (ev) => { heard = ev.detail.choice; });
    pop.querySelector('[data-row="theme"]').click();
    return heard !== null && win.XITheme.get() === heard &&
      doc.documentElement.getAttribute("data-theme") === (heard === "dark" ? "dark" : "light");
  })());
  t("a row whose control is hidden is left out", (() => {
    shown = false; X.settings.close(); X.settings.open(btn);
    return !rows().some((r) => /Letter bank/.test(r));
  })());
  t("the menu ends with Privacy", /Privacy/.test(rows()[rows().length - 1]));
  t("and Escape closes it too", (() => {
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
    return pop.hidden && btn.getAttribute("aria-expanded") === "false";
  })());
}

console.log("\nClearing a record clears the family's, not one game's");
/* "Clear everything" swept fcw. only, so the word search, Scrambled and HiLo
   survived a reset the server had already carried out in full — the two sides
   disagreeing about what everything meant. It lives in the chrome because the
   project's rule is that a game never writes another game's prefix. */
{
  const doc = render("hilo/index.html", "https://www.thexigames.com/hilo/");
  const win = doc.defaultView, store = win.localStorage;
  const records = ["fcw.results.v1", "fcw.v04.daily.3", "xiws.results",
                   "xiws.daily.2026-09-02", "xisc.results", "xihl.results", "qfx.results"];
  const kept = ["xi.theme", "xi.club", "xi.deviceCode", "fcw.clubPref",
                "fcw.deviceCode", "fcw.pitch", "fcw.bank"];
  records.concat(kept).forEach((k) => store.setItem(k, "x"));
  const removed = win.XIChrome.records.clear();
  t("every game's record goes, not just the one you are on",
    records.every((k) => store.getItem(k) === null), `${removed} removed`);
  /* A reset clears what you have DONE, never how you like the thing to look
     and never who you are — wiping the device code would cut somebody off
     from results already synced to their account. */
  t("and no preference or identity goes with them",
    kept.every((k) => store.getItem(k) === "x"),
    kept.filter((k) => store.getItem(k) !== "x").join(", ") || "all kept");
  t("the game that asks does not reach into another game's prefix itself", (() => {
    const js = fs.readFileSync("crossword/js/game.js", "utf8");
    return /XIChrome\.records\.clear\(\)/.test(js) &&
      !/localStorage[^\n]*xiws\.|localStorage[^\n]*xisc\.|localStorage[^\n]*xihl\./.test(js);
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
