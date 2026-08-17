-- 007-archive-elimination-clues.sql
--
-- Archives every clue that identifies its answer by ruling other clubs out.
--
--   "London — not Arsenal"                  => Hammers
--   "London — not Chelsea, Tottenham or Queens"  => Irons
--   "Rovers — not Doncaster"                => Blackburn
--
-- Two things are wrong with the form. It is a poor clue: it gives a city and a
-- list of wrong answers, and asks the player to arrive at a club by
-- subtraction rather than by knowing anything. And it drags other clubs into
-- the clue as negatives, which is what put "London — not Arsenal" onto an
-- Arsenal themed board — a clue naming Arsenal purely to say it is not the
-- answer.
--
-- The better version already exists for most of them. "West Ham United" =>
-- Hammers, "Queens Park Rangers" => Hoops and "Chelsea" => Blues are all in
-- the bank as Club → Nickname clues, sitting alongside the weak ones. Four
-- answers lose their only clue and need a replacement written: Spurs,
-- Blackburn, Doncaster and Doncaster Rovers.
--
-- max_per = 0 archives without deleting, which is the schema's own way and
-- keeps the row and its reason for the next person who wonders.
--
-- THIS IS HALF THE JOB. Data in D1 takes effect immediately; data.json does
-- not know about it, and the next rebuild from source will put all eleven back
-- in circulation. The same change has to be made in the bank.

UPDATE clues SET max_per = 0, notes =
  COALESCE(notes || ' ', '') || '[Archived: identifies by elimination.]'
WHERE id IN (
  '121',            -- London — not Chelsea                      => Arsenal
  '126',            -- London — not Arsenal                      => Chelsea
  'CN3QUEENS0',     -- London — not Chelsea or Tottenham         => Hoops
  'CN3WESTHA0',     -- London — not Arsenal                      => Hammers
  'CN3WESTHA1',     -- London — not Chelsea, Tottenham or Queens => Irons
  'CNCHELSEA',      -- London — not Tottenham or Queens          => Blues
  'CNTOTTENHAMH',   -- London — not Chelsea or Queens            => Spurs
  'NC3BLACKB0',     -- Rovers — not Doncaster                    => Blackburn
  'NC3DONCAS0',     -- Rovers — not Blackburn                    => Doncaster
  'NC2018',         -- Rovers — not Doncaster                    => Blackburn Rovers
  'NC2027'          -- Rovers — not Blackburn                    => Doncaster Rovers
);

-- Check it did what it says: expect 11.
-- SELECT COUNT(*) FROM clues WHERE max_per = 0 AND clue LIKE '%— not %';
