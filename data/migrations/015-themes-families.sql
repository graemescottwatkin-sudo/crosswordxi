-- 015-themes-families.sql
--
-- Groundwork for Clubs and themes: Core / Special / General bands on a club
-- page, replacing numbered boards per club.
--
-- Additive and nullable throughout. Nothing existing is moved, renamed or
-- deleted, and no code in v48 reads any of these columns — so this can be run
-- before the UI that uses it, which is the right order. Deploy code expecting
-- a column before the column exists and the endpoint 500s.

-- Which club a theme belongs to, and which band it sits in.
--
-- Stored rather than derived from the theme id. Splitting "arsenal-strikers"
-- on the first hyphen would work until a club id contains one, and deriving
-- the same fact in two places is the failure this project keeps meeting: the
-- listing and the importer would each hold their own idea of who owns a board
-- and drift apart without either being wrong on its own.
ALTER TABLE themes ADD COLUMN club_id TEXT;
ALTER TABLE themes ADD COLUMN family TEXT;   -- 'core' | 'special' | 'general'

-- Whether a board appears in the listing.
--
-- Deliberately NOT done by pushing release_on into the future. getThemeBoard()
-- treats release_on > today as "this board does not exist", and every token
-- path runs through it — check-answer, reveal and finish included. Future
-- dating an old board would therefore break the live challenges pointing at
-- it, which is the exact thing the additive pivot exists to protect.
--
-- release_on keeps its single meaning: when the board became playable.
-- listed answers a different question: whether it is still on the shelf.
ALTER TABLE theme_boards ADD COLUMN listed INTEGER NOT NULL DEFAULT 1;

-- Existing rows: every theme is its own club, every board stays listed.
-- Topic themes (Grounds, Nicknames, Derbies and the rest) are not clubs and
-- keep a NULL club_id — the bands are a club-page concept and topics keep
-- numbered boards.
UPDATE themes SET club_id = id, family = 'general' WHERE kind = 'club';

CREATE INDEX IF NOT EXISTS idx_themes_club ON themes (club_id, family);
CREATE INDEX IF NOT EXISTS idx_theme_boards_listed ON theme_boards (listed, release_on);
