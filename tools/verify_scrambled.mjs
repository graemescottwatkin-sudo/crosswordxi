/* verify_lineups.mjs — read an XI off the source, not off a summary.
 *
 * WHY THIS EXISTS
 *
 * Board data was first gathered by fetching pages through a summarising model.
 * That model returned "Bernardo Silva — Spain". He is Portuguese, and the raw
 * article says so: `{{flagicon|POR}} [[Bernardo Silva]]`. Nationality is the
 * hint field on a club board, so that one wrong value would have shipped a
 * board that lies to the player about the thing they spent a hint on.
 *
 * A summary is not a source. This reads the article wikitext itself and parses
 * the lineup table, so the nationality on a board is the nationality printed
 * in the table, character for character, with nothing paraphrasing in between.
 *
 * WHAT IT CANNOT DO
 *
 * It checks a board against the page. It cannot tell you the page is right, and
 * it cannot check a board whose source is not a Wikipedia match report — the
 * Aston Villa v PSG board is sourced from Sky and has to be read by hand.
 *
 * Usage:
 *   node research/tools/verify_lineups.mjs fetch "<page title>"     cache one page
 *   node research/tools/verify_lineups.mjs show  "<page title>"     print both XIs
 *   node research/tools/verify_lineups.mjs check                    compare every board
 */

import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/* PORTED from the research repo's verify_lineups.mjs, pointed at the bank and
   made OFFLINE-ONLY.
 *
 * It answers the question build_scrambled.js structurally cannot: is a board
 * that is internally consistent also FACTUALLY RIGHT. The board data was first
 * gathered through a summarising fetch which returned "Bernardo Silva - Spain";
 * he is Portuguese, and nationality is the hint field on a club board, so that
 * one value would have shipped a board that lies to the player about the thing
 * they spent a hint on.
 *
 * WHY IT MUST NOT FETCH HERE. Upstream this tool caches from Wikipedia. As an
 * import gate that would be a multi-minute network job failing for reasons
 * that have nothing to do with the boards — the author's own sweep read
 * 202 -> 248 -> 256 -> 264 purely from re-running after rate limits, with
 * nothing else changed. Pointed at the pinned snapshots it is instant and
 * deterministic, and it checks the boards against the article state they were
 * verified against rather than whatever the article says today.
 *
 * A missing snapshot is a REFUSAL, not a fetch and not a skip.
 */
const BANK = (() => {
  const i = process.argv.indexOf("--source");
  const base = i > -1 ? process.argv[i + 1]
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scrambledxi-source");
  return base;
})();
const CACHE = path.join(BANK, "sources");
const XI_DIR = path.join(BANK, "xi");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const slug = (title) => title.replace(/[^A-Za-z0-9]+/g, "_");

/* Synchronous, because the fetch is execFileSync and the whole tool is a
   straight line. Atomics.wait on a throwaway buffer is the only way to block
   without spinning the CPU. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* ---- the source, fetched raw ------------------------------------------- */

export function wikitext(title) {
  const file = path.join(CACHE, slug(title) + ".wiki");
  if (existsSync(file)) return readFileSync(file, "utf8");
  /* OFFLINE ONLY. Upstream this fetched and cached; here a missing snapshot is
     a refusal. Fetching would make the import gate depend on Wikipedia being
     reachable and unthrottled, and would check the board against the article
     as it reads TODAY rather than the state it was verified against — a source
     edited after a board shipped would fail an import that changed nothing. */
  throw new Error(
    `no pinned snapshot for "${title}" (looked for ${path.relative(BANK, file)}).\n` +
    `      The bank ships the article snapshots it was verified against. If this ` +
    `board is new,\n      stage it with its source rather than importing against a ` +
    `source nobody kept.`);
}

/* ---- the lineup tables, parsed ----------------------------------------- */

/* A starter row looks like:
     |GK ||'''31'''||{{flagicon|BRA}} [[Ederson (footballer, born 1993)|Ederson]]
   Everything after the "Substitutes:" marker in a table is not a starter. */
/* Three things this has to tolerate, each found by a board failing to verify:
   - `{{fbaicon|ENG}}` instead of `{{flagicon|ENG}}` (2013 FA Cup final)
   - `{{flagicon|FRA|1974}}`, a flag with a variant year (2019 CL final)
   - `'''9 '''`, a shirt number with a stray space (1999 CL final, Andy Cole)
   The last one is worth remembering: it made United's whole XI invisible, and
   the checker then compared the United board against Bayern's eleven. */
