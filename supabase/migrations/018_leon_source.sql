-- Migration 018: Add 'leon' to the GENERATED source column
-- Leon Bets events use prefix "leon:" in external_id

-- Must DROP then re-ADD because GENERATED columns can't be ALTERed
ALTER TABLE events DROP COLUMN IF EXISTS source;

ALTER TABLE events ADD COLUMN source TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN external_id LIKE 'kambi:%' THEN 'kambi'
      WHEN external_id LIKE 'leon:%' THEN 'leon'
      ELSE 'goldbet'
    END
  ) STORED;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
