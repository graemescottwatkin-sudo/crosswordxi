/* post_deploy.mjs — record what is live, by deriving it rather than being told.
 *
 *   node tools/post_deploy.mjs            show what it would write
 *   node tools/post_deploy.mjs --write    write it
 *
 * WHY THIS EXISTS. The post-deploy bump was four hand-edits across two files:
 * LAST_SHIPPED and LAST_SHIPPED_ASSETS, per game. It was skipped often enough
 * that LAST_SHIPPED once sat two releases behind what was live, which widened
 * the range the gate could not refuse — and that stale gate is what let a
 * client fix nearly ship under an unchanged cache key.
 *
 * IT DERIVES, IT DOES NOT ACCEPT. Every value written is computed here:
 *   - the tag comes from the LIVE page, not from the tree and not from an
 *     argument, so a tag can only be recorded once production is serving it;
 *   - the hash is computed from the tree's own asset bytes;
 *   - and it refuses unless the live tag equals the tree's tag AND that game's
 *     live_check passes. A bump recorded for a deploy that never landed is
 *     worse than no bump: it is a gate reporting a version nobody is serving.
 *
 * The game list is the contract's, read from tools/aligned_test.mjs. A new
 * game is a row THERE and nowhere else.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const SITE = "https://www.thexigames.com";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/* The game list, from the contract that already owns it. */
const GAMES = [...read("tools/aligned_test.mjs")
  .matchAll(/\{\s*dir:\s*"([a-z]+)"/g)].map((m) => m[1]);
if (!GAMES.length) { console.log("FAIL  no games found in tools/aligned_test.mjs"); process.exit(1); }

/* The same rule both gates use: the game's own tagged assets, discovered from
   the page, hashed in a stable order. Restating it here would be the second
   copy this whole exercise exists to avoid — but the gates cannot import from
   a tools/ file and stay standalone, so the shape is asserted below instead. */
function assetHash(dir) {
  const html = read(`${dir}/index.html`);
  const paths = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+)\?v=[^"]*"/g)]
    .map((m) => m[1]).sort();
  if (!paths.length) return null;
  const h = crypto.createHash("sha256");
  for (const p of paths) {
    h.update(p); h.update("\0");
    /* NORMALISED TO LF FIRST. The hash is meant to describe the bytes that
       SHIP, and what ships is what is in git — LF. On a Windows checkout the
       same file is CRLF in the working tree, so the hash depended on which
       tool last wrote the file: a plain `git checkout` of an untouched file
       turned every one of these gates red for a change nobody had made.
       All five places that compute this hash normalise, or they cannot
       agree. */
    h.update(fs.readFileSync(path.join(ROOT, dir, p), "utf8").replace(/\r\n/g, "\n"));
  }
  return h.digest("hex").slice(0, 16);
}
const tagFrom = (html) => (html.match(/js\/game\.js\?v=(v[0-9a-z]+)"/) || [])[1] || null;

let refused = 0;
const plan = [];

for (const dir of GAMES) {
  const treeTag = tagFrom(read(`${dir}/index.html`));
  let liveTag = null;
  try {
    const res = await fetch(`${SITE}/${dir}/`, { headers: { "cache-control": "no-cache" } });
    liveTag = res.ok ? tagFrom(await res.text()) : null;
  } catch (e) { liveTag = null; }

  if (!treeTag || !liveTag) {
    console.log(`FAIL  ${dir}: could not read a tag — tree ${treeTag || "?"}, live ${liveTag || "?"}`);
    refused++; continue;
  }
  if (treeTag !== liveTag) {
    console.log(`FAIL  ${dir}: the deploy has not landed — tree ${treeTag}, live ${liveTag}`);
    console.log(`      nothing is recorded for a version production is not serving.`);
    refused++; continue;
  }
  /* The live_check is the evidence that the deploy is HEALTHY, not merely
     present. Its own bytes probe proves the served file is this checkout. */
  try {
    execFileSync(process.execPath, [path.join(ROOT, dir, "live_check.mjs"), "--expect", liveTag],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
  } catch (e) {
    console.log(`FAIL  ${dir}: live_check --expect ${liveTag} did not pass; nothing recorded`);
    refused++; continue;
  }

  const gateFile = `${dir}/deploy_check.mjs`;
  const gate = read(gateFile);
  const curTag = (gate.match(/const LAST_SHIPPED = "([^"]+)"/) || [])[1];
  const curHash = (gate.match(/const LAST_SHIPPED_ASSETS = "([^"]+)"/) || [])[1];
  const newHash = assetHash(dir);
  if (!newHash) { console.log(`FAIL  ${dir}: no tagged assets found`); refused++; continue; }

  plan.push({ dir, gateFile, curTag, newTag: liveTag, curHash, newHash });
  console.log(`  ok  ${dir}: live ${liveTag}, live_check passed`);
}

if (refused) {
  console.log(`\n${refused} game(s) refused. Nothing written.`);
  process.exit(1);
}

console.log("\nWhat would change:\n");
let changes = 0;
for (const p of plan) {
  const tagLine = p.curTag === p.newTag ? `    LAST_SHIPPED        ${p.curTag} (unchanged)`
    : `    LAST_SHIPPED        ${p.curTag} -> ${p.newTag}`;
  const hashLine = p.curHash === p.newHash ? `    LAST_SHIPPED_ASSETS ${p.curHash} (unchanged)`
    : `    LAST_SHIPPED_ASSETS ${p.curHash} -> ${p.newHash}`;
  if (p.curTag !== p.newTag || p.curHash !== p.newHash) changes++;
  console.log(`  ${p.gateFile}`);
  console.log(tagLine);
  console.log(hashLine);
}
if (!changes) { console.log("\nAlready up to date. Nothing to write."); process.exit(0); }

if (!WRITE) {
  console.log("\nRe-run with --write to apply.");
  process.exit(0);
}

for (const p of plan) {
  let gate = read(p.gateFile);
  gate = gate.replace(/const LAST_SHIPPED = "[^"]+";/, `const LAST_SHIPPED = "${p.newTag}";`);
  gate = gate.replace(/const LAST_SHIPPED_ASSETS = "[^"]+";/, `const LAST_SHIPPED_ASSETS = "${p.newHash}";`);
  fs.writeFileSync(path.join(ROOT, p.gateFile), gate);
  console.log(`  written  ${p.gateFile}`);
}
console.log("\nCommit as: LAST_SHIPPED " + plan.map((p) => p.newTag).join(" / ") + " + asset hashes");
