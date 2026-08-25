-- 014-entry-help.sql — which kind of help, not how many pieces of it.
--
-- The standings said "2 reveals" for two revealed letters and "3 reveals" for
-- two revealed answers and a letter. A letter costs 2 points and an answer
-- costs 9, so the same word described 4 points and 20 — and a perfectly
-- legitimate score looked impossible beside a worse one.
--
-- The counts existed separately on the play row and were added together on the
-- way into the entry, which threw away the only thing that made the number mean
-- anything. Four columns, so the table can say what was actually done.

ALTER TABLE challenge_entries ADD COLUMN reveal_letters INTEGER DEFAULT 0;
ALTER TABLE challenge_entries ADD COLUMN reveal_answers INTEGER DEFAULT 0;
ALTER TABLE challenge_entries ADD COLUMN check_answers  INTEGER DEFAULT 0;
ALTER TABLE challenge_entries ADD COLUMN check_grids    INTEGER DEFAULT 0;

-- Existing rows carry the merged totals in `checks` and `reveals`; the split is
-- recoverable from the play they came from.
UPDATE challenge_entries SET
  reveal_letters = COALESCE((SELECT p.srv_reveal_letters FROM plays p WHERE p.play_id = challenge_entries.play_id), 0),
  reveal_answers = COALESCE((SELECT p.srv_reveal_answers FROM plays p WHERE p.play_id = challenge_entries.play_id), 0),
  check_answers  = COALESCE((SELECT p.srv_checks         FROM plays p WHERE p.play_id = challenge_entries.play_id), 0),
  check_grids    = COALESCE((SELECT p.srv_check_alls     FROM plays p WHERE p.play_id = challenge_entries.play_id), 0);

-- And the times, which were measured to ended_at — written when the tab closes,
-- sometimes minutes after the score was worked out. Same span as the score.
UPDATE challenge_entries SET elapsed_secs = COALESCE((
  SELECT MAX(0, CAST((julianday(p.srv_verified_at) - julianday(p.started_at)) * 86400 AS INTEGER))
    FROM plays p WHERE p.play_id = challenge_entries.play_id
     AND p.srv_verified_at IS NOT NULL), elapsed_secs);
