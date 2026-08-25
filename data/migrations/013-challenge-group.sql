-- 013-challenge-group.sql — who sent it, and who it went to.
--
-- One field was doing two jobs. A challenge has a creator — a person, whose
-- name comes from their account when they have one — and it has an audience,
-- which is whatever the sender calls the group: "the five-a-side lot", "work",
-- "Test". Asking for one name got the other, and the page then read "Test
-- challenged you" over a board sent by Graeme.
--
-- Nullable, because a challenge sent to one person does not need a group name
-- and being made to invent one would be a form standing between somebody and
-- sending a link.

ALTER TABLE challenges ADD COLUMN group_name TEXT;
