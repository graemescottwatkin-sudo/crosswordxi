/* sources.js — the citation behind a solved clue, and the rule about which
 * ones a player is shown.
 *
 * WHY A CLUE HAS A SOURCE AT ALL. Sourcing is the owner's one standing rule,
 * and the bank keeps it: every live row carries `source` (one to three URLs),
 * `sourceName` (the publisher, as a label) and `prov` (an editorial
 * provenance note). The daily boards embed the whole bank row in their
 * payload, so the citation has been in the database all along — it simply
 * never left the server, because publicPuzzle() rebuilds each row from a
 * whitelist that does not include it.
 *
 * IT IS RELEASED ON SOLVE, NEVER WITH THE BOARD. Around one row in
 * seventeen has the answer inside its own URL — the international-caps clues
 * are sourced to per-player pages, so Buffon's clue cites a page named after
 * him. Sending citations down with the board would hand those answers over.
 * So a source is returned by /api/verify and /api/check-answer at the moment
 * an entry is confirmed correct, which is the same rule HiLo already keeps
 * for its per-call sources.
 *
 * WHICH SOURCES ARE SHOWN. A private record of where a fact came from and a
 * link put in front of a player are different things. The bank cites
 * bookmakers on 224 live rows and a user-editable wiki on 132 more, which is
 * fine as provenance and not fine as a link on a football puzzle that
 * children play. So this is an ALLOWLIST, not a denylist: a domain nobody has
 * approved shows no link at all. A gap is a gap; a link to a betting site is
 * a decision nobody made. The rule lives on the server so a browser never
 * receives a URL it is not allowed to show, whatever the page does with it.
 *
 * The list grows by asking. As the bank's own re-sourcing lands the shown
 * proportion rises without a line of this changing.
 */

/* Hosts a citation may be shown for. Matched on the registrable host and its
   subdomains, so "en.wikipedia.org" is covered by "wikipedia.org". */
export const SOURCE_HOSTS = [
  /* Reference */
  "wikipedia.org", "britannica.com",
  /* Football records and statistics */
  "rsssf.org", "theanalyst.com", "footballcritic.com", "transfermarkt.com",
  "transfermarkt.co.uk", "worldfootball.net", "11v11.com", "soccerbase.com",
  /* Competitions and governing bodies */
  "uefa.com", "fifa.com", "premierleague.com", "efl.com", "thefa.com",
  "laliga.com", "bundesliga.com", "legaseriea.it", "ligue1.com",
  "concacaf.com", "conmebol.com", "cafonline.com", "the-afc.com",
  /* Players' bodies */
  "thepfa.com", "irishfa.com",
  /* Official club sites. Named one at a time because "an official club site"
     is not a pattern anything can derive, and a wrong guess here is a link
     to somebody else's domain. */
  "mancity.com", "manutd.com", "arsenal.com", "chelseafc.com", "liverpoolfc.com",
  "evertonfc.com", "newcastleunited.com", "tottenhamhotspur.com", "avfc.co.uk",
  "wolves.co.uk", "westham.com", "brightonandhovealbion.com", "cpfc.co.uk",
  /* Football data and records */
  "soccerway.com", "fotmob.com", "lfchistory.net", "fa-cupfinals.co.uk",
  /* Broadcasters and press */
  "bbc.co.uk", "bbc.com", "skysports.com", "theguardian.com", "telegraph.co.uk",
  "independent.co.uk", "espn.com", "global.espn.com", "nbcsports.com",
  "reuters.com", "apnews.com", "theathletic.com", "si.com", "cbssports.com",
  "bbci.co.uk", "goal.com", "90min.com", "football365.com", "planetfootball.com",
  "teamtalk.com",
];

/* Explicitly refused, and why, so the next person does not have to guess:
   these are the two kinds of citation that are sound in a private record and
   unsound as a link shown to a player. Nothing depends on this list — the
   allowlist above already refuses anything it does not name — but a domain
   that was considered and rejected should say so rather than look forgotten. */
export const SOURCE_REFUSED = {
  "bet365.com": "a bookmaker; not a link to put in front of a player",
  "paddypower.com": "a bookmaker; not a link to put in front of a player",
  "fandom.com": "anyone can edit it, so it cannot carry a citation publicly",
};

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch (e) { return null; }
}

