#!/usr/bin/env node
/* tools/build_themes.js
 *
 * Themed boards, generated from the existing bank and written as SQL.
 *
 *   node tools/build_themes.js --source ../crosswordxi-source --launch 10 --weeks 14
 *
 * A themed board is an ordinary puzzle built from one theme's slice of the
 * bank. The generator is handed the slice as its rows rather than a filter,
 * because filters select on group/era/difficulty and a theme is none of those.
 *
 * Everything the generator already refuses still applies, and two of its rules
 * bite far harder here than on a general puzzle: a clue may not name another
 * entry's answer, and an answer may not have been named by a clue already
 * placed. On a Manchester United board almost every clue says "Manchester
 * United", so the club itself is usually unplaceable, and each placement rules
 * out more of a small pool. That is why a theme with sixty distinct answers
 * does not yield five boards.
 *
 * No clue is reused inside a theme: each board excludes everything its
 * predecessors used. Across themes reuse is fine and expected — meeting Old
 * Trafford in Grounds and again in Manchester United months later is not a
 * repeat anyone minds.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i === -1 ? d : process.argv[i + 1];
};
const SOURCE = arg("source", ROOT);
const LAUNCH = parseInt(arg("launch", "10"), 10);
const WEEKS = parseInt(arg("weeks", "14"), 10);
const MAX_PER_THEME = parseInt(arg("max-per-theme", "4"), 10);
const OUT = path.join(ROOT, "data", "themes-production.sql");
const PLAN = path.join(ROOT, "data", "themes-plan.json");

function need(f) {
  const p = path.resolve(SOURCE, f);
  if (!fs.existsSync(p)) { console.error(`Cannot find ${p}`); process.exit(1); }
  return p;
}
const FCW = require(need("engine.js"));
const rows = JSON.parse(fs.readFileSync(need("data.json"), "utf8"));
/* Extra banks merged in, for material written for one theme rather than
   scraped from the general bank. Same shape, same rules — the generator does
   not care where a row came from. */
const extraArg = arg("extra", "");
for (const f of extraArg.split(",").filter(Boolean)) {
  const p = path.resolve(f);
  if (!fs.existsSync(p)) { console.error(`Cannot find ${p}`); process.exit(1); }
  const add = JSON.parse(fs.readFileSync(p, "utf8"));
  const have = new Set(rows.map((r) => String(r.id)));
  let n = 0;
  for (const r of add) if (!have.has(String(r.id))) { rows.push(r); n++; }
  console.log(`merged ${n} rows from ${path.basename(p)}`);
}
const { THEMES, poolFor } = require("./themes.js");

const CLUB = "club";   // matches the kind set in tools/themes.js
const TARGET = 11;
/* Transfers are capped at 3 everywhere, as they are on the Daily. On a club
   board everything else is capped at 2 as well, because the same construction
   three times reads as one question asked three ways: Chelsea #1 came out with
   four Managers clues, Manchester City #1 with three "Who Am I", and Arsenal
   with three of "Won the FA Cup in ____, beating Arsenal in the final".
   Topic boards are exempt from the wildcard — on a Grounds board the category
   *is* the theme, and capping it at two makes the board impossible. */
const FAMILY_CAP = { Transfer: 3 };
const CLUB_FAMILY_CAP = { "*": 2, Transfer: 3 };

/* How often the theme appears only as the side that lost. One is colour — a
   club's history includes being beaten. Three of eleven is a board about
   everyone else's trophies, handed to that club's own supporters. */
function beatenCount(puzzle, theme) {
  if (!theme.keys) return 0;
  let n = 0;
  for (const e of puzzle.entries) {
    const clue = String(e.row.clue || "");
    const isAnswer = theme.keys.some((k) =>
      k.replace(/[^a-z0-9]/g, "") === String(e.row.grid || "").toLowerCase());
    if (isAnswer) continue;
    for (const k of theme.keys) {
      // "beating Arsenal in the final", "Arsenal ... runners-up"
      if (new RegExp("(beating|beat|defeat\\w*|runners?[- ]up to)[^.]{0,40}" +
                     k.replace(/[^a-z0-9 ]/g, ""), "i").test(clue)) { n++; break; }
    }
  }
  return n;
}
const MAX_BEATEN = 1;
const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const salt = () => crypto.randomBytes(12).toString("hex");

