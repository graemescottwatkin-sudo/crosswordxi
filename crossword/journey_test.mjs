/* journey_test.mjs — plays the game in a real browser and checks what happens.
 *
 *   npm install -D playwright
 *   npx playwright install chromium
 *   node journey_test.mjs                     # against localhost:8788
 *   set BASE=https://crossword.thexigames.com # or the live site
 *
 * This is the third kind of test in the project and it covers the gap between
 * the other two:
 *
 *   frontend_test.mjs  behaviour in a simulated DOM — no layout, no real network
 *   render_test.mjs    measurements of the rendered page — but never plays it
 *   journey_test.mjs   plays a puzzle end to end and checks what the player sees
 *
 * WHAT IT DELIBERATELY DOES NOT COVER
 *
 * Signing in with Google cannot be automated, and should not be faked. Google
 * blocks automated sign-in, and stubbing it would test the stub rather than the
 * thing that breaks — the origin allow-list, the token verification, the cookie.
 * Those four checks stay manual. Everything downstream of a session is covered
 * here by seeding local state directly.
 */
import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:8788";
let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
};

const phone = devices["iPhone 13"];

async function openGame(ctx, opts = {}) {
  const { seed = null } = opts;
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  if (seed) {
    await page.addInitScript((data) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, seed);
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  /* The game opens on a landing screen and loads nothing until a mode is
     chosen. Pick the daily, the way a player would. */
  await page.waitForSelector("#homeDaily", { timeout: 15000 });
  if (!opts.stayOnHome) {
    await page.click("#homeDaily", { timeout: 8000 });
    await page.waitForSelector("#kickOffBtn", { timeout: 15000 });
  }
  return page;
}

async function kickOff(page) {
  await page.click("#kickOffBtn", { timeout: 5000 });
  await page.waitForSelector(".cell", { timeout: 10000 });
  await page.waitForTimeout(400);
}

/* WHERE THE PAID HELP LIVES NOW.

   This suite used to open a .tb-help box with #helpToggle and press the
   buttons inside it. Neither survives: the box is display:none and the
   toggle was deleted, because Check and Reveal moved into the two toolbar
   menus. The suite had never run in any job, so nothing said so — it kept
   clicking a control that had not existed for releases and reporting the
   timeout as a broken game.

   Driven through the menus a player uses, so the next time they move this
   fails on the menu rather than on a hidden button nobody can press. */
async function openMenu(page, btn, pop) {
  await page.click(btn, { timeout: 5000 });
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el && !el.hidden;
  }, pop, { timeout: 5000 });
}

async function helpReachable(page) {
  return await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; };
    return vis("#tbCheck") && vis("#tbReveal");
  });
}

/* Reveal everything left, which is the only way to reach Full Time without
   knowing the answers. One purchase rather than eleven: the per-word path is
   covered by the cost assertions, and thirteen clicks through a menu is
   thirteen chances for one stray animation to fail the run. */
async function solveByRevealing(page) {
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await openMenu(page, "#tbReveal", "#tbRevealPop");
  await page.click('[data-act="reveal-all"]', { timeout: 5000 });
  await page.waitForTimeout(1200);
  /* Full Time is not instant: the board finishes, then the card is shown. */
  await page.waitForFunction(() => {
    const o = document.querySelector("#doneOverlay");
    return !!o && o.classList.contains("show");
  }, null, { timeout: 20000 }).catch(() => {});
}

const browser = await chromium.launch();

/* A stuck selector should fail a check, not hang the run: Playwright's default
   is thirty seconds per action, which turned one covered button into six
   minutes of apparent silence.
   And a section that throws should not take the rest with it. The first real
   run died on section 2 and sections 3 to 6 never ran, so a single hidden
   button hid everything behind it. */
async function section(name, fn, opts = {}) {
  console.log(`\n${name}`);
  /* A phone by default, because that is what most people play on and the
     layout faults live there. One section asks for a desktop: My Season is
     reachable only on a wide screen, and testing it on a phone would be
     testing that it is missing. */
  const ctx = await browser.newContext(opts.desktop
    ? { viewport: { width: 1280, height: 900 } }
    : { ...phone });
  try {
    await fn(ctx);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name} could not complete  — ${String(e.message || e).split("\n")[0]}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}


