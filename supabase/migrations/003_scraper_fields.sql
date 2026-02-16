-- ============================================================
-- MIGRATION 003: Scraper support — unique indexes for upsert
-- ============================================================
-- Columns external_id, minute, previous_odds already exist in 001.
-- This migration adds the unique indexes required by the scraper
-- API routes for ON CONFLICT upsert operations.
-- ============================================================

BEGIN;

-- Add columns IF NOT EXISTS (safe for fresh or existing DBs)
ALTER TABLE events ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS minute INT;
ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS previous_odds DECIMAL(8,2);

-- Unique index on events.external_id for scraper upsert
-- PostgreSQL allows multiple NULLs in unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_external_id
  ON events(external_id);

-- Unique index on markets(event_id, market_type) for market upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_markets_event_type
  ON markets(event_id, market_type);

-- Unique index on outcomes(market_id, name) for outcome upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_outcomes_market_name
  ON outcomes(market_id, name);

COMMIT;
