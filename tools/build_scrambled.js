#!/usr/bin/env node
/* tools/build_scrambled.js — turn authored XIs into stored boards.
 *
 *   node tools/build_scrambled.js            build every XI, write the module
 *   node tools/build_scrambled.js --check    build and gate, write nothing
 *
 * Reads every tools/scrambled/xi/NNN-*.json (files starting "_" are skipped,
 * so _TEMPLATE.json is not a board) and writes
 * functions/_lib/sc-boards.js.
 *
 * SCRAMBLES ARE GENERATED HERE AND STORED, NEVER DERIVED IN THE BROWSER
 *
 *   1. Every player must see the same board, or a shared score compares
 *      nothing. A scramble computed at load time from an unseeded shuffle is a
 *      different puzzle per device.
 *
 *   2. A scramble derived at runtime is derived from whatever string is in the
 *      data, and the whole point of the English-form gate is that the string
 *      might be wrong. Generating here means the gate runs before anything is
 *      stored, and a bad name never becomes a board at all.
 *
 * THE LAYOUT IS DERIVED FROM THE FORMATION, NOT AUTHORED BESIDE IT. The draft
 * carried `formation: "4-4-2"` next to a hand-written list of bands and slot
 * ids: one fact in two places, and the day they disagreed the board would have
 * been captioned 4-4-2 and drawn as something else. Here the string is parsed
 * and everything else falls out of it.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  NAME_SHAPE, normalise, letterBag, enumerationOf,
} from "../functions/_lib/sc-names.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SRC = path.join(HERE, "scrambled", "xi");
const DEST = path.join(ROOT, "functions", "_lib", "sc-boards.js");
const CHECK_ONLY = process.argv.includes("--check");

/* ---- Seeded RNG ----------------------------------------------------------
   mulberry32. Deterministic, so rebuilding the same XI twice produces the same
   scramble and a stored board is reproducible from its source file. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- SOME NAMES CANNOT BE DERANGED, AND ONE OF THEM IS GIGGS --------------
 *
 * The draft's first scrambler demanded zero fixed points — no letter left
 * where it started — and refused GIGGS outright. It was right to: G,I,G,G,S
 * has three Gs in five positions, so the three Gs have only two positions that
 * are not their own to move into. One G must stay put. No shuffle exists.
 *
 * The rule that survives is "as deranged as the letters allow". For a letter
 * appearing k times in a name of length n, its copies have n-k positions that
 * are not their own, so at least 2k-n of them are stuck. The floor for the
 * whole name is the worst letter's floor, and a scramble is accepted only if
 * it hits that floor exactly.
 *
 * Stated as a floor rather than a tolerance on purpose. "Allow up to one fixed
 * letter" would also have let GIGGS through — and would have quietly accepted
 * a lazy shuffle of BECKHAM, where zero is achievable and one is a free hint
 * nobody priced.
 */
export function minimumFixedPoints(letters) {
  const n = letters.length;
  const counts = {};
  for (const ch of letters) counts[ch] = (counts[ch] || 0) + 1;
  return Math.max(0, ...Object.values(counts).map((k) => Math.max(0, 2 * k - n)));
}

export function scrambleName(letters, rand) {
  const src = letters.split("");
  const floor = minimumFixedPoints(letters);
  let best = null, bestFixed = Infinity;

  /* Rejection rather than a constructive algorithm: the constraint is cheap to
     test and the strings are short. Bounded, because an unbounded search on
     impossible input is a hung build rather than a failed one. */
  for (let attempt = 0; attempt < 4000; attempt++) {
    const out = src.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    let fixed = 0;
    for (let i = 0; i < out.length; i++) if (out[i] === src[i]) fixed++;
    if (fixed < bestFixed) { bestFixed = fixed; best = out.join(""); }
    if (fixed === floor) return { scramble: best, fixed, floor };
  }
  return best ? { scramble: best, fixed: bestFixed, floor } : null;
}

/* ---- The formation, parsed ----------------------------------------------
 * "4-4-2" is ten outfielders in three lines, plus the goalkeeper: eleven.
 * The default position labels come from the line's index and its size, and an
 * author who wants something else writes `pos` on the player.
 */
