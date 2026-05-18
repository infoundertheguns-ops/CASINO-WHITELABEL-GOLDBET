CREATE TABLE external_id_mapping (
  event_id UUID NOT NULL REFERENCES events_v2(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('api-football', 'flashscore', 'odds-api')),
  external_id TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.0,
  verified BOOLEAN NOT NULL DEFAULT false,
  matched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, provider),
  UNIQUE (provider, external_id)
);

CREATE INDEX idx_external_id_mapping_provider_external
  ON external_id_mapping(provider, external_id);

CREATE INDEX idx_external_id_mapping_event_id
  ON external_id_mapping(event_id);
