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
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
