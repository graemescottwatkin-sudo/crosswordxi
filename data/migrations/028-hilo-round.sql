-- 028 — HiLo XI: the clock the server owns, so a score can be verified.
--
-- WHY THIS EXISTS. A challenge table is only worth looking at if the scores in
-- it were computed by the server — plays.srv_score, which no endpoint accepts
-- from a browser. Until now only Crossword XI wrote one, because /api/finish
-- marks the grid from answers the server holds and times the sitting from a
-- clock it started. HiLo already judges every call server-side, so WHICH calls
-- were right has never been forgeable. What it could not know was WHEN each
-- call was shown — and this game's score is per-call speed: ten points inside
-- the grace, falling a point a second to nothing.
--
-- So the server keeps the clock. hl_round holds where the current call's clock
-- started; hl_call is the record of each call as it was judged, with the
-- elapsed the server measured itself.
--
-- TWO MOMENTS START A CLOCK, which is why there is a clock_ms to update rather
-- than an arithmetic on the call rows alone. After a RIGHT call the next call
-- is shown at once, so its clock starts when this server answered. After a
-- WRONG call the round waits for a tap of Next, and the gap before that tap is
-- not thinking time — so the page says when the clock restarted and that is
-- the only thing about timing the browser gets to say. It can only ever move
-- the start LATER, which costs the player points; there is nothing to gain.
--
-- MILLISECONDS AS INTEGERS, not datetime(). The clock is twelve seconds and
-- scored to the second, so second-resolution text would round a call's worth
-- by a whole point.
--
-- Applied once, and safe to run twice: both statements are IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS hl_round (
  play_id     TEXT PRIMARY KEY,       -- the attempt, from /api/play
  token       TEXT NOT NULL,          -- which board, so a round cannot change board
  started_ms  INTEGER NOT NULL,       -- kick off, by this server's clock
  clock_ms    INTEGER NOT NULL        -- when the current call's clock started
);

CREATE TABLE IF NOT EXISTS hl_call (
  play_id     TEXT NOT NULL,
  idx         INTEGER NOT NULL,       -- which call, 1 to 11
  called      TEXT NOT NULL,          -- 'higher' | 'lower', as it was sent
  was_right   INTEGER NOT NULL,       -- this server's verdict, not a claim
  elapsed_ms  INTEGER NOT NULL,       -- measured here, from clock_ms
  at_ms       INTEGER NOT NULL,       -- when it was judged
  PRIMARY KEY (play_id, idx)
);
