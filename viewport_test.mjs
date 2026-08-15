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
/* A hard `width` or `min-width` declaration can force overflow. `max-width`
   prevents it, and a media-query breakpoint — `(min-width:1000px)` — is a
   condition, not a width, so neither counts. Both are excluded by lookbehind:
   the first version of this check flagged its own breakpoints. */
const fixedWide = [...css.matchAll(/(?<![(\w-])(?:min-)?width\s*:\s*(\d{3,})px/g)]
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

/* Landscape tablets: width is abundant, height is scarce, and the board is
   limited only by height. Anything the toolbar gives back becomes cells. */
const flatCss = css.replace(/\s*\n\s*/g, "");
const landscape = flatCss.slice(flatCss.indexOf("@media (orientation:landscape) and (max-height:1100px)"));
/* Slice the block it actually belongs to, not a fixed number of characters
   from a neighbouring one — the first version of this drifted out of range the
   moment nearby rules grew. */
const narrowLandscape = flatCss.slice(
  flatCss.indexOf("and (max-height:1100px) and (max-width:999px)"),
  flatCss.indexOf("and (max-height:1100px) and (min-width:1000px)"));
t("narrow landscape collapses the league table to one row",
  /#tablePanel tbody tr:not\(\.you\)\{display:none\}/.test(narrowLandscape));
t("narrow landscape collapses the table, where there is no room for a rail",
  /@media \(orientation:landscape\) and \(max-height:1100px\) and \(max-width:999px\)/.test(flatCss));
const rail = flatCss.slice(flatCss.indexOf("and (max-height:1100px) and (min-width:1000px)"));
t("wide landscape grids the stage, not the body", (() => {
  /* Gridding the body put the rail beside the whole stage, so it ran the height
     of the page while the board floated in the middle of its column. Gridding
     the stage makes the rail a column of the board itself. */
  return /\.stage\{display:grid;align-items:start;justify-content:center/.test(rail) &&
    !/body\{display:grid/.test(rail);
})());
t("the rail sits in the board's row and stretches to its height",
  /\.toolbar\{grid-column:1;grid-row:2;align-self:stretch/.test(rail) &&
  /\.grid-wrap\{grid-column:2;grid-row:2/.test(rail));
t("the active clue spans the rail and the board",
  /\.now-clue\{grid-column:1 \/ -1;grid-row:1\}/.test(rail));
t("the clue lists run full width underneath",
  /\.clues\{grid-column:1 \/ -1;grid-row:4\}/.test(rail));
t("panels inside the rail are contents of the card, not boxes on top of it",
  /\.tb-table,\.tb-help\{[^}]*background:none;border:none;padding:0/.test(rail));
/* A plain 1fr track refuses to shrink below its content, so the help buttons
   pushed straight out through the side of the card. */
t("help buttons cannot overflow the rail",
  /\.tb-row\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/.test(rail) &&
  /\.tb-row \.btn\{min-width:0/.test(rail));
t("the rail uses short button labels, since it is only 280px wide",
  /\.tb-row \.lbl-full\{display:none\}/.test(rail) && /\.tb-row \.lbl-short\{display:inline\}/.test(rail));
t("the toolbar stacks from the top rather than spreading down the card",
  /\.toolbar\{justify-content:flex-start\}/.test(rail));
t("the board column is sized to the board, so the pitch keeps hugging the grid", (() => {
  /* With 1fr the column was as wide as the page and the grid sat in half a
     pitch. max-content makes the column the board's own width, so the pitch and
     the crossword cover the same space and the edges still line up. */
  return /grid-template-columns:minmax\(230px,280px\) max-content/.test(rail) &&
    /\.grid-wrap\{justify-self:start\}/.test(rail);
})());
t("the clue lists use the full width instead of the board's",
  /\.clues,#seasonPanel\{max-width:none\}/.test(rail));
t("the two landscape layouts cannot both apply", (() => {
  // One is max-width:999px, the other min-width:1000px.
  return /\(max-width:999px\)/.test(flatCss) && /\(min-width:1000px\)/.test(flatCss);
})());
t("the board panel becomes display:contents so its children can be placed",
  /\.grid-panel\{display:contents\}/.test(rail));

/* Dark mode had the crossword nearly invisible against its own pitch: the cell
   fill and the turf sat at 1.57:1, where light mode manages 5.04:1. The grid
   shape got lost as a mass. Both dark blocks — the OS one and the forced one —
   must carry the fix, or choosing "dark" by hand would look different from
   having dark set in the OS. */
const darkBlocks = (css.match(/--cell-bg:#5A6356/g) || []).length;
t("both dark themes lighten the playable cells", darkBlocks === 2, darkBlocks + " blocks");
t("cells are painted from their own token, not the card colour",
  /\.cell\{[^}]*background:var\(--cell-bg\)/.test(css.replace(/\s*\n\s*/g, "")) &&
  /:root\{[^}]*--cell-bg:#FFFFFF/.test(css.replace(/\s*\n\s*/g, "")));
t("the solved animation settles back to the cell colour, not the card",
  /@keyframes solved\{.*?background:var\(--cell-bg\)/.test(css.replace(/\s*\n\s*/g, "")));

/* Phone reorder: clock/solved/pause/new on one row, help on one row, and the
   league table moved below the board. */
/* There are two @media (max-width:640px) blocks — a one-line cursor rule and
   the main phone block. Take the last, and take all of it. */
const phone = flatCss.slice(flatCss.lastIndexOf("@media (max-width:640px)"));
t("phone: status and controls sit on a single row",
  /\.tb-left\{flex-direction:row;flex-wrap:nowrap/.test(phone));
t("phone: the four help buttons sit on a single row",
  /\.tb-row\{grid-template-columns:repeat\(4,1fr\)/.test(phone));
t("phone: substitution takes its own row when it appears",
  /#subBtn\{grid-row:auto;grid-column:1 \/ span 4\}/.test(phone));
/* The v05p bug, one specificity level up: `#tablePanel.below-board tbody tr`
   outranks the bare `tr.faroff` rule, so without an explicit override the
   moved table would show all twenty rows again. */
t("phone: the moved table still hides rows outside the three-row window",
  /#tablePanel\.below-board tbody tr\.faroff\{display:none\}/.test(phone));
t("phone: and it shows the full three rows, not just yours", (() => {
  const showAll = phone.indexOf("#tablePanel.below-board tbody tr{display:table-row}");
  const collapse = phone.indexOf("#tablePanel tbody tr:not(.you){display:none}");
  // Equal specificity, so the later rule wins: the override must come after.
  return showAll > -1 && collapse > -1 && showAll > collapse;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
