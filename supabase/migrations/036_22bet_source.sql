-- Migration 036: Add '22bet' to the GENERATED source column on events
-- 22bet scraper uses prefix "22bet:" in external_id
--
-- Must DROP then re-ADD because GENERATED columns can't be ALTERed.
-- This rewrites the `source` value for every existing row, but it is a
-- pure read of `external_id` so Postgres does it in a single table scan.
-- Tested on ~2k rows (current events volume) → well under 1s.

ALTER TABLE events DROP COLUMN IF EXISTS source;

ALTER TABLE events ADD COLUMN source TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN external_id LIKE 'kambi:%' THEN 'kambi'
      WHEN external_id LIKE 'leon:%' THEN 'leon'
      WHEN external_id LIKE '22bet:%' THEN '22bet'
      ELSE 'goldbet'
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
