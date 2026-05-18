-- 182: external_id_mapping table for cross-provider event ID resolution
-- Stores fuzzy-matched mappings between events_v2.id and external provider IDs
-- (api-football, flashscore, odds-api). Confidence-scored, with verified flag
-- gate for writes to events_v2 timer/score fields.

CREATE TABLE IF NOT EXISTS external_id_mapping (
  event_id UUID NOT NULL REFERENCES events_v2(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('api-football', 'flashscore', 'odds-api')),
  external_id TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.0,
  verified BOOLEAN NOT NULL DEFAULT false,
  matched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, provider),
  UNIQUE (provider, external_id)
);

-- Rollback: DROP TABLE IF EXISTS external_id_mapping;
