/* share_test.mjs — how a result leaves the site, in every game.
 *
 * Every game already wrote share TEXT. What only Crossword XI had was
 * somewhere to send it — a native sheet with a copy fallback, named buttons
 * for the places a football result gets posted — and a Challenge control. So
 * three games had the words and no envelope, which is the same shape of gap
 * as the settings cog and the keyboard before it.
 *
 * The point of this suite is that there is now ONE row, mounted by four
 * games, rather than four rows that agree today. A game keeping its own
 * platform buttons is the drift this exists to refuse.
 *
 *   node tools/share_test.mjs        (from the repo root)
 */
import { gameDir } from "../functions/_lib/permalink.js";
import fs from "node:fs";
import { JSDOM } from "jsdom";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}
const read = (p) => fs.readFileSync(p, "utf8");
const GAMES = ["crossword", "wordsearch", "scrambled", "hilo"];

console.log("One row, four games");
for (const g of GAMES) {
  const html = read(`${gameDir(g)}/index.html`);
  const js = read(`${gameDir(g)}/js/game.js`);
  t(`${g} links the shared share module, script and stylesheet`,
    /shared\/xi-share\.js/.test(html) && /shared\/xi-share\.css/.test(html));
  t(`${g} has somewhere to mount it, and mounts it`,
    /id="shareRow"/.test(html) && /XIShare\.mount\(/.test(js));
  /* THE TEXT STAYS THE GAME'S. A crossword result is not a word search
     result, and each game already knew how to write its own — so the module
     is handed a function, never a string it composed itself. */
  t(`${g} hands over a function for its own text, not a string`,
    /text:\s*(shareText|function)/.test(js));
  /* And no game keeps its own copy of the places to send it. */
  t(`${g} keeps no platform buttons of its own`,
    !/wa\.me|twitter\.com\/intent|reddit\.com\/submit/.test(js),
    "the URLs live in shared/xi-share.js");
}

console.log("\nWhat the row actually builds");
{
  const dom = new JSDOM('<div id="m"></div>', { runScripts: "outside-only" });
  const { window } = dom;
  window.eval(read("shared/xi-share.js"));
  const doc = window.document;
  const opened = [];
  window.open = (url) => { opened.push(url); return null; };

  const mounted = window.XIShare.mount(doc.getElementById("m"), {
    text: () => "Scrambled XI #10\nline two",
    url: () => "https://www.thexigames.com/football/scrambled/daily/10",
  });
  t("it mounts and returns its controls", !!mounted && !!mounted.share);
  t("a share control and a challenge control",
    !!doc.querySelector(".xis-share") && !!doc.querySelector(".xis-challenge"));
  const targets = [...doc.querySelectorAll(".xis-target")].map((b) => b.textContent);
  t("and the places a football result gets posted",
    targets.join(",") === "WhatsApp,X,Reddit", targets.join(", "));

  /* THE PHONE'S OWN SHEET WHERE THERE IS ONE, A COPY WHERE THERE IS NOT.
     This was the crossword's alone and moved here with the row; the other
     three had no sheet at all. On a phone the native sheet already offers
     WhatsApp, Messages and everything else installed, which beats a row of
     buttons guessing what somebody has installed. */
  {
    const d2 = new JSDOM('<div id="m"></div>', { runScripts: "outside-only" });
    d2.window.eval(read("shared/xi-share.js"));
    const sheet = [];
    d2.window.navigator.share = (x) => { sheet.push(x); return Promise.resolve(); };
    d2.window.XIShare.mount(d2.window.document.getElementById("m"),
      { text: () => "a result", url: () => "u" });
    d2.window.document.querySelector(".xis-share")
      .dispatchEvent(new d2.window.Event("click"));
    t("the phone's own share sheet is used where there is one",
      sheet.length === 1 && sheet[0].text === "a result");

    const d3 = new JSDOM('<div id="m"></div>', { runScripts: "outside-only" });
    d3.window.eval(read("shared/xi-share.js"));
    const copied = [];
    d3.window.navigator.clipboard = { writeText: (x) => { copied.push(x); return Promise.resolve(); } };
    d3.window.XIShare.mount(d3.window.document.getElementById("m"),
      { text: () => "a result", url: () => "u" });
    d3.window.document.querySelector(".xis-share")
      .dispatchEvent(new d3.window.Event("click"));
    t("and it copies where there is not", copied.length === 1 && copied[0] === "a result",
      "desktop has no share sheet");
  }

  /* THE TEXT IS READ WHEN THE BUTTON IS PRESSED, not when the row is built —
     the row is mounted at boot and the result does not exist yet. */
  let calls = 0;
  const live = window.XIShare.mount(doc.getElementById("m"),
    { text: () => { calls++; return "later"; }, url: () => "u" });
  t("the text function is not called at mount time", calls === 0);
  doc.querySelector(".xis-target").dispatchEvent(new window.Event("click"));
  t("and is called when a target is pressed", calls === 1);
  t("which opens that platform with the text in it",
    opened.length === 1 && opened[0].startsWith("https://wa.me/?text=") &&
    decodeURIComponent(opened[0].split("text=")[1]) === "later",
    opened[0]);
  void live;
}

console.log("\nThe challenge control");
{
  const dom = new JSDOM('<div id="m"></div>', { runScripts: "outside-only" });
  const { window } = dom;
  window.eval(read("shared/xi-share.js"));
  const doc = window.document;
  let ran = 0;
  window.XIShare.mount(doc.getElementById("m"),
    { text: () => "t", url: () => "u", challenge: () => { ran++; } });
  doc.querySelector(".xis-challenge").dispatchEvent(new window.Event("click"));
  t("a game with a real creator gets its own handler", ran === 1);

  /* A game whose scoring is not server-side yet cannot make a standings
     table, so its Challenge sends the board and the score — the same
     invitation without the table. The owner asked for the control to be
     present on that understanding. */
  const dom2 = new JSDOM('<div id="m"></div>', { runScripts: "outside-only" });
  dom2.window.eval(read("shared/xi-share.js"));
  const shared = [];
  dom2.window.navigator.share = (d) => { shared.push(d); return Promise.resolve(); };
  dom2.window.XIShare.mount(dom2.window.document.getElementById("m"),
    { text: () => "I scored 100", url: () => "https://x/board/7" });
  dom2.window.document.querySelector(".xis-challenge")
    .dispatchEvent(new dom2.window.Event("click"));
  t("a game without one sends the board and the score",
    shared.length === 1 && shared[0].text === "I scored 100\nhttps://x/board/7",
    JSON.stringify(shared[0] && shared[0].text));

  /* And a game that already HAS a challenge form on the same card asks for no
     button, rather than showing a second one beside it. */
  const dom3 = new JSDOM('<div id="m"></div>', { runScripts: "outside-only" });
  dom3.window.eval(read("shared/xi-share.js"));
  dom3.window.XIShare.mount(dom3.window.document.getElementById("m"),
    { text: () => "t", url: () => "u", challenge: false });
  t("challenge: false omits the button and keeps the rest",
    !dom3.window.document.querySelector(".xis-challenge") &&
    !!dom3.window.document.querySelector(".xis-share") &&
    dom3.window.document.querySelectorAll(".xis-target").length === 3);
  t("and the crossword is the game that asks for that",
    /challenge:\s*false/.test(read("football/crossword/js/game.js")),
    "its results card already carries a challenge form");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
