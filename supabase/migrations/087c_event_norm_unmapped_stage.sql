-- ═══════════════════════════════════════════════════
-- Migration 087c: Add 'unmapped' stage + extend CHECK
--
-- Engine must persist unmapped events as negative-cache rows so that
-- subsequent backfill runs skip them (by joining on event_normalization).
-- Without this, backfill loops forever on the ~90%+ niche events that
-- have no flashscore candidate.
--
-- A scheduled retry can clear low-confidence / unmapped rows after N days
-- so they get re-tried when flashscore catches up, but by default the
-- cron simply excludes events already in event_normalization.
-- ═══════════════════════════════════════════════════

-- Drop the old CHECK (Postgres doesn't support adding a value to an existing
-- CHECK constraint in place; we have to DROP + ADD).
ALTER TABLE event_normalization
  DROP CONSTRAINT IF EXISTS event_normalization_match_stage_check;

ALTER TABLE event_normalization
  ADD CONSTRAINT event_normalization_match_stage_check
  CHECK (match_stage IN (
    'flashscore_native','regex','trigram','alias_dict','propagation','llm','manual','unmapped'
  ));

-- Make flashscore_id nullable so unmapped rows can be stored with NULL fsid.
ALTER TABLE event_normalization
  ALTER COLUMN flashscore_id DROP NOT NULL;

-- Index to support periodic retry of old unmapped rows (if we want to add
-- that cron later). For now, just enables efficient filter.
CREATE INDEX IF NOT EXISTS idx_event_norm_unmapped_age ON event_normalization(created_at)
  WHERE match_stage = 'unmapped';

COMMENT ON CONSTRAINT event_normalization_match_stage_check ON event_normalization IS
  'Extended CHECK to include unmapped as negative-cache stage. flashscore_id may be NULL iff match_stage=unmapped.';
