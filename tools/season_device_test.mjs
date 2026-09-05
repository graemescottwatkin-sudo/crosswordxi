/* season_device_test.mjs — the season a player keeps without an account.
 *
 * season_test.mjs proves the RULE. season_store_test.mjs proves the half that
 * writes to D1 for a signed-in player. This proves the OTHER branch: the
 * device's own record, written by shared/xi-plays.js at the same two moments,
 * and read by the hub.
 *
 * THE THREE THINGS THAT MATTER HERE
 *
 *   1. The day is the SERVER'S. A device clock must never key a season row —
 *      a phone an hour behind would file a Tuesday as a Monday, and the two
 *      branches would then disagree about the same play.
 *   2. There is ONE rule. shared/xi-season.js is the file the Functions
 *      import, so a season computed on the hub and a season computed on the
 *      server are the same arithmetic, not two spellings of it.
 *   3. A start and a finish both get recorded, from the real xi-plays.js,
 *      running against a fake fetch — because "the games call this at the
 *      right time" is the claim, and grepping for a function name would not
 *      test it.
 *
 * No jsdom: xi-plays.js needs a window, a document that takes listeners, a
 * navigator and two storages, and those are small enough to build honestly.
 * A fake that is right while the code is wrong is worse than no fake, so
 * localStorage here is a real string store with a real quota failure mode.
 *
 *   node tools/season_device_test.mjs        (from the repo root)
 */
import fs from "node:fs";
import vm from "node:vm";
import { season as serverSeason, dayResult as serverDayResult } from "../functions/_lib/season.js";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* A storage that behaves like the real one: string keys, string values, and
   a switch to make it throw the way a full or blocked one does. */
