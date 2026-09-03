-- 026 — plays stops assuming one game.
--
-- THE PROBLEM. Only the crossword counted attempts: how many people opened a
-- board, how many finished it, and where the ones who gave up had got to.
-- `plays` is crossword-shaped — a daily number or a theme slug, checks and
-- reveals — and the word search and Scrambled sent nothing, so a board that
-- 140 people opened could not be told from one that 12 finished.
--
-- THE KEY, the same answer migrations 020 and 024 gave `results` and the
-- reports: one `game` column beside the key the game addresses a board by,
-- not a table per game and not a column per game.
--
--     crossword    board_key = daily:12 | man-united-3 | practice
--     wordsearch   board_key = ws:2026-09-01 | XIWS-0025
--     scrambled    board_key = sc:12
--
-- The universal numbers stay in their columns — solved of total, completed,
-- elapsed — and anything one game alone cares about (a bonus found, help
-- bought, an assisted flag) goes to `detail` as JSON, exactly as it does on
-- results. Existing rows are the crossword's, which the default says.
--
-- Applied once. ALTER TABLE ADD COLUMN is not idempotent.

ALTER TABLE plays ADD COLUMN game TEXT NOT NULL DEFAULT 'crossword';
ALTER TABLE plays ADD COLUMN board_key TEXT;
ALTER TABLE plays ADD COLUMN detail TEXT;

CREATE INDEX IF NOT EXISTS idx_plays_game_board ON plays (game, board_key);
