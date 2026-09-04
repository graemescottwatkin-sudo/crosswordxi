/* sc-board.js — the one place a stored Scrambled XI board becomes a public
 * payload, plus the rule for which board is today's.
 *
 * Every response carrying a board goes through publicBoard(), so there is a
 * single function to audit rather than three endpoints each deciding for
 * themselves what is safe to send.
 *
 * AN HONEST NOTE ABOUT WHAT THIS CAN AND CANNOT PROTECT
 *
 * Crossword XI strips the solution letter from every cell, and that genuinely
 * hides the answer. Here it cannot: the scramble IS the name's letters,
 * sitting on screen by design. Anybody determined enough to run an anagram
 * solver against eleven letter bags will get the board out, and no server-side
 * measure changes that — it is the game.
 *
 * So this is not pretending to hide today's names. What it protects is real:
 *
 *   - the hint values, which are the priced help
 *   - the aliases, which name the exact spellings that will be accepted and
 *     would narrow a solver's search
 *   - every OTHER day's board, which is the leak that actually matters and is
 *     handled by playableToken() before this is ever reached
 */
import { dailyNumber } from "./daily.js";
import { SC_BOARDS } from "./sc-boards.js";

/* THE TOKEN. Scrambled XI's own prefix, parsed beside the rotation that

/* THE BOARDS COME FROM D1 WHEN IT IS BOUND, AND FROM THE MODULE WHEN IT IS NOT.
   Boards began life generated into sc-boards.js and read from there. That is
   gated and correct, but it makes changing a board a DEPLOY — a typo in an XI
   waits for a release, and every board that ever shipped stays in the history.
   The other three games keep their content in D1 for that reason: changing a
   question is an import, not a deploy.

   The fallback is the SAME boards, not sample data, so falling back is not a
   quiet lie the way a sample crossword would be — but it is still a different
   answer, so the payload says which one it gave. The word search learned this
   the hard way: hasDB() falling back looked exactly like a working game with a
   small bank, and nothing was reading the tell. */
export function hasDB(env) { return !!(env && env.DB); }

export async function loadBoards(env) {
  if (!hasDB(env)) return { boards: SC_BOARDS, source: "module" };
  try {
    const { results } = await env.DB
      .prepare("SELECT payload FROM sc_board ORDER BY id").all();
    const rows = (results || [])
      .map((r) => { try { return JSON.parse(r.payload); } catch (e) { return null; } })
      .filter(Boolean);
    /* An empty table is the un-imported state, not an empty bank. Serving no
       board at all there would take the game down for a missing import; the
       module is the honest answer, and `source` says so. */
    if (rows.length) return { boards: rows, source: "d1" };
  } catch (e) { /* table absent, or unreadable: fall through to the module */ }
  return { boards: SC_BOARDS, source: "module" };
}

/* THE LAST-TWO BOARDS, WHICH ARE NOT THE BANK. Each current club's last two
   league games — a set that goes stale every round and is replaced whole, so
   it lives in its own table rather than among boards that never change, and
   it has no module to fall back to: a stale fallback would be worse than an
   empty list. Nothing here ever reaches the daily ring. */
export async function loadLast2(env) {
  if (!hasDB(env)) return { boards: [], source: "none" };
  try {
    const { results } = await env.DB
      .prepare("SELECT payload FROM sc_last2 ORDER BY club, gameweek").all();
    const rows = (results || [])
      .map((r) => { try { return JSON.parse(r.payload); } catch (e) { return null; } })
      .filter((b) => b && b.type === "prem-last2");
    return { boards: rows, source: "d1" };
  } catch (e) { /* table absent, or unreadable: an empty set, said so */ }
  return { boards: [], source: "none" };
}
/* THE TOKEN. Scrambled XI's own prefix, parsed beside the rotation that
   composes it — the entrant-key fault costs this project a release every time
   a key is built in one file and read in another. Crossword XI uses `daily:`
   and the word search uses `ws:`; a third game inventing a fourth spelling of
   "which board" is how they end up disagreeing. */
export const scKey = (n, mode) => "sc:" + (mode === "consonants" ? "c:" : "") + n;

/* WHICH CYPHER A TOKEN ASKS FOR, for the daily and the finals alike.
   Anything unrecognised is the anagram, which is what every token issued
   before this existed meant — so a token already sitting in somebody's
   localStorage still means what it meant when it was written. */