const BACK = { 3: ["CB", "CB", "CB"], 4: ["LB", "CB", "CB", "RB"], 5: ["LWB", "CB", "CB", "CB", "RWB"] };
const MID = { 1: ["CM"], 2: ["CM", "CM"], 3: ["CM", "CM", "CM"], 4: ["LM", "CM", "CM", "RM"], 5: ["LM", "CM", "CM", "CM", "RM"] };
const FWD = { 1: ["ST"], 2: ["ST", "ST"], 3: ["LW", "ST", "RW"] };

export function parseFormation(text) {
  const parts = String(text || "").trim().split("-");
  if (parts.length < 2 || parts.some((p) => !/^[1-5]$/.test(p))) {
    return { error: `"${text}" is not a formation — expected something like 4-4-2` };
  }
  const lines = parts.map(Number);
  const outfield = lines.reduce((a, b) => a + b, 0);
  if (outfield !== 10) {
    return { error: `${text} is ${outfield} outfielders plus a keeper — an XI is eleven` };
  }

  /* The keeper sits deepest; the outfield lines are spread evenly between the
     edge of the box and the last third. y is 0 at the top of the pitch. */
  const bands = [{ id: "gk", y: 0.90, size: 1 }];
  const top = 0.16, bottom = 0.74;
  lines.forEach((size, i) => {
    const y = lines.length === 1 ? (top + bottom) / 2
      : bottom - (i * (bottom - top)) / (lines.length - 1);
    bands.push({ id: "b" + (i + 1), y: Number(y.toFixed(4)), size });
  });

  const labels = ["GK"];
  lines.forEach((size, i) => {
    const table = i === 0 ? BACK : i === lines.length - 1 ? FWD : MID;
    const row = table[size] || Array(size).fill(i === 0 ? "CB" : "CM");
    labels.push(...row);
  });

  return { lines, bands, labels };
}

/* ---- The gate ------------------------------------------------------------
   Every invariant that must hold before anything is stored. A board failing
   any of these is refused rather than repaired: a build that quietly fixes its
   input teaches you that the input was fine. */
