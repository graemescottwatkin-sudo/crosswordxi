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
import fs from "node:fs";
import { PERMA_GAMES, todayKeyFor, validKey, permalinkPath, permalinkRoute }
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
const shellFor = (game) => fs.readFileSync(`${game}/index.html`, "utf8");

const env = {
  ASSETS: {
    fetch: async (req) => {
      const game = new URL(req.url || req).pathname.split("/").filter(Boolean)[0];
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
  t(`${game}: the path is /${game}/daily/<key>`,
    permalinkPath(game, today) === `/${game}/daily/${today}`);
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
    html.includes(`<base href="/${game}/">`));
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
    html.includes('href="https://www.thexigames.com/crossword/daily/5"'));
  t("og:url and og:title follow it",
    html.includes('content="https://www.thexigames.com/crossword/daily/5"') &&
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
    r.status === 301 && r.headers.get("Location") === "/crossword/daily/7",
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