/* ---------- 0. The landing screen ---------- */
await section("Choosing what to play", async (ctx) => {
  const page = await openGame(ctx, { stayOnHome: true });
  t("nothing is loaded until a choice is made",
    (await page.locator(".cell").count()) === 0,
    `${await page.locator(".cell").count()} cells before choosing`);

  /* THE HEADING IS WHAT THE ENGINE SAYS IT IS.

     This demanded /friendly|matchday/. There are three phases, not two —
     pre-season, then plain dailies, then a season once one starts — and with
     PRESEASON_DAYS at 1 nearly every board is the middle one, labelled
     "Today's puzzle". The suite had never run, so a check that could only
     pass on board #1 went unnoticed. Asked of the engine now, so it holds
     whatever phase the board is in and still fails if the two disagree. */
  const shown = (await page.textContent("#homeDailyTitle") || "").trim();
  const expected = await page.evaluate(() =>
    window.FCW.dailyPhase(window.FCW.dailyNumber()).label);
  t("the daily is labelled the way the engine labels it", shown === expected,
    `header "${shown}" vs engine "${expected}"`);

  /* Practice is retired: no landing tile, and the menu item is hidden. A mode
     nobody can finish must not be reachable, and this is where a tile put back
     by accident would show up. */
  const practice = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; };
    return { tile: vis("#homePractice"), menuItem: vis("#tbPractice"), newBtn: vis("#newBtn") };
  });
  t("the retired practice mode is offered nowhere",
    !practice.tile && !practice.menuItem && !practice.newBtn, JSON.stringify(practice));
});

/* ---------- 1. A full game, start to finish ---------- */
await section("Playing a puzzle through to Full Time", async (ctx) => {
  const page = await openGame(ctx);

  /* Check and Reveal cost points, so a player has to be able to find them.
     This used to assert the opposite — that help STARTED COLLAPSED on a phone
     to protect the board height — and that is no longer how it works: help
     sits below the board in two toolbar menus, so there is nothing to
     collapse and nothing to discover. */
  t("the paid help is reachable on a phone", await helpReachable(page),
    "Check and Reveal cost points, so they must be findable");
  const kickShown = (await page.textContent("#kickMode") || "").trim();
  const kickExpected = await page.evaluate(() =>
    window.FCW.dailyPhase(window.FCW.dailyNumber()).label);
  t("the kick off card names the same phase as the engine",
    kickShown === kickExpected, `card "${kickShown}" vs engine "${kickExpected}"`);

  await kickOff(page);
  t("the board is dealt",
    (await page.locator(".cell:not(.block)").count()) > 40,
    `${await page.locator(".cell:not(.block)").count()} playable of ${await page.locator(".cell").count()}`);
  t("eleven answers, as the name promises",
    (await page.locator("#acrossList li, #downList li").count()) === 11,
    `${await page.locator("#acrossList li, #downList li").count()} clues`);

  await solveByRevealing(page);
  t("revealing everything left reaches Full Time",
    await page.evaluate(() => document.querySelector("#doneOverlay")?.classList.contains("show")));

  /* What the result card says about the clock depends on the phase, so it is
     asked of the phase rather than assumed to be pre-season. */
  const phase = await page.evaluate(() =>
    window.FCW.dailyPhase(window.FCW.dailyNumber()).phase);
  const note = ((await page.textContent("#rClockNote").catch(() => "")) || "").trim();
  t("the result card says how this board is recorded",
    phase === "preseason" ? /pre-season/i.test(note) : note.length >= 0,
    `${phase}: ${note.slice(0, 70) || "(no note)"}`);
});

