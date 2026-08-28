-- 021 — a board in progress follows the player.
--
-- THE PROBLEM, HIT THREE TIMES BY THE OWNER IN TWO DAYS. Only FINISHED boards
-- sync: results carry the score once Full Time banks it, but the letters of a
-- board mid-solve lived in the localStorage of the device that typed them.
-- Start on a phone, open a laptop, blank grid. The design was "by design"
-- until the person who designed it kept tripping on it.
--
-- THE SHAPE. One row per player per board, identified by the SAME key scheme
-- results uses — migration 020's entry_key (daily:N / ws:YYYY-MM-DD / game
-- three's prefix). The state column is the game's own local save, verbatim
-- JSON: the save format is already the one fact in one place per game, and a
-- second "sync format" would be a copy that drifts.
--
-- THE CLOCK RIDES INSIDE. Each game's snapshot already carries its elapsed
-- figure (savedAt / elapsed), so resuming on another device continues the
-- match instead of restarting it.
--
-- updated_at is the SERVER's clock, set on every write. Conflict resolution
-- ("newest snapshot wins") compares server-issued timestamps only — a device
-- clock is never consulted, which is the standing date-trap rule.

CREATE TABLE IF NOT EXISTS board_state (
  user_id    TEXT NOT NULL,
  game       TEXT NOT NULL,
  entry_key  TEXT NOT NULL,
  state      TEXT NOT NULL,             -- the game's own save JSON, verbatim
  updated_at TEXT NOT NULL,             -- server clock, ISO, set on every write
  PRIMARY KEY (user_id, game, entry_key)
);

-- The read path is "this player's state for this board" — the primary key —
-- and the housekeeping path is "everything this player left behind", covered
-- by the same index's prefix. No further index needed.
