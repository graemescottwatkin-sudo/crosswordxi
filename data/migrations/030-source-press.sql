-- 030 — who opened a source, and how many times today.
--
-- The owner's position, in their words: "i dont mind sharing sources but i
-- dont want it mass requested by a single user". So a citation stops being
-- something the page is handed and becomes something an ACCOUNT asks for, one
-- press at a time, with a ceiling.
--
-- WHY A ROW PER USER PER DAY AND NOT A ROW PER PRESS. The two questions asked
-- were "who, and how often" and "stop one account taking the lot", and a
-- daily counter answers both in one read: the cap is the count, and the count
-- IS the how-often. A row per press would answer a third question nobody has
-- asked — which source is popular — at the cost of a row for every press
-- forever. The day is a UTC date string, because the SERVER decides what day
-- it is and a device clock is not a day.
--
-- The count is incremented by ON CONFLICT, so two presses landing together
-- cannot both read 4 and both write 5.
--
-- Applied once, and safe to run twice.

CREATE TABLE IF NOT EXISTS source_press (
  user_id     TEXT NOT NULL,          -- the account; there is no anonymous press
  day         TEXT NOT NULL,          -- YYYY-MM-DD, the server's UTC day
  presses     INTEGER NOT NULL DEFAULT 0,
  last_at     TEXT,                   -- when the most recent one was, for a look
  PRIMARY KEY (user_id, day)
);

-- "Who is opening the most sources" is the query this exists to answer, and it
-- reads a day at a time or all of them at once.
CREATE INDEX IF NOT EXISTS source_press_day ON source_press (day, presses DESC);
