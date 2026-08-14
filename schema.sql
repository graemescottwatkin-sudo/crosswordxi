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
  difficulty    INTEGER,
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
