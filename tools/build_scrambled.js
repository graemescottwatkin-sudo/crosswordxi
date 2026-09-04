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
  NAME_SHAPE, normalise, letterBag, enumerationOf, wordsOf,
} from "../functions/_lib/sc-names.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
/* THE BANK LIVES OUTSIDE THIS REPOSITORY, like the crossword's and the word
   search's. It did not, and Cloudflare Pages serves everything at the repo
   root that functions/ does not claim — so every board source was being
   served by the live site: the answer key, and worse, the SCHEDULE. The API
   refuses ?no= for any day past today ("the future is shut, because opening
   it gives away everything") while /tools/scrambled/xi/005-*.json answered
   200 with the same board.
   The generated module was never exposed — it sits under functions/, which
   Pages bundles into the Worker rather than serving — but the sources it is
   built FROM were, which is the same leak one step earlier. */
const DEFAULT_SOURCE = path.join(ROOT, "..", "scrambledxi-source");
const SOURCE_ARG = (() => {
  const i = process.argv.indexOf("--source");
  return i > -1 ? process.argv[i + 1] : null;
})();
/* THE BANK, OR THE SAMPLE. The full bank lives outside this repository like
   the crossword's and the word search's; CI does not have it, and neither does
   a fresh clone. Rather than making --check unrunnable there, the builder falls
   back to the four sample sources in-tree — the same four the shipped module
   holds, so the module it builds is identical either way and --check gates
   truthfully in both places. With the bank present it gates all 261 and still
   writes those four. */
const SOURCE_ROOT = SOURCE_ARG || DEFAULT_SOURCE;
const BANK = path.join(SOURCE_ROOT, "xi");
const SAMPLE_SRC = path.join(HERE, "scrambled", "sample-xi");
const SRC = fs.existsSync(BANK) ? BANK : SAMPLE_SRC;

/* THE PACKAGES, AND THE ID SPACE THE SITE OWNS.
   The research side numbers every package from 1: the Daily bank is 1–365,
   the iconic lineups are 1–546, and sc_board has one id column. Imported as
   authored, the iconic boards would overwrite the dailies and join the ring.
   So each package has a base its ids are lifted by and a say in whether its
   boards are dailies at all — a rule the site applies, rather than a fact the
   author is asked to restate in every file. The Daily bank keeps its authored
   ids because the ring counts by them; the iconic bank sits from 1001 and is
   never a daily. A package's boards must fit under the next base, and the
   importer refuses a bank that does not. The last-two set is not here: it is
   its own table, replaced whole, and tools/import_last2.js owns it. */
export const PACKAGES = [
  { dir: "xi",     idBase: 0,    daily: true,  what: "the Daily bank" },
  { dir: "iconic", idBase: 1000, daily: false, what: "the iconic lineups" },
];
export function packageDirs(root) {
  return PACKAGES.map((p) => ({ ...p, path: path.join(root, p.dir) }))
    .filter((p) => fs.existsSync(p.path));
}

/* What ships in the repo is a SAMPLE, not the bank — the same shape as the
   crossword's sample-puzzles.js. It exists so an unbound D1 binding degrades
   to something playable rather than to nothing, and it is deliberately small
   enough that committing the bank by accident is visible in a diff. */
/* FOUR BOARDS, AND ONE OF THEM CARRIES A MULTI-WORD TILE. The sample is the
   fallback the game degrades to, and it is also what the suites read, so it
   has to cover the SHAPES the rules care about and not merely be the first
   four boards. Board 14 is here for VAN DIJK: without a multi-word cypher the
   word-by-word check passes by having nothing to check, which board_test
   refuses to call a pass. */
const SAMPLE_COUNT = 4;
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

