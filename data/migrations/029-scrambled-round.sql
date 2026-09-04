-- 029 — Scrambled XI: the clock and the help the server owns, so a score can
-- be verified.
--
-- The same job migration 028 did for HiLo, and a simpler one. HiLo scores each
-- call on its own twelve-second clock, so the server had to know when every
-- one of eleven calls was shown. Scrambled has ONE clock for the board — a
-- ninety-minute match in fifteen real minutes, five for a consonant board —
-- and a score is 114 with time and help taken off it. So the server needs
-- three things, and it already serves all three:
--
--   started   it can write the moment the round begins
--   solved    it marks every guess, in /api/scrambled/guess
--   help      it serves every reveal, in /api/scrambled/reveal
--
-- WHY THE SOLVES NEED A TABLE AND THE HELP DOES NOT. Help only has to be
-- added up, and the server is the thing adding it, so it accumulates on the
-- round. A solve has to be counted ONCE: the same slot can be guessed again
-- after a dropped connection, and a round is finished when eleven distinct
-- slots are done. So a row per slot, keyed by the slot, and a second guess at
-- one already solved changes nothing.
--
-- `how` keeps the distinction the game already makes on screen: a name worked
-- out is not a name bought, and full time counts them separately.
--
-- A SLOT THAT ARRIVED FREE HAS NO ROW HERE AND NEEDS NONE. In the consonant
-- cypher a name with no vowels IS its own cypher, so the board hands it over
-- at kick off, the page never guesses it and nothing is ever sent up for it.
-- The server counts those off the board instead, which is why a full house is
-- the board's slots minus the ones it gave away rather than a flat eleven.
--
-- Applied once, and safe to run twice: both statements are IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS sc_round (
  play_id     TEXT PRIMARY KEY,      -- the attempt, from /api/play
  token       TEXT NOT NULL,         -- which board, and in which cypher
  started_ms  INTEGER NOT NULL,      -- kick off, by this server's clock
  help        INTEGER NOT NULL DEFAULT 0,  -- points of help it has served
  -- The careers hint is ONE purchase for the whole board, not eleven: the
  -- page charges it on the transition and a second click bills nothing. The
  -- server has to keep the same rule or the two scores differ by three.
  hinted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sc_solve (
  play_id     TEXT NOT NULL,
  slot_id     TEXT NOT NULL,
  how         TEXT NOT NULL,         -- 'solved' | 'revealed'
  at_ms       INTEGER NOT NULL,
  PRIMARY KEY (play_id, slot_id)
);
