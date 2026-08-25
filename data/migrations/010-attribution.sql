-- 010-attribution.sql — where a player came from.
--
-- Session-scoped attribution: the campaign that brought somebody to the site is
-- attached to every attempt they make during that visit. It does not survive
-- the visit, and that is deliberate — persisting it across days is a tracking
-- identifier and needs consent, which is a decision to take on purpose rather
-- than to arrive at.
--
-- Designed so first-touch can be added later without restructuring:
--
--   * these columns describe THIS attempt's session, and keep their meaning
--     whatever is added alongside
--   * `attribution_scope` says which kind a row carries, so a later first-touch
--     set can live beside these without either being mistaken for the other
--   * a visitor id, when there is one, is a column on this table and a join —
--     not a change to any of the above
--
-- Theme and source stay separate: somebody playing the Arsenal board may have
-- arrived from anywhere, including another page on the site.

ALTER TABLE plays ADD COLUMN utm_source   TEXT;
ALTER TABLE plays ADD COLUMN utm_medium   TEXT;
ALTER TABLE plays ADD COLUMN utm_campaign TEXT;
ALTER TABLE plays ADD COLUMN utm_content  TEXT;
ALTER TABLE plays ADD COLUMN utm_term     TEXT;
ALTER TABLE plays ADD COLUMN referrer     TEXT;
ALTER TABLE plays ADD COLUMN attribution_scope TEXT DEFAULT 'session';

-- The reporting question is "how did this source do", so source leads.
CREATE INDEX IF NOT EXISTS idx_plays_source
  ON plays (utm_source, utm_campaign, utm_content);

-- Check it took: expect all seven at the foot of the list.
-- PRAGMA table_info(plays);
