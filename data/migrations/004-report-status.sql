-- 004 — a report can be marked as dealt with
--
-- Without this the list only grows: every export re-reads everything already
-- actioned, and after a month of daily play that is most of it.
--
-- Kept rather than deleted. A clue you decided to leave alone is worth
-- remembering, or it gets re-flagged and re-considered next month.

ALTER TABLE clue_reports ADD COLUMN status TEXT DEFAULT 'open';
ALTER TABLE clue_reports ADD COLUMN reviewed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_reports_status ON clue_reports (status);
