-- 006-themes.sql — the Themed section.
--
-- Three things, deliberately separate.
--
-- themes        what a theme is. Named and numbered so a share can say
--               "Manchester United #3" and mean something.
-- theme_boards  the boards themselves, one row per board, each with its own
--               number within its theme and the date it becomes playable.
-- theme_requests what players have asked for. A picklist, not free text, so
--               the answer to "which club should I write clues for next" is a
--               sortable number rather than a pile of strings where Man Utd,
--               man united and MUFC are three different requests.
--
-- Boards and their release dates live in the same table, but a board can be
-- stored long before it is released: the section publishes the schedule four
-- weeks out while boards are built six to eight weeks out, and the buffer is
-- what makes the published date safe to promise.

CREATE TABLE IF NOT EXISTS themes (
  id         TEXT PRIMARY KEY,          -- 'man-united', used in URLs
  name       TEXT NOT NULL,             -- 'Manchester United', shown to players
  kind       TEXT NOT NULL,             -- 'club' | 'topic'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS theme_boards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id   TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  board_no   INTEGER NOT NULL,          -- #1, #2 … within the theme
  -- The day it becomes playable, YYYY-MM-DD. Compared against the server's
  -- own date, never the browser's: the client and the server already disagree
  -- about which day it is for part of every day outside UTC, and a board that
  -- appears an hour early for some players is the smaller version of the same
  -- bug that leaks tomorrow's daily.
  release_on TEXT NOT NULL,
  payload    TEXT NOT NULL,             -- { salt, theme, puzzle } — holds answers
  clue_ids   TEXT,                      -- JSON array, for circulation reporting
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (theme_id, board_no)
);
CREATE INDEX IF NOT EXISTS idx_theme_boards_release ON theme_boards (release_on);
CREATE INDEX IF NOT EXISTS idx_theme_boards_theme ON theme_boards (theme_id, board_no);

-- One request per person per theme. A second one replaces the first rather
-- than counting twice, exactly as clue_reports does — the same button pressed
-- again is a mis-tap, not a second opinion.
CREATE TABLE IF NOT EXISTS theme_requests (
  id           TEXT PRIMARY KEY,
  -- Not a foreign key: the whole point is asking for themes that do not exist
  -- yet. Free text is capped and only reached when the picklist has nothing.
  theme_key    TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT,
  status       TEXT DEFAULT 'open',
  reviewed_at  TEXT,
  -- Nothing sends mail yet. The column exists now because adding it later
  -- means a migration against a live table holding real requests, and because
  -- without somewhere to record who has been told, a slow morning sends the
  -- same person the same notice twice.
  notified_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (theme_key, requested_by)
);
CREATE INDEX IF NOT EXISTS idx_theme_requests_key ON theme_requests (theme_key);
CREATE INDEX IF NOT EXISTS idx_theme_requests_status ON theme_requests (status);
