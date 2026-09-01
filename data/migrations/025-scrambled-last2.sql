-- 025 — Scrambled XI's last-two boards: each current Premier League club's
-- last two league games, the real starting XI in the published formation.
--
-- ITS OWN TABLE, NOT ROWS IN sc_board. The bank in sc_board never changes
-- once a board is right; this set goes stale EVERY ROUND and is replaced
-- whole — never merged — so it is a different kind of thing with a different
-- lifecycle, and its ids (1–40, one per club per game) would collide with the
-- bank's. Keeping it apart also keeps it out of the daily ring by
-- construction: loadBoards() reads sc_board and nothing else.
--
-- THE SHAPE. One row per board, the whole board as JSON, the same way
-- sc_board stores the bank. The three derived columns exist for the questions
-- the game will ask without opening the payload: which club, which round,
-- and how old the newest board is — the freshness a stale set is detected by.
--
-- Safe to run twice, as every migration here must be.

CREATE TABLE IF NOT EXISTS sc_last2 (
  id         INTEGER PRIMARY KEY,      -- the board number within the set
  club       TEXT NOT NULL,            -- the club whose XI this is
  gameweek   INTEGER NOT NULL,         -- the league round
  kickoff_ms INTEGER NOT NULL,         -- kickoff, epoch milliseconds
  title      TEXT NOT NULL,            -- the scoreline, shown on the start card
  payload    TEXT NOT NULL,            -- JSON: the whole board, names included
  source     TEXT NOT NULL,            -- the league's fixture record it is taken from
  updated_at TEXT NOT NULL             -- server clock, ISO, set on every write
);

-- Read by club and round; forty rows need no further index.
