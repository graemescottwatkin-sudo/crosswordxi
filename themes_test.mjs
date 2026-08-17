/* themes_test.mjs — the Themed section: the boards, the API and the guards.
 *
 * The board data is checked against the same invariants the generator is
 * trusted to hold, because themed pools stress two of them far harder than a
 * general puzzle does: almost every Manchester United clue says "Manchester
 * United", so the cross-naming rule rules out most of a small pool at once.
 * A themed board that broke one of these would be a board nobody could solve.
 *
 * The API half runs the real Function modules against a stub database, in the
 * shape d1_test.mjs uses — the release guard is the thing worth proving, and
 * it is a WHERE clause, so it has to be tested against something that runs SQL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* ---------- The generated boards ---------- */
console.log("The boards");
/* The plan holds answers, so it is not in the repository — it travels with the
   generated SQL instead. Absent, these checks skip rather than fail: a suite
   that always fails on a clean checkout is one people stop reading, and this
   file still has the API half to run. */
const planPath = path.join(DIR, "data", "themes-plan.json");
const hasPlan = fs.existsSync(planPath);
if (!hasPlan) {
  console.log("  --  the board checks need data/themes-plan.json; run tools/build_themes.js");
}

if (hasPlan) {
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  t("boards were built", plan.length > 0, plan.length + " boards");

  t("every board has eleven answers, the invariant the game is named after",
    plan.every((b) => b.answers.length === 11),
    plan.filter((b) => b.answers.length !== 11).map((b) => b.name + " #" + b.no).join(", ") || "all eleven");

  t("no board repeats an answer",
    plan.every((b) => new Set(b.answers.map((a) => a.toUpperCase())).size === b.answers.length));

  t("no board repeats a clue",
    plan.every((b) => new Set(b.clueIds).size === b.clueIds.length));

  /* Within a theme, no clue twice. Across themes it is expected and fine:
     meeting Old Trafford in Grounds and again in Manchester United months
     apart is not a repeat anybody minds. */
  const byTheme = {};
  plan.forEach((b) => { (byTheme[b.theme] = byTheme[b.theme] || []).push(b); });
  const reused = [];
  for (const [theme, boards] of Object.entries(byTheme)) {
    const seen = new Set();
    for (const b of boards) {
      for (const id of b.clueIds) {
        if (seen.has(id)) reused.push(`${theme} reuses ${id}`);
        seen.add(id);
      }
    }
  }
  t("no clue is used twice inside one theme", reused.length === 0, reused.slice(0, 3).join("; "));

  /* The theme is what a board is ABOUT, never what it answers. A Manchester
     City board is about Maine Road, Shaun Goater, its transfers and its
     managers — asking a City supporter to write in "Manchester City" is a
     label, not a clue. Grounds and stands are fair game and deliberately not
     caught here; club nicknames are, because a nickname is the club. */
  const { THEMES, isSelfAnswer } = await import("./tools/themes.js").then((m) => m.default || m);
  const themeById = Object.fromEntries(THEMES.map((x) => [x.id, x]));
  /* The bank itself, so membership can be judged on the clue rather than the
     answer — which is the only place the mistake is visible. */
  const bankPath = path.join(DIR, "data.json");
  const bankById = fs.existsSync(bankPath)
    ? Object.fromEntries(JSON.parse(fs.readFileSync(bankPath, "utf8")).map((r) => [String(r.id), r]))
    : {};
  const selfAnswers = [];
  for (const b of plan) {
    const th = themeById[b.theme];
    if (!th || !th.self) continue;
    for (const a of b.answers) {
      const grid = String(a).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (isSelfAnswer({ grid }, th)) selfAnswers.push(`${b.name} #${b.no}: ${a}`);
    }
  }
  t("no board's answer is the theme itself", selfAnswers.length === 0,
    selfAnswers.slice(0, 4).join("; ") || "none");

  /* A theme named only to be ruled out does not belong to that theme. The city
     clues disambiguate with "— not X", so "London — not Chelsea, Tottenham or
     Queens" answers West Ham and named two big clubs purely as wrong answers;
     both boards carried it before this. */
  const { namedOnlyToExclude } = await import("./tools/themes.js").then((m) => m.default || m);
  const excluded = [];
  for (const b of plan) {
    const th = themeById[b.theme];
    if (!th || !th.keys) continue;
    for (const id of b.clueIds) {
      const row = bankById[String(id)];
      if (row && namedOnlyToExclude(row, th)) excluded.push(`${b.name} #${b.no}: ${row.clue}`);
    }
  }
  t("no board carries a clue that names its theme only to exclude it",
    excluded.length === 0, excluded.slice(0, 3).join("; ") || "none");

  /* One construction three times reads as one question asked three ways.
     Chelsea #1 came out with four Managers clues and Arsenal with three of
     "Won the FA Cup in ____, beating Arsenal in the final". Transfers keep
     their cap of 3; everything else on a club board is capped at 2. Topic
     boards are exempt, because there the category *is* the theme. */
  const overFamily = [];
  for (const b of plan) {
    const th = themeById[b.theme];
    if (!th || th.kind !== "club") continue;
    const fams = {};
    b.clueIds.forEach((id) => {
      const r = bankById[String(id)];
      if (!r) return;
      const f = r.cat.split(" \u2192")[0];
      fams[f] = (fams[f] || 0) + 1;
    });
    for (const [f, n] of Object.entries(fams)) {
      if (n > (f === "Transfer" ? 3 : 2)) overFamily.push(`${b.name} #${b.no}: ${n} x ${f}`);
    }
  }
  t("no club board asks the same kind of question three times",
    overFamily.length === 0, overFamily.slice(0, 3).join("; ") || "none");

  /* A club's history includes being beaten, and one such clue is colour. Three
     of eleven is a board about everyone else's trophies handed to that club's
     own supporters. */
  const beaten = [];
  for (const b of plan) {
    const th = themeById[b.theme];
    if (!th || !th.keys) continue;
    let n = 0;
    b.clueIds.forEach((id) => {
      const r = bankById[String(id)];
      if (!r) return;
      const isAnswer = th.keys.some((k) => k.replace(/[^a-z0-9]/g, "") === String(r.grid).toLowerCase());
      if (isAnswer) return;
      if (th.keys.some((k) => new RegExp("beating[^.]{0,40}" + k.replace(/[^a-z0-9 ]/g, ""), "i").test(r.clue))) n++;
    });
    if (n > 1) beaten.push(`${b.name} #${b.no}: beaten ${n} times`);
  }
  t("no board shows its theme losing more than once",
    beaten.length === 0, beaten.slice(0, 3).join("; ") || "none");

  t("board numbers run from 1 with no gaps",
    Object.values(byTheme).every((boards) => {
      const nos = boards.map((b) => b.no).sort((a, b) => a - b);
      return nos.every((n, i) => n === i + 1);
    }));

  /* Whatever the build was told, not a second copy of it here: a hard-coded
     date would fail the moment the rollout date moved, on boards that were
     perfectly correct. */
  const LAUNCH_DAY = plan.map((b) => b.release).sort()[0];
  const launch = plan.filter((b) => b.release === LAUNCH_DAY);
  /* The launch batch is weighted towards the largest followings: two boards
     each for United, Liverpool and Arsenal, one each for Chelsea, Spurs and
     City. Two of a theme arriving together is a back catalogue, not a repeat —
     which is why the four-week rule below exempts them. */
  const WANT = { "man-united": 2, liverpool: 2, arsenal: 2, chelsea: 1, spurs: 1,
                 "man-city": 1, grounds: 1, nicknames: 1, "premier-league": 1 };
  const got = {};
  launch.forEach((b) => { got[b.theme] = (got[b.theme] || 0) + 1; });
  t("the launch batch is the weighting asked for",
    Object.entries(WANT).every(([k, n]) => got[k] === n) &&
    Object.keys(got).length === Object.keys(WANT).length,
    JSON.stringify(got));
  t("a dozen boards are ready for launch day", launch.length === 12, launch.length + " boards");
  /* Somebody who supports none of the big six has to have something to open
     on day one, or the section is not for them. */
  /* Somebody who supports none of the big six has to have something to open
     on day one, and one token board is thin cover for two thirds of the
     audience. Three of the twelve are for everyone. */
  const forEveryone = launch.filter((b) => ["grounds", "nicknames", "premier-league"].includes(b.theme));
  t("three of the launch boards are not about a big-six club",
    forEveryone.length === 3, forEveryone.map((b) => b.name).join(", "));

  /* The point of the launch batch is that nobody arrives to an empty room. */
  const bigSix = ["man-united", "liverpool", "arsenal", "man-city", "chelsea", "spurs"];
  t("every one of the big six has a board on launch day",
    bigSix.every((id) => launch.some((b) => b.theme === id)),
    bigSix.filter((id) => !launch.some((b) => b.theme === id)).join(", ") || "all present");

  /* A theme's boards must not all land at once, or the weekly cadence is a
     fiction. Ordering by theme instead of by board number put Manchester
     United #2, #3 and #4 inside a month. */
  const gaps = [];
  for (const [theme, boards] of Object.entries(byTheme)) {
    // Launch-day boards are an archive released at once, not a cadence.
    const dates = boards.map((b) => b.release).filter((d) => d !== LAUNCH_DAY).sort();
    for (let i = 1; i < dates.length; i++) {
      const days = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
      if (days < 28) gaps.push(`${theme} ${dates[i - 1]}→${dates[i]} (${days}d)`);
    }
  }
  t("after launch, no theme returns inside four weeks", gaps.length === 0,
    gaps.slice(0, 3).join("; "));

  /* Fridays, apart from the launch batch and one deliberate burst. Rather than
     exempting a hard-coded date range — which would quietly pass anything that
     drifted out of Friday later — this checks the shape: every non-Friday
     release belongs to a single unbroken run of consecutive days. */
  /* Derive the burst rather than assume where it is: the longest unbroken run
     of consecutive days. It has to be found this way round because Christmas
     Day is itself a Friday — filtering Fridays out first punches a hole in the
     middle of a run that is perfectly contiguous, which is what the first
     version of this check did before failing a correct schedule. */
  const days = [...new Set(plan.filter((b) => b.release !== LAUNCH_DAY).map((b) => b.release))].sort();
  let bestRun = [], run = [];
  days.forEach((d, i) => {
    const consecutive = i > 0 && (new Date(d) - new Date(days[i - 1])) / 86400000 === 1;
    run = consecutive ? run.concat(d) : [d];
    if (run.length > bestRun.length) bestRun = run.slice();
  });
  const outside = days.filter((d) => bestRun.indexOf(d) === -1);
  t("every release outside the burst is a Friday",
    outside.every((d) => new Date(d + "T00:00:00Z").getUTCDay() === 5),
    outside.filter((d) => new Date(d + "T00:00:00Z").getUTCDay() !== 5).join(", ") || "all Fridays");
  t("there is exactly one burst, not scattered odd days",
    bestRun.length >= 7 && days.length - outside.length === bestRun.length,
    bestRun.length + " consecutive days from " + bestRun[0]);

  const burst = plan.filter((b) => b.release >= "2026-12-21" && b.release <= "2026-12-27");
  t("Christmas week releases one board a day for seven days",
    burst.length === 7 && new Set(burst.map((b) => b.release)).size === 7,
    burst.length + " boards across " + new Set(burst.map((b) => b.release)).size + " days");
  t("and Christmas Day and Boxing Day both get one",
    burst.some((b) => b.release === "2026-12-25") && burst.some((b) => b.release === "2026-12-26"));
}

