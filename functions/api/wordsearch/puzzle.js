/* GET /api/wordsearch/puzzle?id=XIWS-0123
 *
 * One released board, whole. The guard is the reason this endpoint exists:
 * a board whose first scheduled day is still ahead is refused with a 404 that
 * names nothing — not the theme, not the category, not whether the id exists.
 * A refusal that says "that's next Tuesday's" has already leaked what it
 * guards. Unknown id and unreleased id are the same answer on purpose. */
import { boardById, released } from "../../_lib/wsdata.js";

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
  const puzzle = await boardById(env, id);
  if (!puzzle) return json({ error: "No such board." }, 404);
  return json({ puzzle });
}
