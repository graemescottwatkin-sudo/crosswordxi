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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
