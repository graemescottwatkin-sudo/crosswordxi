-- 009-play-number.sql
--
-- A readable reference for each attempt at a board.
--
-- The first person to open today's daily is 000001, the second 000002, and a
-- refresh keeps the number rather than issuing a new one. Each board has its
-- own sequence: being 000001 on the daily says nothing about who you are on
-- Bolton #2.
--
-- Why it is worth having: the play id is generated in a variable, so a refresh
-- discarded it and started a fresh row. One person reloading twice counted as
-- three players, which is most of why the practice figures ran ahead of
-- reality. Persisting the reference alongside the saved game — which is
-- already on the device, because continuing a game you started is the service
-- you asked for — makes one sitting one row.
--
-- What it deliberately is not: an identity. It does not follow anyone between
-- boards or between days, and clearing site data resets it, exactly as it
-- resets the saved game.

ALTER TABLE plays ADD COLUMN play_no INTEGER;

-- Attempts are numbered within a board, so this is the index that has to be
-- fast: "how many attempts at this board so far".
CREATE INDEX IF NOT EXISTS idx_plays_scope
  ON plays (mode, daily_no, theme_key, play_no);

-- Check it took: expect play_no in the list.
-- PRAGMA table_info(plays);
