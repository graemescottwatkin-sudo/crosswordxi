-- 008-plays-theme.sql
--
-- Which themed board an attempt was on.
--
-- /api/play coerced mode to "practice" or "daily", so every themed board was
-- filed as practice with nothing to say which one. That was fine when themed
-- boards did not exist and useless the moment they did: a themed board is the
-- one thing here designed to be passed between friends, so which board gets
-- played is the question worth being able to answer.
--
-- theme_key holds "man-united-3" — the same slug the share link carries, so a
-- row here joins to the link somebody actually sent.
--
-- Existing rows are left alone. Eighteen practice attempts predate this and
-- some of them were themed; there is no way to tell which, and guessing would
-- put made-up numbers in the only record of what really happened.

ALTER TABLE plays ADD COLUMN theme_key TEXT;

CREATE INDEX IF NOT EXISTS idx_plays_theme ON plays (theme_key);

-- Check it took: expect the column to be listed.
-- PRAGMA table_info(plays);
