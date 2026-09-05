/* permalink.js — one URL, one puzzle, forever.
 *
 * WHY THIS EXISTS. The archive could browse the past but could not ADDRESS it:
 * every board in every game answered to the same URL, so a link posted on the
 * 3rd pointed at a different puzzle by the 10th. A Reddit thread, its comments
 * and its scores all came unstuck from the board they were about. The owner's
 * requirement is the whole of the design: one URL, one puzzle, forever.
 *
 * THE SHAPE, for every game in the family:
 *
 *   /<game>/daily          302 to today's permalink
 *   /<game>/daily/<key>    that puzzle, permanently
 *
 * The key is whatever the game ALREADY calls a board, never a new name for it:
 *
 *   crossword   matchday number   /football/crossword/daily/12
 *   scrambled   board number      /football/scrambled/daily/12
 *   wordsearch  the day it ran    /football/wordsearch/daily/2026-09-03
 *   hilo        the day it ran    /football/hilo/daily/2026-09-03
 *
 * Two games count matchdays and two schedule by date; that is what their data
 * is, and inventing a common key would have meant a second identity for every
 * board and a mapping to keep in step. `/answers/<no>` already addresses a
 * crossword board by its number, and this agrees with it.
 *
 * WHETHER A BOARD EXISTS, and why that changed on 4 Sep 2026.
 *
 * This said the route deliberately did not check — that it needed the bank,
 * and a database read on every page load to answer a question the game answers
 * a moment later anyway, so a well-formed past key with no board behind it
 * opened the game, which said so. That reasoning holds for a PLAYER. It does
 * not hold for a crawler, and the two use the same URLs.
 *
 * A numbered game is bounded: keys run 1 to today. A game keyed by DATE is
 * not, and /football/wordsearch/daily/2020-01-01 answered 200 with a self-referencing
 * canonical, as did /football/hilo/daily/1999-12-31 — an unbounded set of
 * near-identical pages each claiming to be the permanent address of a board
 * that never ran. Crawl budget is finite and those pages would spend it, which
 * makes this worse for search than having no board links at all.
 *
 * So the date games now ask their own schedule, and a day with no board gets
 * the same identical 404 a future key gets. That IS a database read per page
 * load, for two of the five games — one indexed lookup on a schedule table,
 * paid to keep an unbounded URL space off the index. The numbered games ask
 * nothing, because for them there was never a question.
 */
import { dailyNumber, dailyDayKey, utcDay } from "./daily.js";

/* THE GAMES, and the one thing that differs between them: what a board is
   called. `kind` decides the shape of the key, how today's is computed and
   how a day is said out loud. */
export const PERMA_GAMES = {
  crossword: { name: "Crossword XI", kind: "number" },
  wordsearch: { name: "Wordsearch XI", kind: "date" },
  scrambled: { name: "Scrambled XI", kind: "number" },
  hilo: { name: "HiLo XI", kind: "date" },
  /* The same ring as Scrambled read half a turn round, so the same key shape
     and a different board behind every number. */
  vowels: { name: "Vowels XI", kind: "number" },
};

/* WHAT A BOARD IS CALLED OUT LOUD: the day it ran, in every game.
   Not the number, even where the number is the key. "Matchday 5" was the
   first draft and it was wrong twice over — the crossword reserves that word
   for boards inside a season and calls the rest "Today's puzzle", so a share
   preview would have named a thing the page itself never says. The date is
   what the board's own strap shows, it is true of all four games, and it is
   what somebody following a link from a thread posted last Tuesday actually
   wants to read. */
export function keyLabel(game, key) {
  const g = PERMA_GAMES[game];
  if (!g) return String(key);
  return dayLabel(g.kind === "number" ? dailyDayKey(key) : key);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];

/* "3 September 2026". Built from the string's own parts rather than a Date,
   because a Date built from an ISO day is UTC midnight and any formatter that
   applies a timezone can move it to the day before. */
