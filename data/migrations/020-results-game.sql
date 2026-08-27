-- 020 — results stops assuming one game.
--
-- THE PROBLEM. The session cookie has been scoped Domain=.thexigames.com since
-- accounts existed, so a player signed in on the crossword is already signed in
-- on the word search. There was simply nothing for that to carry: `results` is
-- keyed on daily_no, which is the crossword's day number, and word search
-- scores lived in localStorage under xiws.results. Sign in, play on a phone,
-- open an iPad, and the word search history was gone. The offer said "across
-- every device you play on".
--
-- THE KEY. Crossword rows deduplicate on daily_no. A word search has no daily
-- number — it has a day. Special-casing per game is how "the entrant key
-- computed in four places" happened, so instead there is ONE key column, the
-- one thing a row is unique by, composed once per game:
--
--     crossword    daily:2
--     wordsearch   ws:2026-08-27
--
-- UNIQUE(user_id, game, entry_key). Game three adds a prefix, not a column.
--
-- THE DETAIL. Games do not share a fact sheet. checks, revealed_letters and
-- substitutions are crossword ideas; found_count and bonus_found are word
-- search ideas. Adding eleven columns per game IS the duplication fault in
-- schema form, so anything game-specific goes in `detail` as JSON and the
-- shared columns stay shared: score, elapsed_seconds, played_on, solved.

ALTER TABLE results ADD COLUMN game TEXT NOT NULL DEFAULT 'crossword';
ALTER TABLE results ADD COLUMN entry_key TEXT;
ALTER TABLE results ADD COLUMN detail TEXT;

-- Every existing row is a crossword daily. Backfill the key from the column it
-- was already unique by, so the new constraint describes the data that is
-- already there rather than a rule starting today.
UPDATE results
   SET entry_key = 'daily:' || daily_no
 WHERE entry_key IS NULL AND daily_no IS NOT NULL;

-- Rows with no daily_no were never written by migrate.js (it skips them), but
-- if any exist they get a key that cannot collide rather than a NULL that the
-- unique index would let through repeatedly.
UPDATE results
   SET entry_key = 'row:' || id
 WHERE entry_key IS NULL;

-- The constraint the whole migration exists for. A duplicate daily makes a
-- streak meaningless, and until now that was enforced by a SELECT-then-INSERT
-- in application code — two devices migrating at once could pass both checks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_entry
  ON results (user_id, game, entry_key);

-- The read path is "everything this account played of this game, newest
-- first", which is a scan without this.
CREATE INDEX IF NOT EXISTS idx_results_user_game
  ON results (user_id, game, played_on DESC);
