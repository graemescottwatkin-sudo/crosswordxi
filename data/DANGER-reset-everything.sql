-- ⚠️  DESTROYS EVERYTHING, INCLUDING ACCOUNTS  ⚠️
--
-- Drops and recreates every table: clues, puzzles, users, sessions, results.
-- Every registered player and every stored result is deleted permanently.
--
-- This exists for starting again on an empty project. If anybody other than you
-- has signed in, do not run it. Use data/schema.sql (safe, additive) and the
-- files in data/migrations/ instead.

DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS puzzles;
DROP TABLE IF EXISTS clues;

-- Then run data/schema.sql to rebuild them.