/* ---------- The API ---------- */
console.log("\nThe API");
const { onRequestGet: themes } = await import("./functions/api/themes.js");
const { onRequestGet: board } = await import("./functions/api/theme-board.js");

/* A stub that answers the three shapes the endpoints ask for. Enough SQL
   awareness to tell a released board from an unreleased one, which is the
   guard under test. */
const TODAY = new Date().toISOString().slice(0, 10);
/* Two weeks out is inside the four-week publication horizon and should appear
   in the schedule; ninety days is beyond it and should not. The first version
   of this put the only unreleased board forty days out, outside the horizon,
   and then failed the code for correctly not publishing it. */
const SOON = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const FAR = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
const BOARDS = [
  { id: 1, theme_id: "man-united", theme_name: "Manchester United", board_no: 1, release_on: "2026-01-02" },
  { id: 2, theme_id: "man-united", theme_name: "Manchester United", board_no: 2, release_on: SOON },
  { id: 3, theme_id: "man-united", theme_name: "Manchester United", board_no: 3, release_on: FAR },
];
function stubDB() {
  return {
    prepare(sql) {
      const st = {
        _b: [],
        bind(...b) { st._b = b; return st; },
        async first() {
          if (/FROM theme_boards b JOIN themes/.test(sql)) {
            const row = BOARDS.find((x) => x.id === Number(st._b[0]));
            return row ? Object.assign({ payload: JSON.stringify({ puzzle: { width: 1, height: 1, cells: {}, entries: [] } }) }, row) : null;
          }
          if (/SELECT id FROM theme_boards/.test(sql)) {
            const [theme, no, today] = st._b;
            const row = BOARDS.find((x) => x.theme_id === theme && x.board_no === Number(no) && x.release_on <= today);
            return row ? { id: row.id } : null;
          }
          return null;
        },
        async all() {
          if (/WHERE b.release_on <= \?/.test(sql)) {
            return { results: BOARDS.filter((b) => b.release_on <= st._b[0]).map((b) => ({
              id: b.theme_id, name: b.theme_name, kind: "club",
              board_no: b.board_no, board_id: b.id, release_on: b.release_on })) };
          }
          if (/release_on > \? AND b.release_on <= \?/.test(sql)) {
            return { results: BOARDS.filter((b) => b.release_on > st._b[0] && b.release_on <= st._b[1])
              .map((b) => ({ name: b.theme_name, board_no: b.board_no, release_on: b.release_on })) };
          }
          return { results: [] };
        },
      };
      return st;
    },
  };
}
const env = { DB: stubDB() };
const jsonOf = async (res) => JSON.parse(await res.text());