function memStorage() {
  const map = new Map();
  return {
    _map: map, _throw: false,
    getItem(k) { if (this._throw) throw new Error("blocked"); return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { if (this._throw) throw new Error("QuotaExceeded"); map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
  };
}

/* A browser, near enough. Everything xi-season.js and xi-plays.js touch and
   nothing they do not. `answers` is what the fake /api/play replies with. */
function browser(answers) {
  const calls = [];
  const sandbox = {
    localStorage: memStorage(),
    sessionStorage: memStorage(),
    location: { search: "" },
    document: {
      referrer: "",
      addEventListener() {},
    },
    navigator: {},
    addEventListener() {},
    console,
    Promise, JSON, Date, Math, String, Number, Object, Array, Error,
    URL, URLSearchParams, Blob: class {},
    fetch(url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const answer = typeof answers === "function" ? answers(body) : answers;
      return Promise.resolve({ json: () => Promise.resolve(answer) });
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of ["shared/xi-season.js", "shared/xi-plays.js"]) {
    vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
  }
  sandbox._calls = calls;
  return sandbox;
}

const DAY = "2026-09-05";

console.log("The rule is one file, not two");
{
  const b = browser({ ok: true, day: DAY });
  /* THE CHECK THAT KEEPS THE BRANCHES HONEST. Not "both files exist" — that
     the browser's copy and the server's import give the same answer to the
     cases the rule is made of. If shared/xi-season.js were ever forked from
     functions/_lib/season.js, this is what would go red. */
  const cases = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 1], [5, 0], [4, 4]];
  const same = cases.every(([s, f]) => b.XISeason.dayResult(s, f) === serverDayResult(s, f));
  t("the hub and the server agree on every kind of day", same,
    cases.map(([s, f]) => `${s}/${f}=${b.XISeason.dayResult(s, f)}`).join(" "));
  const days = [
    { day: "2026-09-01", started: 2, finished: 2 },
    { day: "2026-09-02", started: 3, finished: 1 },
    { day: "2026-09-03", started: 1, finished: 0 },
    { day: DAY, started: 2, finished: 1 },
  ];
  const mine = b.XISeason.season(days, DAY);
  const theirs = serverSeason(days, DAY);
  t("and on a whole season, table and form alike",
    JSON.stringify(mine) === JSON.stringify(theirs),
    `P${mine.played} W${mine.won} D${mine.drawn} L${mine.lost} ${mine.points}pts, form ${mine.marks.join("")}`);
}

console.log("\nThe day comes from the server, or nothing is written");
{
  const b = browser({ ok: true, day: DAY });
  t("a day the server gave is stored", b.XISeason.noteStart("crossword", DAY) === true);
  /* EVERY SHAPE A DEVICE CLOCK PRODUCES, refused. A season keyed on any of
     these would be a different season on every device the player owns. */
  const junk = [undefined, null, "", "today", "2026-9-5", "05/09/2026",
    "2026-09-05T00:00:00Z", 1757030400000, "2026-09-05 ", "yesterday"];
  const refused = junk.filter((d) => b.XISeason.noteStart("hilo", d) === false);
  t("and every other shape is refused rather than repaired",
    refused.length === junk.length,
    `${refused.length}/${junk.length} refused`);
  t("so only the server's day is in the record",
    b.XISeason.days().length === 1 && b.XISeason.days()[0].day === DAY,
    JSON.stringify(b.XISeason.days()));
  t("and a game name it does not recognise is refused too",
    b.XISeason.noteStart("Scrambled XI", DAY) === false &&
    b.XISeason.noteStart("", DAY) === false,
    "one game spelt two ways would count as two starts");
}

console.log("\nWhat a day comes to, on the device");
{
  const b = browser({ ok: true, day: DAY });
  b.XISeason.noteStart("crossword", DAY);
  b.XISeason.noteStart("hilo", DAY);
  b.XISeason.noteFinish("crossword", DAY);
  const d = b.XISeason.days()[0];
  t("two started, one finished", d.started === 2 && d.finished === 1, JSON.stringify(d));
  t("which is a draw, not a loss",
    b.XISeason.season(b.XISeason.days(), "2099-01-01").drawn === 1);
  /* THE SAME IDEMPOTENCE THE SERVER'S PRIMARY KEY GIVES: a reload, a double
     tap and a resumed round are one start, because games are named not
     counted. */
  for (let i = 0; i < 6; i++) b.XISeason.noteStart("crossword", DAY);
  t("and starting the same game six times is one start",
    b.XISeason.days()[0].started === 2);
  /* A FINISH IMPLIES A START. Somebody who signed in mid-puzzle, or whose
     start never got a reply, has still played today. */
  const c = browser({ ok: true, day: DAY });
  c.XISeason.noteFinish("wordsearch", DAY);
  const only = c.XISeason.days()[0];
  t("a finish with no start counts as both",
    only.started === 1 && only.finished === 1, JSON.stringify(only));
}

console.log("\nToday is never settled");
{
  const b = browser({ ok: true, day: DAY });
  b.XISeason.noteStart("crossword", DAY);
  const s = b.XISeason.season(b.XISeason.days(), DAY);
  t("a day still being played is not counted into the table",
    s.played === 0 && s.points === 0, `P${s.played}`);
  t("but it is shown as what it would be",
    !!s.inFlight && s.inFlight.provisional === "L",
    "a defeat with hours left in it can still become a draw");
  t("and the season has started, so there is no invitation",
    s.started === true, "they kicked off; telling them to start would be wrong");
}

console.log("\nxi-plays.js writes it, at the two moments that matter");
{
  /* THE REAL FILE, not a description of it. The claim is that a game which
     calls XIPlays.start() and XIPlays.end(true) gets a season row without
     knowing a season exists — so the test calls exactly those. */
  const b = browser({ ok: true, day: DAY, playNo: 41 });
  await b.XIPlays.start({ game: "scrambled", mode: "daily", boardKey: "sc:12", total: 11 },
    () => ({ solved: 11, elapsed: 120 }));
  t("a start is recorded from the server's answer",
    b.XISeason.days().length === 1 && b.XISeason.days()[0].started === 1,
    JSON.stringify(b.XISeason.days()));
  t("and not yet finished", b.XISeason.days()[0].finished === 0);

  b.XIPlays.end(true);
  await new Promise((r) => setTimeout(r, 0));
  t("a finish is recorded when the board is completed",
    b.XISeason.days()[0].finished === 1, JSON.stringify(b.XISeason.days()));

  /* AND AN ABANDON WRITES NO FINISH, which is the loss condition: the season
     reads the absence. */
  const c = browser({ ok: true, day: DAY, playNo: 1 });
  await c.XIPlays.start({ game: "hilo", mode: "daily", boardKey: "hl:2026-09-05", total: 11 },
    () => ({ solved: 3, elapsed: 40 }));
  c.XIPlays.end(false);
  await new Promise((r) => setTimeout(r, 0));
  const row = c.XISeason.days()[0];
  t("an attempt that ends unfinished leaves no finish",
    row.started === 1 && row.finished === 0, "the absence IS the loss");
  t("so the day reads as a defeat once it is over",
    c.XISeason.season(c.XISeason.days(), "2099-01-01").lost === 1);
}

console.log("\nWhen the server says nothing, the device invents nothing");
{
  /* A rate-limited reply, an error, a site with no answer at all. The row is
     lost — which is a small wrong. Filing it under a day this device guessed
     would be a wrong season, which is a large one. */
  for (const answer of [{ error: "Too many requests. Give it a minute." },
                        { ok: false }, {}, null]) {
    const b = browser(answer);
    await b.XIPlays.start({ game: "crossword", mode: "daily", total: 11 }, () => ({}));
    b.XIPlays.end(true);
    await new Promise((r) => setTimeout(r, 0));
    t("no day in the answer, no row in the record — " + JSON.stringify(answer),
      b.XISeason.days().length === 0, JSON.stringify(b.XISeason.days()));
  }
}

console.log("\nStorage that will not take it");
{
  const b = browser({ ok: true, day: DAY, playNo: 41 });
  b.localStorage._throw = true;
  t("a blocked or full store is refused, not thrown",
    b.XISeason.noteStart("crossword", DAY) === false);
  t("and reading it back gives an empty season rather than an error",
    b.XISeason.days().length === 0);
  b.localStorage._throw = false;
  /* AND THE GAME SURVIVES IT. A season that cannot be written must never
     cost somebody the puzzle they just started. */
  b.localStorage._throw = true;
  const played = await b.XIPlays.start({ game: "vowels", mode: "daily", total: 11 }, () => ({}));
  t("a play still starts, and still gets its number, when the season cannot be stored",
    played === 41 && b._calls.length === 1 && b._calls[0].game === "vowels",
    "play no " + played);
}

console.log("\nThe record is the family's, and it is small");
{
  const b = browser({ ok: true, day: DAY });
  t("it lives under the family prefix, not a game's",
    b.XISeason.KEY.indexOf("xi.") === 0 &&
    !/fcw\.|xiws\.|xisc\.|xihl\.|xivw\./.test(b.XISeason.KEY), b.XISeason.KEY);
  /* WHAT IS IN IT. A day, the games started, the games finished. Not a score,
     not a board, not how long anything took — the season counts finishes, so
     anything else would be kept because it was there rather than needed. */
  b.XISeason.noteFinish("crossword", DAY);
  const raw = JSON.parse(b.localStorage.getItem(b.XISeason.KEY));
  const fields = Object.keys(raw.days[DAY]).sort().join(",");
  t("and holds a day, the starts and the finishes — nothing else",
    fields === "f,s", fields);

  /* IT DOES NOT GROW FOREVER. */
  for (let i = 0; i < 260; i++) {
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    b.XISeason.noteStart("crossword", d);
  }
  const kept = b.XISeason.days().length;
  t("old days fall off the back", kept > 100 && kept <= 200, kept + " days kept");
  t("newest first, so the hub does not have to sort it",
    b.XISeason.days()[0].day > b.XISeason.days()[1].day);

  t("and it can be forgotten", b.XISeason.forget() === true && b.XISeason.days().length === 0);
}

console.log("\nThe hub reads whichever branch it is on");
{
  /* THE HUB'S OWN SCRIPT, read as text: it must call /api/season, must take
     `today` from that answer, and must never build a date of its own. */
  const hub = fs.readFileSync("index.html", "utf8");
  /* CODE, NOT PROSE. The first draft of these three looked for "/api/season"
     and "shared/xi-season.js" anywhere in the file — and the block above them
     is a long comment that says both. Deleting the script tag and pointing the
     fetch somewhere else left every one of them green, because a comment
     mentioning a thing satisfied a check that meant to demand the thing.
     Comments are stripped first, and what is demanded is a script TAG and a
     fetch CALL. */
  const code = hub
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  t("the hub asks the server for the season",
    /fetch\(\s*"\/api\/season"/.test(code), "a comment naming it is not asking");
  t("and loads the one rule rather than restating it",
    /<script src="shared\/xi-season\.js\?v=/.test(code) &&
    code.indexOf("XISeason.season(") > -1,
    "the rule is imported by the server from the same file");
  /* The season block must not contain a date built on the device. The page
     does use `new Date()` for the human-readable heading, which is fine — it
     is a label, not a key — so this looks at the season block alone. */
  const at = hub.indexOf("---- THE SEASON ---");
  const block = at > -1 ? hub.slice(at) : "";
  t("and the season block builds no date of its own",
    !!block && !/new Date\(/.test(block) && /d\.today/.test(block),
    "today is the server's, in both branches");
  /* THE INVITATION IS THE RULE'S SENTENCE, not the page's. Read off the code
     for the same reason: a comment quoting the owner would otherwise fail it. */
  t("the invitation is not written into the markup",
    code.indexOf("Play your first game") === -1 &&
    code.indexOf("NO_SEASON_YET") > -1,
    "the sentence and the condition that shows it cannot drift apart");
}

console.log("\nAnd the hub's own block, run rather than read");
{
  /* THE CHECKS ABOVE GREP THE PAGE. This one RUNS it: the season block is
     lifted out of index.html and executed against a fake document and a fake
     /api/season, once per branch. A draw() that threw, or hid the strip, or
     put the wrong number in it would pass every grep in this file and reach a
     player — which is the fault this project keeps finding, so it is the one
     worth spending a fake DOM on. */
  const hub = fs.readFileSync("index.html", "utf8");
  const from = hub.indexOf("  (function () {\n    var box = document.getElementById(\"season\");");
  /* Up to the block's OWN close, not the page script's. Slicing to
     "})();</script>" took one brace too few and the sandbox refused to compile
     it, which at least failed loudly — one brace too MANY would have run a
     truncated block and quietly tested something else. */
  const END = "  })();\n})();\n</script>";
  const to = hub.indexOf(END);
  const block = from > -1 && to > from ? hub.slice(from, to + "  })();".length) : "";
  t("the season block can be found in the page to run it", !!block,
    block ? block.length + " chars" : "not found — the block moved or was renamed");

  function el(id) {
    return { id, hidden: true, textContent: "", innerHTML: "", kids: [],
      appendChild(c) { this.kids.push(c); }, className: "" };
  }
  async function render(answer, deviceDays) {
    const b = browser({ ok: true, day: DAY });
    (deviceDays || []).forEach(function (d) {
      for (let i = 0; i < d.started; i++) b.XISeason.noteStart("g" + i, d.day);
      for (let i = 0; i < d.finished; i++) b.XISeason.noteFinish("g" + i, d.day);
    });
    const nodes = { season: el("season"), seasonLine: el("seasonLine"), seasonForm: el("seasonForm") };
    b.document.getElementById = (id) => nodes[id] || null;
    b.document.createElement = () => el("span");
    b.fetch = () => Promise.resolve({ json: () => Promise.resolve(answer) });
    vm.runInContext(block, vm.createContext(b), { filename: "index.html#season" });
    await new Promise((r) => setTimeout(r, 0));
    return nodes;
  }

  /* A SIGNED-IN PLAYER: the server's numbers, drawn as given. */
  const acct = await render({
    account: true, today: DAY, message: null,
    season: { played: 6, won: 2, drawn: 3, lost: 1, points: 9,
      marks: ["W", "D", "L", "D", "W", "D"], started: true },
    inFlight: { day: DAY, provisional: "W", started: 2, finished: 2 },
  });
  t("an account's season is drawn from the server's own numbers",
    acct.season.hidden === false &&
    /<b>6<\/b> played/.test(acct.seasonLine.innerHTML) &&
    /<b>2<\/b> won/.test(acct.seasonLine.innerHTML) &&
    /<b>9<\/b> pts/.test(acct.seasonLine.innerHTML),
    acct.seasonLine.innerHTML.replace(/<[^>]+>/g, ""));
  /* SPELT OUT, NOT LETTER-AND-NUMBER. "P0 W0 D0 L0" reads as PO WO DO LO in
     the display face — four words and no numbers — which is what the owner
     saw on the first day this shipped. */
  t("and the labels are words, so no count can read as a letter",
    !/P\d/.test(acct.seasonLine.innerHTML) && !/W\d/.test(acct.seasonLine.innerHTML),
    "P0 in this typeface is indistinguishable from PO");
  t("with today shown as unsettled beside the settled run",
    acct.seasonForm.kids.length === 7 &&
    acct.seasonForm.kids[6].className.indexOf("now") > -1 &&
    acct.seasonForm.kids[6].textContent === "W",
    acct.seasonForm.kids.map((k) => k.textContent + (k.className.indexOf("now") > -1 ? "?" : "")).join(""));

  /* NO ACCOUNT: the same rule, over this device's own record. The numbers
     below are not restated from the server's — they are what the rule makes
     of three settled days plus today. */
  const dev = await render({ account: false, today: DAY },
    [{ day: "2026-09-01", started: 2, finished: 2 },
     { day: "2026-09-02", started: 3, finished: 1 },
     { day: "2026-09-03", started: 1, finished: 0 },
     { day: DAY, started: 1, finished: 0 }]);
  t("a device's season is computed from its own record, not the server's",
    dev.season.hidden === false &&
    /<b>3<\/b> played/.test(dev.seasonLine.innerHTML) &&
    /<b>1<\/b> won/.test(dev.seasonLine.innerHTML) &&
    /<b>1<\/b> drawn/.test(dev.seasonLine.innerHTML) &&
    /<b>1<\/b> lost/.test(dev.seasonLine.innerHTML) &&
    /<b>4<\/b> pts/.test(dev.seasonLine.innerHTML),
    dev.seasonLine.innerHTML.replace(/<[^>]+>/g, ""));
  t("and today is still in flight on that branch too",
    dev.seasonForm.kids.length === 4 &&
    dev.seasonForm.kids[3].className.indexOf("now") > -1 &&
    dev.seasonForm.kids[3].textContent === "L",
    dev.seasonForm.kids.map((k) => k.textContent).join(""));

  /* A SEASON UNDER WAY WITH NOTHING SETTLED must not recite four zeroes.
     A player who kicked off an hour ago has a season and no result in it, and
     "0 played 0 won 0 drawn 0 lost" is both ugly and, in this typeface,
     unreadable. It says the first result is pending, which is the truth. */
  const dayOne = await render({ account: false, today: DAY },
    [{ day: DAY, started: 2, finished: 2 }]);
  t("a season with nothing settled says so rather than printing zeroes",
    /first result pending/.test(dayOne.seasonLine.innerHTML) &&
    !/0/.test(dayOne.seasonLine.innerHTML),
    dayOne.seasonLine.innerHTML.replace(/<[^>]+>/g, ""));
  t("and today still shows as the provisional result it would be",
    dayOne.seasonForm.kids.length === 1 &&
    dayOne.seasonForm.kids[0].textContent === "W" &&
    dayOne.seasonForm.kids[0].className.indexOf("now") > -1,
    "two finished today is a win, once the day is over");

  /* THE INVITATION, which is what the owner asked for: "there should be a
     message to play your 1st game to start your season." */
  const fresh = await render({ account: false, today: DAY, message: null }, []);
  t("a player with nothing played is invited to start a season",
    fresh.season.hidden === false &&
    fresh.seasonLine.textContent === "Play your first game to start your season." &&
    fresh.seasonForm.kids.length === 0,
    fresh.seasonLine.textContent);
  const invited = await render({ account: true, today: DAY,
    message: "Play your first game to start your season.",
    season: { played: 0, won: 0, drawn: 0, lost: 0, points: 0, marks: [], started: false },
    inFlight: null }, []);
  t("and so is a signed-in player who has not started one",
    invited.seasonLine.textContent === "Play your first game to start your season.",
    invited.seasonLine.textContent);

  /* NOTHING AT ALL rather than a wrong season, when the server cannot say
     what day it is. */
  for (const answer of [{ account: false }, {}, null]) {
    const none = await render(answer, [{ day: "2026-09-01", started: 2, finished: 2 }]);
    t("no day from the server, nothing drawn — " + JSON.stringify(answer),
      none.season.hidden === true && none.seasonLine.textContent === "",
      "an empty space is right; a season off a device clock is not");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
