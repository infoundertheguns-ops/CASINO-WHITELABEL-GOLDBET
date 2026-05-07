-- supabase/migrations/181_create_event_enrichment.sql
-- New table for SofaScore enrichment payloads, 1:1 with events_v2.

CREATE TABLE IF NOT EXISTS event_enrichment (
  event_v2_id          UUID PRIMARY KEY REFERENCES events_v2(id) ON DELETE CASCADE,
  sofa_event_id        BIGINT NOT NULL UNIQUE,
  sport_slug           TEXT NOT NULL,

  -- 10 endpoint payloads (jsonb, nullable, independently populated)
  stats                JSONB,
  lineups              JSONB,
  incidents            JSONB,
  momentum             JSONB,
  shotmap              JSONB,
  best_players         JSONB,
  highlights           JSONB,
  comments             JSONB,
  votes                JSONB,
  featured_players     JSONB,

  -- telemetry
  last_synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_endpoint_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_enrichment_last_synced
  ON event_enrichment (last_synced_at);

CREATE INDEX IF NOT EXISTS idx_event_enrichment_sport_slug
  ON event_enrichment (sport_slug);

-- Rollback: DROP TABLE event_enrichment;
