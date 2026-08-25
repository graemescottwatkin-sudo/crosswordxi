-- 012-challenges.sql — challenge boards.
--
-- Finish a themed board, press Challenge, send the link. Whoever opens it plays
-- that exact board and their verified result joins a table belonging to that
-- challenge.
--
-- Deliberately not a leaderboard. A leaderboard asks people to care about
-- strangers; a challenge gives them somebody they already want to beat. Two
-- people challenging on the same board get two tables, because a challenge
-- belongs to a social group and merging them turns it into the thing that was
-- deliberately deferred.
--
-- Every score here is copied from plays.srv_score, which the server computed
-- from the answers it holds, the help it served and the clock it started. There
-- is no field in any endpoint that a browser can put a number into.

CREATE TABLE IF NOT EXISTS challenges (
  id           TEXT PRIMARY KEY,          -- short and URL-safe: k3f9p2
  theme_id     TEXT NOT NULL,
  board_no     INTEGER NOT NULL,
  created_by   TEXT,                      -- users(id); null for a guest
  creator_name TEXT NOT NULL,
  play_id      TEXT NOT NULL,             -- the verified play it was created from
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  hidden       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS challenge_entries (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  play_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  score        INTEGER NOT NULL,
  elapsed_secs INTEGER NOT NULL,
  checks       INTEGER NOT NULL,
  reveals      INTEGER NOT NULL,
  -- The account id where there is one, otherwise a key kept on the device.
  -- One SCORED RESULT per entrant, not one start: a legitimate interrupted
  -- attempt has to be resumable, or a phone call costs somebody their go.
  entrant_key  TEXT NOT NULL,
  hidden       INTEGER DEFAULT 0,         -- removed from the page, kept in the record
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (challenge_id, entrant_key)
);

-- Who started, so "six have taken this, four finished" is a real number rather
-- than an estimate. A name is taken before the board opens, so a start is known
-- even when it never becomes an entry. Starts are counted; they are not listed.
CREATE TABLE IF NOT EXISTS challenge_starts (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  entrant_key  TEXT NOT NULL,
  name         TEXT NOT NULL,
  play_id      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (challenge_id, entrant_key)
);

CREATE INDEX IF NOT EXISTS idx_centries_challenge ON challenge_entries (challenge_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_cstarts_challenge  ON challenge_starts (challenge_id);
CREATE INDEX IF NOT EXISTS idx_challenges_board   ON challenges (theme_id, board_no);

-- The challenge a play belongs to, so the funnel can follow a chain:
-- challenge opened -> name entered -> started -> finished -> entered -> a new
-- challenge created from it.
ALTER TABLE plays ADD COLUMN challenge_id TEXT;
CREATE INDEX IF NOT EXISTS idx_plays_challenge ON plays (challenge_id);
