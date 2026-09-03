-- 027 — HiLo XI, the tenth shirt: its boards and its calendar.
--
-- A board is twelve items in a fixed order — eleven calls — with a value on
-- each that the browser must NOT be given up front. The whole board sits in
-- `payload` as JSON, including every row's source; the API decides what
-- leaves the server (functions/_lib/hl-board.js), the same shape as the
-- Scrambled bank.
--
-- Two kinds of board, one table. A DAILY board is one the calendar hands out
-- on a day; a CLUB board (a club's managers by year of appointment) is never
-- in the calendar and is played from the club's own page. `kind` says which,
-- `club` names the club for the club kind, and the calendar is its own
-- table keyed by the day — so a day's board is a lookup, not arithmetic, and
-- the content side can regenerate the run-in without touching a board.
--
-- The research side numbers boards from 296; ids are theirs and are TEXT so
-- a leading zero or a letter can never turn into a different board.
--
-- Applied once. CREATE TABLE IF NOT EXISTS is idempotent; nothing else here.

CREATE TABLE IF NOT EXISTS hl_board (
  id          TEXT PRIMARY KEY,        -- the research side's id, e.g. '398'
  kind        TEXT NOT NULL,           -- 'daily' | 'club'
  club        TEXT,                    -- the club's slug for kind 'club', else NULL
  category    TEXT NOT NULL,           -- shown during play
  subtitle    TEXT NOT NULL,           -- shown during play
  payload     TEXT NOT NULL,           -- JSON: the whole board, values and sources included
  updated_at  TEXT NOT NULL            -- server clock, ISO, set on every write
);

CREATE TABLE IF NOT EXISTS hl_schedule (
  day         TEXT PRIMARY KEY,        -- YYYY-MM-DD, UTC, the server's day
  board_id    TEXT NOT NULL            -- the hl_board row that is that day's
);

CREATE INDEX IF NOT EXISTS idx_hl_board_kind ON hl_board (kind, club);
