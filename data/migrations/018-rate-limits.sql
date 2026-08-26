-- One row per (endpoint, caller) per window. Fixed-window counting: coarse,
-- cheap, and enough — the threat is a curl loop filling a table, not a
-- distributed attack. Rows are upserted in place, so the table stays at
-- roughly (endpoints x recent callers) rows rather than growing per request.
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,          -- name:ip
  window_start INTEGER NOT NULL,
  n INTEGER NOT NULL
);
