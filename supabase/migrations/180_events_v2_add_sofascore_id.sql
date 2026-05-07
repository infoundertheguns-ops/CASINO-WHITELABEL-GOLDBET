-- supabase/migrations/180_events_v2_add_sofascore_id.sql
-- Add SofaScore foreign-id column to events_v2.
-- Mirror of flashscore_id pattern. Nullable, no FK, indexed for direct lookup.

ALTER TABLE events_v2 ADD COLUMN IF NOT EXISTS sofascore_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_events_v2_sofascore_id
  ON events_v2 (sofascore_id) WHERE sofascore_id IS NOT NULL;

-- Rollback (manual):
--   DROP INDEX IF EXISTS idx_events_v2_sofascore_id;
--   ALTER TABLE events_v2 DROP COLUMN IF EXISTS sofascore_id;
