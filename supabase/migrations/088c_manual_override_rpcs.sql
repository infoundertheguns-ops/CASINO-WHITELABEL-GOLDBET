-- ═══════════════════════════════════════════════════
-- Migration 088c: Admin RPCs for Manual Override
--
-- Service-role RPCs that the admin Next.js API routes call to perform
-- operator actions on outcomes. Each RPC:
--   1. Mutates outcomes.manual_* fields (protected from scraper upserts per B2)
--   2. Inserts an audit row into outcome_manual_actions
--   3. Returns a jsonb with the resulting state for UI confirmation
--
-- All RPCs are SECURITY DEFINER with explicit p_user_id input (extracted in
-- the calling API route from auth.uid()). No reliance on JWT context — keeps
-- the RPCs callable from service_role cron jobs too.
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- 088c.1 — Helper: snapshot outcome.manual_* as jsonb
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION _snapshot_manual_state(p_outcome_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'manual_suspended', o.manual_suspended,
    'manual_odds', o.manual_odds,
    'manual_reason', o.manual_reason,
    'manual_expires_at', o.manual_expires_at,
    'manual_set_by', o.manual_set_by,
    'manual_set_at', o.manual_set_at
  )
  FROM outcomes o
  WHERE o.id = p_outcome_id;
$$;

COMMENT ON FUNCTION _snapshot_manual_state IS
  'Internal helper: return JSONB snapshot of outcomes.manual_* fields for audit before/after diffing.';

-- -----------------------------------------------------
-- 088c.2 — suspend_outcome
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION suspend_outcome(
  p_outcome_id uuid,
  p_reason text DEFAULT NULL,
  p_duration_minutes int DEFAULT NULL,  -- NULL = permanent
  p_user_id uuid DEFAULT NULL,
  p_consensus_id bigint DEFAULT NULL,
  p_source text DEFAULT 'manual'         -- 'manual' | 'auto_consensus'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  v_expires := CASE
    WHEN p_duration_minutes IS NULL THEN NULL
    ELSE now() + make_interval(mins => p_duration_minutes)
  END;

  UPDATE outcomes SET
    manual_suspended = true,
    manual_reason = p_reason,
    manual_expires_at = v_expires,
    manual_set_by = p_user_id,
    manual_set_at = now()
  WHERE id = p_outcome_id;

  v_new := _snapshot_manual_state(p_outcome_id);

  v_action := CASE
    WHEN p_source = 'auto_consensus' THEN 'auto_suspend'
    ELSE 'suspend'
  END;

  INSERT INTO outcome_manual_actions
    (outcome_id, action_type, old_value, new_value, reason, source, consensus_id, created_by)
  VALUES
    (p_outcome_id, v_action, v_old, v_new, p_reason, p_source, p_consensus_id, p_user_id)
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'outcome_id', p_outcome_id,
    'audit_id', v_audit_id,
    'expires_at', v_expires,
    'new_state', v_new
  );
END;
$$;

COMMENT ON FUNCTION suspend_outcome IS
  'Flag an outcome as manually suspended. p_duration_minutes NULL = permanent. p_source=auto_consensus marks it as a tiered auto-suspension so the cron audit trail is distinguishable from operator actions.';

-- -----------------------------------------------------
-- 088c.3 — override_outcome_odds
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION override_outcome_odds(
  p_outcome_id uuid,
  p_new_odds numeric,
  p_reason text DEFAULT NULL,
  p_duration_minutes int DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_consensus_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_expires timestamptz;
  v_audit_id bigint;
BEGIN
  IF p_new_odds IS NULL OR p_new_odds <= 1 THEN
    RETURN jsonb_build_object('error', 'new odds must be > 1', 'outcome_id', p_outcome_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM outcomes WHERE id = p_outcome_id) THEN
    RETURN jsonb_build_object('error', 'outcome not found', 'outcome_id', p_outcome_id);
  END IF;

  v_old := _snapshot_manual_state(p_outcome_id);

  v_expires := CASE
    WHEN p_duration_minutes IS NULL THEN NULL
    ELSE now() + make_interval(mins => p_duration_minutes)
  END;

  UPDATE outcomes SET
    manual_odds = p_new_odds,
    manual_reason = p_reason,
    manual_expires_at = v_expires,
    manual_set_by = p_user_id,
    manual_set_at = now()
  WHERE id = p_outcome_id;

  v_new := _snapshot_manual_state(p_outcome_id);

  INSERT INTO outcome_manual_actions
    (outcome_id, action_type, old_value, new_value, reason, source, consensus_id, created_by)
  VALUES
    (p_outcome_id, 'override', v_old, v_new, p_reason, 'manual', p_consensus_id, p_user_id)
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'outcome_id', p_outcome_id,
    'audit_id', v_audit_id,
    'expires_at', v_expires,
    'new_state', v_new
  );
