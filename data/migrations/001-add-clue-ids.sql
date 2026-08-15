-- 001 — clue_ids on puzzles (applied 15 Aug 2026)
--
-- Lets /api/practice pick a puzzle by which clues a player has not seen, rather
-- than only which puzzles they have been served. Without it, clue circulation
-- silently falls back to avoiding repeats by puzzle.
--
-- Safe to re-run: SQLite errors on a duplicate column, which is harmless here,
-- but check the status panel afterwards rather than the command's exit code.

ALTER TABLE puzzles ADD COLUMN clue_ids TEXT;
