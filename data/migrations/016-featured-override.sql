-- 016-featured-override.sql
--
-- Lets the board of the day be set by hand instead of taken from the cycle.
--
-- Keyed by date rather than being a single "current" row, so an override
-- expires on its own. A one-row setting would have to be cleared by hand, and
-- the failure would be silent: the same board featured for a fortnight while
-- everybody assumed the cycle had it. A row for 2026-09-18 stops applying on
-- the 19th whether anybody remembers it or not.
--
-- It also means a week can be set in advance — one row per date — which is the
-- reason to want this at all: a board worth pointing at usually coincides with
-- something happening that day.

CREATE TABLE IF NOT EXISTS featured_override (
  on_date    TEXT PRIMARY KEY,          -- YYYY-MM-DD, server's UTC day
  board_id   INTEGER NOT NULL,          -- theme_boards.id
  note       TEXT,                      -- why, for whoever reads this later
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (board_id) REFERENCES theme_boards (id)
);

-- Reads are one row by exact date, so the primary key is the whole index.
-- Listed here rather than added later: an override that silently fails to
-- apply looks identical to one nobody set.
