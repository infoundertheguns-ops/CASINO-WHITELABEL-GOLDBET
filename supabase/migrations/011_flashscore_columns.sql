-- Migration 011: Add flashscore_id to events for cross-source matching
-- Flashscore does NOT create events — it only matches existing ones for settlement verification

ALTER TABLE events ADD COLUMN IF NOT EXISTS flashscore_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_flashscore_id
  ON events(flashscore_id) WHERE flashscore_id IS NOT NULL;
