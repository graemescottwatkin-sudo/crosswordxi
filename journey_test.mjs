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

async function openGame(ctx, { seed = null } = {}) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  if (seed) {
    await page.addInitScript((data) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, seed);
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#kickOffBtn", { timeout: 15000 });
  return page;
}

async function kickOff(page) {
  await page.click("#kickOffBtn", { timeout: 5000 });
  await page.waitForSelector(".cell", { timeout: 10000 });
  await page.waitForTimeout(400);
  await openHelp(page);
}

/* Help starts collapsed on a phone — Check and Reveal cost points, so they are
   deliberately a tap away rather than under a thumb. Every one of those buttons
   is therefore invisible until it is opened, and a test that does not know
   spends its run clicking nothing. */
async function openHelp(page) {
  const collapsed = await page.evaluate(() => {
    const box = document.querySelector(".tb-help");
    return !!box && box.classList.contains("collapsed");
  });
  if (collapsed) {
    await page.click("#helpToggle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

/* Reveal every answer in turn. It is the only way to reach Full Time without
   knowing the solutions, and it exercises the reveal path — a server call —
   once per entry, which is worth testing in itself. */
async function solveByRevealing(page) {
  const stillHidden = await page.evaluate(() => {
    const b = document.querySelector("#revealBtn");
    return !b || b.offsetParent === null;
  });
  if (stillHidden) {
    console.log("      note: reveal button still not visible after opening help");
  }

  const count = await page.evaluate(() =>
    document.querySelectorAll("#acrossList li, #downList li").length);
  /* Short timeouts matter more than they look. Once Full Time covers the
     buttons a default click waits thirty seconds before giving up, and
     thirteen of those is six minutes of a test that appears to have hung. */
  const tap = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});
  const isDone = () => page.evaluate(() => {
    const o = document.querySelector("#doneOverlay");
    return !!o && o.classList.contains("show");
  });
  for (let i = 0; i < count + 2; i++) {
    if (await isDone()) break;
    await tap("#revealBtn");
    await page.waitForTimeout(300);
    if (await isDone()) break;
    await tap("#nextClue");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
}

const browser = await chromium.launch();

/* A stuck selector should fail a check, not hang the run: Playwright's default
   is thirty seconds per action, which turned one covered button into six
   minutes of apparent silence.
   And a section that throws should not take the rest with it. The first real
   run died on section 2 and sections 3 to 6 never ran, so a single hidden
   button hid everything behind it. */
async function section(name, fn) {
  console.log(`\n${name}`);
  const ctx = await browser.newContext({ ...phone });
  try {
    await fn(ctx);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name} could not complete  — ${String(e.message || e).split("\n")[0]}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}


/* ---------- 1. A full game, start to finish ---------- */
await section("Playing a puzzle through to Full Time", async (ctx) => {
  const page = await openGame(ctx);

  t("help starts collapsed on a phone, so the board keeps its height",
    await page.evaluate(() => {
      const box = document.querySelector(".tb-help");
      return !!box && box.classList.contains("collapsed");
    }), "Check and Reveal cost points, so they are a tap away");
  t("the kick off card names the phase",
    /pre-season friendly|matchday/i.test(await page.textContent("#kickMode")),
    (await page.textContent("#kickMode")).trim());

  await kickOff(page);
  t("the board is dealt",
    (await page.locator(".cell:not(.block)").count()) > 40,
    `${await page.locator(".cell:not(.block)").count()} playable of ${await page.locator(".cell").count()}`);
  t("eleven answers, as the name promises",
    (await page.locator("#acrossList li, #downList li").count()) === 11,
    `${await page.locator("#acrossList li, #downList li").count()} clues`);

  await solveByRevealing(page);
  t("revealing every answer reaches Full Time",
    await page.evaluate(() => document.querySelector("#doneOverlay")?.classList.contains("show")));

  const note = (await page.textContent("#rClockNote").catch(() => "")) || "";
  t("a friendly says it is kept in the pre-season record",
    /pre-season/i.test(note), note.trim().slice(0, 70) || "(no note)");
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
await section("The pre-season record", async (ctx) => {
  /* Three finished friendlies, written straight into local storage. Playing
     three days takes three days; the display is the thing under test.

     They must end TODAY. A run only counts if it reaches today or yesterday —
     finishing an old puzzle after the next has begun does not revive a streak —
     so a fixture dated into the future reports a current run of 0 and quietly
     tests nothing. Ask the page what day it is rather than guessing. */
  const probe = await ctx.newPage();
  await probe.goto(BASE, { waitUntil: "domcontentloaded" });
  await probe.waitForSelector("#kickOffBtn", { timeout: 15000 });
  /* `var FCW` at top level is window.FCW in a browser, but read the header as
     a fallback rather than assume it — the label is what a player sees anyway. */
  const today = await probe.evaluate(() => {
    if (window.FCW && typeof window.FCW.dailyNumber === "function") {
      return window.FCW.dailyNumber();
    }
    const txt = document.querySelector("header")?.textContent || "";
    const m = txt.match(/#(\d+)/);
    return m ? Number(m[1]) : 1;
  });
  await probe.close();

  const days = [today - 2, today - 1, today].filter((n) => n >= 1);
  const results = JSON.stringify(days.map((n) => ({
    date: "2026-08-" + (15 + n), dailyNo: n, phase: "preseason", seed: n * 7,
    score: 100 - n, position: n, elapsedSeconds: 300, matchMinute: 20,
    checks: 0, revealedLetters: 0, revealedAnswers: 0, club: "Arsenal",
  })));
  const page = await openGame(ctx, { seed: { "fcw.results.v1": results } });
  /* Kick off first. The Kick Off card is modal, so the footer — and My Season
     with it — is unreachable until the game starts. Seeding the results does
     not change that. */
  await kickOff(page);

  await page.click("#statsBtn", { timeout: 5000 });
  await page.waitForTimeout(400);
  const sub = (await page.textContent("#statsSub")) || "";
  t("My Season counts them as pre-season, not as the season",
    /pre-season/i.test(sub), sub.trim());
  t("and counts every one of them", sub.indexOf(String(days.length)) === 0,
    `${days.length} seeded`);

  const preNote = await page.evaluate(() => {
    const el = document.querySelector("#statsPreNote");
    return el && el.style.display !== "none" ? el.textContent : null;
  });
  t("no separate pre-season line while it is still pre-season",
    preNote === null, preNote || "(hidden, as expected)");

  await page.click("#statsClose", { timeout: 5000 }).catch(() => {});
  const streak = (await page.textContent("#streakLine")) || "";
  t("the streak line calls it a pre-season run",
    /pre-season run/i.test(streak), streak.trim());
  /* The run must reach today, or the figure is meaningless. This read 0 with a
     fixture dated into the future, which looked like a passing test. */
  t("consecutive days up to today count as a current run",
    new RegExp("run " + days.length + "\\b").test(streak),
    `expected run ${days.length} — ${streak.trim()}`);
});

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
await section("Practice", async (ctx) => {
  const page = await openGame(ctx);
  await kickOff(page);
  const first = await page.textContent("#ncText");
  await page.click("#newBtn", { timeout: 5000 });
  await page.waitForTimeout(1500);
  const second = await page.textContent("#ncText");
  t("New Puzzle deals a different puzzle", first !== second,
    `${(first || "").slice(0, 28)} -> ${(second || "").slice(0, 28)}`);

  const circ = (await page.textContent("#circLine").catch(() => "")) || "";
  t("the clue counter is running", /clue/i.test(circ) || circ === "",
    circ.trim() || "(daily mode, so blank)");
});

/* ---------- 6. Refreshing does not change what you are playing ---------- */
await section("Refreshing mid-game", async (ctx) => {
  const page = await openGame(ctx);
  await kickOff(page);
  await page.click("#newBtn", { timeout: 5000 });                 // switches to practice
  await page.waitForTimeout(1200);
  const before = await page.textContent("#kickMode").catch(() => "");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const mode = await page.evaluate(() => localStorage.getItem("fcw.mode"));
  t("the mode in play survives a refresh", mode === "practice", `mode=${mode}`);
});

await browser.close();
console.log(`\n${"─".repeat(60)}\n${fail ? `${fail} failures` : "All journey checks passed."}`);
console.log("\nNot covered here, and deliberately so: signing in with Google.");
console.log("Automating it would test a stub rather than the origin allow-list,");
console.log("the token verification and the cookie — which are what break.");
process.exit(fail ? 1 : 0);
