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
   prevents it, and a media-query breakpoint — `(min-width:860px)` — is a
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
   visible. The saving now comes from the league table not being in the header
   at all: it is under the board in the markup at every width, so the banner
   never carries a table's worth of width and nothing has to collapse. */
/* The table is back in the rail, where it reads as part of the same dashboard
   as the clock and the help buttons. What sits under the board is the season
   record — the run of results is what the score means, and it belongs against
   the thing that produced it. */
/* There is no banner any more. Everything sits in one column under the clue
   strip, in the order it is read: board, controls, help, season, table. */
t("every block sits in the board column, not in a banner", (() => {
  const html = fs.readFileSync("index.html", "utf8");
  const panel = html.slice(html.indexOf('<div class="grid-panel"'), html.indexOf('<div class="osk"'));
  return html.indexOf('<div class="toolbar"') === -1 &&
    ["tb-game", "tb-help", 'id="seasonPanel"', 'id="tablePanel"'].every((k) => panel.indexOf(k) > -1);
})());
t("nothing collapses the table to a single row now that it has the board's width",
  !/#tablePanel tbody tr:not\(\.you\)\{display:none\}/.test(css.replace(/\s*\n\s*/g, "")));
t("the phone clue card is shorter but still fixed, so the board cannot jump", (() => {
  const flat = css.replace(/\s*\n\s*/g, "");
  return /\.now-clue\{height:112px\}/.test(flat) && !/\.now-clue\{height:auto/.test(flat);
})());

/* Landscape tablets: width is abundant, height is scarce, and the board is
   limited only by height. Anything the toolbar gives back becomes cells. */
/* Comments stripped as well as newlines: several rules now carry explanations
   long enough that a regex spanning a declaration block matches the prose
   instead of the CSS. */
const flatCss = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "");
const landscape = flatCss.slice(flatCss.indexOf("@media (orientation:landscape) and (max-height:1100px)"));
/* Slice the block it actually belongs to, not a fixed number of characters
   from a neighbouring one — the first version of this drifted out of range the
   moment nearby rules grew. */
const narrowLandscape = flatCss.slice(
  flatCss.indexOf("and (max-height:1100px) and (max-width:859px)"),
  flatCss.indexOf("and (max-height:1100px) and (min-width:860px)"));
t("narrow landscape lays the table on its side under the board", (() => {
  /* Width there is plentiful and height is not, so the club sits alongside the
     rows rather than above them. */
  return /\.tb-table\{flex-direction:row;align-items:center/.test(narrowLandscape) &&
    /\.tb-table \.club-bar\{margin-bottom:0/.test(narrowLandscape);
})());
t("narrow landscape collapses the table, where there is no room for a rail",
  /@media \(orientation:landscape\) and \(max-height:1100px\) and \(max-width:859px\)/.test(flatCss));
const rail = flatCss.slice(flatCss.indexOf("and (max-height:1100px) and (min-width:860px)"));
t("wide landscape grids the stage, not the body", (() => {
  /* Gridding the body put the rail beside the whole stage, so it ran the height
     of the page while the board floated in the middle of its column. Gridding
     the stage makes the rail a column of the board itself. */
  return /\.stage\{display:grid;align-items:start/.test(rail) &&
    !/body\{display:grid/.test(rail);
})());
t("the rail sits in the board's row and ends with its content", (() => {
  /* Stretching it to the board's height left a couple of hundred pixels of
     empty card below the help buttons. */
  return /\.toolbar\{grid-column:1;grid-row:2/.test(rail) &&
    /\.toolbar\{align-self:start\}/.test(rail) &&
    /\.grid-wrap\{grid-column:2;grid-row:2/.test(rail);
})());
t("the rail + board tracks are centred inside the page", (() => {
  const js = fs.readFileSync("js/game.js", "utf8");
  /* Was `width:100%`, which the shipped CSS never says: the stage is capped to
     the measured pair width so the spanning rows cannot widen the tracks. The
     assertion was left behind when the rule changed. */
  return /width:min\(100%,var\(--block-w,[^)]*\)\)/.test(rail) && /margin:0 auto/.test(rail) &&
    /justify-content:center/.test(rail) &&
    /--block-w/.test(js) && /railW \+ pairGap \+ boardW/.test(js) &&
    /* Derived from the cell size, not read back off the painted board — and
       from the widest board the generator builds, not this puzzle's width, so
       the pitch does not resize under the column that lines up with it. */
    /frameCols \* size \+ wrapPadX/.test(js);
})());
t("nothing that spans both columns can widen them", (() => {
  // min-width:0 stops a long clue or a long list item forcing a track wider.
  return /\.now-clue\{[^}]*min-width:0/.test(rail) && /\.clues\{[^}]*min-width:0/.test(rail);
})());
t("the active clue spans the pair and is capped to the pair width",
  /\.now-clue\{grid-column:1 \/ -1;grid-row:1;.*?width:min\(100%,var\(--block-w,100%\)\);justify-self:center/.test(rail));
t("the clue lists span underneath and are capped to the pair width",
  /\.clues\{grid-column:1 \/ -1;grid-row:4;.*?width:min\(100%,var\(--block-w,100%\)\);justify-self:center/.test(rail));
t("panels inside the rail are contents of the card, not boxes on top of it",
  /\.tb-match,\.tb-game,\.tb-help\{[^}]*background:none;border:none;padding:0/.test(rail));
t("the season record follows the board into the second column, at the board's width",
  /#seasonPanel\{grid-column:2;grid-row:3;[^}]*width:var\(--board-w/.test(rail));
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
  /* Went 1fr -> max-content -> var(--board-w). 1fr made the column as wide as
     the page; max-content let a long clue in a spanning row widen it. The
     board's width is known exactly, so the track is told rather than asked. */
  return /grid-template-columns:var\(--rail-w\)\s*var\(--board-w/.test(rail) &&
    /\.grid-wrap\{grid-column:2;grid-row:2/.test(rail);
})());
t("the clue lists end at the same right edge as the board pair",
  /\.clues\{max-width:var\(--block-w,100%\)\}/.test(rail));
t("the two landscape layouts cannot both apply", (() => {
  // One is max-width:859px, the other min-width:860px.
  return /\(max-width:859px\)/.test(flatCss) && /\(min-width:860px\)/.test(flatCss);
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
t("phone: the readouts and the controls each stay on one line",
  /\.tb-readouts,\.tb-controls\{gap:5px;flex-wrap:nowrap\}/.test(phone));
t("phone: help is two labelled pairs, not four loose buttons", (() => {
  /* Four across fitted, but "All" and "Answer" side by side gave no clue which
     was a check and which a reveal. Label plus pair reads as one phrase. */
  return /\.tb-row\{grid-template-columns:auto minmax\(0,1fr\) minmax\(0,1fr\)/.test(phone) &&
    /\.tb-sub\{min-width:38px/.test(phone);
})());
t("phone: substitution sits under the pairs when it appears",
  /\.tb-row-sub \.btn\{grid-column:2 \/ span 2\}/.test(phone));
/* The v05p bug, one specificity level up: `#tablePanel.below-board tbody tr`
   outranks the bare `tr.faroff` rule, so without an explicit override the
   moved table would show all twenty rows again. */
t("phone: the moved table still hides rows outside the three-row window",
  /#tablePanel\.below-board tbody tr\.faroff\{display:none\}/.test(phone));
t("phone: and it shows the full three rows, not just yours", (() => {
  /* The blanket collapse is gone, so this no longer turns on rule order — but
     the three-row window must still be what is shown, and the faroff override
     above is what keeps it to three rather than twenty. */
  return phone.indexOf("#tablePanel.below-board tbody tr{display:table-row}") > -1 &&
    !/#tablePanel tbody tr:not\(\.you\)\{display:none\}/.test(phone);
})());

/* ---- The reserved slot column ----
   The boxes are a fixed column so they start in the same place on every clue.
   That only has to hold within a puzzle — the only time you switch between
   clues — so the reservation is now the longest answer in the loaded puzzle
   rather than the longest the engine could place. Reserving fifteen when the
   longest answer was nine spent 130px of a strip capped to the board width,
   and the clue text paid for it. MAX_DIM is still the ceiling and still worth
   checking, because the fallback before a puzzle loads assumes it. */
/* Rules scoped to a container that no longer exists stop applying silently.
   Dissolving the banner left .toolbar .btn orphaned, so every button in the
   board column lost display:inline-flex — and the pause icon sat off-centre on
   both axes, because justify-content has nothing to act on inside an
   inline-block. Nothing failed; it just looked wrong. */
t("button layout rules reach the column the buttons actually live in", (() => {
  const html = fs.readFileSync("index.html", "utf8");
  const stillHasToolbar = html.indexOf('<div class="toolbar"') > -1;
  return stillHasToolbar || /\.grid-panel \.tb-box \.btn\{[^}]*display:inline-flex/.test(flatCss);
})());
t("and the icon button centres its glyph on both axes",
  /\.icon-btn\{[^}]*align-items:center[^}]*justify-content:center/.test(flatCss));

/* Twelve themes stacked as heading-then-boxes filled the sheet and pushed the
   schedule below it out of reach. Name and boards share a line, and the number
   buttons are sized to the number rather than being wide buttons with "#1"
   adrift in them — without dropping below the 44px target. */
t("a theme and its boards sit on one line",
  /\.theme-group\{[^}]*display:flex[^}]*align-items:center/.test(flatCss));
t("and the number buttons stay at the touch target while being square",
  /\.theme-board\{[^}]*min-height:44px;min-width:44px/.test(flatCss));

/* The fixed frame is a wide-screen arrangement, and the arithmetic behind it
   has to be gated the same way the CSS is. It was not: dividing by MAX_COLS
   sized every board for fourteen columns, so a ten-column puzzle on a phone
   came out with cells a third smaller than the screen could carry. */
t("the fixed frame is gated to the same width in the CSS and the maths", (() => {
  const js = fs.readFileSync("js/game.js", "utf8");
  const gate = /var wideFrame = vw >= (\d+)/.exec(js);
  const css = /@media \(min-width:(\d+)px\)\{\.grid-wrap\{width:min\(100%,var\(--board-w/.exec(flatCss);
  return gate && css && gate[1] === css[1];
})(), (() => {
  const js = fs.readFileSync("js/game.js", "utf8");
  const g = /var wideFrame = vw >= (\d+)/.exec(js);
  return g ? "maths gated at " + g[1] : "no gate found";
})());
t("and a narrow screen sizes the board for the puzzle, not the frame",
  /frameCols = wideFrame \? Math\.max\(MAX_COLS, puzzle\.width\) : puzzle\.width/
    .test(fs.readFileSync("js/game.js", "utf8")));

/* Arrangements that only work with room: the game row and the help row were
   both laid out for a wide screen and neither was gated, so a clock, a count
   and four buttons sat on one unbreakable line at 390px. */
t("the game row only refuses to wrap where there is room",
  /@media \(min-width:900px\)\{\.grid-panel > \.tb-game \.tb-controls\{flex-wrap:nowrap\}/
    .test(flatCss));
t("and below that the readings take their own line",
  /@media \(max-width:899px\)\{[\s\S]{0,400}\.tb-readouts\{flex:0 0 100%/.test(flatCss));
t("help groups fall to full width on a narrow screen",
  /@media \(max-width:899px\)\{\.grid-panel > \.tb-help \.tb-row\{flex:1 1 100%\}/.test(flatCss));

console.log("\nThe letter slots");
const engine = fs.readFileSync("js/engine.js", "utf8");
const maxDim = Number((/var MAX_DIM = (\d+)/.exec(engine) || [])[1]);
t("the generator still bounds the grid at the width the reservation assumes",
  maxDim === 15, "MAX_DIM = " + maxDim);
t("the reservation is derived from a slot count, not a typed-in pixel value",
  /--bank-w:calc\(var\(--bank-slots\) \* var\(--bank-cell\)/.test(flatCss));
t("and the fallback before a puzzle loads is the generator's own ceiling",
  new RegExp("--bank-slots:" + maxDim + "[;\\s]").test(flatCss),
  (/--bank-slots:(\d+)/.exec(flatCss) || [])[1] + " vs MAX_DIM " + maxDim);
t("the loaded puzzle then sets it from its own longest answer",
  /setProperty\("--bank-slots"/.test(fs.readFileSync("js/game.js", "utf8")));
t("the slots take that reserved width rather than what the sentence leaves",
  /\.bank\{[^}]*flex:0 0 var\(--bank-w\);width:var\(--bank-w\)/.test(flatCss));
t("a gap element is 9px, so three of them are the 27px reserved", (() => {
  const m = /\.bank-gap\{width:(\d+)px\}/.exec(flatCss);
  return m && Number(m[1]) * 3 === 27;
})());
t("cells are sized from the same variable, so the reservation cannot drift",
  /\.bank-cell\{width:var\(--bank-cell\)/.test(flatCss));
t("long clues shrink to fit instead of scrolling", (() => {
  /* overflow-y:auto meant the longest clues could be read only by scrolling
     inside a 96px card, which nobody discovers. */
  return /\.nc-main\{[^}]*overflow:hidden/.test(flatCss) &&
    !/\.nc-main\{[^}]*overflow-y:auto/.test(flatCss);
})());
t("the slots drop to their own row only where they cannot fit beside the clue",
  /@media \(max-width:900px\)\{[^@]*\.bank\{flex:0 0 100%;width:100%\}/.test(flatCss));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
