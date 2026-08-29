-- 023 — Scrambled XI's boards, in the database rather than in a shipped file.
--
-- 022 IS RESERVED for QuickFire XI, whose migration was named in its RUN-ME
-- but not delivered. Taking that number here would collide with it the day it
-- arrives, and a migration applied under the wrong name cannot be un-applied:
-- D1 has no migration table, so the file name IS the record.
--
-- WHY A TABLE AT ALL. The boards were generated into functions/_lib/sc-boards.js
-- and read from there. That works and is gated, but it means changing a board
-- is a DEPLOY: the names ride in the bundle, so a typo in an XI waits for a
-- release, and every board that has ever shipped stays in the git history. The
-- other three games all keep their content in D1 for exactly this reason —
-- "changing a question is an import, not a deploy".
--
-- THE SHAPE. One row per board, the whole board as JSON, the same way `puzzles`
-- stores a crossword. Deriving columns here would be a second statement of a
-- structure tools/build_scrambled.js already owns, and the two would drift.
-- The payload written here is the SAME object the builder puts in the module —
-- one derivation, two destinations, never re-derived.
--
-- Safe to run twice, as every migration here must be.

CREATE TABLE IF NOT EXISTS sc_board (
  id         INTEGER PRIMARY KEY,      -- the board number, as the ring counts
  title      TEXT NOT NULL,            -- shown on the start card
  payload    TEXT NOT NULL,            -- JSON: the whole board, names included
  source     TEXT NOT NULL,            -- the URL the XI is taken from
  updated_at TEXT NOT NULL             -- server clock, ISO, set on every write
);

-- The ring reads every row in id order, so no further index earns its keep:
-- the primary key already provides it.