export function tokenCypher(token) {
  return /^sc:(?:iconic:)?c:\d+$/.test(String(token || "")) ? "consonants" : "anagram";
}

/* THE DAILY RING IS THE ELIGIBLE BOARDS, NOT THE WHOLE BANK.
   Not every board belongs in a daily. Some are simply too hard to be anyone's
   Tuesday — a 1963 side of eleven names most players have never read — and a
   daily that hands those out burns the streak it exists to build. A board can
   be in the bank, playable, and out of the rotation.

   `daily: false` in the source takes a board out. Anything not saying so is in,
   so the flag is opt-OUT: a board added without an opinion behaves the way
   every board did before this existed, and nobody has to remember to mark 262
   files.

   THE ID IS NOT THE RING POSITION. Taking a board out shifts every later board
   in the rotation by a day, which is why proofing links address boards by id
   through the admin route and only the daily uses this. */
/* THE FLAG, SAID ONCE. `daily: false` is what takes a board out of the
   rotation, and two places now care: the ring, which must skip it, and the
   finals catalogue, which is made of exactly the boards the ring skips.
   Written twice they would disagree the first time the flag changed spelling. */
export function outOfRotation(board) { return !!board && board.daily === false; }

export function dailyRing(boards) {
  const all = boards && boards.length ? boards : SC_BOARDS;
  const ring = all.filter((b) => b && !outOfRotation(b));
  /* Every board excluded is a bank nobody can play a daily from. Falling back
     to the whole bank is the honest failure: a wrong board beats no game. */
  return ring.length ? ring : all;
}

/* Which board is board number N. The bank is a ring: with a small bank the
   rotation repeats, and it repeats visibly rather than pretending not to. */
export function boardForNumber(n, boards, mode) {
  const ring = dailyRing(boards);
  if (!Number.isInteger(n) || n < 1 || !ring.length) return null;
  /* HALF A TURN AWAY, so the two games never show one eleven on one day and
     a board's turn in the other game is half a year off. It cannot collide,
     because it collides only where the offset is zero — which is why this is
     an offset and not a stride: a stride of 457 is fine on 911 boards and
     collides on EVERY day at 912, and the ring length is not ours to fix.
     An offset of one would satisfy the rule and break the spirit of it:
     tomorrow's board would be today's, in the other cypher. */
  const turn = mode === "consonants" ? Math.floor(ring.length / 2) : 0;
  return ring[(n - 1 + turn) % ring.length];
}

/* TEST MODE — THE WHOLE BANK IS PLAYABLE, AND THIS MUST BE FLIPPED BEFORE
   LAUNCH.
   The rule below is the right one for a live game: the past is open so somebody
   arriving in November can catch up a missed day, and the future is shut
   because opening it gives away everything. Scrambled is not live — it is
   unlaunched, unlinked, and being played by its owner against a thirty-board
   test bank where "the future" is simply the boards nobody has reached yet.
   Enforcing the daily rule there makes twenty-five of thirty boards unplayable
   for no benefit: there is no schedule to protect and no player to protect it
   from.
   Named rather than hidden in a condition, so it is greppable, and asserted by
   board_test so it cannot be left true by accident the day this game ships. */
const OPEN_ARCHIVE = false;

/* WHETHER THE CONSONANT BOARDS ARE PUBLIC. THEY ARE, SINCE 4 SEP 2026.
   They became Vowels XI, the fifth shirt, at /vowels/ — the same eleven names
   and the same bank as Scrambled, with the letters left in their own order and
   the vowels taken out instead of the whole name shuffled.
   It was false for as long as the game was being built, and false did not mean
   absent: the boards built, stored and served, but only to a signed-in admin,
   so the owner could test on the live site while nobody else could reach it.
   Named rather than hidden in a condition so it is greppable, and asserted by
   the suite so it cannot be flipped by accident — exactly as OPEN_ARCHIVE
   above, which is the fault this pattern was invented for. */
const CONSONANTS_PUBLIC = true;
export function consonantsPublic() { return CONSONANTS_PUBLIC; }

/* Any board up to today, never one after it. The past is open — somebody
   arriving in November must be able to catch up a missed day — and the future
   is shut, because opening it gives away everything. The SERVER decides what
   day it is; a number sent up from a browser is a number off a clock the
   player controls. */
