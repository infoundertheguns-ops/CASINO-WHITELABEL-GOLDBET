-- Rollback for migration 162 — restore original RPC bodies (without dual-write)

DROP FUNCTION IF EXISTS _resolve_v2_outcome_for_legacy(uuid);
DROP FUNCTION IF EXISTS _upsert_manual_override_v2(uuid, numeric, boolean, boolean, timestamptz, text, text);

-- Restore original suspend_outcome (verified body 2026-04-30)
CREATE OR REPLACE FUNCTION suspend_outcome(
  p_outcome_id        uuid,
  p_reason            text,
  p_duration_minutes  integer,
  p_user_id           uuid,
  p_consensus_id      bigint,
  p_source            text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_expires timestamptz;
  v_audit_id bigint;
  v_action text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outcomes WHERE id = p_outcome_id) THEN
    RETURN jsonb_build_object('error', 'outcome not found', 'outcome_id', p_outcome_id);
  END IF;
  v_old := _snapshot_manual_state(p_outcome_id);
  v_expires := CASE WHEN p_duration_minutes IS NULL THEN NULL ELSE now() + make_interval(mins => p_duration_minutes) END;
  UPDATE outcomes SET manual_suspended = true, manual_reason = p_reason, manual_expires_at = v_expires, manual_set_by = p_user_id, manual_set_at = now() WHERE id = p_outcome_id;
  v_new := _snapshot_manual_state(p_outcome_id);
  v_action := CASE WHEN p_source = 'auto_consensus' THEN 'auto_suspend' ELSE 'suspend' END;
  INSERT INTO outcome_manual_actions (outcome_id, action_type, old_value, new_value, reason, source, consensus_id, created_by)
    VALUES (p_outcome_id, v_action, v_old, v_new, p_reason, p_source, p_consensus_id, p_user_id) RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object('success', true, 'outcome_id', p_outcome_id, 'audit_id', v_audit_id, 'expires_at', v_expires, 'new_state', v_new);
END; $$;

CREATE OR REPLACE FUNCTION override_outcome_odds(
  p_outcome_id uuid, p_new_odds numeric, p_reason text, p_duration_minutes integer, p_user_id uuid, p_consensus_id bigint
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_old jsonb; v_new jsonb; v_expires timestamptz; v_audit_id bigint;
BEGIN
  IF p_new_odds IS NULL OR p_new_odds <= 1 THEN RETURN jsonb_build_object('error', 'new odds must be > 1', 'outcome_id', p_outcome_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM outcomes WHERE id = p_outcome_id) THEN RETURN jsonb_build_object('error', 'outcome not found', 'outcome_id', p_outcome_id); END IF;
  v_old := _snapshot_manual_state(p_outcome_id);
  v_expires := CASE WHEN p_duration_minutes IS NULL THEN NULL ELSE now() + make_interval(mins => p_duration_minutes) END;
  UPDATE outcomes SET manual_odds = p_new_odds, manual_reason = p_reason, manual_expires_at = v_expires, manual_set_by = p_user_id, manual_set_at = now() WHERE id = p_outcome_id;
  v_new := _snapshot_manual_state(p_outcome_id);
  INSERT INTO outcome_manual_actions (outcome_id, action_type, old_value, new_value, reason, source, consensus_id, created_by)
    VALUES (p_outcome_id, 'override', v_old, v_new, p_reason, 'manual', p_consensus_id, p_user_id) RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object('success', true, 'outcome_id', p_outcome_id, 'audit_id', v_audit_id, 'expires_at', v_expires, 'new_state', v_new);
END; $$;

CREATE OR REPLACE FUNCTION restore_outcome(
  p_outcome_id uuid, p_user_id uuid, p_source text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_old jsonb; v_new jsonb; v_audit_id bigint; v_action text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outcomes WHERE id = p_outcome_id) THEN RETURN jsonb_build_object('error', 'outcome not found', 'outcome_id', p_outcome_id); END IF;
  v_old := _snapshot_manual_state(p_outcome_id);
  IF NOT (v_old->>'manual_suspended')::boolean AND (v_old->>'manual_odds') IS NULL THEN
    RETURN jsonb_build_object('success', true, 'outcome_id', p_outcome_id, 'noop', true, 'new_state', v_old);
  END IF;
  UPDATE outcomes SET manual_suspended = false, manual_odds = NULL, manual_reason = NULL, manual_expires_at = NULL, manual_set_by = NULL, manual_set_at = NULL WHERE id = p_outcome_id;
  v_new := _snapshot_manual_state(p_outcome_id);
  v_action := CASE WHEN p_source = 'cron_expiry' THEN 'expire' WHEN p_source = 'auto_consensus' THEN 'auto_restore' ELSE 'restore' END;
  INSERT INTO outcome_manual_actions (outcome_id, action_type, old_value, new_value, reason, source, created_by)
    VALUES (p_outcome_id, v_action, v_old, v_new, NULL, p_source, p_user_id) RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object('success', true, 'outcome_id', p_outcome_id, 'audit_id', v_audit_id, 'new_state', v_new);
END; $$;

-- Note: manual_overrides rows from backfill remain (harmless if v_player_outcomes still reads them).
-- For full rollback delete them explicitly:
-- DELETE FROM manual_overrides WHERE created_by = 'mig162-backfill';

DELETE FROM _migrations WHERE name = '162_admin_overrides_dual_write';
