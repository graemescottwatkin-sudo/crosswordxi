/* aligned_test.mjs — the contract every game in the family signs.
 *
 *   node tools/aligned_test.mjs        (from the repo root)
 *
 * WHY THIS EXISTS, WRITTEN THE NIGHT BEFORE GAME THREE. With one game, there
 * is nothing to align. With two, every shared fact quietly grew a second copy
 * and one of them drifted: the palette declared twice, the chrome grown twice,
 * the CSRF header named per-game, the tag law real in one gate and a costume
 * in the other ("v000" — a check that compared every build against nothing),
 * a merge rule that agreed by coincidence until two devices disagreed forever.
 * Game three triples every one of those opportunities on the day it lands.
 *
 * THE SHAPE. One GAMES table. Every check below runs identically for every
 * row. Adding a game is adding a row — and the moment it is added, the whole
 * contract applies to it. A check that must be copied per game would itself
 * be the fault this suite exists to end.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}
const read = (p) => fs.readFileSync(p, "utf8");
const has = (p) => fs.existsSync(p);

/* Every stylesheet a game ships, wherever it keeps them. */
function listCss(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = d + "/" + e.name;
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".css")) out.push(f);
    }
  };
  try { walk(dir); } catch (e) { /* a game with no stylesheets of its own */ }
  return out;
}

/* The selectors of a stylesheet, by splitting on braces. Enough for the
   question asked of it — what does this rule land on — and it cannot lose a
   backslash the way a pattern can. @media heads are skipped rather than
   parsed: their contents come round again as ordinary rules. */
function selectorsOf(css) {
  /* Comments first. This project comments heavily inside its stylesheets, and
     prose read as selectors turns a real finding into a coincidence: the first
     run of the collision check reported a clash on "so white", which is not a
     selector at all. It happened to fire on the right file for the wrong
     reason, which is worse than not firing. */
  let out2 = "";
  for (let k = 0; k < css.length; k++) {
    if (css[k] === "/" && css[k + 1] === "*") {
      const end = css.indexOf("*/", k + 2);
      if (end < 0) break;
      k = end + 1;
      continue;
    }
    out2 += css[k];
  }
  css = out2;
  const out = [];
  for (const chunk of css.split("}")) {
    const head = chunk.split("{")[0];
    if (!head || head.includes("@")) continue;
    for (const sel of head.split(",")) if (sel.trim()) out.push(sel);
  }
  return out;
}

/* THE FAMILY. dir is the path under the root and the URL; prefix is the
   game's localStorage namespace — distinct per game, or two games sharing a
   browser overwrite each other's saves. */
/* `dir` is where the game LIVES, and since 5 Sep 2026 that is under its theme:
   other kinds of quiz are coming and XI never meant football. Written out
   rather than composed, because this table is the family's own statement of
   what a game is — but it agrees with gameDir() in permalink.js, and the check
   below holds the two together so a game cannot live in one place and be
   addressed in another. */
/* `id` IS NOT `dir`, AND THE MOVE IS WHAT SEPARATED THEM. They were the same
   word until 5 Sep 2026 and every check could use either. Now a game is
   identified as "crossword" — in the server's game list, in its results rows,
   in its storage prefix — and LIVES at football/crossword. Conflating them
   made this file ask games.js whether it listed "football/crossword", which it
   does not and must not: an id is not a path, and the day the theme changes
   the id must not change with it. */
const GAMES = [
  { id: "crossword",  dir: "football/crossword",  name: "Crossword XI",  prefix: "fcw"  },
  { id: "wordsearch", dir: "football/wordsearch", name: "Wordsearch XI", prefix: "xiws" },
  { id: "scrambled",  dir: "football/scrambled",  name: "Scrambled XI",  prefix: "xisc" },
  { id: "hilo",       dir: "football/hilo",       name: "HiLo XI",       prefix: "xihl" },
  { id: "vowels",     dir: "football/vowels",     name: "Vowels XI",     prefix: "xivw" },
];