/* The window between deploying the code and running the migration is real:
   it was hit on the first deploy, and /api/themes returned a 500 because the
   tables did not exist yet. Unconfigured is not broken. */
const missingTables = {
  DB: { prepare() { return { bind() { return this; },
    async all() { throw new Error("D1_ERROR: no such table: themes"); },
    async first() { throw new Error("D1_ERROR: no such table: themes"); } }; } },
};
const beforeMigration = await themes({ request: new Request("https://x/api/themes"), env: missingTables });
t("with the tables not yet created, the section reads as unconfigured rather than failing",
  beforeMigration.status === 200, "status " + beforeMigration.status);
t("and reports itself unconfigured, so the client shows an empty section",
  (await jsonOf(beforeMigration)).configured === false);

const list = await jsonOf(await themes({ request: new Request("https://x/api/themes"), env }));
t("released boards are listed", list.themes.length === 1 && list.themes[0].boards.length === 1,
  JSON.stringify(list.themes.map((x) => x.id + ":" + x.boards.length)));
t("an unreleased board is not in the available list",
  !list.themes.some((x) => x.boards.some((b) => b.no === 2)));
t("the schedule publishes the name and date of what is coming",
  list.upcoming.length === 1 && list.upcoming[0].no === 2 && !!list.upcoming[0].releaseOn,
  JSON.stringify(list.upcoming));
