-- Migration 104 — Auto-deactivate markets/outcomes when event transitions to status='ended'
--
-- Problem: scrapers 22bet/betfair (and occasionally kambi on bug paths) mark
-- events.status='ended' directly via upsert without passing through the
-- admin `deactivateEvent()` helper. This leaves markets/outcomes with
-- is_active=true pointing at ended events — orphan rows that pollute
-- /admin/consensus with cap-placeholder odds (1500+) and grow storage
-- indefinitely (~1M rows/day for 22bet).
--
-- Fix: DB-level trigger that cascades the deactivation atomically in the
-- same transaction as the status change. Zero backlog structurally going
-- forward. Source-agnostic (kambi benefits too as belt-and-braces on top
-- of its healthy settlement pipeline).
--
-- Backfill of existing ~1.47M orphan rows is handled separately by batch
-- script (see task #3) after this trigger is in place to avoid races.

-- ═══ Function ═══
CREATE OR REPLACE FUNCTION public.fn_deactivate_on_event_ended()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- Deactivate markets for this event
  UPDATE public.markets
     SET is_active = false,
         is_suspended = true,
         updated_at = v_now
   WHERE event_id = NEW.id
     AND (is_active = true OR is_suspended = false);

  -- Deactivate outcomes for those markets
  UPDATE public.outcomes
     SET is_active = false,
         is_suspended = true,
         updated_at = v_now
   WHERE market_id IN (
           SELECT id FROM public.markets WHERE event_id = NEW.id
         )
     AND (is_active = true OR is_suspended = false);

  RETURN NEW;
END;
$$;

-- ═══ Trigger ═══
-- Drop existing trigger if any (idempotent replay)
DROP TRIGGER IF EXISTS trg_deactivate_on_event_ended ON public.events;

CREATE TRIGGER trg_deactivate_on_event_ended
AFTER UPDATE OF status ON public.events
FOR EACH ROW
WHEN (NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended')
EXECUTE FUNCTION public.fn_deactivate_on_event_ended();

-- ═══ Verification notes (post-deploy) ═══
-- 1. Pick a live event about to end and run:
--      UPDATE events SET status='ended' WHERE id='<uuid>';
--    then verify:
--      SELECT COUNT(*) FROM outcomes o
--       JOIN markets m ON m.id=o.market_id
--       WHERE m.event_id='<uuid>' AND o.is_active=true;
--    → should return 0.
--
-- 2. Latency check (for event with ~200 outcomes, expected <100ms):
--      EXPLAIN (ANALYZE, BUFFERS)
--      UPDATE events SET status='ended' WHERE id='<uuid>';
--
-- 3. Trigger does NOT fire on UPDATE that doesn't change status.
--    Scraper upsert writes (minute, score, is_live) stay untouched.
