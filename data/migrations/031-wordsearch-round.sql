-- 031 — Wordsearch XI: the clock, the finds and the fouls the server owns, so
-- a score can be verified.
--
-- The last of the five games to get this, and the one that could not have it
-- until now. HiLo judged every call already; Scrambled marked every guess and
-- sold every reveal. This game judged NOTHING: the board travelled whole —
-- every answer with its exact start and end square — and the page decided for
-- itself what had been found. There was no server-side fact about a word
-- search round to build a score out of.
--
-- The board stopped travelling whole in the same release as this migration.
-- The server judges each selection now, which is what makes these rows mean
-- something: every one of them was written by the thing that decided it.
--
-- WHAT A WORD SEARCH SCORE IS MADE OF, and where each part comes from:
--
--   the clock     started here, at kick off
--   the finds     one row per word, written when the server judged the hit
--   the fouls     a wrong selection, escalating +1' to +4' and capped at 15'
--   the bonus     a found row like any other, flagged
--
-- WHY FOULS NEED A ROW EACH AND NOT A COUNTER. The penalty escalates with
-- CONSECUTIVE wrong selections and resets on a right one, so the order of the
-- two matters and a running total cannot reconstruct it. Rows carry when each
-- happened; the run is derived from the sequence, which is the one place that
-- rule can be applied to the same data the page applied it to.
--
-- Keyed by the word, not by a count: the same word selected twice — a retry
-- after a dropped connection, a double tap — is one find, and the eleventh
-- distinct word is what finishes a board.
--
-- Applied once, and safe to run twice.

CREATE TABLE IF NOT EXISTS ws_round (
  play_id     TEXT PRIMARY KEY,      -- the attempt, from /api/play
  puzzle_id   TEXT NOT NULL,         -- which board, so the server can judge it
  day         TEXT NOT NULL,         -- the day it was the daily, YYYY-MM-DD
  started_ms  INTEGER NOT NULL       -- kick off, by this server's clock
);

CREATE TABLE IF NOT EXISTS ws_find (
  play_id     TEXT NOT NULL,
  word        TEXT NOT NULL,         -- the grid form, which is the key
  is_bonus    INTEGER NOT NULL DEFAULT 0,
  at_ms       INTEGER NOT NULL,
  PRIMARY KEY (play_id, word)
);

CREATE TABLE IF NOT EXISTS ws_foul (
  play_id     TEXT NOT NULL,
  idx         INTEGER NOT NULL,      -- the nth wrong selection of this round
  at_ms       INTEGER NOT NULL,
  PRIMARY KEY (play_id, idx)
);
