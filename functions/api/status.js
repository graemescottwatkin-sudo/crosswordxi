/* GET /api/status — what is actually live.
 *
 * The build badge tells you which frontend is running. It cannot tell you
 * whether the database is connected, whether the puzzles you imported arrived,
 * or whether the schema is the one the code expects — and those have been the
 * hard-to-see failures. A site running perfectly on three development samples
 * looks identical to one running on a full clue bank.
 *
 * Counts only. No clue text, no answers, nothing that is not already visible
 * from playing the game.
 */
import { json } from "../_lib/puzzle.js";
import { hasDB, bankSize } from "../_lib/db.js";
import { dailyNumber } from "../_lib/daily.js";

async function count(env, sql) {
  try {
    const row = await env.DB.prepare(sql).first();
    return row ? Object.values(row)[0] : null;
  } catch (e) {
    return null;      // a missing table is an answer in itself
  }
}

export async function onRequestGet({ env }) {
  const today = dailyNumber();

  if (!hasDB(env)) {
    return json({
      source: "development samples",
      db: false,
      accounts: false,
      today,
      note: "No D1 binding. The game is running on the handful of puzzles built " +
            "into the code, not your clue bank.",
    });
  }

  const [clues, practice, dailies, firstDay, lastDay, tagged, users,
         themeBoards, themeLive, themeNext] = await Promise.all([
    count(env, "SELECT COUNT(*) AS n FROM clues"),
    count(env, "SELECT COUNT(*) AS n FROM puzzles WHERE mode = 'practice'"),
    count(env, "SELECT COUNT(*) AS n FROM puzzles WHERE mode = 'daily'"),
    count(env, "SELECT MIN(daily_no) AS n FROM puzzles WHERE mode = 'daily'"),
    count(env, "SELECT MAX(daily_no) AS n FROM puzzles WHERE mode = 'daily'"),
    count(env, "SELECT COUNT(*) AS n FROM puzzles WHERE mode = 'practice' AND clue_ids IS NOT NULL"),
    count(env, "SELECT COUNT(*) AS n FROM users"),
    /* Themed boards are a third of the content now, and the only way to tell
       whether the import arrived was to open the section and find it empty —
       which looks the same whether the tables are missing, the import never
       ran, or every board is scheduled for a future Friday. Three separate
       causes, one blank screen. These three numbers separate them: null means
       no table, 0 means no import, and stored-but-none-released means the
       dates are ahead of today. */
    count(env, "SELECT COUNT(*) AS n FROM theme_boards"),
    count(env, "SELECT COUNT(*) AS n FROM theme_boards WHERE release_on <= date('now')"),
    count(env, "SELECT MIN(release_on) AS n FROM theme_boards WHERE release_on > date('now')"),
  ]);

  const reach = tagged ? await bankSize(env) : 0;

  return json({
    source: "D1",
    db: true,
    accounts: !!env.GOOGLE_CLIENT_ID,
    clues,
    practice,
    practiceReach: reach,
    /* Whether the pool carries clue ids tells you if the schema and the puzzle
       import are the current pair. Without it, clue circulation silently falls
       back to avoiding repeats by puzzle rather than by clue. */
    clueIdsPresent: tagged === practice && practice > 0,
    dailies,
    firstDay,
    lastDay,
    today,
    daysLeft: lastDay === null ? null : lastDay - today,
    users,
    themeBoards,
    themeLive,
    themeNext,
  });
}
