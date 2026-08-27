-- 019 — XI Word Search moves its bank server-side.
--
-- Two tables, prefixed ws_ so the second game's rows can never collide with
-- the crossword's — the lesson migration 019 exists to apply before it is
-- needed rather than after (see: results has no game column; this schema
-- never repeats that shape).
--
-- The payload is the whole board as JSON: grid, answers with placements, and
-- the bonus. There is no point stripping answers the way the crossword does —
-- a word search's answers are readable off the grid by construction, and the
-- client needs placements to judge a drag. What the server protects is not
-- the answers to today's board but WHICH board is tomorrow's: the schedule.

CREATE TABLE IF NOT EXISTS ws_puzzles (
  id         TEXT PRIMARY KEY,          -- XIWS-0001
  theme      TEXT NOT NULL,
  category   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ready',   -- ready | evolving
  hash       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  share_key  TEXT NOT NULL,
  payload    TEXT NOT NULL              -- JSON: { grid, answers, bonus }
);

CREATE TABLE IF NOT EXISTS ws_schedule (
  day        TEXT PRIMARY KEY,          -- yyyy-mm-dd, the server's UTC day
  puzzle_id  TEXT NOT NULL REFERENCES ws_puzzles(id)
);

-- The released-board question is asked on every Free Play fetch: "when does
-- this board first appear as a daily?" Without the index that is a scan of
-- 730 rows per request.
CREATE INDEX IF NOT EXISTS idx_ws_schedule_puzzle ON ws_schedule (puzzle_id, day);
