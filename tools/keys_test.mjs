/* keys_test.mjs — the family's on-screen keyboard.
 *
 * It is shared, so it is tested here rather than inside one game: the point of
 * moving it out of the crossword was that two games now depend on the same
 * keys, and a suite that lived in one of them would be checking the keyboard
 * on behalf of a game that might stop using it.
 *
 * WHAT MATTERS ABOUT A KEYBOARD. That every letter is reachable and reports
 * itself; that the two destructive-ish keys are not next to each other; that a
 * game which asks for no enter key does not get one; and that pressing a key
 * does not steal focus from whatever the game has focused, which is the whole
 * reason it is pointerdown with preventDefault rather than click.
 *
 *   npm install -D jsdom --no-save
 *   node tools/keys_test.mjs        (from the repo root)
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const source = fs.readFileSync("shared/xi-keys.js", "utf8");
const css = fs.readFileSync("shared/xi-keys.css", "utf8");

function freshWindow(coarse) {
  const dom = new JSDOM('<!doctype html><body><div class="osk" id="osk"></div></body>',
    { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.matchMedia = (q) => ({ matches: coarse && q.includes("coarse"), media: q });
  dom.window.eval(source);
  return dom.window;
}

/* A press, the way a finger makes one. */
function press(win, btn) {
  const ev = new win.Event("pointerdown", { bubbles: true, cancelable: true });
  btn.dispatchEvent(ev);
  return ev;
}

console.log("Every letter is there, once, and says which it is");
{
  const win = freshWindow(true);
  const typed = [];
  const built = win.XIKeys.build(win.document.getElementById("osk"),
    { letter: (ch) => typed.push(ch), back: () => typed.push("<back>") });
  t("it builds", built === true);

  const keys = [...win.document.querySelectorAll(".osk-key")];
  const letters = keys.filter((k) => /^[A-Z]$/.test(k.textContent));
  t("twenty-six letters, one key each",
    letters.length === 26 && new Set(letters.map((k) => k.textContent)).size === 26,
    letters.length + " keys");
  t("laid out as a keyboard, three rows",
    win.document.querySelectorAll(".osk-row").length === 3);
  t("in the order a keyboard has them",
    win.XIKeys.ROWS.join("") === "QWERTYUIOPASDFGHJKLZXCVBNM");

  letters.forEach((k) => press(win, k));
  t("every letter key reports its own letter, and no other",
    typed.join("") === letters.map((k) => k.textContent).join(""),
    typed.join(""));
  /* A-Z with nothing missing: the row strings are the only place the layout is
     written down, so a dropped letter would be silent. */
  t("and between them they cover the alphabet",
    [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].every((ch) => typed.includes(ch)));
}

console.log("\nThe keys that are not letters");
{
  const win = freshWindow(true);
  const log = [];
  win.XIKeys.build(win.document.getElementById("osk"),
    { letter: (ch) => log.push(ch), back: () => log.push("BACK"), enter: () => log.push("ENTER") });
  const keys = [...win.document.querySelectorAll(".osk-key")];
  const wide = keys.filter((k) => k.classList.contains("wide"));
  t("a backspace and an enter, both wide", wide.length === 2);

  const rows = [...win.document.querySelectorAll(".osk-row")];
  const last = [...rows[2].children];
  t("they are on the last row", last.filter((k) => k.classList.contains("wide")).length === 2);
  /* A MIS-TAP THAT SUBMITS IS WORSE THAN ONE THAT DELETES. Opposite ends, so
     the two are never neighbours — and the row still measures ten keys. */
  t("at opposite ends of it, never side by side",
    last[0].classList.contains("wide") && last[last.length - 1].classList.contains("wide") &&
    last.length === 9);
  t("enter first, backspace last, so delete stays where a keyboard puts it",
    last[0].classList.contains("go") && !last[last.length - 1].classList.contains("go"));

  press(win, last[0]);
  press(win, last[last.length - 1]);
  t("and each does its own job", log.join(",") === "ENTER,BACK", log.join(","));
}

console.log("\nA game that wants no enter key does not get one");
{
  /* The crossword is that game: Enter steps to the next clue there, and a key
     that moves you off the clue you are typing is not what anyone reaches for. */
  const win = freshWindow(true);
  win.XIKeys.build(win.document.getElementById("osk"), { letter: () => {}, back: () => {} });
  const keys = [...win.document.querySelectorAll(".osk-key")];
  t("no enter key at all", keys.filter((k) => k.classList.contains("go")).length === 0);
  t("and the last row is the seven letters plus backspace",
    [...win.document.querySelectorAll(".osk-row")[2].children].length === 8);
}