/* Build up to `want` boards for one theme, each using clues none of the
   earlier ones used. Several seeds per board, because a small pool fails to
   reach eleven far more often than the whole bank does. */
function boardsFor(theme, want) {
  const pool = poolFor(rows, theme);
  const made = [];
  const usedIds = {};
  for (let n = 1; n <= want; n++) {
    let got = null;
    for (let attempt = 0; attempt < 200 && !got; attempt++) {
      const seed = 7000000 + hash(theme.id) + n * 104729 + attempt * 7919;
      const filter = Object.keys(usedIds).length ? { excludeIds: usedIds } : {};
      let p;
      const cap = theme.kind === CLUB
        ? (theme.familyCap
            ? { "*": theme.familyCap, Transfer: Math.max(3, theme.familyCap) }
            : CLUB_FAMILY_CAP)
        : FAMILY_CAP;
      try {
        p = FCW.generate(pool, { seed, filter, maxPerFamily: cap });
      } catch (e) { continue; }
      if (p && p.entries.length === TARGET && beatenCount(p, theme) <= MAX_BEATEN) got = p;
    }
    if (!got) break;                       // this theme is spent; stop cleanly
    got.entries.forEach((e) => { usedIds[e.row.id] = true; });
    made.push(got);
  }
  return made;
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0 % 100000;
}

/* Every invariant the game relies on, checked on the way out rather than
   trusted. A themed board that breaks one of these must not be stored. */
function validate(p, theme) {
  const faults = [];
  if (p.entries.length !== TARGET) faults.push(`${p.entries.length} answers`);
  const grids = p.entries.map((e) => e.row.grid);
  if (new Set(grids).size !== grids.length) faults.push("duplicate answer");
  const transfers = p.entries.filter((e) => e.row.cat.startsWith("Transfer")).length;
  if (transfers > FAMILY_CAP.Transfer) faults.push(`${transfers} transfers`);
  const beaten = beatenCount(p, theme);
  if (beaten > MAX_BEATEN) faults.push(`theme beaten ${beaten} times`);
  if (theme.kind === CLUB) {
    const fams = {};
    p.entries.forEach((e) => {
      const f = e.row.cat.split(" \u2192")[0];
      fams[f] = (fams[f] || 0) + 1;
    });
    const wildcard = theme.familyCap || 2;
    for (const [f, n] of Object.entries(fams)) {
      const limit = f === "Transfer" ? Math.max(3, wildcard) : wildcard;
      if (n > limit) faults.push(`${n} x ${f}`);
    }
  }
  for (const e of p.entries) {
    const clue = " " + e.row.clue.toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, "") + " ";
    if (clue.indexOf(e.row.grid) !== -1) faults.push(`self-answering ${e.row.id}`);
    for (const other of p.entries) {
      if (other === e) continue;
      if (clue.indexOf(other.row.grid) !== -1) {
        faults.push(`${e.row.id} names ${other.row.grid}`);
      }
    }
  }
  return faults;
}

console.log("Generating themed boards from the existing bank\n");
const built = [];
const ONLY = arg("only", "");
for (const theme of THEMES) {
  if (ONLY && theme.id !== ONLY) continue;
  const pool = poolFor(rows, theme);
  const made = boardsFor(theme, MAX_PER_THEME);
  const good = [];
  made.forEach((p, i) => {
    const faults = validate(p, theme);
    if (faults.length) {
      console.log(`  ${theme.name} #${i + 1}  REJECTED  ${faults.join(", ")}`);
    } else good.push(p);
  });
  good.forEach((p, i) => built.push({ theme, no: i + 1, puzzle: p }));
  console.log(`${theme.name.padEnd(22)}pool ${String(pool.length).padStart(4)}   boards ${good.length}`);
}

console.log(`\n${built.length} boards built across ${THEMES.length} themes`);

