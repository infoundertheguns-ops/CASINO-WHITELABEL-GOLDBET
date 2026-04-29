-- ═══════════════════════════════════════════════════
-- Migration 088e: Auto-suspend tiered from consensus outliers
--
-- Cron-callable stored proc that scans recent consensus outliers on
-- "core" market types with abs_delta_pct above a threshold and
-- auto-suspends the Kambi outcome for a short TTL.
--
-- Rationale: if Kambi's odds diverge drastically from 22bet on a market
-- that real players actively bet (1X2 / GG-NG / U-O / DC / Handicap),
-- the safer default is to freeze the outcome while the operator reviews.
-- Self-heals: if Kambi normalizes within the TTL, the outcome reopens
-- automatically via cleanup_expired_manual_overrides.
--
-- Deliberately idempotent:
--   - does nothing if consensus already has an auto_suspend action in
--     the last hour (prevents thrash if the consensus cron re-inserts)
--   - skips if the outcome already has manual_suspended=true
-- ═══════════════════════════════════════════════════

-- Drop any prior signatures before re-creating (signature evolved to include p_max_per_run)
DROP FUNCTION IF EXISTS auto_suspend_consensus_outliers(numeric, int, int);
DROP FUNCTION IF EXISTS auto_suspend_consensus_outliers(numeric, int, int, int);

CREATE OR REPLACE FUNCTION auto_suspend_consensus_outliers(
  p_threshold_pct numeric DEFAULT 50,
  p_duration_minutes int DEFAULT 30,
  p_lookback_minutes int DEFAULT 60,
  p_max_per_run int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_outcome_id uuid;
  v_current_manual boolean;
  v_suspended int := 0;
  v_skipped_already_manual int := 0;
  v_skipped_no_outcome int := 0;
  v_skipped_recent_action int := 0;
BEGIN
  FOR v_rec IN
    SELECT
      c.id AS consensus_id,
      c.market_type,
      c.outcome_name,
      c.kambi_event_id,
      c.abs_delta_pct,
      c.delta_pct,
      c.snapshot_at
    FROM v_consensus_latest c
    WHERE c.abs_delta_pct >= p_threshold_pct
      AND c.reviewed = false
      AND c.snapshot_at >= now() - make_interval(mins => p_lookback_minutes)
      AND (
        -- Core market families
        c.market_type = '1X2'
        OR c.market_type LIKE '1X2 H %'
        OR c.market_type = 'GG/NG'
        OR c.market_type LIKE 'GG/NG %'
        OR c.market_type LIKE 'U/O %'
        OR c.market_type = 'DC'
        OR c.market_type LIKE 'DC %'
        OR c.market_type LIKE 'Handicap%'
        OR c.market_type LIKE 'Handicap Asiatico%'
      )
    ORDER BY c.abs_delta_pct DESC
  LOOP
    -- Throttle: stop once max_per_run suspensions have been applied
    EXIT WHEN v_suspended >= p_max_per_run;
    -- Skip if the same consensus already had an auto_suspend action recently
    IF EXISTS (
      SELECT 1 FROM outcome_manual_actions a
      WHERE a.consensus_id = v_rec.consensus_id
        AND a.action_type = 'auto_suspend'
        AND a.created_at > now() - interval '1 hour'
    ) THEN
      v_skipped_recent_action := v_skipped_recent_action + 1;
      CONTINUE;
    END IF;

    -- Resolve Kambi outcome
    SELECT o.id, o.manual_suspended
      INTO v_outcome_id, v_current_manual
    FROM markets m
    JOIN outcomes o ON o.market_id = m.id
    WHERE m.event_id = v_rec.kambi_event_id
      AND m.market_type = v_rec.market_type
      AND o.name = v_rec.outcome_name
    ORDER BY o.is_active DESC, o.updated_at DESC
    LIMIT 1;

    IF v_outcome_id IS NULL THEN
      v_skipped_no_outcome := v_skipped_no_outcome + 1;
      CONTINUE;
    END IF;

    -- Do not overwrite an operator-set manual suspend
    IF v_current_manual THEN
      v_skipped_already_manual := v_skipped_already_manual + 1;
      CONTINUE;
    END IF;

    -- Suspend via canonical RPC (chains SECURITY DEFINER)
    PERFORM suspend_outcome(
      p_outcome_id := v_outcome_id,
      p_reason := format(
        'auto_consensus: Δ=%s%% %s on %s',
        round(v_rec.abs_delta_pct, 1),
        CASE WHEN v_rec.delta_pct > 0 THEN 'higher' ELSE 'lower' END,
        v_rec.market_type
      ),
      p_duration_minutes := p_duration_minutes,
      p_user_id := NULL,
      p_consensus_id := v_rec.consensus_id,
      p_source := 'auto_consensus'
    );

    -- Mark the consensus snapshot reviewed so it stops being auto-processed
    -- and moves visually into the "handled" bucket on the consensus page.
    UPDATE consensus_snapshots
      SET reviewed = true,
          reviewed_at = now(),
          notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE ' | ' END ||
                  format('auto_suspend %sm', p_duration_minutes)
    WHERE id = v_rec.consensus_id;

    v_suspended := v_suspended + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'suspended', v_suspended,
    'skipped_already_manual', v_skipped_already_manual,
    'skipped_no_outcome', v_skipped_no_outcome,
    'skipped_recent_action', v_skipped_recent_action,
    'threshold_pct', p_threshold_pct,
    'duration_minutes', p_duration_minutes,
    'lookback_minutes', p_lookback_minutes,
    'max_per_run', p_max_per_run,
    'ran_at', now()
  );
END;
$$;

COMMENT ON FUNCTION auto_suspend_consensus_outliers IS
  'Cron-callable: scan recent consensus outliers on core markets above threshold and auto-suspend the Kambi outcome for p_duration_minutes. Idempotent (skips if same consensus already auto-suspended in last hour, never overwrites operator-set manual_suspended). Throttled by p_max_per_run to avoid overwhelming the system on a backlog.';

REVOKE ALL ON FUNCTION auto_suspend_consensus_outliers(numeric, int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_suspend_consensus_outliers(numeric, int, int, int) TO service_role;