/* Publishing everything ever built would commit to dates the build buffer
   cannot yet keep. Four weeks is the promise; beyond it is nobody's business. */
t("the schedule stops at the four-week horizon",
  !list.upcoming.some((u) => u.no === 3), JSON.stringify(list.upcoming.map((u) => u.no)));
t("the schedule carries no board and no answers",
  !JSON.stringify(list.upcoming).includes("puzzle") &&
  !JSON.stringify(list.upcoming).includes("payload"));

const ok = await board({ request: new Request("https://x/api/theme-board?id=1"), env });
t("a released board is served", ok.status === 200);
const okBody = await jsonOf(ok);
t("and names itself, so the share message cannot drift", okBody.label === "Manchester United #1", okBody.label);

const early = await board({ request: new Request("https://x/api/theme-board?id=2"), env });
t("an unreleased board is refused", early.status === 404, String(early.status));

const byName = await board({ request: new Request("https://x/api/theme-board?theme=man-united&no=1"), env });
t("a board can be opened by name, for readable share links", byName.status === 200);
const earlyByName = await board({ request: new Request("https://x/api/theme-board?theme=man-united&no=2"), env });
t("and an unreleased one cannot be, either way in", earlyByName.status === 404);

/* The release guard has to live where check-answer and reveal read from, or
   it guards the list and not the answers. */
const db = fs.readFileSync(path.join(DIR, "functions/_lib/db.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
t("getPuzzleForToken applies the release guard, not just the listing",
  /if \(t\.mode === "theme"\) return getThemeBoard\(env, t\.id\);/.test(db));
t("tokens understand themed boards", /\(daily\|practice\|theme\)/.test(db));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