/* Order: the launch batch takes one board from each of the biggest draws, so
   nobody arrives to a section with nothing for their club. The rest fall into
   the weekly run, alternating a club with a topic so no club returns soon. */
/* How many boards of each theme are out on day one. Weighted towards the
   largest followings deliberately: the launch batch is an archive, not a
   cadence, so two Manchester United boards arriving together is a back
   catalogue rather than a repeat. */
const LAUNCH_SPEC = [
  ["man-united", 2], ["liverpool", 2], ["arsenal", 2],
  ["chelsea", 1], ["spurs", 1], ["man-city", 1],
  /* One board for everybody else. Without it the whole shelf on day one is
     big six, and a Sunderland or Forest supporter arriving has nothing to
     open. Grounds rather than any other topic because it is measurably the
     least big-six board in the set — eleven different clubs, none of them a
     big six, from Craven Cottage to Burnden Park. */
  ["grounds", 1], ["nicknames", 1], ["premier-league", 1],
  /* Two Bolton boards on the shelf from the start. The other two follow on
     their Fridays — a theme with four boards and nothing to wait for is an
     archive rather than a series. */
  ["bolton", 2],
];
const first = [], rest = [];
const quota = {};
LAUNCH_SPEC.forEach(([id, n]) => { quota[id] = n; });
const order = LAUNCH_SPEC.map(([id]) => id);
for (const b of built) {
  if (quota[b.theme.id] && b.no <= quota[b.theme.id]) first.push(b);
  else rest.push(b);
}
first.sort((a, b) =>
  (order.indexOf(a.theme.id) - order.indexOf(b.theme.id)) || (a.no - b.no));
LAUNCH_SPEC.forEach(([id, n]) => {
  const got = first.filter((b) => b.theme.id === id).length;
  if (got < n) console.log(`  NOTE: ${id} wanted ${n} at launch, the bank yielded ${got}`);
});

/* Board number first, then theme. Ordering by theme instead put Manchester
   United #2, #3 and #4 inside a month, which is precisely the repetition the
   weekly cadence exists to avoid: every theme's second board goes out before
   any theme's third. Clubs and topics alternate within each round. */
const weekly = [];
const maxNo = rest.reduce((m, b) => Math.max(m, b.no), 0);
for (let n = 2; n <= maxNo; n++) {
  const clubs = rest.filter((b) => b.no === n && b.theme.kind === "club");
  const topics = rest.filter((b) => b.no === n && b.theme.kind === "topic");
  while (clubs.length || topics.length) {
    if (clubs.length) weekly.push(clubs.shift());
    if (topics.length) weekly.push(topics.shift());
  }
}
/* Any first board not in the launch batch goes out early — a club with only
   one board has nothing else to wait for. */
const leftoverFirsts = rest.filter((b) => b.no === 1);
weekly.unshift(...leftoverFirsts);

/* Priority themes take the earliest slots that still keep four weeks between
   their own boards. Four weeks is the gap the whole programme holds to, so
   this brings a theme forward without making it repeat sooner than any other.
   Slot 4 is the fifth Friday, which is 28 days after launch. */
const SPACING = 4;
for (const t of THEMES.filter((x) => x.priority)) {
  const mine = weekly.filter((b) => b.theme.id === t.id);
  if (!mine.length) continue;
  mine.forEach((b) => weekly.splice(weekly.indexOf(b), 1));
  mine.sort((a, b) => a.no - b.no).forEach((b, i) => {
    const at = Math.min((i + 1) * SPACING - 1, weekly.length);
    weekly.splice(at, 0, b);
  });
}

/* Fridays, with room for a burst.
 *
 * The ordinary cadence is one board a Friday. A special week suspends that and
 * releases one a day for seven days — Christmas week, where the holiday is
 * exactly when people have time and the ordinary Friday would be competing
 * with Christmas Day itself.
 *
 * One a day rather than seven at once, and the archive is why: every board
 * stays playable for good, so both shapes leave the same seven available by
 * the end of the week. The difference is seven reasons to come back against
 * one, and nothing is lost by the drip — a board released on the Monday is
 * still there on the Saturday for anyone who was busy.
 */
