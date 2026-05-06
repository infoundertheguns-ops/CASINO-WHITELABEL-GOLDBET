-- Migration 179 — sport-aware mark_stale_lives_settled
--
-- Context:
--   The previous version used a flat 6h threshold from starts_at. For sports
--   like calcio (~2h matches) or basket (~2.5h), this leaked dozens of
--   "ghost-live" rows into the live listing — events that finished hours
--   earlier but odds-api had stopped returning, so the ingester upsert
--   couldn't demote them. Manual cleanup on 2026-05-07 with 3h threshold
--   settled 78 events at once.
--
--   Tennis (5-set Grand Slam can run 5h+) and snooker/darts (long matches)
--   need a more lenient threshold to avoid false-positive demotion that
--   gets re-promoted by the next [live] cycle (causing publisher noise:
--   finished → live → finished within 30s).
--
-- Behaviour:
--   Replaces the flat threshold with a sport-aware CASE on
--   events_v2.sport_slug. The p_max_live_hours param now acts as a
--   FALLBACK for unmapped sports (default 4h, was 6h).
--
--   Per-sport hours:
--     football, basketball, handball, volleyball, mma, boxing → 3h
--     baseball, snooker, darts, esports, american-football    → 4h
--     tennis, cricket                                          → 6h
--     other (rugby, ice-hockey, etc) → falls through to p_max_live_hours
--
--   Tennis is 6h to cover Grand Slam 5-setters; cricket can also run long.
--   ice-hockey defaults to fallback (4h) which covers OT shootouts.
--
-- Rollback:
--   Re-apply the prior function definition (kept inline in repo history).

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_stale_lives_settled(p_max_live_hours integer DEFAULT 4)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_v2_settled       int := 0;
  v_legacy_settled   int := 0;
  v_t0 timestamptz := now();
BEGIN
  -- Step 1: events_v2 — flip status='live' → 'settled' using sport-aware cutoff.
  UPDATE events_v2
  SET status     = 'settled',
      updated_at = now()
  WHERE status   = 'live'
    AND starts_at < now() - make_interval(hours =>
      CASE sport_slug
        WHEN 'football'    THEN 3
        WHEN 'basketball'  THEN 3
        WHEN 'handball'    THEN 3
        WHEN 'volleyball'  THEN 3
        WHEN 'mma'         THEN 3
        WHEN 'boxing'      THEN 3
        WHEN 'baseball'    THEN 4
        WHEN 'snooker'     THEN 4
        WHEN 'darts'       THEN 4
        WHEN 'esports'     THEN 4
        WHEN 'american-football' THEN 4
        WHEN 'tennis'      THEN 6
        WHEN 'cricket'     THEN 6
        ELSE p_max_live_hours
      END
    );
  GET DIAGNOSTICS v_v2_settled = ROW_COUNT;

  -- Step 2: legacy events — same change, matched by 'odds-api:<id>' external_id.
  -- Avoids a 60s wait for the next derive_legacy_from_v2() heartbeat.
  UPDATE events e
  SET status     = 'ended',
      is_live    = false,
      updated_at = now()
  FROM events_v2 v2
  WHERE e.external_id = 'odds-api:' || v2.odds_api_id::text
    AND v2.status     = 'settled'
    AND v2.updated_at >= v_t0
    AND e.is_live      = true;
  GET DIAGNOSTICS v_legacy_settled = ROW_COUNT;

  RETURN jsonb_build_object(
    'v2_settled',      v_v2_settled,
    'legacy_settled',  v_legacy_settled,
    'threshold_hours', p_max_live_hours,
    'duration_ms',     (EXTRACT(EPOCH FROM (now() - v_t0)) * 1000)::int,
    'cutoff',          v_t0
  );
END;
$function$;

COMMENT ON FUNCTION public.mark_stale_lives_settled(integer) IS
  'Sport-aware stale-lives sweeper (mig 179). Per-sport thresholds vs flat 6h. Param is fallback for unmapped sports.';

INSERT INTO _migrations (name, applied_at)
VALUES ('179_mark_stale_lives_sport_aware', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;