function dayLabel(key) {
  const [y, m, d] = String(key).split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month} ${y}` : key;
}

/* Today's key for a game, from the SERVER's clock. The same rule the game
   itself uses: a matchday number from the family epoch, or the UTC day. */
export function todayKeyFor(game, now = Date.now()) {
  const g = PERMA_GAMES[game];
  if (!g) return null;
  return g.kind === "number" ? String(dailyNumber(now)) : utcDay(now);
}

/* Is this a key this game could ever have had, and is it not in the future?
   Returns the canonical form of the key, or null. Canonical matters: "007"
   and "7" would otherwise be two URLs for one board, which is the whole
   thing this file exists to prevent. */
export function validKey(game, raw, now = Date.now()) {
  const g = PERMA_GAMES[game];
  if (!g || raw == null) return null;
  const s = String(raw).trim();
  const today = todayKeyFor(game, now);
  if (g.kind === "number") {
    /* Leading zeros are accepted and then corrected by the 301 in the route:
       a bot that pads its numbers gets one board at one address rather than
       "07" and "7" both serving matchday seven. */
    if (!/^0*[1-9][0-9]{0,5}$/.test(s)) return null;
    const n = Number(s);
    return n <= Number(today) ? String(n) : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  /* A real date, and the one it claims to be: 2026-02-31 parses to March. */
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s <= today ? s : null;
}

/* ---- AND DID THE GAME ACTUALLY RUN THAT DAY? ----
 *
 * validKey above answers "could this key ever have been a board, and is it not
 * in the future". For a numbered game that is the whole question: the ring
 * wraps, so every number from 1 to today resolves to a board. For a game keyed
 * by DATE it is not, and the gap was an unbounded set of crawlable pages —
 * /football/wordsearch/daily/2020-01-01 and /football/hilo/daily/1999-12-31 both answered 200
 * with a self-referencing canonical, for any past date anybody typed. Hundreds
 * of thousands of near-identical pages, each claiming to be the permanent
 * address of a board that never existed. Worse for search than having no board
 * links at all, because crawl budget is finite and those pages would spend it.
 *
 * The route's own 404 already said it refused a key that was "simply not a
 * board". It did not. This is that sentence made true.
 *
 * Asked of each game's own schedule, because the schedule is where the answer
 * lives. Without a database there is nothing to ask, and the honest answer is
 * yes — the same rule the rest of the family keeps, and the sample banks the
 * offline suites run against would otherwise all 404. */
export async function ranOn(env, game, key) {
  const g = PERMA_GAMES[game];
  if (!g) return false;
  if (g.kind === "number") return true;
  if (!env || !env.DB) return true;
  try {
    if (game === "wordsearch") {
      const row = await env.DB.prepare("SELECT 1 AS n FROM ws_schedule WHERE day = ?")
        .bind(String(key)).first();
      return !!row;
    }
    if (game === "hilo") {
      const row = await env.DB.prepare("SELECT 1 AS n FROM hl_schedule WHERE day = ?")
        .bind(String(key)).first();
      return !!row;
    }
  } catch (e) {
    /* The table is absent or unreadable. Refusing every board on a database
       error would take an entire game's archive off the site for a fault that
       has nothing to do with the board asked for. */
    return true;
  }
  return true;
}

/* ---- WHERE A GAME LIVES ----
 *
 * The theme is the first segment of every game's URL, added on 4 Sep 2026 when
 * the owner said other kinds of quiz are coming — Friends, Game of Thrones —
 * and that they will not use football's scoring. XI is three meanings and none
 * of them is football: eleven clues, eleven games, eleven players to a team.
 *
 * ONE PLACE, and this is it. The move rewrote a hundred literal paths across
 * ninety files, and every one of those was a place the theme could later be
 * wrong. Anything that BUILDS a path asks here instead, so the day a second
 * theme lands there is one function to change rather than a search to repeat.
 *
 * A lookup rather than a constant for the same reason: the second theme is
 * coming, and its games will not be football's. */
export const THEME_OF = {
  crossword: "football", wordsearch: "football", scrambled: "football",
  hilo: "football", vowels: "football", quickfire: "football",
};
export const themeOf = (game) => THEME_OF[game] || "football";
export const gamePath = (game) => `/${themeOf(game)}/${game}/`;
/* The same fact as a FILE path, for the gates and suites that read a game's
   own files off the repository. They built those paths dynamically —
   `${game}/index.html` — which no search-and-replace can see, so the move left
   a dozen of them reading a directory that no longer existed. Asked for here
   so the next move is one function again. */
export const gameDir = (game) => `${themeOf(game)}/${game}`;
export const permalinkPath = (game, key) => `${gamePath(game)}daily/${key}`;

/* The page a permalink serves is the GAME'S OWN PAGE, fetched from the static
   assets and altered in four ways. Not a copy of it: a second copy of a game's
   shell would be a second thing to keep in step with the game, and this
   project has paid for that shape more than once.
 *
 * base      the page lives at /<game>/ and every asset and link in it is
 *           relative, so without this they would resolve against
 *           /<game>/daily/ and 404. One tag, and the page runs unmoved.
 * title     what a share preview says. A bot posting eleven threads a week
 *           wants them to read "Matchday 12", not eleven identical lines.
 * canonical itself, so the permalink is the address of the puzzle.
 * description the day again, in a sentence. These pages ARE indexed — the
 *           owner's call, made knowing that the board arrives by script so
 *           the HTML a crawler is handed is the same shell every time. The
 *           title and this line are what differ, and they are the least a
 *           page should have of its own before it is offered to a crawler.
 *           The board's content-rich page is still its answers page, which
 *           has always been indexable and is where the search traffic for a
 *           board actually goes. */
export function permalinkHtml(html, { game, key, origin }) {
  const g = PERMA_GAMES[game];
  const title = `${keyLabel(game, key)} · ${g.name}`;
  const url = origin + permalinkPath(game, key);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  /* Plain string edits rather than HTMLRewriter, which exists only in the
     Workers runtime — the suite would have had to test a stand-in for it, and
     a check that exercises a stand-in proves nothing about what ships. These
     run the same in both places, against a head this repo writes and this
     repo's own test reads. A rewrite that stops matching is not silent: the
     suite asserts every one of them landed, on the real page. */
  const head = `<base href="${gamePath(game)}">`;
  const desc = `The ${g.name} board from ${keyLabel(game, key)}, playable in full. ` +
    `One address, one puzzle — this link opens this board and no other.`;
  return html
    .replace(/<head(\s[^>]*)?>/i, (m) => m + head)
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`)
    .replace(/(<link[^>]+rel="canonical"[^>]*href=")[^"]*(")/i, (m, a, b) => a + esc(url) + b)
    .replace(/(<meta[^>]+property="og:url"[^>]*content=")[^"]*(")/i, (m, a, b) => a + esc(url) + b)
    .replace(/(<meta[^>]+property="og:title"[^>]*content=")[^"]*(")/i, (m, a, b) => a + esc(title) + b)
    .replace(/(<meta[^>]+name="twitter:title"[^>]*content=")[^"]*(")/i, (m, a, b) => a + esc(title) + b)
    .replace(/(<meta[^>]+name="description"[^>]*content=")[^"]*(")/i, (m, a, b) => a + esc(desc) + b)
    .replace(/(<meta[^>]+property="og:description"[^>]*content=")[^"]*(")/i, (m, a, b) => a + esc(desc) + b);
}

/* The whole route, for every game. A game's file under functions/<game>/daily/
   is three lines and this is the behaviour, so four games cannot drift into
   four URL schemes. */
export async function permalinkRoute({ request, env, params }, game) {
  const url = new URL(request.url);
  const parts = [].concat(params && params.path ? params.path : []).filter(Boolean);

  /* NO KEY MEANS TODAY, AND TODAY DOES NOT WEAR A NUMBER.
     This bounced to /daily/9 with a 302, which put a board number in front of
     somebody who had asked for "today" — the number belongs to the archive,
     where it is the thing being pointed at. So today's board is served here,
     at the address that was asked for, and the numbered address is named in
     the canonical instead: crawlers consolidate on the permanent one, and a
     bot can read today's number from the canonical or the Link header
     without following anything. */
  const asked = parts.length === 0 ? todayKeyFor(game) : parts[0];
  if (parts.length > 1) return notFound();

  const key = validKey(game, asked);
  if (!key) return notFound();
  /* One board, one address. A key that is not in its canonical form redirects
     to the one that is, rather than serving the same board twice. Not for
     /daily itself, which is a name for today rather than a key. */
  if (parts.length === 1 && key !== parts[0]) {
    return new Response(null, {
      status: 301,
      headers: { Location: permalinkPath(game, key), "Cache-Control": "no-store" },
    });
  }

  /* A DAY THE GAME DID NOT RUN IS NOT A BOARD, and gets the same identical
     refusal a future key gets — a probe must not be able to tell which of the
     two it hit, which is the rule the answers pages already keep. */
  if (!(await ranOn(env, game, key))) return notFound();

  const shell = await env.ASSETS.fetch(new URL(gamePath(game), url.origin));
  if (!shell.ok) return notFound();
  const html = permalinkHtml(await shell.text(), { game, key, origin: url.origin });
  /* The same no-store the game's own page carries in _headers: the shell
     names its assets with a ?v= build tag, and a stale shell pins a player to
     an old build permanently. */
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      /* The permanent address of what this page is showing, readable from a
         HEAD request. /daily is today and changes at midnight; this says
         which board today turned out to be, so a bot can record the URL that
         will still mean this board next week without parsing any HTML. */
      Link: `<${url.origin}${permalinkPath(game, key)}>; rel="canonical"`,
    },
  });
}

function notFound() {
  /* One identical refusal for a key that is malformed, in the future, or
     simply not a board — the same rule the answers pages keep, so a probe
     cannot tell which of those it hit. */
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
