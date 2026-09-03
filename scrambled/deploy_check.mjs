/* scrambled/deploy_check.mjs — the gate Scrambled XI ships through.
 *
 * Run from the repository root, with no node_modules, no package.json and no
 * .wrangler in the tree. Those are checked, because a gate that passes on a
 * machine with build state and fails on Pages has told you nothing.
 *
 *   node scrambled/deploy_check.mjs        expect 0 failed
 *
 * THE TAG LAW. LAST_SHIPPED is what is LIVE, and LAST_SHIPPED_ASSETS is a hash
 * of the bytes it names. A tag is burned the moment it ships and never goes
 * backwards, so after a deploy this gate fails "moved past the version now
 * live" until the next release moves the tag. That is the law working.
 *
 * WHAT THIS GATE CANNOT SEE. It reads shape, not truth. It will pass a board
 * whose XI is wrong, a career that belongs to another player, or a scramble
 * that is unfair. The bank is checked by tools/build_scrambled.js --check and
 * by the author who sourced it; a green gate here is a well-formed release,
 * not a correct one.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const has = (p) => fs.existsSync(path.join(ROOT, p));

/* WHAT IS LIVE. Bump both after a deploy, with tools/post_deploy.mjs, which
   derives them from the live page rather than trusting anyone's memory. */
const LAST_SHIPPED = "v001r";
const LAST_SHIPPED_ASSETS = "26f95403b5cf0bfe";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* The bytes this game ships, hashed together. Its own assets only: shared/
   carries its own plain vN lifecycle and must not move with the game tag. */
function ownAssetHash() {
  /* THE SAME HASH THE OTHER GATES AND post_deploy COMPUTE, or the bump can
     never match. Discovered from the page, never a hardcoded list — an asset
     added to index.html is covered the day it is added — and hashed as
     name, NUL, bytes in a stable order. The first version of this gate
     hashed a fixed list of bytes only, so the value post_deploy recorded
     could not be reproduced here and the gate went red on the next run for
     a change nobody had made. One hash, three gates, one shape. */
  const paths = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+)\?v=[^"]*"/g)]
    .map((m) => m[1]).sort();
  if (!paths.length) return null;
  const h = crypto.createHash("sha256");
  for (const p of paths) {
    h.update(p); h.update("\0");
    h.update(fs.readFileSync(path.join(ROOT, "scrambled", p)));
  }
  return h.digest("hex").slice(0, 16);
}

const html = read("scrambled/index.html");
const js = read("scrambled/js/game.js");

console.log("The tag law");
const tag = (html.match(/js\/game\.js\?v=(v[0-9a-z]+)"/) || [])[1];
t("asset URLs carry a build tag so a cached copy cannot be reused", !!tag, tag);
t("LAST_SHIPPED is a real version, not a sentinel",
  !!LAST_SHIPPED && LAST_SHIPPED !== "v000", `shipped ${LAST_SHIPPED}`);
/* LAST_PRESENTED is NOT checked here. aligned_test asserts it for every game
   in the family, and a file cannot search itself for a string it must contain
   in order to search for it — written both ways, the check matched its own
   text and failed a file that does not declare the constant at all. One fact,
   one place, and the place is the cross-game contract. */
t("the build tag has moved past the version now live", tag > LAST_SHIPPED,
  `now ${tag}, live ${LAST_SHIPPED}`);
/* The pairing that makes the tag mean something: if the bytes moved, the tag
   must have moved with them, or a browser holding yesterday's copy keeps it. */
const nowHash = ownAssetHash();
t("the game's own assets cannot change without its build tag moving",
  nowHash === LAST_SHIPPED_ASSETS ? tag === LAST_SHIPPED : tag > LAST_SHIPPED,
  nowHash === LAST_SHIPPED_ASSETS
    ? "unchanged since the last ship"
    : `changed, and the tag moved ${LAST_SHIPPED} -> ${tag}`);
t("the build tag matches the one the script reports",
  (js.match(/var BUILD = "([^"]+)"/) || [])[1] === tag, tag);
t("every asset the page pulls carries the same tag", (() => {
  const tags = [...html.matchAll(/(?:css|js)\/[a-z_]+\.(?:css|js)\?v=(v[0-9a-z]+)"/g)]
    .map((m) => m[1]);
  return tags.length > 0 && tags.every((x) => x === tag);
})());

console.log("\nThe tree is clean enough to be Pages");
for (const junk of ["node_modules", "package.json", "package-lock.json", ".wrangler"]) {
  t(`no ${junk} in the repository root`, !has(junk));
}
t("no forbidden files in the game folder", (() => {
  const bad = fs.readdirSync(path.join(ROOT, "scrambled"))
    .filter((f) => /\.(zip|sql|bak)$/i.test(f) || f === "bank.json");
  return bad.length === 0;
})(), "a bank or a zip in a served folder is the answer key on the web");

console.log("\nThe bank stays secret");
t("no board source is served from the game folder",
  !has("scrambled/xi") && !has("scrambled/boards"),
  "sources under a served path are the schedule and the answers");
t("the generated module lives under functions/, which Pages bundles",
  has("functions/_lib/sc-boards.js") && !has("scrambled/js/sc-boards.js"));
t("and the production SQL is not in the tree", !has("data/sc-production.sql") ||
  read(".gitignore").includes("data/*-production.sql"),
  "gitignored, so it cannot be committed by accident");

console.log("\nThe archive is shut");
t("the open archive flag is off, so tomorrow's board is not public",
  /const OPEN_ARCHIVE = false;/.test(read("functions/_lib/sc-board.js")));

console.log("\nIt is part of the family");
t("the page loads the shared tokens before the shared chrome", (() => {
  const tok = html.indexOf("xi-tokens.css");
  const chr = html.indexOf("xi-chrome.css");
  return tok > -1 && chr > -1 && tok < chr;
})());
/* Comments stripped first. This stylesheet SAYS it defines no .xic- rules, in
   a comment, and the check read that sentence as the thing it forbids —
   failing a file for describing its own compliance. */
t("it defines no .xic- rules of its own", (() => {
  const css = read("scrambled/css/style.css");
  let out = "";
  for (let k = 0; k < css.length; k++) {
    if (css[k] === "/" && css[k + 1] === "*") {
      const end = css.indexOf("*/", k + 2);
      if (end < 0) break;
      k = end + 1;
      continue;
    }
    out += css[k];
  }
  return out.indexOf(".xic-") === -1;
})(),
  "the chrome is shared; a game restyling it is two chromes");
t("the CSRF header is the family's", /"X-XI-Games"/.test(js));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
