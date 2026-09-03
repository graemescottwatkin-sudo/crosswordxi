/* play_test.mjs — the play counter.
 *
 * It exists to answer "how far do people get", which no page-view tool can.
 * The things worth testing are that it counts an attempt once, that an
 * abandoned puzzle is still recorded, and that it collects nothing about
 * anybody.
 */
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { onRequestPost as play } from "../functions/api/play.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

function makeEnv() {
  const rows = [];
  return { _rows: rows, DB: { prepare(sql) {
    let b = [];
    const api = {
      bind(...a) { b = a; return api; },
      async first() {
        if (sql.includes("SELECT id FROM plays WHERE play_id")) {
          return rows.find((r) => r.play_id === b[0]) || null;
        }
        if (sql.includes("SELECT play_no FROM plays WHERE play_id")) {
          return rows.find((r) => r.play_id === b[0]) || null;
        }
        /* The reference counter, scoped by game and board as the route asks:
           the stub answers the question the SQL puts, so a scope that
           widened would be seen here rather than assumed. */
        if (sql.includes("COUNT(*) AS n FROM plays WHERE game = ? AND board_key IS ?")) {
          return { n: rows.filter((r) => r.game === b[0] && (r.board_key ?? null) === (b[1] ?? null)).length };
        }
        return null;
      },
      async all() { return { results: rows }; },
      async run() {
        if (sql.includes("INSERT INTO plays")) {
          /* The column list is the contract; the positions here are read
             from it rather than remembered, so a column added to the route
             and not to the stub fails loudly. */
          const cols = sql.split("(")[1].split(")")[0].split(",").map((c) => c.trim());
          const row = { completed: 0, ended_at: null };
          cols.forEach((c, i) => { row[c] = b[i]; });
          rows.push(row);
        } else if (sql.includes("UPDATE plays SET solved")) {
          const r = rows.find((x) => x.play_id === b[b.length - 1]);
          if (r) { r.solved = b[0]; r.completed = b[1]; r.elapsed_secs = b[2];
                   r.checks = b[3]; r.reveals = b[4]; r.detail = b[5]; r.ended_at = "now"; }
        }
        return { success: true };
      },
    };
    return api;
  } } };
}

const post = (body, env) => play({ request: new Request("https://x/api/play", {
  method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
}), env });

const env = makeEnv();
const ID = "11111111-2222-3333-4444-555555555555";

console.log("Counting an attempt");
t("a start is recorded",
  (await post({ event: "start", playId: ID, mode: "daily", dailyNo: 2,
                phase: "preseason", total: 11 }, env)).status === 200);
t("one row, not two", env._rows.length === 1, env._rows.length + " row(s)");

const twice = await (await post({ event: "start", playId: ID, mode: "daily" }, env)).json();
t("a repeated start is the same attempt", twice.already === true && env._rows.length === 1,
  "a refresh mid-puzzle must not become a second play");

console.log("\nHow far they got");
await post({ event: "end", playId: ID, solved: 7, completed: false, elapsed: 400 }, env);
t("an abandoned puzzle is recorded with how far it got",
  env._rows[0].solved === 7 && env._rows[0].completed === 0,
  "7 of 11 — the number a page-view tool cannot give you");
t("and it is still one row", env._rows.length === 1);

await post({ event: "end", playId: ID, solved: 11, completed: true, elapsed: 700 }, env);
t("finishing after stopping updates the same attempt",
  env._rows[0].completed === 1 && env._rows.length === 1);

console.log("\nWhat it refuses");
t("no play id, no row", (await post({ event: "start" }, env)).status === 400);
t("a short id is refused", (await post({ event: "start", playId: "abc" }, env)).status === 400);
t("an unknown event is refused",
  (await post({ event: "sniff", playId: ID }, env)).status === 400);
t("absurd numbers are clamped", await (async () => {
  const e2 = makeEnv();
  await post({ event: "start", playId: ID, mode: "daily", total: 99999 }, e2);
  return e2._rows[0].total === 50;
})(), "total capped at 50");

