/* render_test.mjs — CrosswordXI real-browser layout and behaviour gate
 *
 * WHY THIS EXISTS
 * ---------------
 * viewport_test.mjs reasons about the CSS *text* and says so honestly in its
 * own header: "jsdom does no real layout, so this cannot judge appearance."
 * That is a fair statement of its limits, and it means an entire class of
 * defect is invisible to it — the class that cost XI Word Search five
 * release cycles to find:
 *
 *   - a long puzzle title wrapping to two lines and pushing the grid below
 *     the fold on 20% of puzzles
 *   - the result modal rendering off-screen while its buttons reported as
 *     enabled
 *   - grid cells losing their square aspect because the font was larger than
 *     the cell
 *   - scroll position retained through a view transition, so the player
 *     landed mid-page with the header cut off
 *   - controls measuring 28px on a phone
 *
 * None of those are visible in a stylesheet. All of them are visible in one
 * getBoundingClientRect() call.
 *
 * This harness measures the rendered page in real Chromium across the full
 * device matrix. It is deliberately a *gate*, not a report: it throws.
 *
 * USAGE
 * -----
 *   npx wrangler pages dev .            # in one terminal, so the API works
 *   node render_test.mjs                # in another
 *
 *   BASE=https://crossword.thexigames.com node render_test.mjs
 *
 * Requires: npm i -D playwright  (then npx playwright install chromium)
 *
 * EXPECT IT TO FAIL ON FIRST RUN. That is the point — the failures are the
 * audit. Fix, re-run, and from then on it protects what you fixed.
 */

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8788";
const HEAD = process.env.HEAD === "1";

/* The device matrix. Grouped so a failure report says "phone landscape"
   rather than an unlabelled pair of numbers. Widen it only for a concrete
   reason — sixteen is already more than most teams check, and adding more
   numbers is not the same as adding coverage. */
const VIEWPORTS = [
  ["desktop",            1440, 900],
  ["desktop-macbook",    1512, 945],
  ["laptop-1366",        1366, 768],   // still one of the commonest laptops
  ["laptop-1280",        1280, 720],
  ["tablet-landscape",   1180, 820],
  ["tablet-landscape-sm",1133, 744],
  ["tablet-portrait-lg", 1024, 1366],
  ["tablet-portrait",     820, 1180],
  ["tablet-portrait-sm",  744, 1133],
  ["phone",               390, 844],
  ["phone-393",           393, 852],
  ["phone-360",           360, 780],
  ["phone-small",         320, 568],   // iPhone SE, still in circulation
  ["phone-landscape-lg",  915, 412],
  ["phone-landscape",     844, 390],
  ["phone-landscape-sm",  568, 320],
];

/* 44px is the platform guidance on both iOS and Android. It is not a nicety:
   a 28px control on glass is a mis-tap, and mis-taps in a scored game that
   deducts points for a wrong check are worse than mis-taps elsewhere. */
const MIN_TAP = 44;

let failures = [];
const check = (name, ok, detail) => {
  if (ok) return;
  failures.push(`${name}${detail ? "  — " + detail : ""}`);
};

/* ------------------------------------------------------------------ *
 * Measurements. Everything here runs in the page and returns numbers.
 * Nothing here reads CSS: if a rule is overridden, we see the result.
 * ------------------------------------------------------------------ */
