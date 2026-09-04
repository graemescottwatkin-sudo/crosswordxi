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
 *   crossword   matchday number   /crossword/daily/12
 *   scrambled   board number      /scrambled/daily/12
 *   wordsearch  the day it ran    /wordsearch/daily/2026-09-03
 *   hilo        the day it ran    /hilo/daily/2026-09-03
 *
 * Two games count matchdays and two schedule by date; that is what their data
 * is, and inventing a common key would have meant a second identity for every
 * board and a mapping to keep in step. `/answers/<no>` already addresses a
 * crossword board by its number, and this agrees with it.
 *
 * WHAT THE ROUTE DOES NOT DO. It does not know whether a board EXISTS — that
 * needs the bank, and a database read on every page load to answer a question
 * the game answers a moment later anyway. It refuses what it can be sure of
 * without asking: a key of the wrong shape, and a key in the future. A
 * well-formed past key with no board behind it opens the game, which says so.
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

export const permalinkPath = (game, key) => `/${game}/daily/${key}`;

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
  const head = `<base href="/${game}/">`;
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

  const shell = await env.ASSETS.fetch(new URL(`/${game}/`, url.origin));
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
