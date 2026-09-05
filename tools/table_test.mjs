/* table_test.mjs — the live league table, shared by the football games.
 *
 * Your score IS your club's points in a real historical season. Finish on 82
 * and you won the league in 1995/96; finish on 34 and you went down. The
 * crossword has had this from the beginning and it is the best thing in it;
 * four more games are getting it, so the logic moved to shared/xi-table.js and
 * the crossword's engine now delegates rather than keeping a second copy.
 *
 * THE CHECK THAT MATTERS MOST is that the crossword's answer did not change on
 * the way out. A table that ranks somebody differently after a refactor is a
 * silent regression in the one number a player watches all the way through.
 *
 * IT IS NOT THE SEASON. There is one of those and it belongs to the hub — a
 * result a day across the family, counted from finishes (shared/xi-season.js).
 * A per-board ladder and a family season are different things, and confusing
 * them is exactly what the invented 38-game strip did.
 *
 *   node tools/table_test.mjs        (from the repo root)
 */
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XITable = require("../shared/xi-table.js");

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* The real thirty seasons, loaded the way a page loads them. */
const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("shared/xi-seasons.js", "utf8"), sandbox);
const SEASONS = sandbox.XI_SEASONS;
globalThis.XI_SEASONS = SEASONS;

console.log("The seasons are real, and complete");
{
  t("thirty of them are loaded", SEASONS.length >= 30, SEASONS.length + " seasons");
  const bad = SEASONS.filter((s) => !s.table || s.table.length !== 20).map((s) => s.season);
  t("every one is a twenty-club table", bad.length === 0, bad.join(", ") || "all 20");
  t("and both names point at the same array, not a copy",
    sandbox.window.XI_SEASONS === sandbox.window.FCW_SEASONS,
    "a second list is a list that can drift");
}

const s96 = SEASONS.find((s) => s.season === "1995/96");

console.log("\nYour score is your club's points");
{
  const table = XITable.buildTable("Everton", 82, s96);
  t("the ladder is twenty long", table.length === 20, table.length + " rows");
  const you = table.find((r) => r.isPlayer);
  t("you are in it, once, with your score",
    !!you && you.club === "Everton" && you.points === 82 &&
    table.filter((r) => r.isPlayer).length === 1, JSON.stringify(you));
  t("and 82 in 1995/96 wins the league",
    XITable.playerPosition(table) === 1,
    "Manchester United took it on 82 that year, and a tie goes to the player");
  t("nought puts you bottom",
    XITable.playerPosition(XITable.buildTable("Everton", 0, s96)) === 20);
  /* THE REAL CLUB'S ROW IS REPLACED, NOT ADDED BESIDE. Everton played that
     season; two Evertons in one table is the bug this guards. */
  t("your club appears once, not twice",
    table.filter((r) => r.club === "Everton").length === 1);
  t("and the other nineteen keep their real points",
    table.filter((r) => !r.isPlayer).every((r) =>
      s96.table.some((h) => h.club === r.club && h.points === r.points)),
    "the ladder is history with your score dropped into it");
}

console.log("\nA club that did not play that season");
{
  /* Luton were not in the Premier League in 1995/96. The player still gets a
     place: the bottom club is displaced, so the ladder is always twenty. */
  const table = XITable.buildTable("Luton Town", 40, s96);
  t("you take the bottom club's place, and the ladder stays twenty",
    table.length === 20 && table.filter((r) => r.isPlayer).length === 1);
  const bottom = s96.table[s96.table.length - 1].club;
  t("and it is the bottom club that makes way",
    !table.some((r) => r.club === bottom), "displaced: " + bottom);
}

console.log("\nA tie goes to the player");
{
  /* Somebody finishing level with a real club is ahead of them, not behind.
     A player who drew with fourth and was shown fifth would be reading a
     worse result than they got. */
  const rival = s96.table[5];
  const table = XITable.buildTable("Luton Town", rival.points, s96);
  const you = XITable.playerPosition(table);
  const them = table.find((r) => r.club === rival.club).pos;
  t("level on points puts you above them", you < them, `you ${you}, ${rival.club} ${them}`);
}

