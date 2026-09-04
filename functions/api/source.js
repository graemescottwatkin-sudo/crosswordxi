/* POST /api/source — { token, entry, guess }  ->  the citation behind a clue
 *
 * The owner's rule: "i dont mind sharing sources but i dont want it mass
 * requested by a single user." So a citation is no longer handed down with a
 * verdict. /api/verify still says whether an entry is right and still says
 * whether a source EXISTS, but the link itself is asked for here, by an
 * account, one press at a time, counted, and capped at fifty a day.
 *
 * THE GUESS IS SENT AGAIN, AND CHECKED AGAIN. That is the whole security of
 * this endpoint. Around one row in seventeen has its answer inside its own
 * URL — the international-caps clues are sourced to per-player pages, so
 * Buffon's clue cites a page named after him — which is why a source has
 * never travelled with a board. An endpoint that handed over a citation for
 * an entry index alone would be a way to read those answers without solving
 * anything, and it would be a worse leak than the one the allowlist exists to
 * prevent. So the proof of having solved the clue is the same proof verify
 * asks for: the answer itself.
 *
 * WHAT EACH REFUSAL SAYS. Signed out is 401 and says so, because the player
 * is being asked to register and a page cannot draw that button from a 403.
 * Out of presses is 429 and names the ceiling. A wrong guess is the same
 * "correct: false" verify gives, and costs nothing — a press is spent on a
 * link handed over, never on a request made.
 */
import { normalise, json, bad } from "../_lib/puzzle.js";
import { publicSource, takePress, pressesToday, SOURCE_PRESSES_A_DAY } from "../_lib/sources.js";
import { getPuzzleForToken } from "../_lib/db.js";
import { playableDailyNo, utcDay } from "../_lib/daily.js";
import { isAdmin, currentUser, csrfOk } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!csrfOk(request)) return bad("Refused.", 403);
  let body;
  try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
  const { token, entry, guess } = body || {};

  if (playableDailyNo(token) === false && !(await isAdmin(request, env))) {
    return bad("That puzzle is not today's daily.", 403);
  }
  const stored = await getPuzzleForToken(env, token);
  if (!stored) return bad("Unknown puzzle.", 404);

  const idx = Number(entry);
  if (!Number.isInteger(idx) || idx < 0 || idx >= stored.puzzle.entries.length) {
    return bad("Unknown entry.");
  }

  /* SOLVED FIRST, ACCOUNT SECOND. Checked in this order so a wrong guess is
     told it is wrong rather than told to register: being asked to sign up for
     a link you have not earned is a worse answer than being told you are
     wrong. */
  const row = stored.puzzle.entries[idx].row;
  const answer = normalise(row.grid);
  const typed = normalise(String(guess || ""));
  if (typed.length !== answer.length || typed !== answer) return json({ correct: false });

  const src = publicSource(row);
  /* Nothing to hand over, and that is not a refusal — the row's citation is
     one the allowlist does not permit, or it has none. No press is spent. */
  if (!src) return json({ correct: true, source: null });

  const user = await currentUser(request, env);
  if (!user) {
    return json({ correct: true, needsAccount: true,
      error: "Sources are for registered players. Registering is free." }, 401);
  }

  const day = utcDay();
  const used = await takePress(env, user.id, day);
  if (used === null) {
    return json({ correct: true, capped: true, limit: SOURCE_PRESSES_A_DAY,
      used: await pressesToday(env, user.id, day),
      error: `That is ${SOURCE_PRESSES_A_DAY} sources today. The count resets at midnight UTC.` }, 429);
  }

  return json({ correct: true, source: src, used, limit: SOURCE_PRESSES_A_DAY });
}
