#!/usr/bin/env node
/* tools/import_scrambled.js — the boards into SQL for D1.
 *
 *   node tools/import_scrambled.js
 *   npx wrangler d1 execute crosswordxi --remote --file=data/sc-production.sql
 *
 * OUTPUT data/sc-production.sql   gitignored by data/*-production.sql: it
 *                                 contains every name on every board.
 *
 * IT TRANSPORTS, IT DOES NOT DERIVE. The boards are built by
 * tools/build_scrambled.js from tools/scrambled/xi/*.json, and this reads the
 * module that build produced. Re-deriving them here would be a second
 * implementation of scrambling, formation parsing and slot ids — and the two
 * would drift the first time either changed. One derivation, two destinations:
 * the module the Worker falls back to, and the rows it prefers.
 *
 * AND IT REFUSES IF THE MODULE IS STALE. `build_scrambled.js --check` proves
 * the stored module is what the sources produce. If someone hand-edited the
 * module, or edited an XI without rebuilding, importing would put that
 * difference into the database where no gate can see it. So the check runs
 * first and nothing is written when it fails.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "sc-production.sql");

/* The gate first. Its failure is this tool's failure. */
try {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "build_scrambled.js"), "--check"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.error("REFUSED: tools/build_scrambled.js --check did not pass.");
  console.error("The stored module is not what the sources produce. Run");
  console.error("  node tools/build_scrambled.js");
  console.error("and look at what changed before importing anything.");
  process.exit(1);
}

/* THE SECOND GATE, and the one build_scrambled.js structurally cannot be.
   --check proves the boards are internally consistent and that the stored
   module matches its sources. It cannot tell you a board is WRONG: a lineup
   that gates perfectly and names the wrong nationality is exactly what a
   summarising fetch produced once — "Bernardo Silva - Spain", on a club board
   where nationality is the hint, so the one value a player pays for would have
   been a lie.

   Offline, against the snapshots pinned in the bank. Blocking here rather than
   in CI because this is the moment a wrong board reaches D1, and because a CI
   job fetching Wikipedia goes red for reasons that have nothing to do with the
   boards — the author's own sweep read 202, 248, 256, 264 across re-runs with
   nothing changed but the rate limiter. */
try {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "verify_scrambled.mjs"), "check"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  const out = (e.stdout ? e.stdout.toString() : "") + (e.stderr ? e.stderr.toString() : "");
  console.error("REFUSED: tools/verify_scrambled.mjs check did not pass.");
  console.error("A board disagrees with the source it cites. Nothing written.\n");
  console.error(out.split("\n").filter((l) => /!!|no pinned snapshot|boards:/.test(l)).join("\n"));
  process.exit(1);
}

/* THE SOURCES, NOT THE MODULE. The module in functions/ is a four-board sample
   so that the bank is not committed to a public repository; reading it here
   would have quietly imported four boards over two hundred and sixty-one, and
   the only symptom would have been a ring that repeated every four days.
   Both this tool and the builder now read the same sources, so the module is
   out of the import path entirely and cannot shrink what reaches D1. */
const { gate, parseFormation, build, PACKAGES, packageDirs } = await import(
  "file://" + path.join(ROOT, "tools", "build_scrambled.js").split(path.sep).join("/"));

const SOURCE_ARG = (() => {
  const i = process.argv.indexOf("--source");
  return i > -1 ? process.argv[i + 1] : null;
})();
const SOURCE_ROOT = SOURCE_ARG || path.join(ROOT, "..", "scrambledxi-source");
/* EVERY PACKAGE THE BANK HOLDS, each at its own id base and with its own say
   on the daily ring — the builder's PACKAGES table, read here rather than
   restated, so the module and the rows agree on which board is which id.
   The Daily bank must be present; the others are imported when they are. */
const packages = packageDirs(SOURCE_ROOT);
if (!packages.some((p) => p.dir === PACKAGES[0].dir)) {
  console.error(`REFUSED: no board sources at ${path.join(SOURCE_ROOT, PACKAGES[0].dir)}`);
  console.error("The bank lives outside this repository. Pass --source <dir> if it is elsewhere.");
  process.exit(1);
}
const SC_BOARDS = [];
for (const pkg of packages) {
  const files = fs.readdirSync(pkg.path).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
  for (const f of files) {
    const src = JSON.parse(fs.readFileSync(path.join(pkg.path, f), "utf8"));
    /* Gated again here rather than trusted: --check above proves the module
       matches the sources, not that every source is fit to import. */
    const problems = gate(src, parseFormation(src.formation)) || [];
    if (problems.length) {
      console.error(`REFUSED: ${pkg.dir}/${f}\n  x ${problems[0]}`);
      process.exit(1);
    }
    /* Built here with the builder's own build(), so the rows that reach D1
       carry the derived scrambles, bands and enumerations rather than the raw
       authoring shape. Two builders would eventually be two boards. */
    const board = build(src, `${pkg.dir}/${f}`, pkg);
    if (!board) { console.error(`REFUSED: ${pkg.dir}/${f} did not build.`); process.exit(1); }
    SC_BOARDS.push(board);
    pkg.top = Math.max(pkg.top || 0, board.id);
  }
  console.log(`${pkg.what}: ${files.length} boards, ids ${pkg.idBase + 1}–${pkg.top}` +
    `${pkg.daily ? ", in the daily ring" : ", out of the ring"}`);
}
/* THE ID SPACE HOLDS. A package must fit under the next package's base, and
   no id may appear twice across the bank — the fault this table exists to
   prevent is two packages numbered from 1 sharing one id column. */
{
  const ids = SC_BOARDS.map((b) => b.id);
  if (new Set(ids).size !== ids.length) { console.error("REFUSED: duplicate board ids across the bank."); process.exit(1); }
  for (const pkg of packages) {
    const next = PACKAGES.map((p) => p.idBase).filter((b) => b > pkg.idBase).sort((a, b) => a - b)[0];
    if (next !== undefined && pkg.top > next) {
      console.error(`REFUSED: ${pkg.what} reaches id ${pkg.top}, past the next package's base ${next}.`);
      process.exit(1);
    }
  }
}

/* Every board must name its source. The builder already refuses one without,
   so this cannot fire — which is the point of asserting it anyway: the day the
   builder's rule is relaxed, the database stops being able to say where a
   claim came from, and that should be a refusal here too rather than a silent
   NULL. */
for (const b of SC_BOARDS) {
  if (!b.source) { console.error(`REFUSED: board ${b.id} has no source URL.`); process.exit(1); }
  if (!b.title) { console.error(`REFUSED: board ${b.id} has no title.`); process.exit(1); }
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const now = new Date().toISOString();
const lines = [
  "-- GENERATED by tools/import_scrambled.js — do not edit.",
  "-- Contains every name on every board. Gitignored.",
  "-- Apply migration 023-scrambled-boards.sql first.",
  "",
  "DELETE FROM sc_board;",
  "",
];
for (const b of SC_BOARDS) {
  lines.push(
    "INSERT INTO sc_board (id, title, payload, source, updated_at) VALUES (" +
    [b.id, q(b.title), q(JSON.stringify(b)), q(b.source), q(now)].join(", ") + ");");
}
lines.push("");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n"));

const names = SC_BOARDS.reduce((n, b) => n + (b.slots || []).length, 0);
console.log(`${SC_BOARDS.length} board(s), ${names} names -> data/sc-production.sql`);
console.log("\nApply with:\n  npx wrangler d1 execute crosswordxi --remote --file=data/migrations/023-scrambled-boards.sql");
console.log("  npx wrangler d1 execute crosswordxi --remote --file=data/sc-production.sql\n");
