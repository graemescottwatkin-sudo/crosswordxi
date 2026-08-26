-- 017 — srv_elapsed_secs on plays
--
-- The clock /api/finish scored on: wall time from started_at, plus the match
-- minutes help added. Stored because it was being recomputed downstream and
-- coming out wrong.
--
-- challenge/entry.js worked it out from started_at and srv_verified_at, which
-- is wall time and therefore help-free — so a player who revealed two answers
-- had a leaderboard time twenty-eight minutes short of the one their score came
-- from, under a comment claiming the two agree by construction.
--
-- Nullable on purpose: rows written before this column existed keep working,
-- and entry.js falls back to the old arithmetic for them.
--
-- Safe to re-run: SQLite errors on a duplicate column, which is harmless here.
-- Check the status panel afterwards rather than the command's exit code.

ALTER TABLE plays ADD COLUMN srv_elapsed_secs INTEGER;
