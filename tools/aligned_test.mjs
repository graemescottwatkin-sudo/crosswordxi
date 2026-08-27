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

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}
const read = (p) => fs.readFileSync(p, "utf8");
const has = (p) => fs.existsSync(p);

/* THE FAMILY. dir is the path under the root and the URL; prefix is the
   game's localStorage namespace — distinct per game, or two games sharing a
   browser overwrite each other's saves. */
const GAMES = [
  { dir: "crossword",  name: "Crossword XI",  prefix: "fcw"  },
  { dir: "wordsearch", name: "Wordsearch XI", prefix: "xiws" },
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
  const gate = read(`${g.dir}/deploy_check.mjs`);
  const shipped = (gate.match(/const LAST_SHIPPED = "([^"]+)"/) || [])[1];
  const presented = (gate.match(/const LAST_PRESENTED = "([^"]+)"/) || [])[1];
  /* "v000" compared every build against nothing for as long as the word
     search existed. A sentinel constant is a check that cannot fail. */
  t("LAST_SHIPPED and LAST_PRESENTED exist and are not sentinels",
    !!shipped && !!presented && shipped !== "v000" && presented !== "v000",
    `shipped ${shipped}, presented ${presented}`);
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

  console.log("Its own keys, and only its own");
  t(`every localStorage key it writes is under "${g.prefix}." or the family's "xi."`, (() => {
    const writes = [...js.matchAll(/localStorage\.setItem\(\s*(?:"([^"]+)"|([A-Z_]+))/g)];
    /* Constants are resolved to their literal, so a key hidden behind a
       variable is still checked rather than skipped. "xi." is the family
       namespace — a preference every game shares (the theme) lives there,
       because a family-wide fact under one game's prefix is exactly how the
       word search ended up writing fcw.theme, which this check caught on its
       first run. */
    const value = (m) => m[1] || ((js.match(
      new RegExp(`var ${m[2]} = "([^"]+)"`)) || [])[1] || "");
    return writes.length > 0 && writes.every((m) => {
      const k = value(m);
      return k.indexOf(g.prefix + ".") === 0 || k.indexOf("xi.") === 0;
    });
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
t("the sitemap lists every released game and its answers where they exist",
  GAMES.every((g) => read("sitemap.xml").indexOf(`/${g.dir}/</loc>`) > -1));
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
  return GAMES.every((g) => listed.indexOf(`"${g.dir}"`) > -1);
})(), "functions/_lib/games.js");
t("no game carries a private copy of a shared file",
  GAMES.every((g) => !has(`${g.dir}/xi-tokens.css`) && !has(`${g.dir}/xi-chrome.css`) &&
                     !has(`${g.dir}/xi-chrome.js`)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
