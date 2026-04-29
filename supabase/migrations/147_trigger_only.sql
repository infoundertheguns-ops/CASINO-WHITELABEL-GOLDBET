-- Migration 147 (split v1): trigger only, no cleanup.
--
-- Phase 1.D cleanup-first: blocks NEW kambi inserts/upserts for major sports
-- (odds-api covers them better via derive_legacy_from_v2). Existing kambi
-- major sport events remain in the table and roll off naturally as their
-- starts_at passes. Cleanup of those existing rows is handled by a separate
-- batched script (scripts/db/cleanup-kambi-major-sports.mjs) run alongside
-- the ingester for ~1 hour to drain.
--
-- Idempotent. Rollback: DROP TRIGGER trg_events_block_kambi_major;
--                       DROP FUNCTION events_block_kambi_major_sports();

BEGIN;

CREATE OR REPLACE FUNCTION public.events_block_kambi_major_sports()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.external_id LIKE 'kambi:%' THEN
    IF EXISTS (
      SELECT 1 FROM sports s
      WHERE s.id = NEW.sport_id
        AND s.slug IN (
          'calcio', 'basket', 'tennis', 'baseball', 'rugby', 'cricket',
          'volley', 'pallamano', 'hockey-ghiaccio'
        )
    ) THEN
      RETURN NULL;  -- silently drop
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_block_kambi_major ON public.events;

CREATE TRIGGER trg_events_block_kambi_major
BEFORE INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.events_block_kambi_major_sports();

COMMIT;
