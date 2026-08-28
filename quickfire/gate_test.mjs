/* gate_proof.mjs — proves deploy_check.mjs actually fails.
 *
 *   node quickfire/gate_proof.mjs
 *
 * Breaks one rule at a time, restores the file, and asserts the gate named THAT
 * rule — not merely that something went red. A gate nobody has watched fail is
 * a gate trusted on faith, and this family has shipped three of those: the
 * tokens check that note()d for every build it existed, LAST_SHIPPED frozen at
 * a sentinel, and the live_check that read the wrong catalog key and reported
 * zero boards in green.
 *
 * Every case below is a fault that has happened, here or on a sibling game.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(DIR, f), s);

const FILES = ["index.html", "js/game.js", "js/config.js", "css/style.css"];
const original = Object.fromEntries(FILES.map((f) => [f, read(f)]));

function gate() {
  try {
    return execFileSync(process.execPath, [path.join(DIR, "deploy_check.mjs")],
      { encoding: "utf8", cwd: DIR });
  } catch (e) {
    return String(e.stdout || "");
  }
}

let missed = 0;
function prove(name, file, mutate, fragment) {
  write(file, mutate(original[file]));
  const out = gate();
  write(file, original[file]);
  const caught = out.split("\n").some((l) => l.startsWith("FAIL") && l.includes(fragment));
  console.log((caught ? "  ok  " : "MISS  ") + name);
  if (!caught) {
    missed++;
    console.log("        the gate did not name: " + fragment);
  }
}

const swap = (from, to) => (s) => s.replace(from, to);

console.log("\nEvery check, watched failing");

/* v001t on the word search: assets changed, one ?v= left behind, and the same
   URL then named different bytes for every browser holding it cached. */
prove("a stale tag on one of eight assets", "index.html",
  swap("js/reveal.js?v=v001", "js/reveal.js?v=v000"), "same tag as the code");

/* The family's oldest fault: one fact, two places. */
prove("a second copy of the eleven rule", "js/game.js",
  swap("var CONFIG = window.QFX_CONFIG;",
       "var CONFIG = window.QFX_CONFIG;\n  var oops = function (a) { return a.length === 11; };"),
  "eleven rule is stated once");
prove("the scoring maximum written down twice", "js/game.js",
  swap("var CONFIG = window.QFX_CONFIG;", "var CONFIG = window.QFX_CONFIG;\n  var MAX = 1100;"),
  "maximum is derived");

prove("a test hook left ungated", "js/game.js",
  swap("window.QFX_TEST_ANSWER = IS_LIVE ? undefined :", "window.QFX_TEST_ANSWER ="),
  "test hooks are defined off the live host");

/* The fault the word search rebuild retired: the bank in the browser. */
prove("a bank pasted into a public file", "js/config.js",
  (s) => s + "\nvar BANK = { answers: ['Everton', 'Spain'] };\n",
  "no answers in any public file");

prove("the game styling the shared chrome", "css/style.css",
  (s) => s + "\n.xic-bar { color: red; }\n", "styles no shared chrome");

/* The word search stored the theme under the crossword's prefix for months. */
prove("another game's storage prefix", "js/game.js",
  swap('var PREFIX = "qfx.";', 'var PREFIX = "fcw.";'),
  "own prefix");
prove("a key written outside the namespace", "js/game.js",
  swap("localStorage.setItem(PREFIX + storageKey",
       "localStorage.setItem('xiws.theme', '1'); localStorage.setItem(PREFIX + storageKey"),
  "own prefix");

prove("an absolute API url", "js/game.js",
  swap("api(url)", 'fetch("https://www.thexigames.com/api/quickfire/daily"); api(url)'),
  "relative URLs");

/* Written, dropped into js/, never given a <script> tag. The reference check
   asks the opposite question and passed. */
{
  const orphan = path.join(DIR, "js/board_file.js");
  const kept = fs.readFileSync(orphan, "utf8");
  fs.writeFileSync(path.join(DIR, "js/unreferenced.js"), "/* nobody loads me */\n");
  const out = gate();
  fs.unlinkSync(path.join(DIR, "js/unreferenced.js"));
  const caught = out.split("\n").some((l) => l.startsWith("FAIL") && l.includes("loaded by the page"));
  console.log((caught ? "  ok  " : "MISS  ") + "a file in js/ that the page never loads");
  if (!caught) missed++;
  fs.writeFileSync(orphan, kept);
}

/* The masthead moved into the shared bar, #dailyDate went with it, and the
   script kept asking for it. A null dereference inside a promise reads as
   "could not load the board" and blames the endpoint. */
prove("an element id the page no longer has", "index.html",
  swap('id="startDate"', 'id="startDateRenamed"'), "id the script looks up");

/* A generated import left in the game folder would be served: every answer,
   as a static file, one URL away. */
{
  const stray = path.join(DIR, "qf-production.sql");
  fs.writeFileSync(stray, "-- every answer\n");
  const out = gate();
  fs.unlinkSync(stray);
  const caught = out.split("\n").some((l) => l.startsWith("FAIL") && l.includes("production SQL"));
  console.log((caught ? "  ok  " : "MISS  ") + "a generated SQL import left in the game folder");
  if (!caught) missed++;
}

const clean = gate().trim().endsWith("0 failed");
console.log((clean ? "  ok  " : "MISS  ") + "and the untouched folder still passes");
if (!clean) missed++;

console.log("\n" + (missed ? `${missed} check(s) did not fire` : "Gate proven") + "\n");
process.exit(missed ? 1 : 0);
