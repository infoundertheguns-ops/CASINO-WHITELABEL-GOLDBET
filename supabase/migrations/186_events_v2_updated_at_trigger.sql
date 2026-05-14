-- 186_events_v2_updated_at_trigger.sql
--
-- Adds BEFORE UPDATE trigger on events_v2 to auto-refresh updated_at on
-- every UPDATE. Required because the OddsAPI ingester's upsert chunk does
-- not include updated_at, leaving the column stuck at first INSERT.
--
-- Without this trigger, updated_at was effectively a "FS scraper polled
-- this event" proxy (only FS scraper + admin routes set it explicitly).
-- The cancel-stale-live cron read updated_at as "row liveness" — broken
-- for any event in a FS-uncovered league (amateur football, ITF tennis,
-- regional cricket, etc), where the ingester upserts thousands of times
-- per match but updated_at never moves.
--
-- After this trigger:
--   - Every upsert (ingester) refreshes updated_at via DO UPDATE
--   - Every PATCH (cron, admin) refreshes updated_at
--   - cancel-stale-live cron correctly distinguishes "ingester is still
--     refreshing this row" (recent updated_at, keep) from "no one is
--     touching this anymore" (old updated_at, cancel)
--
-- Same pattern as manual_overrides (mig 158) and oddsapi_translations
-- (mig 159). Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.events_v2_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_v2_updated_at ON public.events_v2;

CREATE TRIGGER trg_events_v2_updated_at
BEFORE UPDATE ON public.events_v2
FOR EACH ROW
EXECUTE FUNCTION public.events_v2_set_updated_at();

COMMIT;