/* ---- THE SCRAMBLE RULE, V1 --------------------------------------------------
 *
 * Difficulty is driven by the length of the answer, separators excluded:
 *   under hardBelow letters   HARD    every letter may move — as deranged as
 *                                     the letters allow, never the answer
 *   hardBelow..easyAbove      MEDIUM  mediumFixedShare of the letters stay put
 *   over easyAbove            EASY    easyFixedShare stay — several anchors
 *
 * The fixed count is the PRIMARY control and is hit exactly, not fished for:
 * a shuffle that keeps lucky hits works at the hard end and hangs at the easy
 * end (exactly 8 fixed of 13 is one shuffle in a hundred thousand). So the
 * anchors are CHOSEN first and only the movers are deranged among themselves,
 * and the target is met by construction. Movement is SECONDARY: among the
 * arrangements that hit the target, the half whose moved letters travelled
 * furthest is discarded and one of the rest is picked at random — the random
 * pick matters, because a recurring player must not be recognisable by the
 * shape of his tile.
 *
 * REPEATED LETTERS count by what the player can see: a letter is fixed when it
 * stands where the answer shows that letter, and travel matches each moved
 * letter to the nearest unclaimed copy of itself. Swapping GIGGS's two Gs is
 * not a move. The derangement floor (2k-n per repeated letter) still bounds
 * the hard end from below: one of GIGGS's three Gs stays because it must.
 *
 * The band edges and shares are V1 defaults that WILL move with playtesting,
 * so they live in one exported object and nowhere else. */
export const DIFFICULTY = { hardBelow: 5, easyAbove: 8, mediumFixedShare: 0.40, easyFixedShare: 0.60 };

export function bandOf(totalLetters) {
  if (totalLetters < DIFFICULTY.hardBelow) return "hard";
  if (totalLetters > DIFFICULTY.easyAbove) return "easy";
  return "medium";
}

/* How many letters of an answer of this length stand home. Hard is zero — the
   floor, applied per word below, is what keeps GIGGS's G where it is. */
export function fixedTarget(totalLetters) {
  const band = bandOf(totalLetters);
  if (band === "hard") return 0;
  const share = band === "easy" ? DIFFICULTY.easyFixedShare : DIFFICULTY.mediumFixedShare;
  return Math.round(totalLetters * share);
}

/* One word, exactly `anchors` letters fixed. Anchor positions are drawn at
   random and the movers are deranged among themselves by rejection — a mover
   may not land where the answer shows its own letter — which is cheap on a
   handful of letters and bounded so an impossible ask is a null, not a hang.
   Some anchor sets leave the movers with no derangement (three Gs and two
   non-G positions), so several sets are tried. Returns up to `want`
   candidates for the travel filter. */
function arrangementsWith(src, anchors, rand, want) {
  const n = src.length;
  const found = [];
  const seen = new Set();
  for (let set = 0; set < 40 && found.length < want; set++) {
    const idx = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const home = new Set(idx.slice(0, anchors));
    const movers = idx.slice(anchors);
    const pool = movers.map((i) => src[i]);
    for (let attempt = 0; attempt < 120; attempt++) {
      const letters = pool.slice();
      for (let i = letters.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [letters[i], letters[j]] = [letters[j], letters[i]]; }
      let ok = true;
      for (let k = 0; k < movers.length; k++) if (letters[k] === src[movers[k]]) { ok = false; break; }
      if (!ok) continue;
      const out = src.slice();
      movers.forEach((i, k) => { out[i] = letters[k]; });
      const s = out.join("");
      if (!seen.has(s)) { seen.add(s); found.push(out); }
      break;
    }
    void home;
  }
  return found;
}

/* How far the moved letters went, matching each to the nearest unclaimed copy
   of itself in the answer. A letter standing home claims its own copy. */
export function travel(src, out) {
  const claimed = new Set();
  for (let i = 0; i < src.length; i++) if (out[i] === src[i]) claimed.add(i);
  let total = 0;
  for (let i = 0; i < src.length; i++) {
    if (out[i] === src[i]) continue;
    let best = -1, bestDist = Infinity;
    for (let j = 0; j < src.length; j++) {
      if (claimed.has(j) || src[j] !== out[i]) continue;
      const d = Math.abs(i - j);
      if (d < bestDist) { bestDist = d; best = j; }
    }
    if (best >= 0) { claimed.add(best); total += bestDist; }
  }
  return total;
}

/* One word to exactly `target` fixed letters, or as near as the letters
   allow: the target is walked out by one in each direction before giving
   up, and the caller's gate decides whether that walk is acceptable. */