console.log("\nThe crossword's answer did not change");
{
  /* THE REGRESSION CHECK. The engine's buildTable and playerPosition are now
     one-line delegations to this module, so the two must agree on every
     season, every club and a spread of scores — not on one sample. */
  const FCW = require("../football/crossword/js/engine.js");
  let compared = 0;
  const differ = [];
  for (const season of SEASONS) {
    for (const club of [season.table[0].club, season.table[10].club,
                        season.table[19].club, "Luton Town"]) {
      for (const score of [0, 1, 33, 61, 82, 113, 114]) {
        const mine = XITable.buildTable(club, score, season);
        const theirs = FCW.buildTable(club, score, season);
        compared++;
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
          differ.push(`${season.season} ${club} ${score}`);
        }
        if (XITable.playerPosition(mine) !== FCW.playerPosition(theirs)) {
          differ.push(`${season.season} ${club} ${score} (position)`);
        }
      }
    }
  }
  t("the engine and the shared module agree, everywhere",
    differ.length === 0,
    differ.length ? "DIFFER: " + differ.slice(0, 4).join(" | ") : compared + " tables compared");
  t("and the engine holds no second copy of either",
    (() => {
      const src = fs.readFileSync("football/crossword/js/engine.js", "utf8");
      const build = src.slice(src.indexOf("function buildTable"), src.indexOf("function playerPosition"));
      return /sharedTable\(\)/.test(build) && !/rows\.sort/.test(build);
    })(),
    "it delegates rather than duplicating");
}

console.log("\nEverybody on a board sees the same ladder");
{
  /* THE SEED IS THE SERVER'S DAY OR THE BOARD'S NUMBER, never a random and
     never a device clock: two players on one board comparing positions is the
     whole point of the thing. */
  const a = XITable.pickSeason("Everton", "2026-09-06");
  const b = XITable.pickSeason("Everton", "2026-09-06");
  t("the same board picks the same season, twice", a && b && a.season === b.season, a && a.season);
  const other = XITable.pickSeason("Everton", "2026-09-07");
  t("and a different day is free to pick another",
    !!other, `${a && a.season} then ${other && other.season}`);
  /* ASKED OF A CLUB THAT PLAYED ONE SEASON, not an ever-present. This was
     asked of Everton, who have played all thirty — so a pick from the whole
     list would have satisfied it by luck, and a sabotage that ignored the
     club entirely stayed green. Barnsley played 1997/98 and nothing else, so
     there is exactly one right answer. */
  const rare = XITable.seasonsForClub("Barnsley");
  t("the club is a one-season club, so the question has one answer",
    rare.length === 1, rare.map((s) => s.season).join(", "));
  t("the season picked is one the club actually played in",
    XITable.pickSeason("Barnsley", "2026-09-06").season === rare[0].season &&
    XITable.pickSeason("Barnsley", "2026-11-30").season === rare[0].season,
    "a ladder your club was never in is a ladder about somebody else");
  /* A club that never made the top flight still gets a season rather than
     nothing — the alternative is a game with no table for some choices. */
  t("a club that never played gets a season anyway",
    !!XITable.pickSeason("Not A Real Club", "2026-09-06"));
}

console.log("\nWhat it does when there is nothing to draw");
{
  t("no season is an empty table, not a crash",
    XITable.buildTable("Everton", 50, null).length === 0);
  t("and a position can still be asked for", XITable.playerPosition([]) === 0);
}

