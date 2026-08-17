-- 005 — anonymous play counter
--
-- One row per attempt at a puzzle. No cookies, no account, nothing personal:
-- the play id is random, generated when a puzzle starts and forgotten when it
-- ends, so it pairs a start with its finish and identifies nobody.
--
-- The point is not visits — Web Analytics counts those. It is how far people
-- get. A daily that 142 people start and 12 finish is a different problem from
-- one that 40 start and 38 finish, and no page-view tool can tell them apart.

CREATE TABLE IF NOT EXISTS plays (
  id           TEXT PRIMARY KEY,
  play_id      TEXT NOT NULL,          -- random per attempt, not per person
  mode         TEXT NOT NULL,          -- 'daily' | 'practice'
  daily_no     INTEGER,
  phase        TEXT,                   -- 'preseason' | 'season'
  solved       INTEGER DEFAULT 0,      -- clues solved when it ended
  total        INTEGER DEFAULT 0,      -- clues in the puzzle
  completed    INTEGER DEFAULT 0,
  elapsed_secs INTEGER DEFAULT 0,
  checks       INTEGER DEFAULT 0,
  reveals      INTEGER DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_play ON plays (play_id);
CREATE INDEX IF NOT EXISTS idx_plays_day ON plays (mode, daily_no);
