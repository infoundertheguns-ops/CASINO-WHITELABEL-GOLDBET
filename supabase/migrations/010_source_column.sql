-- 010: Add generated `source` column to events table
-- Distinguishes Goldbet vs Kambi events based on external_id prefix

ALTER TABLE events ADD COLUMN IF NOT EXISTS source TEXT
  GENERATED ALWAYS AS (
    CASE WHEN external_id LIKE 'kambi:%' THEN 'kambi' ELSE 'goldbet' END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