console.log("\nPressing a key does not take focus off the game");
{
  const win = freshWindow(true);
  win.XIKeys.build(win.document.getElementById("osk"), { letter: () => {}, back: () => {} });
  const k = win.document.querySelector(".osk-key");
  const ev = press(win, k);
  /* THE REASON IT IS pointerdown AND NOT click. A click waits for the pointer
     to come up, which is a visible delay on every letter; and without
     preventDefault the press moves focus to the button, taking the caret out
     of whatever the game had focused. */
  t("the press is cancelled, so focus and the caret stay put", ev.defaultPrevented);
  t("and the keys are buttons that cannot submit a form",
    [...win.document.querySelectorAll(".osk-key")].every((b) =>
      b.tagName === "BUTTON" && b.type === "button"));
}

console.log("\nA device with a real keyboard is not drawn one");
{
  const coarse = freshWindow(true);
  coarse.XIKeys.markTouch();
  t("a touch device is marked, and the CSS shows the keys for it",
    coarse.document.body.classList.contains("touch") &&
    /body\.touch\s+\.osk\s*\{[^}]*display:\s*block/.test(css));

  const fine = freshWindow(false);
  fine.XIKeys.markTouch();
  t("a pointer device is not marked", !fine.document.body.classList.contains("touch"));
  t("and the keyboard is hidden until something marks it",
    /\.osk\s*\{[^}]*display:\s*none/.test(css));
}

console.log("\nBuilt twice, it is still one keyboard");
{
  /* Scrambled opens a board without reloading the page now, so build() can be
     reached more than once in a life. Appending would give a second set of
     keys under the first. */
  const win = freshWindow(true);
  const osk = win.document.getElementById("osk");
  win.XIKeys.build(osk, { letter: () => {}, back: () => {} });
  win.XIKeys.build(osk, { letter: () => {}, back: () => {} });
  t("a second build replaces the first rather than stacking on it",
    win.document.querySelectorAll(".osk-row").length === 3,
    win.document.querySelectorAll(".osk-row").length + " rows");
}

console.log("\nAsked for nothing, it does nothing");
{
  const win = freshWindow(true);
  t("no mount and no handlers is refused rather than thrown",
    win.XIKeys.build(null, { letter: () => {} }) === false &&
    win.XIKeys.build(win.document.getElementById("osk"), null) === false);
}

/* ---- HOW BIG A KEY IS ----------------------------------------------------

   These checks were in crossword/viewport_test.mjs while the keys lived in
   that game's stylesheet. They came here with them: left behind they would
   have gone on reading a file the rules had left, passing on its silence.

   The keyboard's widest row is ten keys, sized from three clamped variables,
   so the fit can be computed rather than guessed — and it is the one thing
   that would put a horizontal scrollbar on a phone. */
console.log("\nHow big a key is, at every width that has to work");
/* ALL WHITESPACE OUT, not only the newlines. These patterns came from a suite
   that read one stylesheet written without spaces after its colons; against a
   file punctuated the other way they matched nothing and reported the rules as
   missing. A check that depends on how a file is spaced is a check that goes
   red on a reformat and quiet on a real change. */
const tight = css.replace(/\s+/g, "");
const dial = (name) => {
  const m = tight.match(new RegExp("--" + name + ":clamp\\(([^)]*)\\)"));
  if (!m) return null;
  const [lo, pref, hi] = m[1].split(",").map((x) => x.trim());
  return { lo: parseFloat(lo), vw: parseFloat(pref), hi: parseFloat(hi) };
};
const key = dial("osk-key"), gap = dial("osk-gap");
t("the keyboard is sized from clamped variables", !!key && !!gap);

const widths = [320, 360, 390, 430, 768, 1024, 1366, 1920];

/* THE ROW IS THE CEILING, so the clamp above is a wish and not the width.
   Keys used to be sized by the clamp alone, which meant the cap had to be
   small enough for the narrowest phone and the keyboard then huddled in the
   middle of anything wider. The width is now the smaller of that wish and
   what a row of ten will actually take, so the wish can be generous.

   That moves what can go wrong. Overflow is impossible by construction; what
   is NOT impossible is the ceiling's own arithmetic drifting from the
   keyboard it describes — it divides by the number of keys in the widest row
   and subtracts one gap fewer, and both are written as literals. If a row
   gains a key they are wrong and every key is too wide by a tenth. So the
   numbers in the CSS are checked against the rows the module actually builds. */
const ceiling = tight.match(
  /\.osk-key\{[^}]*width:min\(var\(--osk-key\),calc\(\(100%-(\d+)\*var\(--osk-gap\)\)\/(\d+)\)\)/);
t("a key is capped by the row it is in, not only by the viewport", !!ceiling,
  ceiling ? `minus ${ceiling[1]} gaps, over ${ceiling[2]}` : "no row ceiling in .osk-key");

/* Read from the module's own row strings — the one place the layout is
   stated — rather than from a number repeated in the suite. */
