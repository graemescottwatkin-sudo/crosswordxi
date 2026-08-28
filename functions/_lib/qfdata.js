/* functions/_lib/qfdata.js — QuickFire XI's only route to D1.
 *
 * Two rules this file exists to hold:
 *
 *  1. A board is served on its play date and not before. There is no fallback
 *     sample: an unbound binding must look like a broken game, not a working
 *     one with a handful of boards. That fallback is what let the word search
 *     run for weeks on sample data with every check green.
 *
 *  2. Nothing leaves here that the player is not entitled to today. A challenge
 *     link can only rebuild questions that have already been played, so a
 *     hand-crafted code cannot read tomorrow's board.
 */

export function hasDB(env) {
  return !!(env && env.DB);
}

const QUESTION_COLUMNS = `
  q.id, q.answer, q.aliases, q.clue, q.answer_type, q.difficulty
`;

function shape(row) {
  return {
    id: row.id,
    clue: row.clue,
    answer: row.answer,
    aliases: String(row.aliases || "").split("|").filter(Boolean),
    answerType: row.answer_type,
    difficulty: row.difficulty || "medium",
  };
}

function split(rows) {
  const questions = [];
  const bench = [];
  for (const row of rows) {
    (row.role === "bench" ? bench : questions).push(shape(row));
  }
  return { questions, bench };
}

/* Today, in Europe/London, from the server rather than the device. The device
   clock is the player's to change; the board is not. */
export function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

export async function getDaily(env, date) {
  const play = date || today();
  const { results } = await env.DB.prepare(`
    SELECT ${QUESTION_COLUMNS}, s.role, s.slot, d.play_date
    FROM qf_daily d
    JOIN qf_daily_slot s ON s.play_date = d.play_date
    JOIN qf_question   q ON q.id = s.question_id
    WHERE d.play_date = ?1
      AND d.status = 'published'
      AND q.status  = 'verified'
    ORDER BY s.role DESC, s.slot
  `).bind(play).all();

  if (!results || !results.length) return null;
  const { questions, bench } = split(results);
  if (questions.length !== 11) return null;   // fail closed: never serve a short board
  return { id: "XIQF-" + play.replace(/-/g, ""), date: play, questions, bench };
}

/* The weekly round, if one is live. Shelf life is enforced here as well as in
   the client — a stale week must not be reachable by editing the page. */
export async function getWeek(env, shelfLifeDays = 10) {
  const { results } = await env.DB.prepare(`
    SELECT ${QUESTION_COLUMNS}, s.role, s.slot, w.week_ending, w.label
    FROM qf_week w
    JOIN qf_week_slot s ON s.week_ending = w.week_ending
    JOIN qf_question  q ON q.id = s.question_id
    WHERE w.status = 'published'
      AND q.status = 'verified'
      AND w.week_ending <= date('now')
      AND w.week_ending >= date('now', ?1)
    ORDER BY w.week_ending DESC, s.role DESC, s.slot
  `).bind(`-${shelfLifeDays} day`).all();

  if (!results || !results.length) return null;
  const weekEnding = results[0].week_ending;
  const rows = results.filter((r) => r.week_ending === weekEnding);
  const { questions, bench } = split(rows);
  if (questions.length !== 11) return null;
  return { weekEnding, label: rows[0].label || "The Last 7 Days", questions, bench };
}

/* Questions for a challenge link. Only ids that have already appeared on a
   board whose play date has passed, so a crafted code reads nothing early. */
export async function getPlayedQuestions(env, ids) {
  const clean = [...new Set(ids)].filter((n) => Number.isInteger(n)).slice(0, 32);
  if (!clean.length) return [];
  const marks = clean.map((_, i) => `?${i + 1}`).join(",");
  const { results } = await env.DB.prepare(`
    SELECT ${QUESTION_COLUMNS}
    FROM qf_question q
    WHERE q.id IN (${marks})
      AND q.status = 'verified'
      AND EXISTS (
        SELECT 1 FROM qf_daily_slot s
        JOIN qf_daily d ON d.play_date = s.play_date
        WHERE s.question_id = q.id
          AND d.status = 'published'
          AND d.play_date <= date('now')
      )
  `).bind(...clean).all();
  return (results || []).map(shape);
}

export function noStore(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
