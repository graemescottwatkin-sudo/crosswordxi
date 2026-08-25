-- 011-server-scoring.sql — counting help on the server.
--
-- A score is time plus the help taken away from 114. Until now every one of
-- those numbers arrived from the browser, which is why the handover forbids a
-- public leaderboard: a submitted score cannot be trusted, and anyone editing
-- their own page can post 114 in nine seconds.
--
-- Nearly all of it is already the server's to know. Checking an answer and
-- revealing a letter are server calls — it served them, so it can count them.
-- The clock starts when the play row is written, by the server's clock rather
-- than the device's. What was missing was somewhere to keep the tally.
--
-- The client's own figures are left where they are rather than replaced. Two
-- independent counts of the same thing is how tampering announces itself: a
-- row where the browser reports no help and the server counted nine reveals is
-- worth looking at.

ALTER TABLE plays ADD COLUMN srv_checks         INTEGER DEFAULT 0;
ALTER TABLE plays ADD COLUMN srv_check_alls     INTEGER DEFAULT 0;
ALTER TABLE plays ADD COLUMN srv_reveal_letters INTEGER DEFAULT 0;
ALTER TABLE plays ADD COLUMN srv_reveal_answers INTEGER DEFAULT 0;
-- Set when the server has marked a finished grid itself, with the score it
-- computed. Null means nothing has been verified and the row must not be shown
-- on anything public.
ALTER TABLE plays ADD COLUMN srv_score          INTEGER;
ALTER TABLE plays ADD COLUMN srv_verified_at    TEXT;

CREATE INDEX IF NOT EXISTS idx_plays_verified ON plays (srv_verified_at, srv_score);
