# The XI Games — design system

One page. The tokens are in `shared/xi-tokens.css`; this is the law for using
them. Every game loads the same file, so a value changed there changes the
family. A value written into a game's own stylesheet changes one game, once,
and then drifts — which is how the crossword came to carry its own copy of
the palette. Don't.

## The rule

**Games consume tokens; they never define them.** A game stylesheet may set
`--anything` only for a fact that exists in that game alone (a cell size, a
column count). It may never restate a colour, a size, a radius, a shadow or a
duration that has a token, and it may never define a `.xic-` rule. The gates
check the second; the cross-game contract now checks the first.

## Colour

Two families of colour, and they are not interchangeable.

**Surfaces and ink** — `--paper`, `--card`, `--ink`, `--ink-soft`,
`--ink-faint`, `--line`, `--tint`. These are what things are made of. Green
(`--pitch`, `--pitch-deep`) is the brand and the primary action, nothing
else. Gold (`--gold`, `--xi-ink`) is the XI mark and the reveal, nothing else.

**State** — `--sel`, `--sel-word`, `--correct`, `--wrong`, `--wrong-bg`,
`--revealed`, `--revealed-bg`. These say what a thing *means* right now. A
state colour is never used for decoration, so a gold cell always means "you
were told" and a red tint always means "that letter is wrong". The form chips
(`--form-w/d/l`) are the same idea at result scale; W derives from
`--correct` because a win and a right answer are the same fact.

**The grid** — `--grid-cell`, `--grid-line`, `--grid-block`, `--grid-field`.
White cells and near-black blocks are the game. The field behind them is a
step off paper and no more; it is a texture, not a pitch.

**Dark mode** is `[data-theme="dark"]` on the root and is a second set of
values, not an inversion. Light is the default. If you add a token, add its
dark value in the same commit or it will not exist there.

## Type

`--disp` (Barlow Condensed) for mastheads, tile letters, kickers and numbers
that are the point. `--body` (Public Sans) for everything you read. Sizes come
from `--fs-xs` … `--fs-mast`; line-heights from `--lh-tight` (display),
`--lh-snug` (headings), `--lh-body` (paragraphs). Uppercase kickers take
`--track-caps`. There is no 15.5px.

## Space, corners, elevation

Spacing is `--sp-1` … `--sp-12`, on a 4px grid. Corners are `--r-xs` (chips),
`--r-sm` (inputs, small buttons), `--r-md` (cards, tiles), `--r-lg` (sheets,
the hero), `--r-pill` (pills). `--radius` is the legacy name for `--r-lg`.
Cards rest on `--shadow-1`; sheets and popovers float on `--shadow-2`.

Nothing interactive is smaller than `--tap` (44px) on a touch screen.

## Motion

Four durations, two curves. `--t-fast` (120ms) for hover and press;
`--t-base` (180ms) for a state change you caused — a cell filling, a chip
appearing; `--t-slow` (320ms) for feedback the game gives you — a solved word
flashing, a wrong cell tinting; `--t-move` (420ms) for something changing
place, like a league-table row, slow enough to be followed by eye. `--ease`
for things arriving, `--ease-in` for things leaving.

**Every transition and animation uses a token duration.** Under
`prefers-reduced-motion` the tokens collapse to `0ms` in one place, so a game
that uses them honours the preference without remembering to.

## Focus

Every control shows `--ring` on `:focus-visible`. It is a two-tone shadow —
paper, then pitch — so it reads on a green button and on a white cell alike.
A control with no focus state is a control a keyboard player cannot find.

## What stays out

No crests, no badges, no club colours as identifiers, no league branding.
Text only. The family is recognisable by its type and its green, and by the
same page appearing whichever game you open.
