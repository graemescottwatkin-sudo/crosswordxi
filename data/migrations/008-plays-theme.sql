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

-- Owner attempts, flagged rather than mixed in.
--
-- Testing a layout twenty times is not twenty people playing, and while the
-- site is being built most of the rows are the owner's. The funnel reports
-- them separately so the headline numbers are visitors.
--
-- A boolean, set on the server from the session — never from the browser,
-- which could otherwise mark anyone's attempt as anyone's. It says "this was
-- the owner" and nothing else: no email, no user id, no identity for any other
-- player. The per-attempt play id stays random, so two goes by one visitor are
-- still indistinguishable from two visitors.

ALTER TABLE plays ADD COLUMN by_owner INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_plays_owner ON plays (by_owner);