export function gate(src, shape) {
  const problems = [];
  const xi = Array.isArray(src.xi) ? src.xi : [];

  if (shape.error) problems.push(shape.error);
  if (xi.length !== 11) {
    problems.push(`${xi.length} players — an XI has eleven, and that is the whole product`);
  }
  if (!src.source) {
    problems.push("no source — a board is a claim about who played and must carry the URL that backs it");
  }
  if (!Number.isInteger(src.seed)) {
    problems.push("no integer seed — without one the scramble is not reproducible from this file");
  }
  if (!src.pool) {
    problems.push("no pool line — a player who does not know the frame is guessing at the whole of football");
  }

  const bags = new Map();
  const claims = new Map();   // every accepted spelling -> the slot claiming it

  xi.forEach((p, i) => {
    const where = `player ${i + 1} ("${p.name}")`;
    if (!NAME_SHAPE.test(String(p.name || "").toUpperCase())) {
      problems.push(`${where}: not English form — author it in plain A-Z, no diacritics`);
      return;
    }
    if (normalise(p.name).length < 3) {
      problems.push(`${where}: too short to scramble meaningfully`);
    }

    /* TWO SLOTS WITH THE SAME LETTERS ARE THE SAME TILE. The player cannot
       know which of them goes where and neither can the marker, so the board
       has an unanswerable slot. This is what forces JACK CHARLTON and BOBBY
       CHARLTON to be authored with forenames. */
    const bag = letterBag(p.name);
    if (bags.has(bag)) {
      problems.push(
        `${where}: same letters as player ${bags.get(bag) + 1} ("${xi[bags.get(bag)].name}") — ` +
        `two identical tiles cannot be told apart. Author both with forenames.`);
    } else bags.set(bag, i);

    /* AN ALIAS THAT MATCHES TWO SLOTS IS A WRONG ANSWER ACCEPTED. Checked
       across names AND aliases, because CHARLTON as an alias of one Charlton
       is exactly as broken as CHARLTON being both their names. */
    for (const spelling of [p.name, ...(p.aliases || [])]) {
      const key = normalise(spelling);
      if (!key) { problems.push(`${where}: an alias normalises to nothing`); continue; }
      if (claims.has(key) && claims.get(key) !== i) {
        problems.push(
          `${where}: "${spelling}" is also accepted for player ${claims.get(key) + 1} ` +
          `("${xi[claims.get(key)].name}") — one spelling, two slots`);
      }
      claims.set(key, i);
    }
  });


  /* A SURNAME SITTING INSIDE ANOTHER ON THE SAME BOARD.
     The bag rule above catches two slots whose letters are IDENTICAL. It
     cannot catch one accepted spelling contained in another: Milan 2003 field
     Costacurta and Rui Costa — different bags, so the bag rule passes — and a
     lone COSTA tile beside COSTACURTA invites the wrong answer, because the
     longer scramble contains every letter of the shorter one.

     Found in the bank rather than in review. The generated boards already
     author the shorter name in full for this reason, which means the rule was
     being kept by whoever remembered it; forty slots across the bank are
     multi-word for this or for the five true collisions. A rule kept by memory
     is the next board's bug.

     Substring, not prefix: the letters are shown scrambled, so where inside
     the longer name the shorter one sits makes no difference to what the
     player is looking at. */
  /* Compared WORD BY WORD, not against the whole name with its spaces
     removed. The first version normalised the lot and flagged NANDO inside
     JON ANDONI GOIKOETXEA — a match spanning the JON/ANDONI boundary that no
     player looking at a five-letter bag beside a nineteen-letter one could
     ever make. Per word still catches COSTA inside the single word
     COSTACURTA, which is the case this rule exists for. */
  const spellings = [];
  xi.forEach((p, i) => {
    for (const s of [p.name, ...(p.aliases || [])]) {
      const k = normalise(s);
      if (!k) continue;
      const words = String(s).split(/[^A-Za-z]+/).map(normalise).filter(Boolean);
      spellings.push({ k, i, s, words });
    }
  });
  const flagged = new Set();
  for (const a of spellings) {
    for (const b of spellings) {
      if (a.i === b.i || a.k.length >= b.k.length) continue;
      if (!b.words.some((w) => w.includes(a.k))) continue;
      const pair = `${a.i}:${a.k}>${b.i}:${b.k}`;
      if (flagged.has(pair)) continue;
      flagged.add(pair);
      problems.push(
        `player ${a.i + 1} ("${a.s}"): its letters sit inside player ${b.i + 1} ` +
        `("${b.s}") — author the shorter one in full, as Rui Costa is beside Costacurta`);
    }
  }
  if (!["club", "nationality"].includes(src.hintField)) {
    problems.push(`hintField must be "club" or "nationality", not ${JSON.stringify(src.hintField)}`);
  } else {
    const missing = xi.filter((p) => !p[src.hintField]).map((p) => p.name);
    if (missing.length) problems.push(`no ${src.hintField} for: ${missing.join(", ")}`);
    const values = new Set(xi.map((p) => p[src.hintField]).filter(Boolean));
    if (values.size < 2) {
      problems.push(
        `every player has the same ${src.hintField} (${[...values][0]}) — that hint ` +
        `sells the player something already on their screen. Use the other field.`);
    }
  }

  return problems;
}