console.log("\nThe rows it renders");
{
  const table = XITable.buildTable("Everton", 61, s96);
  const cells = [];
  const tbody = {
    set innerHTML(v) { cells.push(v); },
    get innerHTML() { return cells[cells.length - 1] || ""; },
  };
  XITable.renderRows(tbody, table, 1);
  const html = tbody.innerHTML;
  t("every one of the twenty is rendered",
    (html.match(/<tr/g) || []).length === 20,
    "hidden by CSS, not dropped — the table is complete to a screen reader");
  t("the player's row is marked", (html.match(/class="you/g) || []).length === 1);
  const far = (html.match(/faroff/g) || []).length;
  t("and the ones nowhere near the player are marked to hide",
    far === 17, far + " of 20 marked far off");
  /* A CLUB NAME IS DATA. These come from a stored table rather than a player,
     but a renderer that writes raw HTML is a renderer that will be handed
     something else one day. */
  const nasty = [{ pos: 1, club: '<img src=x onerror="alert(1)">', points: 1, isPlayer: false }];
  XITable.renderRows(tbody, nasty, 1);
  t("and a club name is escaped rather than written as markup",
    tbody.innerHTML.indexOf("<img") === -1 && tbody.innerHTML.indexOf("&lt;img") > -1);
}

console.log("\nThe club is the family's, not one game's");
{
  t("it is stored under the family prefix",
    XITable.CLUB_KEY.indexOf("xi.") === 0 &&
    !/fcw\.|xiws\.|xisc\.|xihl\.|xivw\./.test(XITable.CLUB_KEY), XITable.CLUB_KEY);
  t("so picking a club in one game picks it in all of them",
    XITable.CLUB_KEY === "xi.club",
    "asking a settled question four more times is asking it four times too many");
}

console.log("\nOne bank, two games, two ladders");
{
  /* SCRAMBLED AND VOWELS READ ONE BANK TWO WAYS, and boardForNumber puts them
     half a ring apart — on any given day they are different elevens that share
     a board NUMBER. Seeding the table on that number gave both games the same
     historical season on the same day: one ladder for two boards, so a player
     doing both played the same season twice and the two games felt like one.
     Spotted by the owner before it shipped.

     The token is the board's identity rather than the day's — sc:12 against
     sc:c:12 — so this checks the two rarely land on the same season, across a
     fortnight rather than on one lucky day. Some collisions are expected: two
     independent picks from thirty seasons will agree now and then, and a check
     demanding they never do would be demanding the arithmetic be rigged. */
  const same = [];
  for (let n = 1; n <= 14; n++) {
    const a = XITable.pickSeason("Everton", "sc:" + n);
    const b = XITable.pickSeason("Everton", "sc:c:" + n);
    if (a && b && a.season === b.season) same.push(`day ${n}: both ${a.season}`);
  }
  t("the two cypher games get different seasons on the same day",
    same.length <= 2, same.length ? same.join(" | ") : "14 days, all different");
  /* AND BOTH PAGES SEED ON THE TOKEN. The arithmetic above only means anything
     if that is what they actually pass. */
  for (const dir of ["football/scrambled", "football/vowels"]) {
    const js = fs.readFileSync(`${dir}/js/game.js`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    t(`${dir} seeds on the board's token, not its number`,
      /mountTable\(String\(board\.token/.test(js),
      "the number is the same in both games; the token is not");
  }
}

console.log("\nWhich games have one, and which do not");
{
  /* A ROW PER GAME, because the alternative is how Vowels XI launched with a
     shirt that never lit: five hand-written blocks, and somebody adds four.
     `table: true` means the game must mount one; false means it must not, and
     saying so is the difference between a decision and an oversight.

     HiLo is the one gap and it is deliberate: it has no live-score accessor,
     so there is no number to put in a ladder yet. When it gets one this row
     flips to true and this check says what is still missing. */
  const GAMES = [
    { dir: "football/crossword", table: true },
    { dir: "football/wordsearch", table: true },
    { dir: "football/scrambled", table: true },
    { dir: "football/vowels", table: true },
    { dir: "football/hilo", table: false },
    { dir: "football/quickfire", table: false },
  ];
  const missing = [], stray = [], half = [];
  for (const g of GAMES) {
    const code = fs.readFileSync(`${g.dir}/index.html`, "utf8")
      .replace(/<!--[\s\S]*?-->/g, " ");
    const js = fs.readFileSync(`${g.dir}/js/game.js`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    /* The PANEL, the MODULE and the MOUNT — all three or none. A page with the
       box and no script draws an empty rectangle; a script with no box does
       nothing at all, and both look like a working game until somebody
       scrolls that far. */
    const box = /id="tablePanel"/.test(code);
    const mod = /<script src="\/shared\/xi-table\.js\?v=/.test(code);
    const seasons = /<script src="\/shared\/xi-seasons\.js\?v=/.test(code);
    /* THE STYLESHEET IS REQUIRED ONLY BY THE GAMES USING THE SHARED MARKUP.
       xi-table.css is scoped entirely under .xit, so a page whose panel does
       not carry that class gets nothing from it — the crossword's table is
       bespoke markup woven into its board layout and styled by its own sheet.
       Demanding the file everywhere failed the crossword for a stylesheet it
       could not have used, which is a check asking for the wrong thing rather
       than a game missing something. */
    const usesSharedMarkup = /class="[^"]*\bxit\b[^"]*"[^>]*id="tablePanel"/.test(code);
    const styled = !usesSharedMarkup ||
      /<link rel="stylesheet" href="\/shared\/xi-table\.css\?v=/.test(code);
    /* The crossword builds its table through its own engine rather than
       XITable.mount, so either way of reaching the shared module counts. */
    const mounts = /XITable\.mount\(/.test(js) || /FCW\.buildTable\(/.test(js);
    if (g.table && !(box && mod && seasons && mounts && styled)) {
      missing.push(`${g.dir} (box ${box}, module ${mod}, seasons ${seasons}, ` +
        `mount ${mounts}, styled ${styled})`);
    }
    if (!g.table && (box || mod || mounts)) stray.push(g.dir);
    if (g.table && (box !== mod || mod !== mounts)) half.push(g.dir);
  }
  t("every game that should have a table has all three parts of one",
    missing.length === 0, missing.join(" | ") || "crossword, wordsearch, scrambled, vowels");
  t("and no game has half of one",
    half.length === 0, half.join(", ") || "a box with no script draws an empty rectangle");
  t("HiLo and QuickFire have none, which is a decision rather than an oversight",
    stray.length === 0, stray.join(", ") ||
      "HiLo has no live-score accessor yet; flip its row when it does");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