export function playableTokenNo(token) {
  /* The optional c: says which cypher. It does not change WHICH DAY, and it
     must not change when a board becomes playable: one rule, one place. */
  const m = /^sc:(?:c:)?(\d+)$/.exec(String(token || ""));
  if (!m) return null;
  const asked = Number(m[1]);
  if (asked < 1) return false;
  /* The ring wraps, as it always has, so any positive number resolves to a
     board. No bound is invented here: this function is given a token, not the
     bank, and a limit it cannot check is a limit that lies. */
  if (OPEN_ARCHIVE) return asked;
  return asked <= dailyNumber() ? asked : false;
}

export function boardForToken(token, boards) {
  const no = playableTokenNo(token);
  /* WITH THE TOKEN'S OWN CYPHER. Without this a consonant token would mark a
     guess against the anagram's board for that day, which is a different
     eleven — the tile on screen and the answer being checked would not be
     the same board. */
  if (typeof no === "number") return boardForNumber(no, boards, tokenCypher(token));
  /* A finals token resolves here rather than in guess.js and reveal.js, which
     is the difference between one rule and two copies of it. */
  return boardForIconicToken(token, boards);
}

/* THE OWNER'S PREVIEW TOKEN, which is a different thing from a play token.
   A play token names a position in the daily ring and is refused past today —
   "the future is shut". The preview names a BOARD BY ID, because ring position
   moves whenever a board is marked out of rotation.

   It had to be a separate spelling. The preview first issued sc:1001 and the
   board loaded but would not accept a guess, because playableTokenNo saw 1001
   against today's 5 and refused it — and had it not, boardForNumber would have
   read 1001 as a ring position and wrapped to an entirely different board. One
   token shape cannot mean both things.

   Carries no authority of its own: every endpoint that accepts it re-checks
   the admin flag against the database on that request. */
export const previewKey = (id) => "sc:preview:" + id;

export function boardForPreviewToken(token, boards) {
  const m = /^sc:preview:(\d+)$/.exec(String(token || ""));
  if (!m) return null;
  const id = Number(m[1]);
  return (boards || []).find((b) => Number(b.id) === id) || null;
}

/* THE FINALS, WHICH ARE ADDRESSED BY ID AND OPEN TO EVERYONE.
 *
 * Five hundred and forty-three boards sit outside the daily rotation — every
 * cup and play-off final in the bank, both XIs of each. They have been in the
 * database since the import and no address reached them: the daily token names
 * a ring position and the ring is exactly the boards these are not, so a third
 * token shape was the only way in.
 *
 * WHY THIS ONE IS SAFE TO OPEN WHERE THE PREVIEW IS NOT. The preview token
 * takes ANY board by id and therefore has to re-check the admin flag on every
 * request — given away, it would hand over tomorrow's daily. This one resolves
 * only boards out of the rotation, and a board out of the rotation is never
 * served as a daily on any date. So there is no schedule for it to leak, and
 * it needs no authority at all. The guard is the whole reason it can be
 * public, which is why it is here and not in the endpoint: the play routes go
 * through boardForToken and inherit it rather than restating it. */
export const iconicKey = (id, mode) => "sc:iconic:" + (mode === "consonants" ? "c:" : "") + id;

export function boardForIconicToken(token, boards) {
  const m = /^sc:iconic:(?:c:)?(\d+)$/.exec(String(token || ""));
  if (!m) return null;
  const id = Number(m[1]);
  const board = (boards || []).find((b) => Number(b.id) === id) || null;
  return outOfRotation(board) ? board : null;
}

/* WHAT A CATALOGUE ROW SAYS, and why each part of it is there.
 *
 * `title` is the fixture — "European Cup final, 1977". `side` is which of the
 * two XIs this board is, taken from the pool line the start card already
 * shows: without it the list carries "World Cup final, 1986" twice with
 * nothing to choose between them. Together they are unique across all 543.
 *
 * `comp` and `year` are derived here rather than in the page, so the grouping
 * is one statement rather than one per caller. A title that does not parse
 * keeps its row and simply has no competition — it is a real board and being
 * unable to file it is not a reason to hide it. */