/* ---- Build ---------------------------------------------------------------- */
function build(src, file) {
  const shape = parseFormation(src.formation);
  const problems = gate(src, shape);
  if (problems.length) {
    console.error(`\n${file} refused:\n`);
    problems.forEach((p) => console.error("  x " + p));
    return null;
  }

  const rand = rng(src.seed);
  const bands = shape.bands;
  const slotBand = [];
  bands.forEach((b) => { for (let j = 0; j < b.size; j++) slotBand.push({ band: b.id, i: j, of: b.size }); });

  const slots = src.xi.map((p, i) => {
    const letters = normalise(p.name);
    const r = scrambleName(letters, rand);
    if (!r) throw new Error(`${file}: "${p.name}" produced no scramble at all.`);
    const { scramble, fixed, floor } = r;
    if (fixed > floor) {
      throw new Error(`${file}: "${p.name}" settled at ${fixed} fixed letters, floor is ${floor}.`);
    }
    if (letterBag(scramble) !== letterBag(p.name)) {
      throw new Error(`${file}: "${p.name}" — the scramble lost a letter. A bug, not bad data.`);
    }
    if (scramble === letters) {
      throw new Error(`${file}: "${p.name}" — the scramble is the name.`);
    }
    const place = slotBand[i];
    return {
      id: "s" + (i + 1),
      band: place.band,
      x: Number(((place.i + 1) / (place.of + 1)).toFixed(4)),
      pos: p.pos || shape.labels[i],
      name: p.name,
      aliases: p.aliases || [],
      club: p.club || null,
      nationality: p.nationality || null,
      scramble,
      fixed,
      len: enumerationOf(p.name),
    };
  });

  return {
    id: src.id,
    title: src.title,
    pool: src.pool,
    formation: src.formation,
    hintField: src.hintField,
    source: src.source,
    bands: bands.map((b) => ({ id: b.id, y: b.y })),
    slots,
  };
}

/* ---- Run ------------------------------------------------------------------
   Guarded. board_test.mjs imports gate() and parseFormation() to sabotage them
   and watch them refuse; without this guard that import would run a build and
   overwrite the generated module as a side effect of running the tests. */
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) { /* imported for its parts */ } else main();

function main() {
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
if (!files.length) {
  console.error(`\nNo XI files in ${path.relative(ROOT, SRC)}. Copy _TEMPLATE.json and fill it in.\n`);
  process.exit(1);
}

const built = [];
let refused = 0;
for (const f of files) {
  const src = JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));
  const board = build(src, f);
  if (!board) { refused++; continue; }
  built.push(board);
}

const ids = built.map((b) => b.id);
if (new Set(ids).size !== ids.length) {
  console.error(`\nDuplicate board ids: ${ids.join(", ")}\n`);
  refused++;
}
if (refused) {
  console.error(`\n${refused} board${refused > 1 ? "s" : ""} refused. Nothing written.\n`);
  process.exit(1);
}

for (const b of built) {
  console.log(`\n  #${b.id} ${b.title} (${b.formation}, sells ${b.hintField})`);
  for (const s of b.slots) {
    const note = s.fixed ? `  (${s.fixed} letter stuck — unavoidable)` : "";
    console.log(`    ${s.pos.padEnd(4)} ${s.scramble.padEnd(14)} -> ${s.name}${note}`);
  }
}

const out = `/* GENERATED by tools/build_scrambled.js — do not edit by hand.
 *
 * Kept under functions/ on purpose. Anything under a game's own directory is
 * served by Cloudflare Pages as a public file; this holds names, clubs and
 * aliases, so it lives where only a Worker can read it.
 *
 * Rebuild with:  node tools/build_scrambled.js
 */
export const SC_BOARDS = ${JSON.stringify(built, null, 2)};
`;
/* --check gates the sources AND compares them against what is actually
   stored. Gating alone would pass while functions/_lib/sc-boards.js said
   something else entirely — a board hand-edited after the build, or a build
   nobody re-ran after editing an XI, is exactly the drift this catches. */
if (CHECK_ONLY) {
  const stored = fs.existsSync(DEST) ? fs.readFileSync(DEST, "utf8") : "";
  if (stored !== out) {
    console.error(`\n${path.relative(ROOT, DEST)} is NOT what these sources build.` +
      `\nRun: node tools/build_scrambled.js\n`);
    process.exit(1);
  }
  console.log(`\n${built.length} board${built.length > 1 ? "s" : ""} gated, and the ` +
    `stored module matches. Nothing written.\n`);
  process.exit(0);
}

fs.writeFileSync(DEST, out);
console.log(`\n${built.length} board${built.length > 1 ? "s" : ""} written to ${path.relative(ROOT, DEST)}\n`);
}