export function scrambleName(letters, rand, target) {
  const src = letters.split("");
  const n = src.length;
  const floor = minimumFixedPoints(letters);
  /* A single letter cannot move and is an anchor by nature. */
  if (n === 1) return { scramble: letters, fixed: 1, floor, target: 1 };
  const want = target === undefined ? floor : target;
  /* Never the answer itself: at most n-2 anchors, since one mover alone has
     nowhere to go. Never below the floor, which the letters impose. */
  const cap = Math.max(floor, n - 2);
  const asked = Math.min(Math.max(want, floor), cap);
  for (const a of [asked, asked + 1, asked - 1]) {
    if (a < floor || a > cap) continue;
    const found = arrangementsWith(src, a, rand, 16);
    if (!found.length) continue;
    /* The travel filter: keep the nearer half, then pick at random. */
    const ranked = found.map((out) => ({ out, t: travel(src, out) })).sort((x, y) => x.t - y.t);
    const keep = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
    const pick = keep[Math.floor(rand() * keep.length)].out;
    let fixed = 0;
    for (let i = 0; i < n; i++) if (pick[i] === src[i]) fixed++;
    return { scramble: pick.join(""), fixed, floor, target: asked };
  }
  return null;
}

/*
 * WORD BY WORD, NEVER ONE BLOB.
 *
 * Most cyphers are a bare surname and this changes nothing for them. But when
 * a clash forces a full name in — or the surname is itself two words, VAN DIJK,
 * LE TISSIER — the letters must stay inside their own word: ALAN SHEARER is
 * NLAA HSAERRE, not a twelve-letter soup with the enumeration underneath
 * pretending a split that the letters do not honour. A blob makes the
 * enumeration a lie: it tells the player where the words break while the
 * letters say they never did.
 *
 * The floor is the SUM of the per-word floors, not the whole name's. Letters
 * can no longer migrate to cover a repeat, so the whole-name floor is no
 * longer reachable and would fail every board it was checked against.
 */

/* THE FLOOR FOR A WHOLE CYPHER, in one place because two callers need it and
   they must not disagree: the builder, to accept a scramble, and the board
   test, to re-derive what the builder accepted. Summed per word, since
   scrambleWords will not let a letter leave its word to cover a repeat. */
export function nameFloor(name) {
  return wordsOf(name).words.reduce((n, w) => n + minimumFixedPoints(w), 0);
}

/* MULTI-WORD TILES band on the TOTAL letters of the answer, then split the
   anchor budget across the words by length. Each word is scrambled with its
   share, separator kept, and each word must differ from its answer (a word's
   anchors are capped at its length minus two). A one-letter clash initial is
   an anchor by nature and spends one of the budget. Largest remainder, so
   the shares sum to the target; a word whose share the letters cannot hit
   pushes the difference to the others where they have room. */
export function wordTargets(words, target) {
  const n = words.reduce((a, w) => a + w.length, 0);
  const exact = words.map((w) => (target * w.length) / n);
  const share = exact.map(Math.floor);
  let left = target - share.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) { if (left <= 0) break; share[i]++; left--; }
  /* Bounds: the floor the letters impose, the cap that keeps the word from
     being the answer, the initial that is an anchor whether asked or not. */
  const lo = words.map((w) => (w.length === 1 ? 1 : minimumFixedPoints(w)));
  const hi = words.map((w, i) => (w.length === 1 ? 1 : Math.max(lo[i], w.length - 2)));
  const out = share.map((s, i) => Math.min(Math.max(s, lo[i]), hi[i]));
  /* Rebalance what clamping moved, one letter at a time, to a word with room. */
  let diff = target - out.reduce((a, b) => a + b, 0);
  for (let guard = 0; diff !== 0 && guard < 64; guard++) {
    const i = out.findIndex((s, k) => (diff > 0 ? s < hi[k] : s > lo[k]));
    if (i < 0) break;
    out[i] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  return out;
}

