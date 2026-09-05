/* permalink_test.mjs — one URL, one puzzle, forever.
 *
 * The rule the owner asked for is a single sentence, and everything below is
 * that sentence made checkable for all four games at once: a link posted on
 * the 3rd must still open the 3rd's board on the 10th, and no second URL may
 * open the same board.
 *
 * EXECUTED, NOT READ. The route is called with a stubbed asset binding and a
 * frozen clock, so what is asserted is what it returns — a status, a
 * Location, a title — and not the shape of its source. A regex over this file
 * could not tell a 302 to today from a 302 to yesterday.
 *
 *   node tools/permalink_test.mjs        (from the repo root)
 */
import { gameDir } from "../functions/_lib/permalink.js";
import fs from "node:fs";
import { PERMA_GAMES, todayKeyFor, validKey, permalinkPath, permalinkRoute, gamePath }
  from "../functions/_lib/permalink.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const GAMES = Object.keys(PERMA_GAMES);
const NOW = Date.parse("2026-09-03T10:00:00Z");

/* THE GAME'S REAL PAGE, not a stand-in for one. The rewrites below find the
   canonical link, the og tags and the title by their shape, so a head that
   changes shape has to fail here rather than quietly serving a permalink
   whose preview still says the game's front page. A stubbed head could not
   fail that way, which is the whole reason this reads the file. */
const shellFor = (game) => fs.readFileSync(`${gameDir(game)}/index.html`, "utf8");

const env = {
  ASSETS: {
    fetch: async (req) => {
      /* THE GAME IS NOT THE FIRST SEGMENT ANY MORE. /football/crossword/ —
         the theme leads, so the stub took "football" as the game and looked
         for football/football/index.html. */
      const parts = new URL(req.url || req).pathname.split("/").filter(Boolean);
      const game = parts[1] || parts[0];
      return new Response(shellFor(game), { headers: { "Content-Type": "text/html" } });
    },
  },
};
const call = (game, path) => permalinkRoute({
  request: new Request("https://www.thexigames.com" + (path === null ? `/${game}/daily` : `/${game}/daily/${path}`)),
  env,
  params: { path: path === null ? [] : String(path).split("/") },
}, game);

console.log("Every game has the same shape");
for (const game of GAMES) {
  const today = todayKeyFor(game, NOW);
  t(`${game}: today's key is the server's idea of today`, !!today, today);
  /* THE THEME LEADS. /football/crossword/daily/12 since 5 Sep 2026 — other
     kinds of quiz are coming, and XI never meant football. Built from
     gamePath rather than written out, so this asserts the SHAPE holds rather
     than restating the theme and having to be edited when it changes. */
  t(`${game}: the path is ${gamePath(game)}daily/<key>`,
    permalinkPath(game, today) === `${gamePath(game)}daily/${today}`);
}

console.log("\n/<game>/daily IS today, and today does not wear a number");
for (const game of GAMES) {
  const r = await call(game, null);
  /* It used to 302 to /daily/9, which put a board number in front of
     somebody who had asked for today. The number belongs to the archive,
     where it is the thing being pointed at. */
  t(`${game}: serves today rather than bouncing to a numbered address`,
    r.status === 200, String(r.status));
  t(`${game}: and is never cached, because today changes at midnight`,
    r.headers.get("Cache-Control") === "no-store");
  /* The permanent address of what it just served, readable without parsing
     any HTML: a bot records this and it still means this board next week. */
  t(`${game}: naming today's permanent address in a Link header`,
    (r.headers.get("Link") || "").includes(permalinkPath(game, todayKeyFor(game))),
    r.headers.get("Link"));
  const html = await r.text();
  t(`${game}: and in the canonical, so a crawler consolidates on it`,
    html.includes('href="https://www.thexigames.com' + permalinkPath(game, todayKeyFor(game)) + '"'));
}