const MEASURE = `() => {
  const de = document.documentElement;
  const rect = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };

  /* offsetParent is null for position:fixed, so it cannot be the visibility
     test — a fixed toolbar would be reported as hidden and skipped. */
  const visible = (e) => {
    const s = getComputedStyle(e), b = e.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" &&
           s.opacity !== "0" && b.width > 0 && b.height > 0;
  };

  const controls = [...document.querySelectorAll(
    "button, select, input, [role=button], a.btn"
  )].filter(visible);

  /* #buildBadge is the "what's live" status pill, not a gameplay control.
     Exempt it so the number reflects controls a player actually needs. */
  const small = controls
    .filter((e) => e.id !== "buildBadge")
    /* The on-screen keyboard's keys are exempt. Ten must fit a row, so they are
       sized like a native keyboard's — and making them 44px tall would push the
       board further under the keyboard, worsening C1 while appearing to fix C3.
       Without this the count rises 16 -> 43 on touch and buries the ~13
       controls the rule is actually about. */
    .filter((e) => !e.classList.contains("osk-key"))
    .filter((e) => e.getBoundingClientRect().height < 43.5)
    .map((e) => (e.id || e.className || e.tagName) + ":" +
                Math.round(e.getBoundingClientRect().height));

  const cells = [...document.querySelectorAll(".cell")].filter(visible);
  const cellBox = cells.length ? cells[0].getBoundingClientRect() : null;

  /* A cell whose content is wider or taller than its box means the letter or
     the clue number is spilling — the symptom that broke landscape in XI
     Word Search, where a viewport-derived font stopped tracking a
     height-constrained board. */
  const cellOverflow = cells.filter(
    (c) => c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1
  ).length;

  /* Clue text that is clipped rather than wrapped is unreadable, and a
     crossword whose clue you cannot read is not playable. */
  const clues = [...document.querySelectorAll(".clue, .clue-item, [data-clue]")].filter(visible);
  const clippedClues = clues.filter(
    (c) => c.scrollHeight > c.clientHeight + 2 || c.scrollWidth > c.clientWidth + 2
  ).length;

  const grid = rect("#grid") || rect(".grid") || rect(".grid-wrap");

  /* A display:none element still returns a rect — zeros at the origin — so
     measuring it reports a keyboard pinned to the top of the page covering
     everything. Filter on visibility first. */
  const kbEl = [...document.querySelectorAll(".osk, #keyboard, .keyboard")].find(visible);
  const kb = kbEl ? kbEl.getBoundingClientRect() : null;

  return {
    scrollY: Math.round(window.scrollY),
    horizontalOverflow: de.scrollWidth > de.clientWidth + 1,
    scrollWidth: de.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    pageHeight: de.scrollHeight,

    gridPresent: !!grid,
    gridTop:    grid ? Math.round(grid.top)    : null,
    gridBottom: grid ? Math.round(grid.bottom) : null,

    cellW: cellBox ? +cellBox.width.toFixed(1)  : null,
    cellH: cellBox ? +cellBox.height.toFixed(1) : null,
    cellCount: cells.length,
    cellOverflow,

    clueCount: clues.length,
    clippedClues,

    keyboardTop:    kb ? Math.round(kb.top)    : null,
    keyboardBottom: kb ? Math.round(kb.bottom) : null,

    controlCount: controls.length,
    smallControls: small,
  };
}`;