const addDays = (d, n) => {
  const c = new Date(d.getTime());
  c.setUTCDate(c.getUTCDate() + n);
  return c;
};
const nextFriday = (d) => addDays(d, ((5 - d.getUTCDay() + 7) % 7) || 7);

function scheduleDates(n, launch, special) {
  const out = [];
  let d = nextFriday(launch);
  let burst = false;
  while (out.length < n) {
    if (special && !burst && d >= special.start) {
      for (let i = 0; i < special.days && out.length < n; i++) out.push(addDays(special.start, i));
      burst = true;
      d = nextFriday(addDays(special.start, special.days - 1));
      continue;
    }
    out.push(d);
    d = addDays(d, 7);
  }
  return out;
}
/* When the section opens. Defaults to today rather than to Matchday 1: the
   themed track is its own thing and does not need the season to have started.
   Set it to the day you actually deploy — a launch date in the past means the
   whole batch is already released, which is right, and one in the future means
   nothing shows up until then, which is also right but rarely intended. */
const LAUNCH_DAY = arg("launch-on", new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(LAUNCH_DAY)) {
  console.error(`--launch-on wants YYYY-MM-DD, not "${LAUNCH_DAY}"`);
  process.exit(1);
}
/* Christmas week by default: seven boards, one a day, 21–27 December, which
   takes in Christmas Eve, Christmas Day and Boxing Day. Costs seven ordinary
   Fridays out of the reserve, which the stock can carry. */
const SPECIAL_START = arg("special-start", "2026-12-21");
const SPECIAL_DAYS = parseInt(arg("special-days", "7"), 10);
const special = SPECIAL_START && SPECIAL_DAYS > 0
  ? { start: new Date(SPECIAL_START + "T00:00:00Z"), days: SPECIAL_DAYS }
  : null;
const dates = scheduleDates(weekly.length, new Date(LAUNCH_DAY + "T00:00:00Z"), special);
const iso = (d) => d.toISOString().slice(0, 10);

const out = [];
out.push("-- Generated by tools/build_themes.js. Do not edit by hand.");
out.push("-- Contains answers: never commit this file.");
out.push("DELETE FROM theme_boards;");
out.push("DELETE FROM themes;");
for (const t of THEMES) {
  const n = built.filter((b) => b.theme.id === t.id).length;
  if (!n) continue;
  out.push(`INSERT INTO themes (id, name, kind) VALUES (${sqlStr(t.id)}, ${sqlStr(t.name)}, ${sqlStr(t.kind)});`);
}
const plan = [];
function row(b, releaseIso) {
  const clueIds = b.puzzle.entries.map((e) => e.row.id);
  const payload = JSON.stringify({ salt: salt(), theme: b.theme.id, puzzle: b.puzzle });
  out.push(`INSERT INTO theme_boards (theme_id, board_no, release_on, payload, clue_ids) VALUES (` +
    `${sqlStr(b.theme.id)}, ${b.no}, ${sqlStr(releaseIso)}, ${sqlStr(payload)}, ` +
    `${sqlStr(JSON.stringify(clueIds))});`);
  plan.push({ theme: b.theme.id, name: b.theme.name, no: b.no, release: releaseIso,
              answers: b.puzzle.entries.map((e) => e.row.answer), clueIds });
}
first.forEach((b) => row(b, LAUNCH_DAY));
weekly.forEach((b, i) => row(b, dates[i] ? iso(dates[i]) : iso(dates[dates.length - 1])));

fs.writeFileSync(OUT, out.join("\n") + "\n");
fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1) + "\n");
console.log(`\nLaunch batch (${first.length}) on ${LAUNCH_DAY}:`);
first.forEach((b) => console.log(`  ${b.theme.name} #${b.no}`));
console.log(`\nWeekly run, first ${Math.min(WEEKS, weekly.length)} of ${weekly.length}:`);
weekly.slice(0, WEEKS).forEach((b, i) =>
  console.log(`  ${iso(dates[i])}  ${b.theme.name} #${b.no}`));
console.log(`\nWrote ${OUT}`);
console.log(`Wrote ${PLAN}  — the answer lists, for review before any of this is imported`);
