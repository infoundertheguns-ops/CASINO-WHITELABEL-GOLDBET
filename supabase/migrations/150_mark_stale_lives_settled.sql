-- Migration 150: mark_stale_lives_settled() — auto-settle events_v2 rows that
-- are stuck as status='live' long after their start time.
--
-- Problem: when odds-api.io stops returning an event (because upstream has
-- finalised the match), our live tier no longer upserts it. The events_v2 row
-- keeps status='live' indefinitely. The player live page then shows ghosts
-- (e.g. football matches still "live" 12h after kickoff).
--
-- Heuristic: any event with status='live' AND starts_at < now() - threshold
-- is almost certainly over. Threshold defaults to 6h, which is safe for the
-- longest realistic live windows we ingest (cricket/tennis 5-set best of 5).
-- Football/basket/hockey are typically <3h end-to-end, so 6h has a comfortable
-- margin. Per-sport tuning can be added later if needed.
--
-- The RPC also propagates to the legacy `events` table via the same
-- 'odds-api:<id>' external_id key used by derive_legacy_from_v2(), so the
-- player frontend (which reads legacy) sees the change immediately without
-- waiting for the next derive heartbeat.
--
-- Idempotent: CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_stale_lives_settled(
  p_max_live_hours int DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $$
DECLARE
  v_v2_settled       int := 0;
  v_legacy_settled   int := 0;
  v_t0 timestamptz := now();
  v_cutoff timestamptz := now() - make_interval(hours => p_max_live_hours);
BEGIN
  -- Step 1: events_v2 — flip status='live' → 'settled' for events past cutoff.
  UPDATE events_v2
  SET status     = 'settled',
      updated_at = now()
  WHERE status   = 'live'
    AND starts_at < v_cutoff;
  GET DIAGNOSTICS v_v2_settled = ROW_COUNT;

  -- Step 2: legacy events — same change, matched by 'odds-api:<id>' external_id.
  -- This avoids a 60s wait for the next derive_legacy_from_v2() heartbeat.
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
    'v2_settled',         v_v2_settled,
    'legacy_settled',     v_legacy_settled,
    'threshold_hours',    p_max_live_hours,
    'cutoff',             v_cutoff,
    'duration_ms',        extract(milliseconds from (now() - v_t0))::int
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_stale_lives_settled(int) TO service_role;

COMMIT;
