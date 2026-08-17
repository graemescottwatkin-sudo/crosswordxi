-- Crossword XI — database schema (safe to re-run)
--
-- This file only creates what is missing. It will never drop a table, so
-- running it against a live database cannot delete accounts.
--
-- It used to begin with DROP TABLE for every table, including `users`. That is
-- fine on an empty database and catastrophic on a live one: a routine re-import
-- would have silently deleted everyone who had signed up. Structural changes
-- now go in data/migrations/ instead, and the destructive version has a name
-- that says what it does.
--
CREATE TABLE IF NOT EXISTS clues (
  id            TEXT PRIMARY KEY,      -- stable id from the source bank
  game_type     TEXT NOT NULL DEFAULT 'crossword',
  category      TEXT NOT NULL,         -- e.g. "Transfers", "Grounds", "Caps"
  clue          TEXT NOT NULL,
  answer        TEXT NOT NULL,         -- display form, e.g. "Paris St Germain"
  grid          TEXT NOT NULL,         -- letters only, e.g. "PARISSTGERMAIN"
  enumeration   TEXT,                  -- e.g. "(5,2,7)"
  entity        TEXT,                  -- club or subject the clue belongs to
  difficulty    TEXT,                  -- 'Easy' | 'Medium' | 'Hard' — a label, not a number
  era           TEXT,                  -- "1990s".."2020s", "Timeless", "Pre-1990"
  puzzle_group  TEXT,                  -- rows that must not share a puzzle
  max_per       INTEGER DEFAULT 1,     -- 0 archives a row without deleting it
  active        INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clues_category ON clues (category);
CREATE INDEX IF NOT EXISTS idx_clues_active   ON clues (active, max_per);
CREATE INDEX IF NOT EXISTS idx_clues_era      ON clues (era);

CREATE TABLE IF NOT EXISTS puzzles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mode        TEXT NOT NULL,           -- 'daily' | 'practice'
  daily_no    INTEGER,                 -- set for daily, NULL for practice
  daily_date  TEXT,                    -- optional human-readable date
  category    TEXT,                    -- set only for filtered practice pools
  payload     TEXT NOT NULL,           -- JSON: { salt, poolId?, puzzle }
  clue_ids    TEXT,                    -- JSON array of the clue ids inside it,
                                       -- so a puzzle can be chosen by what the
                                       -- player has not seen without unpacking
                                       -- every payload on every request
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The daily lookup is the hot path: one row, by number, every request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzles_daily ON puzzles (daily_no) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS idx_puzzles_mode ON puzzles (mode, category);

-- ===========================================================================
-- ACCOUNTS (Phase 1)
--
-- Accounts are optional. Guest play writes to the browser only and touches
-- none of this. Signing in creates a row here and gives the same player a
-- home across devices.
--
-- There are no passwords anywhere in this schema, on purpose: identity comes
-- from Google (and later Apple), verified server-side. Nothing to leak, reset
-- or get wrong.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,        -- internal id, never the email
  provider      TEXT NOT NULL,           -- 'google' | 'apple' | 'email'
  provider_id   TEXT NOT NULL,           -- the provider's subject claim
  email         TEXT,                    -- may be absent or a relay address
  display_name  TEXT NOT NULL,
  club          TEXT,                    -- the club the league table plays as
  -- Set by hand in the database only. Nothing the browser can reach writes it,
  -- and there is no endpoint that grants it: an account cannot promote itself.
  is_admin      INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One account per identity at a provider. Signing in with the same Google
-- account twice finds the existing row rather than making a second one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users (provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,          -- opaque random id, sent as a cookie
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- Results are Phase 2. The table exists now so the account foundation has
-- somewhere to migrate guest history to, and so the shape is settled before
-- anything depends on it.
--
-- It deliberately records the *actions* a score was made of, not just the
-- score. A leaderboard that trusts a number the browser sent is a leaderboard
-- someone will send 114 to; recording start and finish times, checks and
-- reveals means the server can recompute a score later without a rebuild.
CREATE TABLE IF NOT EXISTS results (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_token      TEXT NOT NULL,       -- 'daily:5' | 'practice:37'
  mode              TEXT NOT NULL,       -- 'daily' | 'practice'
  daily_no          INTEGER,
  played_on         TEXT,                -- local date key, for streaks
  solved            INTEGER NOT NULL DEFAULT 0,
  score             INTEGER,             -- as the client calculated it
  elapsed_seconds   INTEGER,
  checks            INTEGER DEFAULT 0,
  check_alls        INTEGER DEFAULT 0,
  revealed_letters  INTEGER DEFAULT 0,
  revealed_answers  INTEGER DEFAULT 0,
  substitutions     INTEGER DEFAULT 0,
  -- Pausing stops the scoring clock. Not forbidden — it hides the puzzle, so it
  -- buys no thinking time — but recorded, so a leaderboard can tell a fast solve
  -- from a slow one taken in instalments.
  pauses            INTEGER DEFAULT 0,
  paused_seconds    INTEGER DEFAULT 0,
  club              TEXT,
  season            TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  source            TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'migrated'
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A daily counts once per player, whatever the browser sends.
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_daily ON results (user_id, daily_no)
  WHERE mode = 'daily' AND daily_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_results_user ON results (user_id, played_on);


-- Clues flagged while playing. Spotting a bad clue mid-game and having to
-- remember it until later is how bad clues survive.
CREATE TABLE IF NOT EXISTS clue_reports (
  id          TEXT PRIMARY KEY,
  clue_id     TEXT NOT NULL,
  reported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  puzzle      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_clue ON clue_reports (clue_id);
