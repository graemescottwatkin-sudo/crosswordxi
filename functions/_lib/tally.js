/* Counting the help the server itself served.
 *
 * A play id arrives with a check or a reveal, and the count against that row
 * goes up by one. The browser is not asked how much help it took — it is the
 * party with the reason to understate it.
 *
 * Everything here fails quietly. A missing play id, an unknown one, a database
 * hiccup: none of that may stop a player getting the letter they asked for and
 * paid points for. An uncounted check makes a score too generous; a refused
 * check breaks the game. Those are not the same size of wrong.
 */
export async function tally(env, playId, column) {
  const allowed = ["srv_checks", "srv_check_alls", "srv_reveal_letters", "srv_reveal_answers"];
  if (allowed.indexOf(column) === -1) return;
  if (!env || !env.DB) return;
  const id = String(playId || "");
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return;
  try {
    await env.DB.prepare(
      `UPDATE plays SET ${column} = COALESCE(${column}, 0) + 1 WHERE play_id = ?`)
      .bind(id).run();
  } catch (e) { /* counting must never break play */ }
}