const rowLengths = freshWindow(true).XIKeys.ROWS.map((r) => r.length);
const widest = Math.max(0, ...rowLengths);
t("and the row it divides by is the widest row the keyboard has",
  !!ceiling && Number(ceiling[2]) === widest && Number(ceiling[1]) === widest - 1,
  `rows ${rowLengths.join("/")} — CSS divides by ${ceiling ? ceiling[2] : "?"}`);

/* With that ceiling the row cannot exceed its container at any width, which
   is the property the old arithmetic was reaching for. Checked by computing
   the effective width the same way the browser will. */
const keyAt = (vw) => {
  const g = Math.min(Math.max(gap.lo, vw * gap.vw / 100), gap.hi);
  const wish = Math.min(Math.max(key.lo, vw * key.vw / 100), key.hi);
  return Math.min(wish, (vw - 8 - (widest - 1) * g) / widest);
};
const overflow = widths.filter((vw) => {
  const g = Math.min(Math.max(gap.lo, vw * gap.vw / 100), gap.hi);
  return widest * keyAt(vw) + (widest - 1) * g + 8 > vw + 0.01;
});
t("the widest keyboard row fits every supported width", overflow.length === 0,
  overflow.length ? overflow.join(", ") + "px overflow" : widths.length + " widths checked");

/* AND IT IS NOT LEAVING THE ROOM EMPTY, which is the fault that started this:
   on a tablet a row of ten sat in the middle of the screen at a 64px cap with
   space to spare on both sides. Measured as the key's own size rather than as
   a fraction of the viewport — a fraction passes on the old CSS at 768px and
   only tells the truth on a very wide one, where the cap is doing something
   deliberate and not something to complain about. */
t("a key on a tablet is bigger than the old fixed cap", keyAt(1024) >= 80,
  Math.round(keyAt(1024)) + "px at 1024");
t("and a phone gains from it too, rather than only the tablet",
  keyAt(390) >= 33 && keyAt(320) >= 27,
  Math.round(keyAt(320)) + "px at 320, " + Math.round(keyAt(390)) + "px at 390");
/* The cap is what stops a key stretching into a letterbox on a wide screen,
   so it is a shape rule, not an oversight. */
t("but a key never grows wider than about two and a half times its height",
  key.hi <= 2.6 * 52, key.hi + "px against a 52px tallest key");
t("keys grow with the screen instead of huddling at a fixed cap",
  key.hi >= 60 && !/\.osk-key\{[^}]*max-width:44px/.test(tight));
t("letter size is clamped, so phones do not lose out to the tablet fix",
  /font-size:clamp\(16px/.test(tight));

/* The block height a game reserves room from. It has to describe the same
   three rows the module builds, or a game leaves a gap or hides its own
   controls behind the keys. */
t("the block height a game reserves is three rows of keys",
  /--osk-block:calc\(var\(--osk-h\)\*3/.test(tight) && rowLengths.length === 3,
  rowLengths.length + " rows");

console.log("\nBoth games ask for it, and neither keeps a copy");
{
  const pages = { crossword: "crossword/index.html", scrambled: "scrambled/index.html" };
  for (const [game, page] of Object.entries(pages)) {
    const html = fs.readFileSync(page, "utf8");
    t(`${game} links the shared keys, script and stylesheet`,
      html.includes("shared/xi-keys.js?v=") && html.includes("shared/xi-keys.css?v=") &&
      /<div class="osk" id="osk">/.test(html));
    const js = fs.readFileSync(`${game}/js/game.js`, "utf8");
    t(`${game} builds through the shared module`, js.includes("XIKeys.build("));
    /* THE POINT OF MOVING IT. A game holding its own row strings or its own
       key markup is a second keyboard, whatever it is called. */
    t(`${game} holds no keyboard of its own`,
      !js.includes("QWERTYUIOP") && !/className\s*=\s*["']osk-key/.test(js));
    const gameCss = fs.readFileSync(`${game}/css/style.css`, "utf8");
    t(`${game} does not restate how a key is sized`,
      !/^\.osk-key\s*\{/m.test(gameCss) && !gameCss.includes("--osk-key:"),
      "overrides of .osk for its own layout are fine; the keys are not its own");
    /* AND IT SURVIVES THE KEYBOARD NOT LOADING. The suites serve a game on its
       own, with no shared/ to fetch, and in production a script can be lost to
       a bad network. Every other reach into the shared layer from these files
       is guarded; this one was not, and an unguarded call took the whole of
       the crossword's game.js down on boot the first time a suite ran without
       it. Checked by position rather than by counting mentions: the guard has
       to come before the first use, or it is not guarding anything. */
    const guard = js.indexOf("if (window.XIKeys)");
    const firstUse = js.indexOf("window.XIKeys.");
    t(`${game} still boots when the shared keyboard does not load`,
      guard > -1 && firstUse > guard,
      guard === -1 ? "no guard at all" : `guard at ${guard}, first use at ${firstUse}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
