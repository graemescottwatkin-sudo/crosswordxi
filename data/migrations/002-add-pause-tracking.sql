-- 002 — pauses on results (applied 15 Aug 2026)
--
-- Pausing hides the puzzle, so it cannot be used to think for free — but it
-- stops the scoring clock, which is worth roughly 20 points in the first half
-- hour and nothing after 30 minutes, when the score has floored.
--
-- Recorded rather than forbidden. A doorbell should not cost a player their
-- score, but a leaderboard should be able to tell a four-minute solve from a
-- four-minute solve spread across two hours.
--
-- Safe to re-run: a duplicate-column error is harmless. Check the status panel
-- rather than the exit code.

ALTER TABLE results ADD COLUMN pauses INTEGER DEFAULT 0;
ALTER TABLE results ADD COLUMN paused_seconds INTEGER DEFAULT 0;