END;
$$;

COMMENT ON FUNCTION override_outcome_odds IS
  'Mask the feed odds with an operator-chosen value. Does NOT overwrite outcomes.odds — the player frontend computes displayOdds = COALESCE(manual_odds, odds).';

-- -----------------------------------------------------
-- 088c.4 — restore_outcome
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION restore_outcome(
  p_outcome_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_source text DEFAULT 'manual'   -- 'manual' | 'cron_expiry' | 'auto_consensus'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_audit_id bigint;
  v_action text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outcomes WHERE id = p_outcome_id) THEN
    RETURN jsonb_build_object('error', 'outcome not found', 'outcome_id', p_outcome_id);
  END IF;

  v_old := _snapshot_manual_state(p_outcome_id);

  -- Idempotent: if nothing is set, return success without audit row
  IF NOT (v_old->>'manual_suspended')::boolean
     AND (v_old->>'manual_odds') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'outcome_id', p_outcome_id,
      'noop', true,
      'new_state', v_old
    );
  END IF;

  UPDATE outcomes SET
    manual_suspended = false,
    manual_odds = NULL,
    manual_reason = NULL,
    manual_expires_at = NULL,
    manual_set_by = NULL,
    manual_set_at = NULL
  WHERE id = p_outcome_id;

  v_new := _snapshot_manual_state(p_outcome_id);

  v_action := CASE
    WHEN p_source = 'cron_expiry' THEN 'expire'
    WHEN p_source = 'auto_consensus' THEN 'auto_restore'
    ELSE 'restore'
  END;

  INSERT INTO outcome_manual_actions
    (outcome_id, action_type, old_value, new_value, reason, source, created_by)
  VALUES
    (p_outcome_id, v_action, v_old, v_new, NULL, p_source, p_user_id)
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'outcome_id', p_outcome_id,
    'audit_id', v_audit_id,
    'new_state', v_new
  );
END;
$$;

COMMENT ON FUNCTION restore_outcome IS
  'Clear all manual_* fields. Idempotent — calling on a non-overridden outcome is a no-op that returns success without creating an audit row.';