const ROW = /^\|\s*(?:\{\{abbr\|)?([A-Z]{2,3})(?:\|[^}]*\}\})?\s*\|\|\s*'''\s*(\d+)\s*'''\s*\|\|\s*(?:\{\{(?:(?:flag|fba)icon|#invoke:flag\|icon)\|([A-Za-z-]+)(?:\|[^}]*)?\}\}\s*)?\[\[([^\]]+)\]\]/;

function displayName(link) {
  const bar = link.indexOf("|");
  return (bar === -1 ? link : link.slice(bar + 1)).trim();
}

export function lineups(title) {
  const text = wikitext(title);
  /* The two team tables are not styled identically. The second usually carries
     `; margin:auto`, so match on the font-size inside the attribute rather than
     on the whole attribute — otherwise only the home XI is ever parsed, and a
     board silently gets compared against the opposition. */
  const blocks = text.split(/\{\|[^\n]*font-size:\s*90%/).slice(1);
  const teams = [];

  for (const block of blocks) {
    /* "Substitutes:" on club match reports, "Substitutions:" on World Cup ones. */
    const upto = block.split(/'''Substitut(?:es|ions):'''/)[0];
    const xi = [];
    for (const line of upto.split("\n")) {
      const m = ROW.exec(line.trim());
      if (!m) continue;
      /* Keep the link target as well as the display text. Where a table prints
         a mononym the target often carries the full name — [[Samuel Quina|Samuel]]
         — which is a sourced fuller name rather than a guessed one. Targets that
         are only a parenthetical disambiguator, [[Diego (footballer, born 1985)]],
         carry nothing extra and are discarded by the caller. */
      const bar = m[4].indexOf("|");
      xi.push({
        pos: m[1], num: Number(m[2]), flag: m[3],
        name: displayName(m[4]),
        target: (bar === -1 ? m[4] : m[4].slice(0, bar)).trim(),
      });
    }
    if (xi.length === 11) teams.push(xi);
  }
  return teams;
}

/* ---- flag codes, spelled out ------------------------------------------- */

const COUNTRY = {
  ALG: "Algeria", ARG: "Argentina", ARM: "Armenia", AUS: "Australia", AUT: "Austria",
  BEL: "Belgium", BIH: "Bosnia and Herzegovina", BLR: "Belarus", BRA: "Brazil",
  BRB: "Barbados", BUL: "Bulgaria", CAN: "Canada", CIV: "Ivory Coast", CMR: "Cameroon",
  COL: "Colombia", CRC: "Costa Rica", CRO: "Croatia", CZE: "Czech Republic",
  DEN: "Denmark", ECU: "Ecuador", EGY: "Egypt", ENG: "England", ESP: "Spain",
  FIN: "Finland", FRA: "France", GEO: "Georgia", GER: "Germany", GHA: "Ghana",
  GRE: "Greece", HON: "Honduras", IRL: "Republic of Ireland", ISL: "Iceland",
  ITA: "Italy", JPN: "Japan", KOR: "South Korea", MAR: "Morocco", MEX: "Mexico",
  MKD: "North Macedonia", MLI: "Mali", MNE: "Montenegro", NED: "Netherlands",
  NGA: "Nigeria", NIR: "Northern Ireland", NOR: "Norway", PAR: "Paraguay",
  POL: "Poland", POR: "Portugal", ROU: "Romania", SCO: "Scotland", SEN: "Senegal",
  SRB: "Serbia", SUI: "Switzerland", SVN: "Slovenia", SWE: "Sweden", TUR: "Turkey",
  TRI: "Trinidad and Tobago", UKR: "Ukraine", URU: "Uruguay", USA: "United States",
  WAL: "Wales", ZIM: "Zimbabwe", "FR_Yugoslavia": "Yugoslavia", YUG: "Yugoslavia",
  "GER-1949": "West Germany", FRG: "West Germany",
  /* The iconic bank's first walk found ninety-four boards "wrong" that were
     right: every one was a code this table did not hold. Added from that
     walk, so the verifier's ignorance is no longer reported as the board's
     error. */
  RUS: "Russia", JAM: "Jamaica", CHI: "Chile", FRY: "Yugoslavia", RSA: "South Africa",
  SAF: "South Africa", IRE: "Republic of Ireland", EIR: "Republic of Ireland",
  SVK: "Slovakia", ISR: "Israel", HUN: "Hungary", PER: "Peru", GUI: "Guinea",
  GAB: "Gabon", COD: "DR Congo", DRC: "DR Congo", BFA: "Burkina Faso", ZAM: "Zambia",
  VEN: "Venezuela", TAN: "Tanzania", SWI: "Switzerland", ROM: "Romania",
  NZL: "New Zealand", LUX: "Luxembourg", LBR: "Liberia", GRN: "Grenada",
  GDR: "East Germany", DOM: "Dominican Republic", DNK: "Denmark", CGO: "Congo",
  CAY: "Cayman Islands", CIS: "CIS", BER: "Bermuda", ALB: "Albania", BAN: "Bangladesh",
};
/* A flag written as a name — {{flagicon|England}} — is its own answer. */
export const country = (flag) => COUNTRY[flag] || (/[a-z]/.test(String(flag)) ? String(flag) : `?${flag}`);

/* ---- comparison against an authored board ------------------------------ */

/* Ł does not decompose under NFD, so without an explicit rule Błaszczykowski
   strips to BASZCZYKOWSKI and never matches the board. Same class as Ø and Đ. */
const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[Øø]/g, "O").replace(/[Ææ]/g, "AE")
  .replace(/[ß]/g, "SS").replace(/[Đđ]/g, "D")
  .replace(/[Łł]/g, "L").replace(/[ıİ]/g, "I")
  .toUpperCase().replace(/[^A-Z]/g, "");

/* A board carries the surname; the source carries the full name. Match on the
   END of the name, not on containment anywhere in it — otherwise COSTA (Rui
   Costa) matches Alessandro COSTAcurta, and the checker reports a nationality
   mismatch that is its own fault. Exact first, then suffix, then containment,
   and a source row can only be claimed once. */
function matchRow(rows, want, taken) {
  const free = rows.filter((r) => !taken.has(r));
  for (const test of [
    (a, b) => a === b,
    (a, b) => a.endsWith(b) || b.endsWith(a),
    (a, b) => a.includes(b) || b.includes(a),
  ]) {
    const hit = free.find((r) => test(strip(r.name), want));
    if (hit) return hit;
  }
  return null;
}

function checkBoard(fileName, dir = XI_DIR) {
  const board = JSON.parse(readFileSync(path.join(dir, fileName), "utf8"));
  const src = board.source || "";
  const m = /en\.wikipedia\.org\/wiki\/([^#?]+)/.exec(src);
  if (!m) return { fileName, skipped: `source is not a Wikipedia article: ${src}` };

  const title = decodeURIComponent(m[1]).replace(/_/g, " ");
  let teams;
  try { teams = lineups(title); } catch (e) { return { fileName, skipped: e.message }; }
  /* Both elevens or nothing. With only one parsed there is no way to know it is
     the right one, and "best overlap" would happily compare a board against the
     opposition and call every name wrong. Refuse rather than guess. */
  if (teams.length < 2) {
    return { fileName, skipped: `parsed ${teams.length} of 2 XIs from "${title}" — cannot verify against half a match` };
  }

  /* Which of the two elevens is this board? The one whose surnames overlap. */
  const want = board.xi.map((p) => strip(p.name));
  let best = null, bestHits = -1;
  for (const xi of teams) {
    const hits = xi.filter((r) => want.some((w) => strip(r.name).includes(w) || w.includes(strip(r.name)))).length;
    if (hits > bestHits) { bestHits = hits; best = xi; }
  }

  const problems = [];
  if (bestHits < 6) problems.push(`could not match this board to either XI on "${title}" (best overlap ${bestHits}/11)`);

  /* Every authored name must appear in the source XI. */
  const taken = new Set();
  for (const p of board.xi) {
    const w = strip(p.name);
    const row = matchRow(best, w, taken);
    if (!row) { problems.push(`${p.name}: not in the source XI`); continue; }
    taken.add(row);
    if (board.hintField === "nationality") {
      const srcNat = country(row.flag);
      if (srcNat !== p.nationality) {
        problems.push(`${p.name}: board says ${p.nationality}, source flag is ${row.flag} = ${srcNat}`);
      }
    }
    if (p.pos && p.pos !== row.pos) {
      problems.push(`${p.name}: board position ${p.pos}, source says ${row.pos}`);
    }
  }
  /* And nobody in the source XI may be missing from the board. */
  for (const row of best) {
    if (!taken.has(row)) problems.push(`${row.name} (${row.pos}) is in the source XI but not on the board`);
  }
  return { fileName, title, problems };
}

/* ---- cli --------------------------------------------------------------- */

const isCli = process.argv[1] && process.argv[1].endsWith("verify_scrambled.mjs");
const [cmd, arg] = isCli ? process.argv.slice(2) : [];

if (cmd === "fetch") { wikitext(arg); console.log(`cached ${arg}`); }
else if (cmd === "show") {
  for (const xi of lineups(arg)) {
    console.log("");
    for (const r of xi) console.log(`  ${r.pos.padEnd(4)} ${String(r.num).padStart(2)}  ${country(r.flag).padEnd(22)} ${r.name}`);
  }
} else if (cmd === "check") {
  /* Every package the bank holds — the Daily bank in xi/ and the iconic
     lineups in iconic/ — because the iconic boards cite Wikipedia and are
     exactly the ones this tool can check, and a walk of xi/ alone would have
     verified none of them while reporting a clean bank. */
  const files = [];
  for (const dir of ["xi", "iconic"]) {
    const full = path.join(BANK, dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full).filter((f) => /^\d/.test(f)).sort()) {
      files.push({ dir: full, name, label: `${dir}/${name}` });
    }
  }
  let bad = 0, skipped = 0;
  for (const { dir, name, label: f } of files) {
    const r = checkBoard(name, dir);
    if (r.skipped) { console.log(`\n  ~  ${f}\n       ${r.skipped}`); skipped++; continue; }
    if (!r.problems.length) { console.log(`  ok ${f}`); continue; }
    bad++;
    console.log(`\n  !! ${f}  (against "${r.title}")`);
    for (const p of r.problems) console.log(`       ${p}`);
  }
  console.log(`\n${files.length} boards: ${files.length - bad - skipped} verified against source, ${bad} with problems, ${skipped} not machine-checkable.\n`);
  if (bad) process.exitCode = 1;
} else if (isCli) {
  console.log("usage: verify_lineups.mjs fetch|show \"<page title>\" | check");
}
