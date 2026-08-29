-- 024 — reporting stops assuming one game.
--
-- THE PROBLEM. Only the crossword can report bad content. `clue_reports` is
-- clue-shaped — clue_id joined to `clues` — and the other three games have no
-- clues: the word search has boards, Scrambled has boards, QuickFire has
-- questions. A player who spots a wrong answer in any of them has nowhere to
-- put it, and the person who could fix it never hears.
--
-- THE KEY, the same answer migration 020 gave `results`. Not a table per game
-- and not a column per game: one `game` column beside the id the game
-- addresses by, so the admin surface, the rate limit and the one-report-per-
-- person rule all keep working untouched.
--
--     crossword    clue_id = a clue id      the clue that is wrong
--     wordsearch   clue_id = XIWS-0240      the board that is wrong
--     scrambled    clue_id = sc board no    the board that is wrong
--     quickfire    clue_id = a question id  the question that is wrong
--
-- clue_id keeps its name because SQLite cannot rename a column without
-- rebuilding the table, and rebuilding a table holding live reports to improve
-- a name is a bad trade. It means "the id of the thing reported"; the `game`
-- column says what kind of thing that is, so a second column stating the kind
-- would be a fact derivable from one already here.
--
-- WHAT IS NOT HERE. No per-game reason lists. The reasons are presentation —
-- "More than one answer fits" means nothing on a Scrambled board — and they
-- arrive as free text in `reason` either way. Storing them per game would be a
-- second place to change when a game gains a reason.
--
-- NOT SAFE TO RUN TWICE. ALTER TABLE ADD COLUMN fails if the column exists, as
-- migration 020 does too. The README asks for re-runnable migrations and this
-- one cannot be; the index below is guarded, the ALTER cannot be. Run it once.

ALTER TABLE clue_reports ADD COLUMN game TEXT NOT NULL DEFAULT 'crossword';

-- Every existing row is a crossword clue — the only game that could report
-- until now — so the DEFAULT above already describes them correctly and no
-- backfill is needed. Stated rather than assumed: a migration that silently
-- relies on a default is one nobody can check later.

-- The read path is "open reports, newest first, for this game", which is a
-- scan of the whole table without this.
CREATE INDEX IF NOT EXISTS idx_clue_reports_game
  ON clue_reports (game, status, created_at DESC);