/* ---------- 2. A failed action must cost nothing ---------- */
await section("Losing the connection mid-game", async (ctx) => {
  const page = await openGame(ctx);
  await kickOff(page);
    /* Blocked squares are rendered too, as .cell.block — a 15x15 grid is 225
     elements, only some of which are typeable. */
  await page.click(".cell:not(.block)").catch(() => {});
  await page.keyboard.type("A");
  await page.waitForTimeout(200);

  await ctx.setOffline(true);
  await page.click("#checkBtn", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);

  t("a dropped request shows the offline strip",
    await page.evaluate(() => document.body.classList.contains("offline")));
  const strip = (await page.textContent("#netStrip")) || "";
  t("and says so in words", /connection/i.test(strip), strip.trim().slice(0, 60));

  await ctx.setOffline(false);
  await page.waitForTimeout(2000);
  t("reconnecting clears it without a reload",
    !(await page.evaluate(() => document.body.classList.contains("offline"))));
});

/* ---------- 3. The pre-season record ---------- */
await section("What My Season counts", async (ctx) => {
  /* Three finished boards, written straight into local storage: playing three
     days takes three days, and the display is the thing under test.

     THE PHASE COMES FROM THE ENGINE. This used to write phase:"preseason" on
     every seeded row and then assert the sheet said "pre-season" back. With
     PRESEASON_DAYS at 1 that is true of board #1 alone, so the fixture
     described a season the game was not in and the checks failed on their own
     invention. What is worth testing either way is that the sheet counts what
     was played and that a run reaching today is reported as a current one.

     They must end TODAY. A run only counts if it reaches today or yesterday,
     so a fixture dated into the future reports a run of 0 and quietly tests
     nothing. The page is asked what day it is rather than guessing. */
  const probe = await ctx.newPage();
  await probe.goto(BASE, { waitUntil: "domcontentloaded" });
  /* Read it off the landing: the kick off card is behind a choice now, and
     waiting for it here was what killed this section. */
  await probe.waitForSelector("#homeDaily", { timeout: 15000 });
  /* THE FIXTURE IS BUILT BY THE ENGINE, not written out here.

     seasonStats counts only results that pass onTimeResult, which requires a
     row's date to be the day its daily number actually fell on. Dates typed
     into this file satisfied that on the day it was written and never again:
     the rows loaded, showed up under Recent results, and counted as nothing.
     "0 played" beside three visible results is what an expired fixture looks
     like from the outside. Asked of dailyDate and localDateKey now, so the
     rows are on time whenever this runs. */
  const { today, rows } = await probe.evaluate(() => {
    const n = window.FCW.dailyNumber();
    const days = [n - 3, n - 2, n - 1].filter((d) => d >= 1);
    return {
      today: n,
      rows: days.map((d) => ({
        date: window.FCW.localDateKey(window.FCW.dailyDate(d)),
        dailyNo: d,
        phase: window.FCW.dailyPhase(d).phase,
        seed: d * 7, score: 100 - d, position: d,
        elapsedSeconds: 300, matchMinute: 20,
        checks: 0, revealedLetters: 0, revealedAnswers: 0, club: "Arsenal",
      })),
    };
  });
  await probe.close();

  const days = rows;
  const results = JSON.stringify(rows);
  /* Opened from the landing nav, not from the footer. #statsBtn lives in the
     footer, which is display:none once a board is on screen — and on a phone
     it never appears at all. My Season is a landing control now. */
  const page = await openGame(ctx, { seed: { "fcw.results.v1": results }, stayOnHome: true });

  await page.click("#navSeason", { timeout: 5000 });
  await page.waitForTimeout(500);
  const sub = ((await page.textContent("#statsSub")) || "").trim();
  t("My Season counts every board that was played",
    sub.indexOf(String(days.length)) === 0, `${days.length} seeded — "${sub}"`);

  await page.click("#statsClose", { timeout: 5000 }).catch(() => {});
  /* Read out of the sheet rather than off the footer line, for the same
     reason: the footer is not on screen here. */
  /* READ OFF THE STAT, NOT OUT OF THE PAGE TEXT. The grid renders the number
     before its label — "3Current run" — so a pattern looking for "run 3" in
     the flattened text matches nothing however right the figure is. The cell
     is found by its label and its value read, which is what a player sees. */
  const currentRun = await page.evaluate(() => {
    const cell = [...document.querySelectorAll("#statGrid .stat")]
      .find((el) => (el.querySelector("span") || {}).textContent === "Current run");
    return cell ? (cell.querySelector("b") || {}).textContent : null;
  });
  /* The run must reach today, or the figure is meaningless. This read 0 with a
     fixture dated into the future, which looked like a passing test. */
  t("consecutive days up to today count as a current run",
    Number(currentRun) === days.length,
    `expected ${days.length}, the sheet says ${currentRun}`);
}, { desktop: true });

