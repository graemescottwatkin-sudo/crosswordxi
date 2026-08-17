-- 003 — admin flag and clue reports (applied on request)
--
-- One column and one table. The flag is set by hand in the database, never by
-- anything the browser can reach — an account cannot promote itself, and there
-- is no endpoint that grants it.
--
-- Safe to re-run: a duplicate-column error is harmless.

ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;

-- Clues flagged while playing. Spotting a bad clue mid-game and having to
-- remember it until later is how bad clues survive.
CREATE TABLE IF NOT EXISTS clue_reports (
  id          TEXT PRIMARY KEY,
  clue_id     TEXT NOT NULL,
  reported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  puzzle      TEXT,                      -- token, so the puzzle can be found again
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_clue ON clue_reports (clue_id);