export function scrambleWords(name, rand) {
  /* Words and the separators between them, from the one splitter the
     enumeration and the tile also use. The scramble keeps the separators —
     "VNA DJIK", "XOALED-CHAMBRELAIN" — so the tile shows the shape of the
     name and a hyphenated surname is no longer a seventeen-letter word. */
  const { words, seps } = wordsOf(name);
  if (!words.length) return null;
  const total = words.reduce((a, w) => a + w.length, 0);
  /* THE CAPS ARE PART OF THE RULE. Three three-letter words — VAN DER SAR,
     nine letters, easy, five to keep — can keep at most one each, or a word
     would be its own answer. So the target a multi-word tile is built to is
     the band's target or the words' ceiling, whichever is lower; the band's
     own figure is kept beside it so the walk is visible. */
  const bandTarget = fixedTarget(total);
  const ceiling = words.reduce((a, w) => a + (w.length === 1 ? 1 : Math.max(minimumFixedPoints(w), w.length - 2)), 0);
  /* And the floor is the other bound: BABB is hard and asked for none home,
     but two of its three Bs have nowhere else to stand. */
  const target = Math.min(Math.max(bandTarget, nameFloor(name)), ceiling);
  const shares = wordTargets(words, target);

  let scramble = "", fixed = 0;
  words.forEach((w, i) => {
    if (scramble === null) return;
    const r = scrambleName(w, rand, shares[i]);
    if (!r) { scramble = null; return; }
    scramble += (i ? (seps[i - 1] || " ") : "") + r.scramble;
    fixed += r.fixed;
  });
  if (scramble === null) return null;
  return {
    scramble, fixed, floor: nameFloor(name), target, bandTarget,
    difficulty: bandOf(total),
    /* Walked: the letters could not hit the band's target exactly — a word's
       floor or cap got in the way. Within one of the built target is the
       rule's own tolerance; the build's gate refuses anything wider. */
    walked: fixed !== bandTarget,
  };
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

  /* THE SECOND CYPHER IS GATED WITH THE FIRST. A board is stored once and
     shown two ways, so a board that cannot be shown both ways is not a
     board. Catching it here rather than at serve time is the whole reason
     the cypher is derived at build. */
  problems.push(...consonantProblems(xi));

  if (shape.error) problems.push(shape.error);
  if (xi.length !== 11) {
    problems.push(`${xi.length} players — an XI has eleven, and that is the whole product`);
  }
  if (!src.source) {
    problems.push("no source — a board is a claim about who played and must carry the URL that backs it");
  }
  /* A LAST-TWO BOARD DERIVES BOTH. Its seed is the kickoff and its pool line
     is the fixture — facts the file already states, so asking the author to
     write them again would be a second copy of each. Every other board must
     carry its own: a lineup's seed is the only thing that makes its scramble
     reproducible, and its pool line is a sentence nobody can derive. */
  if (src.type !== "prem-last2") {
    if (!Number.isInteger(src.seed)) {
      problems.push("no integer seed — without one the scramble is not reproducible from this file");
    }
    if (!src.pool) {
      problems.push("no pool line — a player who does not know the frame is guessing at the whole of football");
    }
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
  /* THE BOARD TYPE. Absent on a lineup board and on a Daily, which are told
     apart by what they carry; "prem-last2" is the one type that has to say so,
     because its hint rule and its shape are its own. Anything else written in
     the field is a board this builder has never met. */
  if (src.type !== undefined && src.type !== "prem-last2") {
    problems.push(`unknown board type ${JSON.stringify(src.type)} — this builder knows "prem-last2", or no type at all`);
  }
  const last2 = src.type === "prem-last2";

  if (!["club", "nationality", "clubs", "none"].includes(src.hintField)) {
    problems.push(`hintField must be "club", "nationality", "clubs" or "none", not ${JSON.stringify(src.hintField)}`);
  } else if (src.hintField === "none") {
    /* NOTHING TO SELL, AND SAID SO. Forty-four of the iconic boards are
       elevens where neither club nor nationality varies enough to be worth a
       purchase, and rather than sell nothing they declare it. The bench keeps
       letters and names; the hint button is not offered. Checked nowhere
       else: a board that sells nothing has nothing to get wrong. */
  } else if (last2) {
    /* A LAST-TWO BOARD IS ITS OWN HINT. The author writes hintField "clubs"
       on these by convention, but no player carries a career: the club and
       the fixture are on the start card, and that IS the hint. So the career
       rule below is not applied — and because no slot has a career, the board
       sells nothing from the bench, which publicBoard reports as it would for
       "none". Guarded on the type, not on the absence of careers, so a Daily
       with an empty career is still refused as the empty purchase it is. */
  } else if (src.hintField === "clubs") {
    /* THE DAILY'S HINT, which is a career rather than a value.
       The "must vary across the eleven" rule below exists because a hint every
       player shares sells nothing — an all-English XI cannot sell nationality.
       A career cannot fail that way: two players sharing an identical club
       history is not a thing. So what is checked instead is that the hint
       EXISTS, because an empty career is a hint the player pays three minutes
       for and receives nothing from. */
    const bare = xi.filter((p) => !Array.isArray(p.clubs) || !p.clubs.length)
      .map((p) => p.name);
    if (bare.length) {
      problems.push(`no club history for: ${bare.join(", ")} — the hint they would ` +
        `pay for is empty`);
    }
    const shapeless = xi.filter((p) => (p.clubs || []).some((c) => !c || !c.club))
      .map((p) => p.name);
    if (shapeless.length) {
      problems.push(`a club entry with no club name for: ${shapeless.join(", ")}`);
    }
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

  /* ---- prem-last2: the shape the league's record gives us ---------------
     Each current club's last two league games, the real XI in the published
     formation. The fixture is the board's identity, so the board must name
     it; the shirt and the armband are the league's facts about that night,
     so they are checked as facts — one shirt per player, one captain per
     eleven — and the position is one the formation record actually uses. */
  if (last2) {
    if (!src.club) problems.push("a last-two board names no club");
    if (!Number.isInteger(src.gameweek) || src.gameweek < 1) {
      problems.push(`gameweek must be a positive integer, not ${JSON.stringify(src.gameweek)}`);
    }
    if (!src.kickoff) problems.push("no kickoff — the fixture is the board's identity");
    if (!Number.isInteger(src.kickoffMillis) || src.kickoffMillis <= 0) {
      problems.push("kickoffMillis must be a positive integer — it is how a stale set is told from a fresh one");
    }
    if (!["home", "away"].includes(src.venue)) {
      problems.push(`venue must be "home" or "away", not ${JSON.stringify(src.venue)}`);
    }
    const shirts = new Map();
    let captains = 0;
    xi.forEach((p, i) => {
      const where = `player ${i + 1} ("${p.name}")`;
      if (!Number.isInteger(p.shirt) || p.shirt < 1 || p.shirt > 99) {
        problems.push(`${where}: shirt must be a number from 1 to 99, not ${JSON.stringify(p.shirt)}`);
      } else if (shirts.has(p.shirt)) {
        problems.push(`${where}: shirt ${p.shirt} is also player ${shirts.get(p.shirt) + 1}'s — two players, one shirt`);
      } else shirts.set(p.shirt, i);
      if (p.captain === true) captains++;
      else if (p.captain !== false && p.captain !== undefined) {
        problems.push(`${where}: captain must be true or false, not ${JSON.stringify(p.captain)}`);
      }
      if (p.pos && !LAST2_POS.includes(p.pos)) {
        problems.push(`${where}: position ${JSON.stringify(p.pos)} is not one the league's formation ` +
          `record uses (${LAST2_POS.join(" ")})`);
      }
    });
    if (captains !== 1) {
      problems.push(`${captains} captains — a starting XI has exactly one, and the league's record names him`);
    }
  }

  return problems;
}

/* Where a player stood THAT NIGHT, from the league's formation record — a
   wider set than the Daily's usual roles, and only ever these. */

/* ---- THE CONSONANT CYPHER -------------------------------------------------
 * A second way to show the same board. The anagram shuffles a name's letters;
 * this leaves every letter where it is and blanks the vowels. SCHMEICHEL
 * reads SCHM__CH_L, O'SHEA reads _'SH__, VAN DIJK reads V_N D_JK. Y stays,
 * and so do spaces, apostrophes and hyphens.
 *
 * WHY THE BLANK RATHER THAN A BARE CONSONANT STRING. SH anchors to nothing.
 * _'SH__ anchors to a length and a shape, so a name that comes to mind is
 * confirmed or rejected at a glance instead of dithered over. Measured across
 * the bank, 94% of tiles blank to a form no other surname in the bank shares:
 * that is what makes the tile an anchor rather than a riddle.
 *
 * DERIVED HERE AND STORED, for the two reasons the scramble is: every player
 * must see the same board, and the gate must run before anything is stored.
 */
export const CY_VOWELS = /[AEIOU]/g;

export function blankVowels(name) {
  return String(name || "").toUpperCase().trim().replace(/\s+/g, " ").replace(CY_VOWELS, "_");
}

/* The cypher for a WHOLE ELEVEN, because two of its rules cannot be applied to
   a name on its own.

   A NAME WITH NO VOWELS blanks to itself: BLYTH, HYND, PRYTZ and TYLL, four in
   the bank. It cannot be hidden, and dropping the player would break the
   eleven, so the tile is marked `presolved` and starts on the team sheet. It
   counts as solved and never as given: the player was not helped, the cypher
   simply had nothing to take away.

   TWO NAMES THAT BLANK ALIKE cannot be told apart — ANDERSON and ANDERSEN are
   both _ND_RS_N. Every side with a fuller display name widens to it, which is
   the answer the letter-bag rule already gives the anagram. One case in the
   951 boards that build today. */
export function consonantCyphers(xi) {
  const slots = (xi || []).map((p) => {
    const name = String(p.name || "").toUpperCase();
    const display = String(p.display || "").toUpperCase();
    const wider = display && normalise(display) !== normalise(name) ? display : null;
    return { wider, basis: name, cyOf: "name" };
  });

  const groups = new Map();
  for (const s of slots) {
    const key = blankVowels(s.basis);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const s of group) {
      if (!s.wider) continue;
      s.basis = s.wider;
      s.cyOf = "display";
    }
  }

  return slots.map((s) => {
    const cy = blankVowels(s.basis);
    const flat = String(s.basis).toUpperCase().trim().replace(/\s+/g, " ");
    return { cy, cyOf: s.cyOf, ...(cy === flat ? { presolved: true } : {}) };
  });
}

/* What the gate refuses. Everything else about this cypher is derived, so
   there are only two ways for a board to be unbuildable in it. */
export function consonantProblems(xi) {
  const problems = [];
  const list = Array.isArray(xi) ? xi : [];
  const cys = consonantCyphers(list);
  const seen = new Map();
  cys.forEach((c, i) => {
    const where = `player ${i + 1} ("${list[i].name}")`;
    /* No consonants at all is a tile of blanks: nothing to hold on to, and no
       widening fixes it, because the forename is not the answer. */
    if (!normalise(list[i].name).replace(CY_VOWELS, "").length) {
      problems.push(`${where}: no consonants — its consonant tile would be blanks`);
    }
    if (seen.has(c.cy)) {
      problems.push(
        `${where}: blanks to ${c.cy}, the same as player ${seen.get(c.cy) + 1} ` +
        `("${list[seen.get(c.cy)].name}") — two consonant tiles cannot be told ` +
        `apart. Author both with forenames.`);
    } else seen.set(c.cy, i);
  });
  return problems;
}

export const LAST2_POS = ["GK", "LB", "CB", "RB", "LWB", "RWB", "CM", "DM", "AM", "LM", "RM", "LW", "RW", "ST"];

/* ---- Build ---------------------------------------------------------------- */
/* Exported so tools/import_scrambled.js produces the SAME built shape from the
   same sources. Two builders would be two boards. */
/* A last-two board's seed is its kickoff, so the scramble is reproducible
   from the fixture and two clubs kicking off at the same minute still differ
   by their gameweek and id. Every other board carries its own seed. */
export function seedOf(src) {
  if (src.type !== "prem-last2" || Number.isInteger(src.seed)) return src.seed;
  return (Math.floor(src.kickoffMillis / 60000) + src.gameweek * 7919 + (Number(src.id) || 0) * 104729) >>> 0;
}

/* And its pool line is the fixture, stated once on the start card: the club,
   the scoreline the title carries, home or away, and when. */
export function poolOf(src) {
  if (src.type !== "prem-last2") return src.pool;
  return `${src.club}'s starting XI — ${src.title}, ${src.venue === "home" ? "at home" : "away"}, ` +
    `gameweek ${src.gameweek}, ${src.kickoff}`;
}

export function build(src, file, pkg) {
  const shape = parseFormation(src.formation);
  const problems = gate(src, shape);
  if (problems.length) {
    console.error(`\n${file} refused:\n`);
    problems.forEach((p) => console.error("  x " + p));
    return null;
  }

  const rand = rng(seedOf(src));
  const bands = shape.bands;
  const slotBand = [];
  bands.forEach((b) => { for (let j = 0; j < b.size; j++) slotBand.push({ band: b.id, i: j, of: b.size }); });

  /* Derived for the eleven at once: a collision is a fact about the board,
     not about a name, so it cannot be decided a slot at a time. */
  const cyphers = consonantCyphers(src.xi);

  const slots = src.xi.map((p, i) => {
    const letters = normalise(p.name);
    const r = scrambleWords(p.name, rand);
    if (!r) throw new Error(`${file}: "${p.name}" produced no scramble at all.`);
    const { scramble, fixed, floor, target, difficulty } = r;
    /* THE RULE'S OWN GATE. The target is hit by construction; a word whose
       letters cannot hit its share walks the target out by one, and that is
       tolerated. Wider than one is a bug in the scrambler, not the data, and
       below the derangement floor is a scramble that does not exist. */
    if (fixed < floor || Math.abs(fixed - target) > 1) {
      throw new Error(`${file}: "${p.name}" settled at ${fixed} fixed letters — target ${target}, floor ${floor}.`);
    }
    if (letterBag(scramble) !== letterBag(p.name)) {
      throw new Error(`${file}: "${p.name}" — the scramble lost a letter. A bug, not bad data.`);
    }
    if (normalise(scramble) === letters) {
      throw new Error(`${file}: "${p.name}" — the scramble is the name.`);
    }
    const place = slotBand[i];
    return {
      id: "s" + (i + 1),
      band: place.band,
      x: Number(((place.i + 1) / (place.of + 1)).toFixed(4)),
      pos: p.pos || shape.labels[i],
      name: p.name,
      /* TWO NAME FIELDS, DELIBERATELY.
         `name` is the CYPHER — the surname, and the only thing scrambled. A
         forename adds letters without adding a clue, and the player was always
         identified by the surname anyway.
         `display` is the REVEAL, shown once the slot is solved: the board should
         read GARY LINEKER at the moment of recognition, not LINEKER. Falls back
         to the cypher, so a board authored without one still works. */
      display: p.display || p.name,
      aliases: p.aliases || [],
      club: p.club || null,
      nationality: p.nationality || null,
      /* The career rides on the slot, beside club-at-the-time rather than
         instead of it — they are different facts and a board may want either.
         Carried only when present, so a lineup board's slots do not gain an
         empty field stating that it has no career history. */
      ...(Array.isArray(p.clubs) && p.clubs.length ? { clubs: p.clubs } : {}),
      /* TWO CAREERS, DELIBERATELY, AND NOT INTERCHANGEABLE.

         clubs is the whole career and it is the HINT — bought from the bench
         before the answer is known.

         premClubs is the Premier League only, and it is the REVEAL: the line
         under the name once the tile is solved. Whelan's career reads Home
         Farm, Liverpool, Southend; his Premier League reads Liverpool. Using
         one for the other would either hand over the answer as a hint or
         print a reveal about clubs this game is not about. */
      ...(Array.isArray(p.premClubs) && p.premClubs.length ? { premClubs: p.premClubs } : {}),
      ...(p.birthYear ? { birthYear: p.birthYear } : {}),
      /* THE LEAGUE'S FACTS ABOUT THAT NIGHT, on a last-two board only: the
         shirt he wore and whether he wore the armband. Carried when present
         so a lineup or Daily slot does not gain fields saying it has neither. */
      ...(Number.isInteger(p.shirt) ? { shirt: p.shirt } : {}),
      ...(p.captain === true ? { captain: true } : {}),
      /* THE PLAYER'S OWN SOURCE. On a lineup board the claim is the board's —
         one article proving who played. On a Daily board there is no such
         article, and the claim moves to the player: each one carries the page
         their career was read from. Dropping it at the build left a Daily board
         resting on nothing inspectable, which board_test now refuses. */
      ...(p.source ? { source: p.source } : {}),
      scramble,
      fixed,
      /* Additive, from the rule: how hard this tile is by its length, and the
         anchors it was built to. Show it or ignore it; nothing else moves. */
      difficulty,
      target,
      len: enumerationOf(p.name),
      /* THE CONSONANT CYPHER, beside the scramble rather than instead of it:
         one stored row, two ways to show the board. `cyOf` says which name it
         was built from, because a collision widens the tile to the full name
         and a bought blank has to be filled from the string on screen. */
      ...cyphers[i],
    };
  });

  return {
    /* Lifted by the package's base: the site owns the id space, the author
       numbers from 1. A board built with no package is the Daily shape. */
    id: Number(src.id) + ((pkg && pkg.idBase) || 0),
    title: src.title,
    pool: src.pool || poolOf(src),
    formation: src.formation,
    hintField: src.hintField,
    /* Carried through only when it is false. A board with no opinion has no
       key, so the built shape does not gain a field stating the default — and
       `daily !== false` in the ring reads the same either way. */
    ...(src.daily === false || (pkg && pkg.daily === false) ? { daily: false } : {}),
    /* A LAST-TWO BOARD, WHOLE. The fixture is its identity, so the club, the
       gameweek, the kickoff and the venue ride with it, and it is never a
       daily — derived from the type rather than asked of the author, because
       "the last two games" is a set that goes stale every round, and a stale
       board in the daily ring would be a Tuesday nobody scheduled. */
    ...(src.type === "prem-last2" ? {
      type: "prem-last2",
      club: src.club,
      gameweek: src.gameweek,
      kickoff: src.kickoff,
      kickoffMillis: src.kickoffMillis,
      venue: src.venue,
      daily: false,
    } : {}),
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
/* Every package the bank holds, or the in-tree sample when there is no bank.
   The sample is the Daily package's shape at base 0, which is what the
   shipped module is. */
const packages = SRC === BANK
  ? packageDirs(SOURCE_ROOT)
  : [{ ...PACKAGES[0], path: SAMPLE_SRC }];
const built = [];
let refused = 0;
for (const pkg of packages) {
  const files = fs.readdirSync(pkg.path).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
  if (!files.length) {
    console.error(`\nNo XI files in ${path.relative(ROOT, pkg.path)}. Copy _TEMPLATE.json and fill it in.\n`);
    process.exit(1);
  }
  for (const f of files) {
    const src = JSON.parse(fs.readFileSync(path.join(pkg.path, f), "utf8"));
    const board = build(src, `${pkg.dir}/${f}`, pkg);
    if (!board) { refused++; continue; }
    built.push(board);
  }
  console.log(`\n${pkg.what}: ${files.length} boards from ${pkg.dir}/, ids from ${pkg.idBase + 1}` +
    `${pkg.daily ? "" : ", none a daily"}`);
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

/* THE MODULE IS A SAMPLE. The full bank goes to D1 through
   tools/import_scrambled.js, which reads these same sources — the module is
   no longer in the import path at all, so it cannot silently shrink what
   reaches production. */
/* THE COMMITTED MODULE IS BUILT FROM THE COMMITTED SOURCE, ALWAYS.

   It used to be the first four of whatever SRC happened to be — the bank on a
   machine that has it, the in-tree sample on one that does not. That makes a
   TRACKED file whose correct contents depend on which machine built it, and
   --check then compares the module against a different source than the one it
   was built from. Every CI run failed on it: the runner has no bank, so it
   rebuilt four other boards and reported the module as hand-edited.

   The bank still gates in full above, and still goes to D1 through
   import_scrambled.js. Only the fallback module is pinned here, to sources
   that travel with the repository and can therefore be checked anywhere. */
const sampleFiles = fs.readdirSync(SAMPLE_SRC)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
const sample = sampleFiles.slice(0, SAMPLE_COUNT)
  .map((f) => build(JSON.parse(fs.readFileSync(path.join(SAMPLE_SRC, f), "utf8")), f))
  .filter(Boolean);
if (sample.length !== Math.min(SAMPLE_COUNT, sampleFiles.length)) {
  console.error(`
A sample board was refused by the gate. The committed module
cannot be built, so nothing was written.
`);
  process.exit(1);
}
const out = `/* GENERATED by tools/build_scrambled.js — do not edit by hand.
 *
 * A SAMPLE OF ${sample.length} BOARDS, NOT THE BANK. The bank is in D1 and its
 * sources live outside this repository, the same arrangement the crossword and
 * the word search use. This exists so an unbound D1 binding degrades to
 * something playable instead of to nothing.
 *
 * Kept under functions/ on purpose: Pages bundles this into the Worker rather
 * than serving it. The sources were NOT under functions/ and were being served
 * by the live site — the answer key and the schedule, on a game whose API
 * refuses to show tomorrow's board.
 *
 * Rebuild with:  node tools/build_scrambled.js
 */
export const SC_BOARDS = ${JSON.stringify(sample, null, 2)};
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
console.log(`\n${built.length} board${built.length > 1 ? "s" : ""} gated; ${sample.length} ` +
  `written as the sample to ${path.relative(ROOT, DEST)}.\n` +
  `The bank reaches D1 through tools/import_scrambled.js, not through this file.\n`);
}