/* Is this a URL a player may be sent to? Subdomains count: news.bbc.co.uk is
   bbc.co.uk, and a host is only allowed if it IS an allowed host or ends with
   a dot and one — so "notwikipedia.org" and "wikipedia.org.evil.com" are not. */
export function showableUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return SOURCE_HOSTS.some((ok) => host === ok || host.endsWith("." + ok));
}

/* The citation for a bank row, as a player may see it, or null.
 *
 * ALL of a row's URLs must be showable, not merely the first. A row citing
 * Wikipedia and a bookmaker is a row whose claim rests partly on the
 * bookmaker, and showing the acceptable half of it presents a fuller
 * provenance than the row actually has.
 *
 * One link out of up to three: the label is the publisher, which the bank
 * writes to describe the row's sources as a whole, and the href is the first.
 * `prov` is not returned at all — it is an editorial value, and "VERIFIED
 * FIRST-HAND" in front of a player invites a question the page cannot answer. */
export function publicSource(row) {
  if (!row) return null;
  const urls = Array.isArray(row.source) ? row.source
    : (typeof row.source === "string" && row.source ? [row.source] : []);
  const name = typeof row.sourceName === "string" ? row.sourceName.trim() : "";
  if (!urls.length || !name) return null;
  if (!urls.every(showableUrl)) return null;
  return { name, url: String(urls[0]) };
}

/* ---- BEHIND AN ACCOUNT, AND CAPPED ------------------------------------
 *
 * The owner's rule, in their words: "i dont mind sharing sources but i dont
 * want it mass requested by a single user." So a citation is no longer
 * something the page is handed on solve — it is something an ACCOUNT asks
 * for, one press at a time, counted, with a ceiling of fifty a day.
 *
 * WHAT A SIGNED-OUT PLAYER IS TOLD. That a source EXISTS, and nothing else:
 * no publisher, no host, no link. The publisher label alone would be harmless
 * on almost every row and this is not a rule worth being almost right about —
 * a name that happened to carry an answer would leak it to everyone, forever,
 * and nobody would know. `locked` is the whole message.
 *
 * The number lives here beside the allowlist, because "how many sources may
 * one account open" and "which sources may anyone see" are the same subject
 * and drift apart the moment they are written in two files. */
export const SOURCE_PRESSES_A_DAY = 50;

/* What travels with a verdict when the asker may not have the link. Shaped so
   the page can tell three states apart without guessing: no citation at all
   (null), one it may show (name + url), and one it may not yet (locked). */
export function lockedSource(row) {
  return publicSource(row) ? { locked: true } : null;
}

/* The count for an account today, the ceiling, and whether it has room. Read
   by the endpoint that hands a link over and by anything that wants to show a
   player what they have left. Without a database there is no counting and so
   no cap — the same rule the rest of the family keeps. */
export async function pressesToday(env, userId, day) {
  if (!env || !env.DB || !userId || !day) return 0;
  try {
    const row = await env.DB.prepare(
      "SELECT presses FROM source_press WHERE user_id = ? AND day = ?")
      .bind(String(userId), String(day)).first();
    return Math.max(0, Number(row && row.presses) || 0);
  } catch (e) { return 0; }
}

/* One press, counted. Returns what the account has used AFTER this one, or
   null if it had none left — so the caller cannot hand over a link and forget
   to count it, which is the shape of every rate limit that quietly does not.
   The increment is ON CONFLICT rather than read-then-write: two presses
   landing together must not both read 49 and both write 50. */
export async function takePress(env, userId, day) {
  if (!env || !env.DB || !userId || !day) return null;
  const used = await pressesToday(env, userId, day);
  if (used >= SOURCE_PRESSES_A_DAY) return null;
  try {
    await env.DB.prepare(
      `INSERT INTO source_press (user_id, day, presses, last_at)
            VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, day)
       DO UPDATE SET presses = presses + 1, last_at = datetime('now')`)
      .bind(String(userId), String(day)).run();
  } catch (e) { return null; }
  return used + 1;
}
