-- 032 — the season's own record: what an account started and finished, per day.
--
-- WHY THIS IS NOT DERIVED FROM WHAT IS ALREADY THERE. The season needs two
-- facts about a day: how many puzzles were finished, and whether any was
-- started. The first is in `results`, which is the account's history and
-- carries user_id. The second is in `plays` — and `plays` HAS NO USER, on
-- purpose. functions/api/play.js says so in as many words: it records whether
-- the owner was testing "and nothing else: no email, no user id, and nothing
-- at all about any other player."
--
-- So the loss condition — started and did not finish — cannot be computed for
-- an account from what exists, and the way to get it is NOT to attach identity
-- to the anonymous telemetry. That would reverse a deliberate decision for a
-- feature that does not need it: a season does not want to know where a player
-- came from, what campaign referred them, or how many checks they used. It
-- wants two numbers a day.
--
-- Hence a purpose-built row, written only for a signed-in player, holding only
-- what a season is made of. Someone reading this table learns which days a
-- player turned up and how many puzzles they finished — which is exactly what
-- the hub shows them about themselves, and nothing more.
--
-- ONE ROW PER GAME PER DAY, not a counter, because "finished 2 or more" means
-- two PUZZLES and a counter cannot say whether the same game was counted
-- twice. The primary key makes a second start of the same board idempotent,
-- which a reload, a double tap or a resumed round will all produce.
--
-- The day is a UTC date string: the SERVER decides what day it is, and a
-- device clock is not a day.
--
-- Applied once, and safe to run twice.

CREATE TABLE IF NOT EXISTS season_play (
  user_id     TEXT NOT NULL,
  day         TEXT NOT NULL,          -- YYYY-MM-DD, the server's UTC day
  game        TEXT NOT NULL,          -- crossword | wordsearch | scrambled | hilo | vowels
  started_at  TEXT NOT NULL,
  finished_at TEXT,                   -- null until it is finished; that IS the loss condition
  PRIMARY KEY (user_id, day, game)
);

-- The season is read a day at a time, newest first, for one player.
CREATE INDEX IF NOT EXISTS season_play_user_day ON season_play (user_id, day DESC);
