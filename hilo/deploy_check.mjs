/* hilo/deploy_check.mjs — the gate HiLo XI ships through.
 *
 * Run from the repository root, with no node_modules, no package.json and no
 * .wrangler in the tree. Those are checked, because a gate that passes on a
 * machine with build state and fails on Pages has told you nothing.
 *
 *   node hilo/deploy_check.mjs        expect 0 failed
 *
 * THE TAG LAW. LAST_SHIPPED is what is LIVE, and LAST_SHIPPED_ASSETS is a hash
 * of the bytes it names. A tag is burned the moment it ships and never goes
 * backwards, so after a deploy this gate fails "moved past the version now
 * live" until the next release moves the tag. That is the law working.
 *
 * WHAT THIS GATE CANNOT SEE. It reads shape, not truth. The boards are gated
 * by tools/import_hilo.js and verified by the research side against their
 * sources; a green gate here is a well-formed release, not a correct one.
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
   derives them from the live page rather than trusting anyone's memory.
   v000z is the day before the first release: not v000, which aligned_test
   refuses as a sentinel, and below v001 so the first ship moves past it. */
const LAST_SHIPPED = "v001c";
const LAST_SHIPPED_ASSETS = "26ea20e28b2e5cec";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const html = read("hilo/index.html");
const js = read("hilo/js/game.js");

/* The bytes this game ships, hashed together: the same hash the other gates
   and post_deploy compute — discovered from the page, name, NUL, bytes in a
   stable order. One hash, four gates, one shape. */
function ownAssetHash() {
  const paths = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+)\?v=[^"]*"/g)]
    .map((m) => m[1]).sort();
  if (!paths.length) return null;
  const h = crypto.createHash("sha256");
  for (const p of paths) {
    if (!has("hilo/" + p)) return null;
    h.update(p); h.update("\0");
    h.update(fs.readFileSync(path.join(ROOT, "hilo", p)));
  }
  return h.digest("hex").slice(0, 16);
}

console.log("The tag law");
const tag = (html.match(/js\/game\.js\?v=(v[0-9a-z]+)"/) || [])[1];
t("asset URLs carry a build tag so a cached copy cannot be reused", !!tag, tag);
t("LAST_SHIPPED is a real version, not a sentinel",
  !!LAST_SHIPPED && LAST_SHIPPED !== "v000", `shipped ${LAST_SHIPPED}`);
t("the build tag has moved past the version now live", tag > LAST_SHIPPED,
  `now ${tag}, live ${LAST_SHIPPED}`);
const nowHash = ownAssetHash();
t("the game's own assets cannot change without its build tag moving",
  !!nowHash && (nowHash === LAST_SHIPPED_ASSETS ? tag === LAST_SHIPPED : tag > LAST_SHIPPED),
  nowHash === LAST_SHIPPED_ASSETS ? "unchanged since the last ship" : `changed, and the tag moved ${LAST_SHIPPED} -> ${tag}`);
t("the build tag matches the one the script reports",
  (js.match(/var BUILD = "([^"]+)"/) || [])[1] === tag, tag);
t("every asset the page pulls carries the same tag", (() => {
  const tags = [...html.matchAll(/(?:css|js)\/[a-z_]+\.(?:css|js)\?v=(v[0-9a-z]+)"/g)].map((m) => m[1]);
  return tags.length > 0 && tags.every((x) => x === tag);
})());
t("every relative file reference resolves, exact case", (() => {
  const refs = [...html.matchAll(/(?:src|href)="(?!data:|#|https?:|mailto:|\/)([^"?]+)"?/g)]
    .map((m) => m[1].split("?")[0]).filter((r) => !r.endsWith("/"));
  return refs.every((r) => fs.existsSync(path.join(HERE, r)));
})());

console.log("\nThe tree is clean enough to be Pages");
for (const junk of ["node_modules", "package.json", "package-lock.json", ".wrangler"]) {
  t(`no ${junk} in the repository root`, !has(junk));
}
t("no forbidden files in the game folder", (() => {
  const bad = fs.readdirSync(path.join(ROOT, "hilo")).filter((f) => /\.(zip|sql|bak)$/i.test(f) || f.endsWith(".json"));
  return bad.length === 0;
})(), "a bank or a zip in a served folder is the answer key on the web");

console.log("\nThe values stay on the server");
t("no board source is served from the game folder", !has("hilo/boards") && !has("hilo/bank"));
t("the production SQL is not in the tree, or is gitignored",
  !has("data/hl-production.sql") || read(".gitignore").includes("data/*-production.sql"));
t("the page holds no value but the first: the judge is the server's",
  /\/api\/hilo\/call/.test(js) && !/chain\b/.test(js.replace(/\/\*[\s\S]*?\*\//g, "")),
  "every call goes up to be marked");
/* EXECUTED, not pattern-matched. This read the source of publicBoard for
   the shape of one line, and the day that line was rewritten to hand over
   LESS — a hidden row as its name alone, after a context gave a call away
   on the live page — the check went red against a stricter truth. A regex
   cannot tell what a function returns; calling it can. */
const { publicBoard } = await import("../functions/_lib/hl-board.js");
const { HL_SAMPLE_BOARDS } = await import("../functions/_lib/hl-sample.js");
t("publicBoard hands over the first row and, of every other row, the name alone", (() => {
  const b = HL_SAMPLE_BOARDS[0];
  const pub = publicBoard(b, "t");
  return pub.rows.length === b.chain.length &&
    pub.rows[0].value === b.chain[0].value &&
    pub.rows.slice(1).every((r) => Object.keys(r).join() === "name");
})(), "no value, context, birth date or precision behind the first");

console.log("\nIt is part of the family");
t("the page loads the shared tokens before the shared chrome", (() => {
  const tok = html.indexOf("xi-tokens.css"), chr = html.indexOf("xi-chrome.css");
  return tok > -1 && chr > -1 && tok < chr;
})());
t("it defines no .xic- rules of its own", (() => {
  const css = read("hilo/css/style.css");
  let out = "";
  for (let k = 0; k < css.length; k++) {
    if (css[k] === "/" && css[k + 1] === "*") { const end = css.indexOf("*/", k + 2); if (end < 0) break; k = end + 1; continue; }
    out += css[k];
  }
  return out.indexOf(".xic-") === -1;
})());
t("the CSRF header is the family's", /"X-XI-Games"/.test(js));
t("the scoring the page plays is the module the tests read",
  /js\/scoring\.js/.test(html) && /HL_SCORING/.test(js));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
