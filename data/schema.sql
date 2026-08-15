-- Crossword XI — Cloudflare D1 schema
--
-- Two tables, doing two different jobs.
--
--   clues    the master bank. Nothing reads it at request time; it is the
--            source the puzzle generator runs against on your machine. It
--            lives here so there is one authoritative copy, backed up and
--            queryable, rather than a spreadsheet on a laptop.
--
--   puzzles  pre-generated puzzles, stored whole. This is what the API reads.
--            Laying out a crossword costs ~900ms of CPU, which a Worker should
--            not spend per request, so the work is done ahead of time and each
--            request becomes one indexed SELECT.
--
-- The schema in the deployment standard assumed one row per question with the
-- puzzle assembled per request. Crossword XI cannot work that way: a crossword
-- is a interlocking layout, not a list of questions, so the generated grid has
-- to be stored as a unit. The clue-level fields are kept in `clues` where they
-- belong.

DROP TABLE IF EXISTS clues;
CREATE TABLE clues (
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

CREATE INDEX idx_clues_category ON clues (category);
CREATE INDEX idx_clues_active   ON clues (active, max_per);
CREATE INDEX idx_clues_era      ON clues (era);

DROP TABLE IF EXISTS puzzles;
CREATE TABLE puzzles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mode        TEXT NOT NULL,           -- 'daily' | 'practice'
  daily_no    INTEGER,                 -- set for daily, NULL for practice
  daily_date  TEXT,                    -- optional human-readable date
  category    TEXT,                    -- set only for filtered practice pools
  payload     TEXT NOT NULL,           -- JSON: { salt, poolId?, puzzle }
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The daily lookup is the hot path: one row, by number, every request.
CREATE UNIQUE INDEX idx_puzzles_daily ON puzzles (daily_no) WHERE mode = 'daily';
CREATE INDEX idx_puzzles_mode ON puzzles (mode, category);

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

DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id            TEXT PRIMARY KEY,        -- internal id, never the email
  provider      TEXT NOT NULL,           -- 'google' | 'apple' | 'email'
  provider_id   TEXT NOT NULL,           -- the provider's subject claim
  email         TEXT,                    -- may be absent or a relay address
  display_name  TEXT NOT NULL,
  club          TEXT,                    -- the club the league table plays as
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One account per identity at a provider. Signing in with the same Google
-- account twice finds the existing row rather than making a second one.
CREATE UNIQUE INDEX idx_users_provider ON users (provider, provider_id);
CREATE INDEX idx_users_email ON users (email);

DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,          -- opaque random id, sent as a cookie
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- Results are Phase 2. The table exists now so the account foundation has
-- somewhere to migrate guest history to, and so the shape is settled before
-- anything depends on it.
--
-- It deliberately records the *actions* a score was made of, not just the
-- score. A leaderboard that trusts a number the browser sent is a leaderboard
-- someone will send 114 to; recording start and finish times, checks and
-- reveals means the server can recompute a score later without a rebuild.
DROP TABLE IF EXISTS results;
CREATE TABLE results (
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
  club              TEXT,
  season            TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  source            TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'migrated'
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A daily counts once per player, whatever the browser sends.
CREATE UNIQUE INDEX idx_results_daily ON results (user_id, daily_no)
  WHERE mode = 'daily' AND daily_no IS NOT NULL;
CREATE INDEX idx_results_user ON results (user_id, played_on);