console.log("\nA permalink opens that board and nothing else");
for (const game of GAMES) {
  const key = todayKeyFor(game, NOW);
  const r = await call(game, key);
  const html = await r.text();
  t(`${game}: 200, and the game's own page`, r.status === 200 && html.includes("js/game.js"));
  /* The page lives at /<game>/ and every asset in it is relative. Without
     this tag they would resolve against /<game>/daily/ and 404 — the board
     would be a blank screen. */
  t(`${game}: carries a base so its relative assets still resolve`,
    html.includes(`<base href="${gamePath(game)}">`));
  t(`${game}: is not cached, like the page it is`, r.headers.get("Cache-Control") === "no-store");
}

console.log("\nWhat a share preview says names the board");
{
  const r = await call("crossword", "5");
  const html = await r.text();
  /* THE DAY, NOT THE NUMBER. "Matchday 5" was the first draft: the crossword
     keeps that word for boards inside a season and calls the rest "Today's
     puzzle", so a preview saying Matchday 5 named something the page never
     says. Board 5 ran on 30 August 2026 — the family epoch is 26 August. */
  t("the title names the day the board ran", /<title>30 August 2026 · Crossword XI<\/title>/.test(html),
    (html.match(/<title>([^<]*)</) || [])[1]);
  /* Proof the rewrite did something: the page it started from carries a
     different title, so this cannot pass on a page that was never touched. */
  const shellTitle = (shellFor("crossword").match(/<title>([^<]*)</) || [])[1];
  t("which is not what the page it started from said", shellTitle !== "30 August 2026 · Crossword XI", shellTitle);
  t("the canonical is the permalink itself, so it is the address of the board",
    html.includes('href="https://www.thexigames.com/football/crossword/daily/5"'));
  t("og:url and og:title follow it",
    html.includes('content="https://www.thexigames.com/football/crossword/daily/5"') &&
    html.includes('content="30 August 2026 · Crossword XI"'));
  /* INDEXED, on the owner's call. What a page offered to a crawler must at
     least have is something of its own, and for these that is the title and
     the description — the board itself arrives by script, so the HTML is the
     same shell every time. Nothing here is asserted about ranking; what is
     asserted is that the page is not blocked and is not word-for-word the
     page beside it. */
  t("the page is not held back from a crawler", !/noindex/.test(html));
  t("and says something of its own, not the game's front page line", (() => {
    const d = (html.match(/name="description" content="([^"]*)"/) || [])[1] || "";
    const shellDesc = (shellFor("crossword").match(/name="description" content="([^"]*)"/) || [])[1] || "";
    return d.includes("30 August 2026") && d !== shellDesc;
  })());
  t("and its social description says the same",
    /property="og:description" content="[^"]*30 August 2026/.test(html));
  const w = await call("wordsearch", "2026-09-01");
  const wh = await w.text();
  t("and a game that schedules by date says the same kind of thing",
    /<title>1 September 2026 · Wordsearch XI<\/title>/.test(wh),
    (wh.match(/<title>([^<]*)</) || [])[1]);
}

console.log("\nOne board, one address");
{
  const r = await call("crossword", "007");
  t("a padded number is corrected with a 301, not served twice",
    r.status === 301 && r.headers.get("Location") === "/football/crossword/daily/7",
    `${r.status} -> ${r.headers.get("Location")}`);
  const deep = await call("crossword", "5/6");
  t("a key with more path after it is refused", deep.status === 404, String(deep.status));
}

console.log("\nThe future is refused, and so is nonsense");
{
  const today = Number(todayKeyFor("crossword", NOW));
  t("tomorrow's matchday is not a page", validKey("crossword", String(today + 1), NOW) === null);
  t("today's is", validKey("crossword", String(today), NOW) === String(today));
  t("yesterday's is", validKey("crossword", String(today - 1), NOW) === String(today - 1));
  t("tomorrow's day is not a page", validKey("hilo", "2026-09-04", NOW) === null);
  t("a day that does not exist is not a page", validKey("hilo", "2026-02-31", NOW) === null);
  t("a day in the wrong shape is not a page",
    validKey("hilo", "3-9-2026", NOW) === null && validKey("hilo", "2026-9-3", NOW) === null);
  t("zero and negative are not board numbers",
    validKey("crossword", "0", NOW) === null && validKey("crossword", "-1", NOW) === null);
  t("nor is a number with anything else in it",
    validKey("crossword", "5x", NOW) === null && validKey("crossword", "5 6", NOW) === null);
  t("a date is not a key for a game that counts matchdays",
    validKey("crossword", "2026-09-01", NOW) === null);
  t("and a number is not a key for a game that schedules by date",
    validKey("hilo", "5", NOW) === null);
}