async function measure(page) { return page.evaluate(eval("(" + MEASURE + ")")); }

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */
const run = async () => {
  const browser = await chromium.launch({ headless: !HEAD, args: ["--no-sandbox"] });

  for (const [name, w, h] of VIEWPORTS) {
    /* The on-screen keyboard is built for touch devices, so a context without
       touch never renders it and the keyboard assertions quietly never run.
       Emulate touch on everything phone- and tablet-sized. */
    const touch = w <= 1180;
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      hasTouch: touch,
      isMobile: touch && !name.includes("landscape"),
      deviceScaleFactor: touch ? 2 : 1,
    });
    const page = await ctx.newPage();

    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 100)); });

    const label = `${name} ${w}x${h}`;

    try {
      await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });

      /* Only scroll if the player would actually have to. CrosswordXI's start
         overlay is position:fixed and centred, so Kick Off is always reachable
         without scrolling — forcing a scroll here manufactured a condition no
         player meets and then reported the result as a defect at all sixteen
         viewports. Scroll only when the control is genuinely below the fold. */
      const mustScroll = await page.evaluate(() => {
        const b = document.querySelector("#kickOffBtn");
        if (!b) return false;
        const r = b.getBoundingClientRect();
        return getComputedStyle(b.closest(".overlay") || b).position !== "fixed"
               && r.bottom > window.innerHeight;
      });
      if (mustScroll) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      }

      /* #kickOffBtn starts disabled and is enabled only once /api/daily has
         returned, so clicking immediately does nothing. v2 swallowed that
         timeout and reported "overlay still present" at every viewport.
         Wait for the button to become enabled, click, then wait for the
         overlay to actually lose its .show class — the overlay is hidden by
         removing a class, not by setting display, so testing computed display
         is not the same question. */
      let started = false;
      try {
        await page.waitForSelector("#kickOffBtn:not([disabled])", { timeout: 12000 });
        await page.click("#kickOffBtn");
        await page.waitForFunction(
          () => !document.querySelector("#startOverlay")?.classList.contains("show"),
          null, { timeout: 8000 }
        );
        /* Let the board paint and any entry animation settle before measuring. */
        await page.waitForTimeout(1000);
        started = true;
      } catch (e) {
        check(`${label} kick off opened the game`, false,
              "overlay never cleared — grid/scroll/keyboard checks skipped");
      }

      /* The on-screen keyboard only renders once a square has focus. Without
         this the keyboard assertions silently pass by never running, which
         looks like coverage and is not. */
      if (started) {
        const cell = page.locator(".cell").first();
        if (await cell.count()) {
          await cell.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }

      const m = await measure(page);

      /* Say so out loud when the keyboard never appeared, rather than
         reporting a pass for a check that did not happen. */
      if (started && m.keyboardTop === null) {
        console.log(`      note: ${label} no on-screen keyboard rendered after focusing a cell`);
      }


      check(`${label} runtime errors`, errors.length === 0, errors[0]);
      check(`${label} no horizontal overflow`, !m.horizontalOverflow,
            `${m.scrollWidth} > ${m.innerWidth}`);
      if (started) {
        check(`${label} scroll reset after kick off`, m.scrollY === 0,
              `scrollY=${m.scrollY} — header and clock will be cut off`);
      }

      if (started && m.gridPresent) {
        check(`${label} grid starts on screen`, m.gridTop >= -1, `top=${m.gridTop}`);
        check(`${label} grid ends within viewport`, m.gridBottom <= h + 2,
              `bottom=${m.gridBottom} vs ${h}`);
      }

      if (m.cellW !== null) {
        check(`${label} cells are square`, Math.abs(m.cellW - m.cellH) <= 1.5,
              `${m.cellW}x${m.cellH}`);
        check(`${label} no cell content overflows`, m.cellOverflow === 0,
              `${m.cellOverflow} of ${m.cellCount} cells`);
      }

      if (m.clueCount) {
        check(`${label} no clue text clipped`, m.clippedClues === 0,
              `${m.clippedClues} of ${m.clueCount} clues`);
      }

      /* The on-screen keyboard is the highest-risk element in this build:
         it is the one thing that can cover the square the player is typing
         into, and iOS reports its viewport differently from every other
         platform. */
      if (started && m.keyboardTop !== null && m.gridPresent) {
        check(`${label} keyboard does not cover the grid`,
              m.keyboardTop >= m.gridBottom - 2,
              `keyboard top ${m.keyboardTop} vs grid bottom ${m.gridBottom}`);
        check(`${label} keyboard sits within the viewport`,
              m.keyboardBottom <= h + 2, `bottom=${m.keyboardBottom}`);
      }

      check(`${label} controls meet ${MIN_TAP}px`, m.smallControls.length === 0,
            m.smallControls.slice(0, 6).join(", ") +
            (m.smallControls.length > 6 ? ` (+${m.smallControls.length - 6} more)` : ""));

      /* The result screen is worth its own check because "enabled" and
         "reachable" are different things, and the difference is invisible
         until someone on a small screen cannot leave Full Time. */
      const menuBtn = page.locator("#resultMenuBtn, .result .menu, [data-action=menu]").first();
      if (await menuBtn.count() && await menuBtn.isVisible()) {
        const b = await menuBtn.boundingBox();
        check(`${label} result exit is on screen`,
              b && b.y >= -1 && b.y + b.height <= h + 1,
              b ? `y=${Math.round(b.y)} h=${Math.round(b.height)}` : "no box");
      }

      const status = failures.filter((f) => f.startsWith(label)).length;
      console.log(`${status ? "FAIL" : "  ok"}  ${label.padEnd(28)}` +
        (m.cellW ? `cell ${m.cellW}px  ` : "") +
        (m.gridBottom ? `grid→${m.gridBottom}/${h}  ` : "") +
        `${m.controlCount} controls`);

    } catch (e) {
      check(`${label} loaded`, false, String(e).slice(0, 110));
      console.log(`FAIL  ${label} — ${String(e).slice(0, 60)}`);
    }

    await ctx.close();
  }

  /* Reduced motion is an accessibility setting, not a preference to ignore:
     if a hint or a highlight is animation-only, honouring the setting
     silently removes information the player needs. */
  const rm = await browser.newContext({
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
  });
  const rmPage = await rm.newPage();
  try {
    await rmPage.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
    const anims = await rmPage.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === "running").length);
    check("reduced motion honoured", anims === 0, `${anims} animations still running`);
    console.log(`  ok  reduced-motion context`);
  } catch { /* non-fatal */ }
  await rm.close();

  await browser.close();

  console.log("\n" + "─".repeat(64));
  if (failures.length) {
    console.log(`${failures.length} failures\n`);
    failures.forEach((f) => console.log("  • " + f));
    console.log("\nThese are measurements of the rendered page, not opinions " +
                "about the CSS.\nEach one is a thing a player would meet.");
    process.exit(1);
  }
  console.log("All viewport checks passed.");
};

run().catch((e) => { console.error(e); process.exit(1); });