const FINAL_TITLE = /^(.+?) final, (\d{4})$/;
const SIDE_IN_POOL = /^(.+?)(?:’s|'s) starting XI\b/;

export function iconicRow(board) {
  const title = String(board.title || "");
  const t = FINAL_TITLE.exec(title);
  const s = SIDE_IN_POOL.exec(String(board.pool || ""));
  return {
    id: board.id,
    title,
    side: s ? s[1] : null,
    comp: t ? t[1] : null,
    year: t ? Number(t[2]) : null,
  };
}

/* Nothing but the five fields above: slots would put the whole bank in one
   response, which is the fault the owner's list route already refused. */
export function iconicList(boards) {
  return (boards || []).filter(outOfRotation).map(iconicRow);
}

/* `no` is the board's place in the daily ring, or null for a board that has
   no place in it. `token` is what the page must send back to play; it defaults
   to the daily spelling, because that is what a numbered board is.
 *
 * THE DEFAULT USED TO BE THE ONLY OPTION, AND IT BROKE THE OWNER'S PREVIEW.
 * The admin route passes previewKey(id) — and passed it as `no`, so the page
 * was handed no: "sc:preview:1424" and token: "sc:sc:preview:1424", which
 * matches neither token shape. The board loaded and every guess came back 403.
 * The comment above previewKey describes fixing exactly this; the fix reached
 * the caller and stopped one line short of here. Hence a token argument: a
 * board that is not a daily says what to call it, rather than having a daily's
 * name computed over the top of the one it was given. */
export function publicBoard(board, no, token) {
  /* WHICH CYPHER, READ OFF THE TOKEN IT WAS ASKED WITH. The token already
     says which board and which way; a separate argument would be one fact in
     two places, and this file carries three comments about that fault. */
  const consonants = tokenCypher(token || scKey(no)) === "consonants";
  /* ONE CYPHER PER PAYLOAD, NEVER BOTH. The scramble beside the blanks would
     hand a consonant player the enumeration and an anagram player the vowel
     positions: each mode's difficulty is the other's giveaway. */
  const slots = (board.slots || []).map((s) => ({
    id: s.id,
    band: s.band,          // which line of the formation this slot sits on
    x: s.x,                // where along that line, 0..1
    pos: s.pos,            // GK / RB / CM / ST — shown, and part of the puzzle
    ...(consonants ? {
      cy: s.cy,            // the name with its vowels blanked, which is the point
      /* A NO-VOWEL NAME RIDES DOWN IN FULL, because its cypher IS the name and
         no arrangement of this game hides it. Said out loud rather than
         leaked: the tile starts solved and the client is told so. */
      ...(s.presolved ? { presolved: true, name: revealName(s) } : {}),
    } : {
      scramble: s.scramble,  // the letters, which are the point
      len: s.len,            // word lengths, e.g. [3, 4] for VAN DIJK
    }),
  }));

  return {
    no,
    token: token || scKey(no),
    /* WHICH CYPHER THIS IS, said by the server. The client reads this and
       never parses the token it was handed. */
    cypher: consonants ? "consonants" : "anagram",
    title: board.title,
    pool: board.pool,            // the visible statement of what the XI is
    formation: board.formation,
    bands: board.bands,          // band ids and their vertical placement
    hintField: board.hintField,  // which hint this board sells; not the values
    hintLabel: hintLabel(board),  // null when the bench has nothing to sell
    /* A last-two board's identity is its fixture, and the fixture is the hint,
       so it rides in the open: the club, the round, when and where. Nothing
       per player — shirts and armbands are facts about a name and come out
       with the name. Absent on every other board rather than null. */
    ...(board.type === "prem-last2" ? {
      type: board.type, club: board.club, gameweek: board.gameweek,
      kickoff: board.kickoff, venue: board.venue,
    } : {}),
    slots,
  };
}

/* THE HINT FIELD IS A PROPERTY OF THE BOARD, NOT OF THE GAME
 *
 * "Reveal club" was the priced hint until the draft's own suite pointed out
 * that the launch board is Manchester United's 1999 side — where the pool
 * statement already says Manchester United, so the hint returns something the
 * player has been looking at since kick-off. Eleven purchases of nothing.
 *
 * A hint has to vary across the eleven or it is not information. Every board
 * therefore names its own field, and the builder refuses a board whose chosen
 * field reads the same for all eleven slots. A club XI hints nationality; a
 * national XI or a Team of the Year hints club. */
/* THE HINT, WHICH IS NOT ALWAYS ONE WORD.
   A lineup board sells the club a player was at THAT DAY, or their nationality
   — one value either way. A Daily board is a selection rather than a team, so
   the club-on-the-day means nothing, and what it sells instead is the whole
   career: Giggs reads "Manchester United", Beckham reads six clubs.

   Those are different facts and the slot carries both. `club` is club-at-the-
   time and belongs to lineup boards; `clubs` is the ordered career and belongs
   to the Daily. Collapsing them would put Ball at Everton in the 1966 final,
   which is the exact error that board's notes were written to prevent.

   Loans are marked rather than dropped: a season away is part of a career, and
   a history that silently omits it reads as wrong to anyone who remembers. */
export function slotHint(board, slotId) {
  const s = (board.slots || []).find((x) => String(x.id) === String(slotId));
  if (!s) return null;
  if (board.hintField === "none") return null;
  if (board.hintField === "clubs") {
    const spells = s.clubs || [];
    if (!spells.length) return null;
    return spells
      .map((c) => c.club + (c.loan ? " (loan)" : ""))
      /* One club named once, however many spells: Bosnich returned to United
         and "Manchester United, Aston Villa, Manchester United" reads as a
         mistake rather than as a career. The order is kept, so a return still
         sits where it happened. */
      .filter((name, i, all) => all.indexOf(name) === i)
      .join(" · ");
  }
  return board.hintField === "club" ? (s.club || null) : (s.nationality || null);
}
/* WHETHER THE BENCH HAS A HINT TO SELL. Read off the slots, not off the
   declaration: a board declaring "none" sells nothing, and so does a
   last-two board that declares "clubs" while no player carries a career —
   the club and the fixture are on its start card, and that is its hint. A
   label on a button that returns nothing is a purchase of nothing, which is
   the fault the hint rule was written against in the first place. */
export function sellsHint(board) {
  if (!board || board.hintField === "none") return false;
  return (board.slots || []).some((s) => slotHint(board, s.id));
}
export function hintLabel(board) {
  if (!sellsHint(board)) return null;
  if (board.hintField === "clubs") return "Reveal career";
  return board.hintField === "club" ? "Reveal club" : "Reveal nationality";
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      /* Boards are per-day and per-request; never let a shared cache hold one. */
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

export function bad(message, status = 400) {
  return json({ error: message }, status);
}

/* THE NAME A PLAYER IS ALLOWED TO SEE, in one place because two endpoints
   hand it over — a correct guess and a bought reveal — and a board that
   read GARY LINEKER one way and LINEKER the other would be the same fact
   told twice and drifting. The cypher is the puzzle; this is the answer. */
export function revealName(slot) {
  return String((slot && (slot.display || slot.name)) || "");
}

/* THE CLUBS A SOLVED PLAYER IS KNOWN FOR, most-appeared first.

   SPELLS ARE SUMMED PER CLUB, NOT LISTED. Bosnich went United, Villa, then
   United again — 3 apps and 23. Counted as two entries, each spell loses to
   any single bigger one and the player's actual second club is pushed off a
   two-line summary by a club he played three games for. A hundred and
   twenty-one of the three hundred and thirty players in the bank have a
   repeat club, so this is the common case, not the corner.

   A total of zero means nobody recorded the appearances, not that the player
   never played: twenty-four spells in the bank carry no count. The number is
   left off those rather than printed as 0, which would be a claim the data
   does not make. Ordering is stable, so clubs level on appearances stay in
   career order. */
export function topClubs(slot, max) {
  const cap = typeof max === "number" ? max : 2;
  const byClub = new Map();
  /* THE REVEAL READS premClubs, NOT THE CAREER. They are different facts and
     the board author sends both: clubs is the whole career and it is what the
     bench SELLS as a hint; premClubs is the Premier League only and it is what
     a solved tile SAYS. Whelan bought as a hint reads Home Farm, Liverpool,
     Southend; Whelan solved reads Liverpool.

     Falls back to the career where a board carries no premClubs, so a board
     authored before the split still names something rather than nothing. */
  for (const spell of (slot && (slot.premClubs || slot.clubs)) || []) {
    if (!spell || !spell.club) continue;
    const at = byClub.get(spell.club) || { club: spell.club, apps: 0 };
    if (typeof spell.apps === "number" && spell.apps > 0) at.apps += spell.apps;
    byClub.set(spell.club, at);
  }
  return [...byClub.values()].sort((a, b) => b.apps - a.apps).slice(0, cap);
}
