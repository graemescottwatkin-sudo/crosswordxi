/* tracking_test.mjs — every built game counts how far people get.
 *
 *   node tools/tracking_test.mjs
 *
 * THE FAULT THIS EXISTS FOR. QuickFire was built, playable, linked and
 * completely uncounted. Not broken — never wired. The shared helper existed,
 * three games called it, and the fourth simply did not, which no suite could
 * notice because nothing anywhere said a game must. The word search had a
 * quieter version of the same gap: its free boards were counted, but the
 * server's mode chain ended in "everything else is daily", so they were
 * counted as dailies and the number read as if nobody chose a board.
 *
 * Both are the same shape — a game or a mode that ships without the counter
 * knowing about it — and both are invisible in the data, because a missing
 * row looks exactly like a board nobody opened. That is what makes this worth
 * a gate rather than a habit: the failure is silent, and the number it
 * corrupts is the one used to decide whether a game is working.
 *
 * The rule: a game on BUILT loads the helper, starts a play and ends one, and
 * every mode any game names is a mode the server will accept.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT, MODES, validPlayGame, validMode } from "../functions/_lib/games.js";
import { gameDir } from "../functions/_lib/permalink.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

let failed = 0;
const fail = (msg) => { console.log("FAIL  " + msg); failed++; };
const pass = (msg) => console.log("ok    " + msg);

/* The games, as the server understands them, are the games checked. A fourth
   game joins this suite by being built, not by being added here. */
for (const game of BUILT) {
  /* THE ID IS NOT THE DIRECTORY ANY MORE. They were the same word until the
     games moved under a theme, and `const dir = game` was true for as long as
     that held. A game is identified as "crossword" and lives at
     football/crossword; asked for rather than assumed, so the next move is one
     function and not this line again. */
  const dir = gameDir(game);

  /* THE RULE IS "A GAME YOU CAN PLAY COUNTS", not "a name in GAMES counts".
     A game under construction has a directory and a scoring module before it
     has a page, and failing on that would make this gate the thing standing
     between a half-built game and a green branch — which is how a gate gets
     deleted rather than fixed. No page means nothing to play and nothing to
     count, so it is noted and skipped. QuickFire, the fault this suite was
     written for, had a page throughout; it is caught either way. */
  if (!exists(`${dir}/index.html`)) {
    console.log(`note  ${game}: on the list but has no ${dir}/index.html yet — ` +
      `nothing to play, so nothing to count. Wire it before it opens.`);
    continue;
  }

  const html = read(`${dir}/index.html`);
  if (!/shared\/xi-plays\.js/.test(html)) {
    fail(`${game}: ${dir}/index.html does not load shared/xi-plays.js`);
  } else pass(`${game}: loads the helper`);

  /* Every script the game ships, because the call may not be in game.js. */
  const jsDir = path.join(ROOT, dir, "js");
  const js = fs.existsSync(jsDir)
    ? fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"))
        .map((f) => read(`${dir}/js/${f}`)).join("\n")
    : "";

  const startsIt = /XIPlays[.]start[\s]*[(]/.test(js);
  const namesIt = new RegExp('game:\\s*[\'"]' + game + '[\'"]').test(js);
  if (!startsIt) fail(`${game}: nothing calls XIPlays.start`);
  else if (!namesIt) fail(`${game}: calls XIPlays.start but never as game: "${game}"`);
  else pass(`${game}: starts a play under its own name`);

  if (!/XIPlays\.end\s*\(/.test(js)) {
    fail(`${game}: nothing calls XIPlays.end — a finish would never be recorded`);
  } else pass(`${game}: ends a play`);

  if (!validPlayGame(game)) {
    fail(`${game}: the server would refuse its plays (validPlayGame says no)`);
  } else pass(`${game}: the server accepts its plays`);
}

/* THE MODES, read from the games rather than trusted. A literal a game passes
   as its mode must be one the server will keep; anything else is written as
   "daily" or refused, and either way the board it names is lost. */
const seen = new Set();
for (const game of BUILT) {
  /* The directory, not the id: this loop still walked ROOT/<id>/js while the
     read below had already been moved to gameDir. It found no files, skipped
     every game, and reported "no mode literals found at all". */
  const jsDir = path.join(ROOT, gameDir(game), "js");
  if (!fs.existsSync(jsDir)) continue;
  for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith(".js"))) {
    const src = read(`${gameDir(game)}/js/${f}`);
    for (const m of src.matchAll(/XIPlays\.start\s*\(\s*\{[^}]*?mode:\s*['"]([a-z]+)['"]/g)) {
      seen.add(m[1]);
    }
    /* The games that pass a mode through a helper name it at the call site
       instead: playsStart("free", ...). */
    for (const m of src.matchAll(/playsStart\s*\(\s*['"]([a-z]+)['"]/g)) seen.add(m[1]);
  }
}
for (const mode of seen) {
  if (!validMode(mode)) fail(`mode "${mode}" is named by a game but is not in MODES`);
  else pass(`mode "${mode}" is one the server keeps`);
}
if (!seen.size) fail("no mode literals found at all — has the call shape changed?");

/* MODES itself must not rot into names nothing uses. Reported, not failed,
   and deliberately weakly: a mode a game chooses at runtime — the crossword
   passes board.kind, QuickFire passes playsMode() — is invisible to a scan
   for literals, so a name listed here may be in constant use. Failing on
   that would be a gate that punishes the better-written games. */
const unused = MODES.filter((m) => !seen.has(m));
if (unused.length) {
  console.log("note  no literal names these, which is not the same as unused: " +
    unused.join(", "));
}

console.log(failed ? `\n${failed} failed` : "\nall tracking checks passed");
process.exit(failed ? 1 : 0);