console.log("\nA refusal says nothing about what it refused");
{
  const future = await call("crossword", "99999");
  const junk = await call("crossword", "nonsense");
  t("the future and the nonsensical get the same 404",
    future.status === 404 && junk.status === 404 &&
    (await future.text()) === (await junk.text()));
  t("and a 404 is never indexed or cached",
    future.headers.get("X-Robots-Tag") === "noindex" &&
    future.headers.get("Cache-Control") === "no-store");
}

/* ---- A DAY THE GAME DID NOT RUN IS NOT A BOARD ----
 *
 * /football/wordsearch/daily/2020-01-01 and /football/hilo/daily/1999-12-31 both answered 200
 * with a self-referencing canonical, for any past date at all: an unbounded
 * set of near-identical pages each claiming to be the permanent address of a
 * board that never existed.
 *
 * The env above has no DB, which is how every check before this one passes —
 * and it is also why none of them could see this. Without a database there is
 * no schedule to ask and the honest answer is yes, so proving the rule needs a
 * database that answers. */
console.log("\n=== A date with no board ===");
{
  const RAN = { wordsearch: ["2026-09-03"], hilo: ["2026-09-03"] };
  const dbEnv = {
    ASSETS: env.ASSETS,
    DB: {
      prepare: (sql) => ({
        bind: (day) => ({
          first: async () => {
            const game = /ws_schedule/.test(sql) ? "wordsearch"
              : /hl_schedule/.test(sql) ? "hilo" : null;
            return game && RAN[game].includes(day) ? { n: 1 } : null;
          },
        }),
      }),
    },
  };
  const callDb = (game, key) => permalinkRoute({
    request: new Request(`https://www.thexigames.com/${game}/daily/${key}`),
    env: dbEnv,
    params: { path: [String(key)] },
  }, game);

  for (const game of ["wordsearch", "hilo"]) {
    const ran = await callDb(game, "2026-09-03");
    t(`${game}: a day it DID run is served`, ran.status === 200, String(ran.status));
    const never = await callDb(game, "2020-01-01");
    t(`${game}: a well-formed past day it never ran is refused`,
      never.status === 404, String(never.status));
    /* The SAME refusal a future key gets, so a probe cannot tell a day with no
       board from a day that has not come — the rule the answers pages keep. */
    const future = await callDb(game, "2099-01-01");
    t(`${game}: and refused identically to a day that has not come`,
      never.status === future.status &&
      never.headers.get("X-Robots-Tag") === future.headers.get("X-Robots-Tag") &&
      never.headers.get("Cache-Control") === future.headers.get("Cache-Control"),
      `${never.status} / ${future.status}`);
  }
  /* A NUMBERED GAME ASKS NOTHING, because for it there was never a question:
     the ring wraps, so every key from 1 to today resolves. If this started
     querying, every crossword and Scrambled permalink would take a database
     read to answer something already known.
     TWO THINGS KEEP THAT TRUE — an early return on `kind === "number"`, and a
     query scoped to the two games that have a schedule — and breaking either
     one alone leaves the BEHAVIOUR unchanged, so this check stays green.
     Recorded rather than filed as a weakness: it asserts what the route does,
     not how, and it goes red the moment both guards are gone. */
  let asked = 0;
  const countEnv = {
    ASSETS: env.ASSETS,
    DB: { prepare: () => { asked++; return { bind: () => ({ first: async () => ({ n: 1 }) }) }; } },
  };
  await permalinkRoute({
    request: new Request("https://www.thexigames.com/football/crossword/daily/1"),
    env: countEnv, params: { path: ["1"] },
  }, "crossword");
  t("a numbered game reads no schedule to serve a board", asked === 0, asked + " queries");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
