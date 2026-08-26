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
 * THE FLEX LAYOUT
 * ---------------
 * The board no longer has to fit. It sits in a frame it pans and zooms inside,
 * so a board taller than the frame is the feature rather than a defect, and
 * "the grid ends within the viewport" would now fail on every puzzle that used
 * the space it was given.
 *
 * What must hold instead: the FRAME is on screen and has room in it, the square
 * being typed into is visible within the frame, and the toolbar and clue card
 * are both reachable. Those are asserted when body carries .flex-layout; the
 * old board-fit assertions still run on the classic path, which remains in the
 * file until this gate has been run against flex on real hardware.
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
import fs from "fs";
import path from "path";

const BASE = process.env.BASE || "http://localhost:8788";

/* SHOTS=1 saves a screenshot of each viewport into shots/. Off by default: the
   full matrix is sixteen PNGs and most runs only want the verdict. */
const SHOTS = !!process.env.SHOTS;
const SHOT_DIR = process.env.SHOT_DIR || "shots";
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
  const line = `${name}${detail ? "  — " + detail : ""}`;
  failures.push(line);
  /* Printed as it happens, not collected for a summary at the end. A run that
     is cut short — a time limit, a hang in a later viewport, a killed dev
     server — otherwise reports nothing at all, and the failures are the entire
     reason for running it. */
  console.log("      • " + line);
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

  /* The square the player is typing into. On a tall portrait screen the board
     may deliberately run past the fold and the page scrolls — what must never
     happen is the *active* cell sitting behind the keyboard. */
  const activeCell = document.querySelector(".cell.active");
  const activeBox = activeCell ? activeCell.getBoundingClientRect() : null;

  /* A deliberate refusal to draw a board: below a certain height there is no
     cell size that leaves room for both grid and keyboard, so the game asks for
     a rotation instead. Not a failure to reach the game — a decision. */
  const rotateEl = document.querySelector("#rotatePrompt");
  const rotateShown = !!rotateEl && visible(rotateEl);

  const frameEl = document.querySelector(".grid-wrap");
  const frame = frameEl ? frameEl.getBoundingClientRect() : null;
  const toolbarEl = document.querySelector(".tbar");
  const toolbar = toolbarEl && getComputedStyle(toolbarEl).display !== "none"
    ? toolbarEl.getBoundingClientRect() : null;
  const clueEl = document.querySelector(".now-clue");
  const clueCard = clueEl ? clueEl.getBoundingClientRect() : null;
  /* activeBox is already measured above, from activeCell. A second one shadowed
     it and threw at every viewport — the gate reported it as a page failure,
     which is exactly what a gate should do with a broken gate. */
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

    /* The flex layout puts the board in a frame it pans and zooms inside, so
       the board itself is allowed to run past the viewport — that is the
       feature. What must stay on screen is the FRAME, and within it the square
       being typed into. */
    flexLayout: document.body.classList.contains("flex-layout"),
    frameTop:    frame ? Math.round(frame.top)    : null,
    frameBottom: frame ? Math.round(frame.bottom) : null,
    frameHeight: frame ? Math.round(frame.height) : null,
    frameWidth:  frame ? Math.round(frame.width)  : null,
    activeInFrame: (function () {
      if (!frame || !activeBox) return null;
      return activeBox.top    >= frame.top    - 1 &&
             activeBox.bottom <= frame.bottom + 1 &&
             activeBox.left   >= frame.left   - 1 &&
             activeBox.right  <= frame.right  + 1;
    })(),
    toolbarPresent: !!toolbar,
    toolbarBottom: toolbar ? Math.round(toolbar.bottom) : null,
    clueTop:    clueCard ? Math.round(clueCard.top)    : null,
    clueBottom: clueCard ? Math.round(clueCard.bottom) : null,

    cellW: cellBox ? +cellBox.width.toFixed(1)  : null,
    cellH: cellBox ? +cellBox.height.toFixed(1) : null,
    cellCount: cells.length,
    cellOverflow,

    clueCount: clues.length,
    clippedClues,

    rotateShown,
    activeCellTop:    activeBox ? Math.round(activeBox.top) : null,
    activeCellBottom: activeBox ? Math.round(activeBox.bottom) : null,
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
  /* Playwright's own browser, installed by `npx playwright install chromium`.
     PLAYWRIGHT_EXECUTABLE points somewhere else when there is a reason — a
     runner that cannot reach the download host, say — but that is the special
     case and it stays out of the way here. Defaulting to anything else made
     the ordinary run fail on Windows for a constraint that was never yours. */
  const browser = await chromium.launch({
    headless: !HEAD,
    args: ["--no-sandbox"],
    ...(process.env.PLAYWRIGHT_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
      : {}),
  });

  /* ONLY=phone,tablet runs a subset. The full matrix takes minutes, and a
     runner with a time limit gets a truncated report that looks like a crash.
     Substring match on the name, so ONLY=phone covers every phone size. */
  const only = (process.env.ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
  const matrix = only.length
    ? VIEWPORTS.filter(([n]) => only.some((o) => n.includes(o)))
    : VIEWPORTS;
  for (const [name, w, h] of matrix) {
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
      /* Tagged, so these attempts can be told from a player's.

         The gate plays a real puzzle on the real site sixteen times a run and
         never finishes one. Untagged that landed as 49 daily plays with zero
         completions on a day the daily had one genuine player — a number that
         reads as a broken daily rather than as a test suite.

         by_owner does not help: it is set from the session, and the gate is not
         signed in. ?r= is the short campaign tag, so the rows carry
         utm_campaign='gate' and any report can exclude them. */
      const url = BASE + (BASE.indexOf("?") > -1 ? "&" : "?") + "r=gate";
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

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
        /* The landing screen comes first now: you choose Daily, Practice or a
           themed board before anything is loaded, and #kickOffBtn does not
           exist until you have. This suite predates that screen, so it clicked
           Kick Off while the home overlay was still up, never got into a game,
           and reported "overlay never cleared" at every viewport — with the
           grid, scroll and keyboard checks all skipped. The measurements it
           exists to take were not being taken. */
        /* Daily and Practice are both suspended, so the route in is Clubs and
           themes — which is also the route almost everybody actually takes,
           arriving from a shared board rather than from the landing screen.
           Falls back to Daily if it is ever open again. */
        /* Daily and Practice are both suspended, so their tiles refuse the
           click. #dailyBtn is the control underneath — hidden in the flex
           layout, never removed — and loading a puzzle is what this suite needs,
           not a particular way of asking for one. */
        const viaBtn = page.locator("#dailyBtn");
        const home = page.locator("#homeOverlay.show #homeDaily:not(.soon)");
        if (await viaBtn.count()) {
          await viaBtn.evaluate((el) => el.click());
        } else if (await home.count()) {
          await home.click({ timeout: 8000 });
          await page.waitForSelector("#kickOffBtn", { timeout: 12000 });
        }
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
        /* A landscape phone below the supported height shows a rotate prompt
           instead of a board, so Kick Off is deliberately unreachable. That is
           a decision, not a broken overlay — at 844x390 the space left once the
           clue card and keyboard are counted is negative, so there is no cell
           size that works and drawing one hides half the grid. */
        const pre = await page.evaluate(() => {
          const el = document.querySelector("#rotatePrompt");
          if (!el) return false;
          const st = getComputedStyle(el);
          return st.display !== "none" && st.visibility !== "hidden";
        });
        if (pre) {
          check(`${label} below the supported height, so it asks for a rotation`, true,
                "rotate prompt shown instead of a cramped board");
        } else {
          check(`${label} kick off opened the game`, false,
                "overlay never cleared — grid/scroll/keyboard checks skipped");
        }
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

      /* SHOTS=1 writes a PNG per viewport, so the thing being measured can also
         be looked at. A gate that only reports numbers asks you to trust that
         the assertions describe what a player sees; a picture beside the
         numbers lets you check that they do — and catches the whole class of
         defect nobody thought to assert on. */
      if (SHOTS) {
        await fs.promises.mkdir(SHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(SHOT_DIR, name + ".png"),
          fullPage: false,          // what fits on the screen is the question
        });
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

      /* The board no longer has to fit.

         It sits in a frame it pans and zooms inside, so a board taller than the
         frame is the feature rather than a defect — asserting that the grid ends
         within the viewport would now fail on every puzzle that uses the space
         it was given. What must hold is that the FRAME is on screen and has
         room in it, and that the square being typed into is visible within it.

         The old assertions are kept for the classic path, which is still in the
         file until this gate has run against flex for a while. */
      if (started && m.flexLayout) {
        check(`${label} board frame starts on screen`, m.frameTop >= -1,
              `top=${m.frameTop}`);
        check(`${label} board frame ends within viewport`, m.frameBottom <= h + 2,
              `bottom=${m.frameBottom} vs ${h}`);
        /* A frame this short is not a board anybody can read, whatever the zoom
           does. It is the flex equivalent of the cell floor the classic layout
           enforced. */
        check(`${label} board frame has usable height`, m.frameHeight >= 140,
              `${m.frameHeight}px — the board has nowhere to go`);
        if (m.activeInFrame !== null) {
          check(`${label} the selected square is inside the frame`, m.activeInFrame,
                `active cell is outside the visible board area`);
        }
        check(`${label} toolbar is on screen`, m.toolbarPresent && m.toolbarBottom <= h,
              `bottom=${m.toolbarBottom} vs ${h}`);
        if (m.clueTop !== null) {
          check(`${label} clue card is on screen`, m.clueBottom <= h + 2 && m.clueTop >= -1,
                `top=${m.clueTop} bottom=${m.clueBottom} vs ${h}`);
        }
      } else if (started && m.gridPresent) {
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
        /* The assertion that matters is the active cell, not the whole grid.
           A board taller than the fold is a deliberate choice on a tall screen:
           the page scrolls and the game keeps the focused square clear of the
           keyboard. Requiring the entire grid above the keyboard would force
           cells down to an illegible size on tablets to satisfy a rule whose
           purpose is that the player can see what they are typing. */
        if (m.activeCellBottom !== null) {
          check(`${label} keyboard does not cover the square being typed into`,
                m.activeCellBottom <= m.keyboardTop + 2 && m.activeCellTop >= -2,
                `active cell ${m.activeCellTop}-${m.activeCellBottom} vs keyboard top ${m.keyboardTop}`);
        }
        if (m.gridBottom > m.keyboardTop + 2) {
          console.log(`      note: ${label} board runs past the keyboard by ` +
                      `${m.gridBottom - m.keyboardTop}px — page scrolls, active cell stays clear`);
        }
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
    /* exitCode, not exit(). process.exit() abandons anything still buffered on
       stdout, so on a redirected or piped run the summary — the only part that
       says what actually failed — was being thrown away while the exit status
       still said failure. Setting the code lets node finish writing and leave
       of its own accord. */
    process.exitCode = 1;
    return;
  }
  console.log("All viewport checks passed.");
};

run().catch((e) => { console.error(e); process.exitCode = 1; });
