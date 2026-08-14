/* Checks the five viewports from §12 of the brief for horizontal overflow.
   jsdom does no real layout, so this cannot judge appearance — what it can do
   is prove no rule forces a width wider than the viewport, which is the one
   failure mode the brief calls out explicitly. */
import fs from "node:fs";
const css = fs.readFileSync("css/style.css", "utf8");
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* Only a hard `width` or `min-width` can force overflow. `max-width` is the
   thing that prevents it, and media-query breakpoints are not widths at all —
   matching those was the first version of this check calling its own caps a
   failure. */
const fixedWide = [...css.matchAll(/(?<!max-)(?:min-)?width\s*:\s*(\d{3,})px/g)]
  .map((m) => Number(m[1])).filter((n) => n > 400);
t("no rule pins a width wider than a phone", fixedWide.length === 0, fixedWide.join(", "));
t("the stage is capped and centred, not fixed",
  /\.stage\{[^}]*max-width:1140px/.test(css.replace(/\s*\n\s*/g, "")));
t("the board box shrinks its padding on small screens",
  /@media \(max-width:700px\)\s*\{\s*\.grid-wrap\{padding:7px 9px\}/.test(css.replace(/\s*\n\s*/g, "")));
t("clue columns stack before the text gets narrow",
  /@media \(max-width:820px\)/.test(css));
t("the grid uses a cell variable, not fixed pixel columns",
  /grid-template-columns\s*=\s*"repeat\(/.test(fs.readFileSync("js/game.js", "utf8")) ||
  /var\(--cell\)/.test(css));
t("cells stay square", /\.cell\{[^}]*width:var\(--cell\);height:var\(--cell\)/.test(css.replace(/\s*\n\s*/g, "")));
/* The keyboard's widest row is 10 keys. Its size comes from three clamped
   variables, so the fit can be computed rather than guessed — and it is the one
   thing that would put a horizontal scrollbar on a phone. */
const dial = (name) => {
  const m = css.match(new RegExp("--" + name + ":clamp\\(([^)]*)\\)"));
  if (!m) return null;
  const [lo, pref, hi] = m[1].split(",").map((x) => x.trim());
  return { lo: parseFloat(lo), vw: parseFloat(pref), hi: parseFloat(hi) };
};
const key = dial("osk-key"), gap = dial("osk-gap");
t("the keyboard is sized from clamped variables", !!key && !!gap);
const widths = [320, 360, 390, 430, 768, 1024, 1366, 1920];
const overflow = widths.filter((vw) => {
  const k = Math.min(Math.max(key.lo, vw * key.vw / 100), key.hi);
  const g = Math.min(Math.max(gap.lo, vw * gap.vw / 100), gap.hi);
  return 10 * k + 9 * g + 8 > vw;
});
t("the widest keyboard row fits every supported width", overflow.length === 0,
  overflow.length ? overflow.join(", ") + "px overflow" : widths.length + " widths checked");
t("keys grow with the screen instead of huddling at a fixed cap",
  key.hi >= 60 && !/\.osk-key\{[^}]*max-width:44px/.test(css.replace(/\s*\n\s*/g, "")));
t("letter size is clamped, so phones do not lose out to the tablet fix",
  /font-size:clamp\(16px/.test(css.replace(/\s*\n\s*/g, "")));

/* The 900px block used to re-assert two clue columns after the 820px stacking
   rule, and being later in the file it won. */
const flat = css.replace(/\s*\n\s*/g, "");
const after820 = flat.slice(flat.indexOf("max-width:820px"));
t("nothing re-forces two clue columns after the stacking rule",
  !/@media \(max-width:900px\)\{[^}]*\.clues\{grid-template-columns:1fr 1fr/.test(after820));

/* The phone header used to take half the viewport before any of the board was
   visible. The league table collapsing to the player's row is the main saving,
   so it is worth a test rather than a comment. */
t("the phone header collapses the league table to your own row",
  /#tablePanel tbody tr:not\(\.you\)\{display:none\}/.test(css.replace(/\s*\n\s*/g, "")));
t("the phone clue card is shorter but still fixed, so the board cannot jump", (() => {
  const flat = css.replace(/\s*\n\s*/g, "");
  return /\.now-clue\{height:112px\}/.test(flat) && !/\.now-clue\{height:auto/.test(flat);
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
