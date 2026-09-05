/* GET /api/wordsearch/puzzle?id=XIWS-0123
 *
 * One released board, whole. The guard is the reason this endpoint exists:
 * a board whose first scheduled day is still ahead is refused with a 404 that
 * names nothing — not the theme, not the category, not whether the id exists.
 * A refusal that says "that's next Tuesday's" has already leaked what it
 * guards. Unknown id and unreleased id are the same answer on purpose. */
import { boardById, released, lastScheduledDay, isTodaysDaily } from "../../_lib/wsdata.js";
import { mayOpenArchive, archiveRefusal, daysBack } from "../../_lib/archive.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(status === 404 ? { "X-Robots-Tag": "noindex" } : {}),
    },
  });

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^XIWS-\d{4}$/.test(id)) return json({ error: "No such board." }, 404);
  if (!(await released(env, id))) return json({ error: "No such board." }, 404);

  /* AND NOT THE BOARD IN FLIGHT. This route hands a board over WHOLE — grid,
     answers, every placement — which is right for free play and was a hole
     for today's daily: released() passes a board first scheduled today, the
     archive gate saw daysBack = 0, and so `?id=<today's id>` returned the
     board every player is competing on, answers and all, to anyone who asked.
     The same identical 404 an unreleased board gets, for the same reason: a
     refusal that says WHICH rule it hit has told you something. */
  if (await isTodaysDaily(env, id)) return json({ error: "No such board." }, 404);

  /* HOW OLD IS THIS BOARD TO A PLAYER: the last day it was the daily, which
     for a board still in rotation is recent however long ago it debuted. A
     board that has never been scheduled has no age and is not gated — the
     free-play catalogue is a catalogue, not a set of back issues.

     Deliberately a different answer from the 404 above. That one refuses to
     admit a board exists, because naming an unreleased board leaks the
     schedule. This one is the opposite: the board is public, the player is
     simply being asked to register, and saying so plainly is the point. */
  const ran = await lastScheduledDay(env, id);
  if (ran !== null) {
    const back = daysBack(ran);
    if (!(await mayOpenArchive(request, env, back))) {
      return json(archiveRefusal(back), 401);
    }
  }

  const puzzle = await boardById(env, id);
  if (!puzzle) return json({ error: "No such board." }, 404);
  return json({ puzzle });
}