-- -----------------------------------------------------
-- 088c.5 — dismiss_consensus
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION dismiss_consensus(
  p_consensus_id bigint,
  p_dismiss_type text,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot consensus_snapshots%ROWTYPE;
  v_issue_id bigint;
  v_issue_type text;
  v_outcome_id uuid;
  v_market_id uuid;
BEGIN
  SELECT * INTO v_snapshot FROM consensus_snapshots WHERE id = p_consensus_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'consensus not found', 'consensus_id', p_consensus_id);
  END IF;

  IF p_dismiss_type NOT IN (
    'bug_kambi', 'bug_22bet', 'mismatch_normalization', 'value_genuine', 'other'
  ) THEN
    RETURN jsonb_build_object('error', 'invalid dismiss_type', 'got', p_dismiss_type);
  END IF;

  -- Mark consensus reviewed
  UPDATE consensus_snapshots SET
    reviewed = true,
    reviewed_at = now(),
    reviewed_by = p_user_id
  WHERE id = p_consensus_id;

  -- For scraper bugs and normalization issues, create a feedback row
  IF p_dismiss_type IN ('bug_kambi', 'bug_22bet', 'mismatch_normalization') THEN
    v_issue_type := CASE
      WHEN p_dismiss_type = 'mismatch_normalization' THEN 'market_normalization'
      ELSE 'scraper_bug'
    END;

    -- Best-effort resolve outcome_id/market_id from the snapshot
    -- (consensus uses market_type+outcome_name+kambi_event_id, we try to resolve
    -- the concrete outcome on the Kambi side for easier ops follow-up)
    SELECT o.id, o.market_id INTO v_outcome_id, v_market_id
    FROM outcomes o
    JOIN markets m ON m.id = o.market_id
    WHERE m.event_id = v_snapshot.kambi_event_id
      AND m.market_type = v_snapshot.market_type
      AND o.name = v_snapshot.outcome_name
    LIMIT 1;

    INSERT INTO normalization_issues
      (issue_type, source, source_ref, event_id, market_id, outcome_id, consensus_id, notes, created_by)
    VALUES
      (
        v_issue_type,
        CASE WHEN p_dismiss_type = 'bug_22bet' THEN '22bet'
             WHEN p_dismiss_type = 'bug_kambi' THEN 'kambi'
             ELSE NULL END,
        v_snapshot.market_type,
        v_snapshot.kambi_event_id,
        v_market_id,
        v_outcome_id,
        p_consensus_id,
        p_notes,
        p_user_id
      )
    RETURNING id INTO v_issue_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'consensus_id', p_consensus_id,
    'dismiss_type', p_dismiss_type,
    'issue_id', v_issue_id
  );
END;
$$;

COMMENT ON FUNCTION dismiss_consensus IS
  'Mark a consensus snapshot as reviewed and optionally enqueue a normalization_issues row for scraper bugs or mapping mismatches. value_genuine / other are pure dismissals without feedback row.';

-- -----------------------------------------------------
-- 088c.6 — cleanup_expired_manual_overrides
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION cleanup_expired_manual_overrides()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared int := 0;
  v_rec record;
  v_old jsonb;
BEGIN
  FOR v_rec IN
    SELECT id FROM outcomes
    WHERE manual_expires_at IS NOT NULL
      AND manual_expires_at < now()
      AND (manual_suspended = true OR manual_odds IS NOT NULL)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_old := _snapshot_manual_state(v_rec.id);

    UPDATE outcomes SET
      manual_suspended = false,
      manual_odds = NULL,
      manual_reason = NULL,
      manual_expires_at = NULL,
      manual_set_by = NULL,
      manual_set_at = NULL
    WHERE id = v_rec.id;

    INSERT INTO outcome_manual_actions
      (outcome_id, action_type, old_value, new_value, reason, source)
    VALUES
      (v_rec.id, 'expire', v_old, _snapshot_manual_state(v_rec.id), 'auto-expired', 'cron_expiry');

    v_cleared := v_cleared + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'cleared', v_cleared,
    'ran_at', now()
  );
END;
$$;

COMMENT ON FUNCTION cleanup_expired_manual_overrides IS
  'Cron-callable: clear manual_* fields where manual_expires_at < now(). Audits each clear as action=expire/source=cron_expiry. SKIP LOCKED to avoid contending with operator actions.';

-- -----------------------------------------------------
-- 088c.7 — Grants (service_role only)
-- -----------------------------------------------------

-- These functions are SECURITY DEFINER + live under service_role client usage
-- (from API routes + cron). Do NOT grant to anon/authenticated.
REVOKE ALL ON FUNCTION suspend_outcome(uuid, text, int, uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION override_outcome_odds(uuid, numeric, text, int, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_outcome(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dismiss_consensus(bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_manual_overrides() FROM PUBLIC;
REVOKE ALL ON FUNCTION _snapshot_manual_state(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION suspend_outcome(uuid, text, int, uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION override_outcome_odds(uuid, numeric, text, int, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION restore_outcome(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION dismiss_consensus(bigint, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_manual_overrides() TO service_role;
GRANT EXECUTE ON FUNCTION _snapshot_manual_state(uuid) TO service_role;