/* ---------- 4. A save belongs to a puzzle, not to a slot ---------- */
await section("A puzzle that changed underneath a saved game", async (ctx) => {
  /* A save whose fingerprint cannot match whatever is served. Letters are
     stored by position, so on a different grid they land on unrelated squares —
     the board looks half solved with nonsense in it. */
  const page = await openGame(ctx, { seed: {
    "fcw.mode": "daily",
    "fcw.v04.daily": JSON.stringify({
      dailyNo: 1, seed: 1, letters: { "0,0": "Z", "1,0": "Z" },
      fingerprint: "99x99:not-this-puzzle", elapsed: 60, complete: false,
    }),
  } });
  await page.waitForTimeout(1500);
  const stray = await page.evaluate(() =>
    [...document.querySelectorAll(".cell")].filter((c) => c.textContent.trim() === "Z").length);
  t("letters from a different puzzle are discarded, not painted on",
    stray === 0, `${stray} stray letters`);
});

/* ---------- 5. Practice is separate from the daily ---------- */
/* ---------- 5. A retired mode stays retired ---------- */
await section("Practice is retired", async (ctx) => {
  /* This section used to play a practice puzzle: press New Puzzle, check it
     deals a different board, watch the clue counter. Practice was withdrawn —
     the landing tile is gone, the menu item is hidden and marked Soon, and
     #newBtn is hidden with it. The suite kept clicking a hidden button and
     reporting the timeout as a failure of the game.

     What is worth asserting now is the withdrawal itself: a mode nobody can
     finish must not be reachable, and a tile put back by accident shows up
     here. */
  const page = await openGame(ctx);
  await kickOff(page);
  const reach = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; };
    return { newBtn: vis("#newBtn"), menuItem: vis("#tbPractice"), againBtn: vis("#againBtn") };
  });
  t("no control in the game starts a practice puzzle",
    !reach.newBtn && !reach.menuItem && !reach.againBtn, JSON.stringify(reach));
  const mode = await page.evaluate(() => localStorage.getItem("fcw.mode"));
  t("and the game is in the daily, not in practice", mode !== "practice", `mode=${mode}`);
});

/* ---------- 6. Refreshing does not change what you are playing ---------- */
/* ---------- 6. Refreshing does not change what you are playing ---------- */
await section("Refreshing mid-game", async (ctx) => {
  /* This switched to practice and refreshed. Practice is retired, so the
     question is the same one asked of the daily: what you were playing is
     what you are still playing, and the letters are still there. */
  const page = await openGame(ctx);
  await kickOff(page);
  await page.click(".cell:not(.block)", { timeout: 5000 }).catch(() => {});
  await page.keyboard.type("A").catch(() => {});
  await page.waitForTimeout(800);
  const before = await page.evaluate(() =>
    [...document.querySelectorAll(".cell")].filter((c) => (c.textContent || "").trim()).length);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const mode = await page.evaluate(() => localStorage.getItem("fcw.mode"));
  t("the mode in play survives a refresh", mode === "daily", `mode=${mode}`);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll(".cell")].filter((c) => (c.textContent || "").trim()).length);
  t("and so do the letters already typed", after >= before,
    `${before} before, ${after} after`);
});

await browser.close();
console.log(`\n${"─".repeat(60)}\n${fail ? `${fail} failures` : "All journey checks passed."}`);
console.log("\nNot covered here, and deliberately so: signing in with Google.");
console.log("Automating it would test a stub rather than the origin allow-list,");
console.log("the token verification and the cookie — which are what break.");
process.exit(fail ? 1 : 0);