const workflow = read(".github/workflows/checks.yml");
const headers = read("_headers");

for (const g of GAMES) {
  console.log(`\n=== ${g.name} (${g.dir}/) ===`);
  const html = has(`${g.dir}/index.html`) ? read(`${g.dir}/index.html`) : "";
  const css = has(`${g.dir}/css/style.css`) ? read(`${g.dir}/css/style.css`) : "";
  const js = has(`${g.dir}/js/game.js`) ? read(`${g.dir}/js/game.js`) : "";

  console.log("Furniture every game must have");
  t("a page, a stylesheet and a script", !!html && !!css && !!js);
  t("its own deploy gate", has(`${g.dir}/deploy_check.mjs`));
  t("its own live check", has(`${g.dir}/live_check.mjs`),
    "post-deploy verification is per game, not per whoever remembered");
  t("a cache block in _headers for its path",
    headers.indexOf(`/${g.dir}/css/*`) > -1 && headers.indexOf(`/${g.dir}/js/*`) > -1);
  t("at least one of its suites named in the workflow",
    new RegExp(`node ${g.dir}/[a-z_]+_test\\.mjs`).test(workflow));

  console.log("The tag law is real, not a costume");
  const gate = has(`${g.dir}/deploy_check.mjs`)
    ? read(`${g.dir}/deploy_check.mjs`) : "";
  const shipped = (gate.match(/const LAST_SHIPPED = "([^"]+)"/) || [])[1];
  /* "v000" compared every build against nothing for as long as the word
     search existed. A sentinel constant is a check that cannot fail. */
  t("LAST_SHIPPED exists and is not a sentinel",
    !!shipped && shipped !== "v000", `shipped ${shipped}`);
  /* v001v: LAST_PRESENTED retired. It tracked packages handed over, and the
     zips have stopped — it had frozen at the last one while releases carried
     on. A constant nothing moves is a comparison against nothing, which is the
     sentinel fault under another name. The burn rule now rides on
     LAST_SHIPPED alone. */
  t("and LAST_PRESENTED is gone rather than frozen",
    !/const LAST_PRESENTED/.test(gate));
  const ownTag = (html.match(/js\/game\.js\?v=(v[0-9a-z]+)"/) || [])[1];
  t("the page's script tag and the script's BUILD agree",
    !!ownTag && js.indexOf(`var BUILD = "${ownTag}"`) > -1, ownTag);

  console.log("One chrome, one palette");
  t("the shared tokens are loaded before the shared chrome", (() => {
    const iTok = html.indexOf("shared/xi-tokens.css");
    const iChr = html.indexOf("shared/xi-chrome.css");
    return iTok > -1 && iChr > -1 && iTok < iChr;
  })());
  t("the shared chrome script is loaded and a bar is placed",
    /shared\/xi-chrome\.js/.test(html) && /class="xic-bar"/.test(html));
  /* THE THEME IS DECIDED ONCE. shared/xi-theme.js stamps the root before
     first paint — light unless chosen — and it must be in the head, because
     a resolver that runs after the stylesheet paints is a flash of the wrong
     palette on every dark-system phone. A game resolving the theme itself
     is a second answer to one question. */
  t("the shared theme script is loaded in the head, and the game keeps no resolver of its own",
    html.indexOf("shared/xi-theme.js") > -1 && html.indexOf("shared/xi-theme.js") < html.indexOf("</head>") &&
    !/prefers-color-scheme/.test(js) && !/setAttribute\("data-theme"/.test(js));
  /* HOW FAR PEOPLE GET, in every game: the shared helper is loaded and the
     game calls it at a start and at an end. A game that loaded it and never
     called it would count nothing and look counted. */
  t("the shared play helper is loaded, and the game starts and ends a play through it",
    /shared\/xi-plays\.js/.test(html) &&
    (/XIPlays\.start\(/.test(js) || /\.XIPlays\.start\(/.test(js)) &&
    (/XIPlays\.end\(/.test(js) || /\.XIPlays\.end\(/.test(js) || /playEnd\(/.test(js)));
  t("the game's own stylesheet defines no .xic- rules",
    !/^\s*\.xic-[a-z-]+[^{]*\{/m.test(css),
    "a game styling the chrome is a second chrome starting");

  console.log("Identity");
  const grab = (re) => ((html.match(re) || [])[1] || "")
    .split(/&mdash;|&ndash;|—|–|\|/)[0].trim();
  const names = [
    grab(/<title>([^<]+)<\/title>/),
    grab(/property="og:title" content="([^"]+)"/),
    grab(/"name":\s*"([^"]+)"/),
    grab(/<h1[^>]*>([^<]+)<\/h1>/),
  ].filter(Boolean);
  t("the name is identical in title, og:title, JSON-LD and h1",
    names.length === 4 && new Set(names).size === 1, [...new Set(names)].join(" / "));
  t("and it is the name on the team sheet", names[0] === g.name,
    `${names[0]} vs ${g.name}`);
  t("the canonical names its own address",
    html.indexOf(`href="https://www.thexigames.com/${g.dir}/"`) > -1);
  /* The disclaimer is a FAMILY sentence, declared once in the shared chrome's
     footer and mounted by every game — wording parity across the family is a
     legal-review requirement, and eleven hand-copied sentences would drift.
     So the check is: the sentence lives in the chrome, and this page mounts
     the footer that carries it. The first draft grepped each page's static
     HTML, which fails for exactly the right reason: the sentence is not IN
     the page, and must not be. */
  t("the page mounts the shared footer that carries the disclaimer",
    /class="xic-foot"/.test(html) &&
    /Not affiliated with/.test(read("shared/xi-chrome.js")));
  /* AND IT MUST NOT BE SEALED INSIDE A VIEW.
     The check above greps for the class, which is true of a footer nested in a
     container that hides. The crossword's sat inside #homeOverlay, so it left
     the page the moment a board opened: the family footer was present in the
     markup and absent from the screen for the whole of every game, and this
     contract called that mounted. Depth is counted, not matched — a regex
     cannot tell nesting. */
  t("and the shared footer is at top level, not inside a view that hides", (() => {
    const body = html.slice(html.indexOf("<body"));
    const at = body.indexOf('<footer class="xic-foot"');
    if (at < 0) return false;
    const before = body.slice(0, at).replace(/<!--[\s\S]*?-->/g, "");
    const opens = (before.match(/<div\b/g) || []).length;
    const closes = (before.match(/<\/div>/g) || []).length;
    return opens - closes === 0;
  })());

  console.log("Its own keys, and only its own");
  t(`every localStorage key it writes is under "${g.prefix}." or the family's "xi."`, (() => {
    /* THREE WAYS A KEY REACHES setItem, and the check has to see all three or
       it is measuring whichever ones it happens to understand.

         setItem("xi.theme", …)   a literal
         setItem(RESULTS_KEY, …)  a constant, resolved to its literal
         setItem(storeKey(), …)   a builder, resolved to what it returns

       Only the first two were read. Scrambled XI builds its key — one save
       per board, so the key carries the board number — and the check saw no
       writes at all, then failed the game for having none. A game doing the
       right thing failed a check that could not look at it. */
    /* THREE WAYS A KEY REACHES setItem, and the check has to see all three or
       it is measuring whichever ones it happens to understand.

         setItem("xi.theme", ...)  a literal
         setItem(RESULTS_KEY, ...) a constant, resolved to its literal
         setItem(storeKey(), ...)  a builder, resolved to what it returns

       Only the first two were read. Scrambled XI builds its key — one save
       per board, so the key carries the board number — so the check saw no
       writes at all and then failed the game for having none. A game doing
       the right thing failed a check that could not look at it.

       Scanned by splitting rather than by pattern: several checks written
       into this repo lost a backslash on the way to the file and became
       patterns that matched nothing while still reporting ok. */
    const QUOTE = String.fromCharCode(34);
    /* The first argument of every setItem call, with bracket depth honoured:
       boardSlot({ kind: "daily", no: n }) is ONE argument, and cutting at the
       first comma turned it into a fragment that resolved to nothing. */
    const firstArgs = (src, call) => {
      const out = [];
      let at = 0;
      for (;;) {
        const i = src.indexOf(call, at);
        if (i < 0) break;
        at = i + call.length;
        let depth = 0, arg = "";
        for (let k = at; k < src.length && k < at + 400; k++) {
          const c = src[k];
          if (c === "(" || c === "{" || c === "[") depth++;
          else if (c === ")" || c === "}" || c === "]") { if (depth === 0) break; depth--; }
          else if (c === "," && depth === 0) break;
          arg += c;
        }
        out.push(arg.trim());
      }
      return out;
    };
    const literalOf = (name) => {
      const head = "var " + name + " = " + QUOTE;
      const at = js.indexOf(head);
      if (at < 0) return null;
      return js.slice(at + head.length, js.indexOf(QUOTE, at + head.length));
    };
    /* A builder is judged by EVERY key it can return, not by the first one.
       slotKey() returns one key for practice and another for a board; a check
       that read only the first would pass a function whose other branch wrote
       anywhere it liked. */
    const returnsOf = (fnName) => {
      const at = js.indexOf("function " + fnName);
      if (at < 0) return null;
      let end = js.indexOf(String.fromCharCode(10) + "  function ", at + 1);
      if (end < 0) end = at + 1500;
      const body = js.slice(at, end);
      const outs = [];
      let k = 0;
      for (;;) {
        const r = body.indexOf("return ", k);
        if (r < 0) break;
        k = r + 7;
        outs.push(body.slice(k, body.indexOf(";", k)).split("+")[0].trim());
      }
      return outs;
    };
    /* RESOLVED RECURSIVELY, because a builder may hand off to another one:
       slotKey() returns a literal on one branch and boardSlot(board) on the
       other, and stopping at the call left that branch reading as an empty
       key — a real key the check could not see, reported as a violation.
       `seen` stops a pair of mutually-recursive builders spinning. */
    const keysOf = (tok, seen) => {
      seen = seen || new Set();
      if (tok.indexOf(QUOTE) === 0) return [tok.slice(1, tok.indexOf(QUOTE, 1))];
      const paren = tok.indexOf("(");
      if (paren < 0) { const v = literalOf(tok); return v === null ? [] : [v]; }
      const name = tok.slice(0, paren);
      if (seen.has(name)) return [];
      seen.add(name);
      const outs = returnsOf(name);
      if (!outs) return [];
      return outs.flatMap((o) => keysOf(o, seen));
    };
    const writes = firstArgs(js, "localStorage.setItem(");
    /* Wrapped, not passed bare: flatMap hands the index as the second
       argument, which arrived where `seen` was expected. */
    const keys = writes.flatMap((tok) => keysOf(tok));
    return writes.length > 0 && keys.length > 0 && keys.every((k) =>
      k.indexOf(g.prefix + ".") === 0 || k.indexOf("xi.") === 0);
  })());
  const others = GAMES.filter((o) => o !== g);
  t("and it never WRITES another game's keys", others.every((o) => {
    const writes = [...js.matchAll(/localStorage\.setItem\(\s*"([^"]+)"/g)].map((m) => m[1]);
    return writes.every((k) => k.indexOf(o.prefix + ".") !== 0);
  }), "reading a legacy key during migration is allowed; writing one is not");
}

console.log("\n=== The family as a whole ===");
/* The squad list lives in the chrome and nowhere else. */
const chrome = read("shared/xi-chrome.js");
t("every released game is on the chrome's squad list, at its own path",
  GAMES.every((g) => chrome.indexOf(`href: "/${g.dir}/"`) > -1 &&
                     chrome.indexOf(`"${g.name}"`) > -1));
/* THE SITEMAP IS GENERATED NOW, so this reads the generator rather than a
   file. The file it replaced held thirteen URLs and not one board, months
   after the permalinks shipped — a hand-kept list of pages that appear daily
   was never going to hold them. */
t("the sitemap lists every released game",
  GAMES.every((g) => read("functions/sitemap.xml.js").indexOf(`"/${g.dir}/"`) > -1));
t("and there is no static sitemap left to be served instead",
  !has("sitemap.xml"),
  "two answers to one URL is the fault this file exists to catch");
t("the CSRF rule is the family's, defined once",
  /export const CSRF_HEADER = "X-XI-Games"/.test(read("functions/_lib/auth.js")) &&
  GAMES.every((g) => {
    const js = read(`${g.dir}/js/game.js`);
    /* Either header satisfies the server; what is forbidden is a game
       inventing a third. */
    return /"X-XI-Games"|"X-Crossword-XI"/.test(js);
  }));
t("the server's game list and this table agree", (() => {
  const lib = read("functions/_lib/games.js");
  const listed = (lib.match(/GAMES = \[([^\]]+)\]/) || [, ""])[1];
  return GAMES.every((g) => listed.indexOf(`"${g.id}"`) > -1);
})(), "functions/_lib/games.js");
t("no game carries a private copy of a shared file",
  GAMES.every((g) => !has(`${g.dir}/xi-tokens.css`) && !has(`${g.dir}/xi-chrome.css`) &&
                     !has(`${g.dir}/xi-chrome.js`)));

/* THE SHARED LAYER HAS THE SAME PROBLEM EVERY GAME HAD, AND HAD NO GATE FOR IT.
   Each game's gate refuses assets that change without their tag moving. The
   shared files are outside every one of those gates: _headers marks /shared/*
   immutable for a year, and the pages reference it as ?v=v1. So editing
   xi-chrome.js — the squad list, which decides what the drawer shows in EVERY
   game — changes what every page renders while every browser holding the old
   file keeps it for a year.

   Found by the QuickFire integration: adding a game to the squad list changes
   all three drawers and nothing anywhere required the ?v= to move. The same
   fault as v001t, one layer up, and the game-level gates cannot see it.

   Move both constants together, in the post-deploy commit, exactly as a game's
   LAST_SHIPPED and LAST_SHIPPED_ASSETS move together. */
const SHARED_TAG = "v23";
const SHARED_HASH = "7d30d957981b1ff9";
/* EVERY PAGE THAT LINKS THE SHARED LAYER, not the games alone. The hub, the
   two static pages and the unlaunched game all carry the chrome now, and the
   server-rendered shell writes the tag from a constant of its own — so a tag
   bump that missed one of them would serve two builds of one chrome. */
const SHARED_PAGES = [
  ...GAMES.map((g) => `${g.dir}/index.html`),
  "index.html", "football/crossword/privacy.html", "football/crossword/how-to-play.html", "football/quickfire/index.html",
];
const sharedRefsOf = (page) => page.split("shared/xi-").slice(1)
  .map((chunk) => chunk.split(String.fromCharCode(34))[0])
  .filter((ref) => ref.indexOf("?v=") > -1);
t("the shared chrome cannot change without its ?v= moving", (() => {
  const h = createHash("sha256");
  /* EVERY served asset in shared/, not the two that existed when this was
     written. The hash covered xi-chrome.js and xi-chrome.css only, so a token
     added to xi-tokens.css moved no hash and asked for no tag — which is how
     the tokens sat on v2 while the chrome went to v5. Documentation is not
     hashed: a wording change in DESIGN.md is not a release. */
  const sharedFiles = fs.readdirSync("shared")
    .filter((f) => f.endsWith(".css") || f.endsWith(".js"))
    .sort().map((f) => "shared/" + f);
  for (const f of sharedFiles) {
    h.update(f); h.update("\0"); h.update(read(f));
  }
  const now = h.digest("hex").slice(0, 16);
  /* EVERY shared asset every page links, not just the script. xi-tokens.css
     sat on v2 while the chrome went to v5, so a token added to it would have
     reached nobody who had visited before — the browser was right to reuse
     what it had. Checking one file of four is checking the one that happened
     to be remembered. Split, not matched: written as a pattern the backslashes
     were eaten on the way into this file and it became a regex that could not
     compile. */
  const tagged = SHARED_PAGES.every((p) => {
    const refs = sharedRefsOf(read(p));
    return refs.length > 0 && refs.every((ref) => ref.split("?v=")[1] === SHARED_TAG);
  }) &&
    /* The server-rendered shell writes its tag from a constant; it is one more
       page, and it must agree. */
    (read("functions/_lib/site-page.js").match(/export const SHARED_TAG = "([a-z0-9]+)"/) || [])[1] === SHARED_TAG;
  if (now === SHARED_HASH) return tagged;
  console.log(`        shared/ CHANGED — bump SHARED_TAG past ${SHARED_TAG} in every ` +
    `page, then set SHARED_HASH to ${now}`);
  return false;
})(), `shared tag ${SHARED_TAG}`);
t("every page references the shared layer at the same version", (() => {
  const tags = SHARED_PAGES.map((p) =>
    (read(p).match(/shared\/xi-chrome\.js\?v=([a-z0-9]+)/) || [])[1]);
  tags.push((read("functions/_lib/site-page.js").match(/export const SHARED_TAG = "([a-z0-9]+)"/) || [])[1]);
  return tags.length > 0 && tags.every(Boolean) && new Set(tags).size === 1;
})(), "one page on an older shared build is two chromes again");
/* THE WHOLE SITE WEARS THE CHROME. The hub and the static pages carried
   their own headers and footers; a page that loads the chrome script and
   places a bar and a footer is one that cannot drift back. */
t("every served page loads the shared chrome and places its bar and footer", (() => {
  const missing = SHARED_PAGES.filter((p) => {
    const html = read(p);
    return !(/shared\/xi-chrome\.js/.test(html) && /class="xic-bar"/.test(html) &&
             /class="xic-foot"/.test(html) && /shared\/xi-theme\.js/.test(html));
  });
  return missing.length === 0;
})(), SHARED_PAGES.join(", "));


/* ---- no game may style a class the chrome puts on the page ---- */
/* THE BUG THIS EXISTS FOR. The wordmark was emitted as a span classed "xi",
   and Crossword XI already had a .xi of its own — a dark green badge for its
   branding. The badge met the the chrome's own colour rule and the XI went dark
   on dark: invisible on one game, correct on the other, from one shared class
   name. The games are already forbidden from writing .xic- rules; this is the
   other half of that fence, and the half that was missing.

   The test is a COLLISION, not a naming convention: the chrome uses a few
   unnamespaced state classes that no game touches, and renaming those buys
   nothing. What must never happen is a game owning a selector that lands on
   the the chrome's own markup.

   Scanned by splitting, not by regex: four checks written this session lost a
   backslash on the way into the file and became patterns matching nothing
   while still reporting ok. */
console.log("\nNo game styles a class the chrome writes");
{
  const Q = String.fromCharCode(34);
  const js = read("shared/xi-chrome.js");

  /* Classes the chrome puts on the page: every class="..." it writes, and the
     second argument of its own el(tag, classes, ...) helper. */
  const written = new Set();
  for (const chunk of js.split("class=" + Q).slice(1)) {
    /* Stop at the first sign of code. A class attribute built by
       concatenation is literal only up to the quote, and reading past it
       collected "k" out of xic-rc xic-" + k + " as though it were a class —
       which then collided with a game's .cal-key .k and reported a clash that
       did not exist. A check that cries wolf gets switched off. */
    let lit = chunk.split(Q)[0];
    for (const stop of ["+", "'", "$", "{"]) {
      const at = lit.indexOf(stop);
      if (at > -1) lit = lit.slice(0, at);
    }
    for (const c of lit.split(" ")) {
      const name = c.trim();
      if (name && name !== "xic-") written.add(name);
    }
  }
  for (const chunk of js.split("el(").slice(1)) {
    const q = chunk.split(Q);
    /* q[1] is the tag, q[3] the class list — but only when nothing but a comma
       separates them, or this is reading some later string entirely. */
    if (q.length > 3 && q[2].trim() === "," ) {
      for (const c of q[3].split(" ")) if (c.trim()) written.add(c.trim());
    }
  }
  t("the chrome writes classes this test can see", written.size > 3,
    written.size + " classes");

  /* A game collides when a rule of its own ENDS in exactly that class: .xi{}
     lands on the the chrome's span, while .cal-key .k.open needs two classes on
     one element and cannot. */
  const clashes = [];
  for (const g of GAMES) {
    let css = "";
    for (const f of listCss(g.dir)) css += read(f) + "\n";
    for (const sel of selectorsOf(css)) {
      const last = sel.trim().split(" ").pop().split(">").pop().trim();
      if (!last.startsWith(".")) continue;
      const name = last.slice(1);
      if (name.includes(".") || name.includes(":")) continue;   // compound: scoped
      if (written.has(name)) clashes.push(g.dir + ": " + sel.trim());
    }
  }
  t("no game owns a selector that lands on the chrome", clashes.length === 0,
    clashes.length ? clashes.join(" | ") : "checked " + GAMES.length + " games");
}



/* ---- the landing shell belongs to one file ---- */
/* The landing was Crossword XI's alone and the word search opened on the
   generation before it — same family, two different sites. The rules moved to
   shared/xi-landing.css unchanged, and all three games load them.

   WHY THIS CHECK AND NOT A PREFIX. The chrome uses xic- to mean "no game may
   restyle this". A landing is a layout games FILL, and renaming eighty rules
   in live markup would have bought a prefix and risked a front page. Single
   ownership is enforced here instead of spelled in the names: a game that
   redefines a selector the shell owns is exactly the drift the prefix would
   have prevented, and this refuses it by name. */
console.log("\nThe landing shell is defined once");
{
  const shellSelectors = new Set();
  for (const sel of selectorsOf(read("shared/xi-landing.css"))) {
    shellSelectors.add(sel.trim());
  }
  t("the shared landing defines the shell", shellSelectors.size > 40,
    shellSelectors.size + " selectors");

  const redefined = [];
  for (const g of GAMES) {
    for (const f of listCss(g.dir)) {
      for (const sel of selectorsOf(read(f))) {
        if (shellSelectors.has(sel.trim())) redefined.push(g.dir + ": " + sel.trim());
      }
    }
  }
  t("and no game redefines any part of it", redefined.length === 0,
    redefined.length ? redefined.slice(0, 4).join(" | ") : "checked " + GAMES.length + " games");

  t("every game loads it", GAMES.every((g) =>
    read(`${g.dir}/index.html`).indexOf("shared/xi-landing.css") > -1));
}

/* ---- games consume tokens; they never define them ---- */
/* THE AUDIT'S HEADLINE. crossword/css/style.css carried its own :root with
   twelve of the shared tokens restated at identical values, and an inverted
   dark palette on top. Change --pitch in shared/ and two games moved; the
   crossword did not. The rule in shared/DESIGN.md is that a game may set a
   custom property only for a fact that exists in that game alone — so any
   name that ALSO exists in the shared token file is a restatement, whatever
   its value, and is refused here by name. Scanned by splitting, not by
   pattern, like every other check in this file that has to survive a shell. */
console.log("\nNo game restates a shared token");
{
  /* COMMENTS ARE NOT DECLARATIONS. This read the whole file, so a comment
     that named a token and then punctuated — "--on-pitch rather than
     --hero-rule: the rule token is tuned for..." — was read as a game
     redefining --hero-rule, and the game had done nothing of the kind. A
     check that can be tripped by prose is one that gets worked around
     rather than trusted. */
  const names = (css) => {
    const out = new Set();
    for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("--").slice(1)) {
      const name = chunk.split(/[^a-z0-9-]/)[0];
      const rest = chunk.slice(name.length).trimStart();
      if (name && rest.startsWith(":")) out.add("--" + name);
    }
    return out;
  };
  const shared = names(read("shared/xi-tokens.css"));
  t("the shared token file defines the palette", shared.size > 60, shared.size + " tokens");
  for (const g of GAMES) {
    const restated = [];
    for (const f of listCss(g.dir)) {
      for (const n of names(read(f))) if (shared.has(n)) restated.push(n);
    }
    t(`${g.name} defines no token the shared file already owns`, restated.length === 0,
      restated.length ? restated.slice(0, 6).join(", ") + (restated.length > 6 ? " …" : "") : "own facts only");
  }
}
/* ---- THE HUB JUDGES EVERY LIVE GAME ----
 *
 * The front door dims a shirt and counts a game in the roll-call once that
 * game has been played today. It does it with one fetch-and-read block per
 * game, written out longhand — and Vowels XI launched with four of those for
 * five live games, so its shirt never went done and the line never counted it.
 * The comment above the block said "three live shirts" while there were four.
 *
 * A block repeated once per game is a block somebody adds four of and forgets
 * the fifth, so this derives the list from the squad rather than restating it:
 * every game in the team sheet above must have its storage prefix read and its
 * shirt marked, or the hub is not judging it. */
console.log("\n=== The hub judges every live game ===");
{
  /* READ THE HUB'S TABLE, NOT THE CODE THAT USES IT.
     This looked for five hand-written blocks — a getItem per prefix and a
     markDone per shirt. That was the right property checked against the wrong
     thing: the hub HAD five copies of one idea, which is exactly why the fifth
     was forgotten the day Vowels launched. It keeps one table now, and five
     literal blocks are what it must never have again — so a check demanding
     them would be demanding the fault back. The table is the one place, and
     this reads the one place.
     Matched on the prefix rather than a guessed key: the crossword's is
     `fcw.results.v1`, and a check that demands a key shape the games never
     agreed on fails a game for being itself. */
  const hub = read("index.html");
  const at = hub.indexOf("var GAMES = [");
  const table = at > -1 ? hub.slice(at, hub.indexOf("];", at)) : "";
  const rows = [...table.matchAll(/n:\s*(\d+),\s*id:\s*"([a-z]+)"[\s\S]*?key:\s*"([^"]+)"/g)]
    .map((m) => ({ n: Number(m[1]), id: m[2], key: m[3] }));
  t("the front door keeps one table of the games, not a block each",
    !!table && rows.length > 0, rows.length + " rows");
  const unjudged = GAMES.filter((g) =>
    !rows.some((r) => r.id === g.id && r.key.indexOf(g.prefix + ".") === 0));
  t("every live game has a row in it, under its own prefix",
    unjudged.length === 0,
    unjudged.length ? unjudged.map((g) => g.name).join(", ") + " not judged"
      : rows.map((r) => r.id).join(", "));
  t("each has its own shirt, and no shirt twice",
    rows.length === GAMES.length &&
    new Set(rows.map((r) => r.n)).size === GAMES.length,
    rows.map((r) => r.n + " " + r.id).join(" | "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