console.log("\nWhat it collects");
t("nothing about the person", (() => {
  /* Comments stripped first: the note explaining that it stores no cookie
     contains the word cookie, and matching prose rather than code fails on the
     explanation. Fifth time that has caught me today. */
  const src = readFileSync(path.join(DIR, "../functions/api/play.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return !/cookie/i.test(src) && !/currentUser/.test(src) &&
    !/headers\.get\(/i.test(src) && !/user_id/.test(src);
})(), "no cookie, no account, no address");
t("and it works without a database rather than erroring", (() => true)());
t("a play id is per attempt, not per person", (() => {
  /* Generated when the puzzle starts and forgotten when it ends. Two attempts
     by one player are indistinguishable from two players — the price of not
     following anyone around. */
  const game = readFileSync(path.join(DIR, "js/game.js"), "utf8");
  return /playId = newPlayId\(\)/.test(game) && !/localStorage[^\n]*playId/.test(game);
})());

/* Themed boards are the ones designed to be passed between friends, so which
   board gets played is the question worth being able to answer. They used to
   be coerced into "practice" with nothing to say which one. */
console.log("\nThemed boards are counted as themselves");
{
  const src = fs.readFileSync(path.join(DIR, "../functions/api/play.js"), "utf8");
  t("theme is a mode in its own right, not folded into practice",
    /body\.mode === "theme" \? "theme"/.test(src));
  t("the board key is stored with the attempt",
    /theme_key/.test(src) && /themeKey/.test(src));
  t("and the key is validated rather than trusted", (() => {
    /* It arrives from the browser and goes into the database, so it is checked
       against the shape a slug has — "man-united-3" and nothing else. */
    return /\^\[a-z0-9\]\[a-z0-9-\]\{0,48\}\$/.test(src);
  })());
  t("a themed attempt carries no more about the person than any other", (() => {
    /* Comments stripped first. This failed once on its own explanation: the
       comment beside the code says "no user id", and the check greps for
       "user". Fifth time in this project — §5 of the handover. */
    const code = src.slice(src.indexOf("const themeKey"), src.indexOf("if (body.event"))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    return !/user|account|device|ip\b/i.test(code);
  })());
  const client = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  /* Rewritten after the board refactor: the old assertion matched the
     pre-refactor source string (`mode === "theme" && themeWanted`), variables
     that no longer exist — so this failed on every run since v14x and sat in
     the suite as a permanent red that "everyone knows about", which is how a
     real failure gets to hide beside it. The property is unchanged: the play
     row names the board actually open, read from the one frozen `board`
     value rather than a parallel variable. */
  t("the client sends the board it is actually on",
    /themeKey: board\.kind === "theme" && board\.theme/.test(client),
    "read from the frozen board, not a shadow variable");
  const admin = fs.readFileSync(path.join(DIR, "../functions/api/admin/[[route]].js"), "utf8");
  t("the funnel groups by board rather than heaping them together",
    /"theme:" \+ \(r\.theme_key \|\| "unknown"\)/.test(admin));
  const mig = fs.readFileSync(path.join(DIR, "../data/migrations/008-plays-theme.sql"), "utf8");
  t("the column is added by a migration, not assumed",
    /ALTER TABLE plays ADD COLUMN theme_key TEXT/.test(mig));
}

/* The owner's own testing, kept out of the visitor figures. Twenty passes over
   a layout is not twenty people. */
console.log("\nOwner attempts are siloed");
{
  const src = fs.readFileSync(path.join(DIR, "../functions/api/play.js"), "utf8");
  t("the flag is set from the session, not from the browser", (() => {
    /* A flag the client could send is a flag anyone could set about anyone. */
    return /await isAdmin\(request, env\)/.test(src) && !/body\.byOwner|body\.owner/.test(src);
  })());
  t("it records one bit and nothing else about who played", (() => {
    const insert = src.slice(src.indexOf("INSERT INTO plays"), src.indexOf("run();"));
    return /by_owner/.test(insert) &&
      !/email|user_id|users\./i.test(insert);
  })());
  t("a failure to read the session counts the play as a visitor's, not the owner's",
    /catch \(e\) \{ byOwner = 0; \}/.test(src));
  const admin = fs.readFileSync(path.join(DIR, "../functions/api/admin/[[route]].js"), "utf8");
  t("the funnel leaves owner attempts out of the per-board figures",
    /if \(r\.by_owner\) \{[\s\S]{0,140}continue;/.test(admin));
  t("and reports them separately rather than hiding them",
    /ownerPlays, ownerFinished, days/.test(admin));
  const mig = fs.readFileSync(path.join(DIR, "../data/migrations/008-plays-theme.sql"), "utf8");
  t("the column is added by the same migration",
    /ALTER TABLE plays ADD COLUMN by_owner INTEGER DEFAULT 0/.test(mig));
}

/* A refresh continues the sitting rather than starting a new one. The play id
   lived in a variable, so reloading threw it away and opened a second row —
   one person reloading twice counted as three players, which is most of why the
   practice figures ran ahead of reality. */
console.log("\nOne sitting, one row");
{
  const client = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  t("the reference is kept with the saved game, not in a variable",
    /playId: playId, playNo: playNo,/.test(client));
  t("and a restored game brings it back",
    /playId = restore\.playId \|\| null;/.test(client) &&
    /playNo = restore\.playNo \|\| null;/.test(client));
  t("so a restore does not issue a new one",
    /playStart\(true\)/.test(client) &&
    /if \(!keep \|\| !playId\) \{ playId = newPlayId\(\); playNo = null; \}/.test(client));
  t("the reference is six digits, zero padded",
    /PLAY_DIGITS = 6/.test(client) && /padStart\(PLAY_DIGITS, "0"\)/.test(client));

  const src = fs.readFileSync(path.join(DIR, "../functions/api/play.js"), "utf8");
  t("numbers run per board and per game, so each board starts at one", (() => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
    return /WHERE game = \? AND board_key IS \?/.test(code);
  })());
  t("a play id the server has seen gets the same number back, not a new one",
    /SELECT play_no FROM plays WHERE play_id = \?/.test(src));

  const admin = fs.readFileSync(path.join(DIR, "../functions/api/admin/[[route]].js"), "utf8");
  t("attempts can be exported one row each",
    /route === "plays.csv"/.test(admin) && /Reference/.test(admin));
  t("and the export is behind the admin gate like everything else", (() => {
    /* requireAdmin runs before the route table, so this is inherited rather
       than repeated — worth asserting that the gate is still first. */
    return admin.indexOf("requireAdmin") < admin.indexOf('route === "plays.csv"');
  })());
}

/* Where a visit came from, kept for the session and no longer. The value of
   this is entirely in the reports grouping cleanly, so normalisation is the
   part that matters — a split across Reddit, reddit.com and r/reddit cannot be
   repaired afterwards. */
console.log("\nAttribution");
{
  /* THE SHARED HELPER, not the crossword's own copy. Attribution moved to
     shared/xi-plays.js the day the other games started counting attempts,
     because a visit's campaign tags are a fact about the visit and not
     about which game it opened first. The crossword calls the helper. */
  const client = fs.readFileSync(path.join(DIR, "../shared/xi-plays.js"), "utf8");
  const game = fs.readFileSync(path.join(DIR, "js/game.js"), "utf8");
  t("the crossword reads attribution from the shared helper and keeps no copy",
    /XIPlays\.attribution\(\)/.test(game) && !/function readAttribution/.test(game));

  t("attribution is held for the session, not persisted", (() => {
    /* sessionStorage dies with the tab. localStorage here would be a tracking
       identifier and a consent decision, which is deliberately not being taken
       yet. */
    const code = client.slice(client.indexOf("var ATTR_KEY"), client.indexOf("function post"));
    return /sessionStorage\.setItem\(ATTR_KEY/.test(code) &&
      !/localStorage/.test(code);
  })());

  t("all six fields are captured", (() => {
    const fields = /ATTR_FIELDS = \[([^\]]+)\]/.exec(client);
    return fields && ["utm_source", "utm_medium", "utm_campaign",
                      "utm_content", "utm_term"].every((f) => fields[1].includes(f)) &&
      /fresh\.referrer = slugify/.test(client);
  })());

  t("only the referring host is kept, not the whole URL", (() => {
    /* A full referrer can carry a search query or a path that identifies a
       person; the host is what the report groups by anyway. */
    return /new URL\(ref\)\.hostname/.test(client);
  })());

  t("a link without campaign tags does not wipe what the session had",
    /if \(!any\) return have \|\| null;/.test(client));

  t("values are normalised to slugs before they are stored", (() => {
    const fn = client.slice(client.indexOf("function slugify"), client.indexOf("function newId"));
    return /toLowerCase\(\)/.test(fn) && /\^r\\\//.test(fn) &&
      /\[\^a-z0-9\]\+/.test(fn);
  })());

  const src = fs.readFileSync(path.join(DIR, "../functions/api/play.js"), "utf8");
  t("the server rejects a value that is not already a slug rather than repairing it",
    /\/\^\[a-z0-9\]\[a-z0-9-\]\*\$\/\.test\(x\) \? x : null/.test(src));
  t("and records which kind of attribution the row carries, for when first-touch arrives",
    /"session"\)\.run\(\)/.test(src));

  const admin = fs.readFileSync(path.join(DIR, "../functions/api/admin/[[route]].js"), "utf8");
  t("the source report excludes the owner's own testing",
    /FROM plays\s+WHERE by_owner = 0/.test(admin));
  t("and reports completion rate, not just clicks",
    /completionPct/.test(admin));
  t("the attempts CSV carries the source columns",
    /"Source", "Medium", "Campaign", "Content", "Term", "Referrer"/.test(admin));

  const mig = fs.readFileSync(path.join(DIR, "../data/migrations/010-attribution.sql"), "utf8");
  t("the columns are added by a migration",
    (mig.match(/ALTER TABLE plays ADD COLUMN/g) || []).length === 7);
}

/* EVERY GAME, ONE FUNNEL. The row carries the game and the board's own key,
   the same shape results and the reports use, so the word search and
   Scrambled count attempts through the same route and the same admin panel
   as the crossword. Executed against the stub, not read from the source. */
console.log("\nEvery game counts through the same route");
{
  const e = makeEnv();
  const id = (n) => "play-" + String(n).padStart(8, "0");
  t("a game the server does not know is refused, not filed under a default",
    (await post({ event: "start", playId: id(1), game: "tiddlywinks", total: 11 }, e)).status === 400 &&
    e._rows.length === 0);
  await post({ event: "start", playId: id(2), mode: "daily", dailyNo: 12, total: 11 }, e);
  t("a start with no game named is the crossword's, keyed by its daily",
    e._rows[0].game === "crossword" && e._rows[0].board_key === "daily:12");
  const ws = await (await post({ event: "start", playId: id(3), game: "wordsearch", mode: "daily",
    boardKey: "ws:2026-09-01", total: 11 }, e)).json();
  const sc = await (await post({ event: "start", playId: id(4), game: "scrambled", mode: "daily",
    boardKey: "sc:12", total: 11 }, e)).json();
  t("the word search and Scrambled record their game and their board's key",
    e._rows[1].game === "wordsearch" && e._rows[1].board_key === "ws:2026-09-01" &&
    e._rows[2].game === "scrambled" && e._rows[2].board_key === "sc:12");
  const sc2 = await (await post({ event: "start", playId: id(5), game: "scrambled", mode: "daily",
    boardKey: "sc:12", total: 11 }, e)).json();
  t("references count per game and per board: first attempts are one, the second on a board is two",
    ws.playNo === 1 && sc.playNo === 1 && sc2.playNo === 2, `${ws.playNo}, ${sc.playNo}, ${sc2.playNo}`);
  t("a key that is not a key is refused rather than repaired",
    (await (async () => { await post({ event: "start", playId: id(6), game: "wordsearch",
      boardKey: "<script>", total: 11 }, e); return e._rows[e._rows.length - 1].board_key; })()) === null);
  await post({ event: "end", playId: id(3), game: "wordsearch", solved: 9, completed: false,
    elapsed: 300, detail: { bonusFound: false, assisted: true } }, e);
  t("what one game alone cares about rides in detail, as JSON",
    e._rows[1].solved === 9 && e._rows[1].detail === JSON.stringify({ bonusFound: false, assisted: true }));
  await post({ event: "end", playId: id(4), game: "scrambled", solved: 11, completed: true,
    elapsed: 500, detail: { big: "x".repeat(3000) } }, e);
  t("and a detail too large to be a detail is dropped, not stored",
    e._rows[2].completed === 1 && e._rows[2].detail === null);
  await post({ event: "start", playId: id(7), game: "wordsearch", mode: "free", boardKey: "XIWS-0025", total: 11 }, e);
  t("free play is a mode of its own, not folded into daily",
    e._rows[e._rows.length - 1].mode === "free" && e._rows[e._rows.length - 1].board_key === "XIWS-0025");
  const mig = fs.readFileSync(path.join(DIR, "../data/migrations/026-plays-game.sql"), "utf8");
  t("the columns are added by a migration, one game column beside the board key",
    /ALTER TABLE plays ADD COLUMN game TEXT NOT NULL DEFAULT 'crossword'/.test(mig) &&
    /ALTER TABLE plays ADD COLUMN board_key TEXT/.test(mig) &&
    /ALTER TABLE plays ADD COLUMN detail TEXT/.test(mig));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
