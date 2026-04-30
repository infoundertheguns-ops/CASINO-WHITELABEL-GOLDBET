-- Migration 162 — Admin manual override dual-write to manual_overrides (Plan D / Elimina-derive Fase 3 / S4)
--
-- Modifies the 3 admin RPC functions (suspend_outcome, override_outcome_odds, restore_outcome)
-- to ALSO write to manual_overrides table (mig 158) when a legacy outcome can be mapped to an
-- outcomes_v2 row. Maintains existing legacy writes (no regression for legacy player path).
--
-- Adds helper _resolve_v2_outcome_for_legacy(legacy_outcome_id) → v2_outcome_id | NULL.
-- Maps via: events.external_id → events_v2.odds_api_id, markets via reverse-translate of
-- _oddsapi_translate_market output, outcomes via line + outcome_name match.
--
-- Backfill: copy current legacy active manual_* state to manual_overrides for resolvable rows.

-- ============================================================
-- Helper: legacy outcome → v2 outcome resolver
-- ============================================================
CREATE OR REPLACE FUNCTION _resolve_v2_outcome_for_legacy(p_legacy_outcome_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_external_id     text;
  v_market_type     text;
  v_outcome_name    text;
  v_line            numeric;
  v_sport_slug_it   text;
  v_v2_event_id     uuid;
  v_v2_market_id    uuid;
  v_v2_outcome_id   uuid;
  v_label_no_line   text;
BEGIN
  SELECT e.external_id, m.market_type, m.line, o.name, sp.slug
    INTO v_external_id, v_market_type, v_line, v_outcome_name, v_sport_slug_it
  FROM outcomes o
  JOIN markets m ON m.id = o.market_id
  JOIN events  e ON e.id = m.event_id
  JOIN leagues l ON l.id = e.league_id
  JOIN sports sp ON sp.id = l.sport_id
  WHERE o.id = p_legacy_outcome_id;

  IF v_external_id IS NULL OR v_external_id NOT LIKE 'odds-api:%' THEN
    RETURN NULL;
  END IF;

  -- Step 1: legacy event → v2 event
  SELECT id INTO v_v2_event_id
  FROM events_v2
  WHERE odds_api_id::text = SUBSTR(v_external_id, 10);
  IF v_v2_event_id IS NULL THEN RETURN NULL; END IF;

  -- Step 2: derive concatenates "translated_name [' ' || line]" — strip suffix to recover label
  IF v_line IS NOT NULL
     AND v_market_type LIKE '% ' || v_line::text THEN
    v_label_no_line := substring(v_market_type FROM 1 FOR length(v_market_type) - length(v_line::text) - 1);
  ELSE
    v_label_no_line := v_market_type;
  END IF;

  -- Step 3: v2 market — translate raw market_name and match
  SELECT m2.id INTO v_v2_market_id
  FROM markets_v2 m2
  WHERE m2.event_id = v_v2_event_id
    AND (
      _oddsapi_translate_market(m2.market_name, v_sport_slug_it) = v_label_no_line
      OR _oddsapi_translate_market(m2.market_name, v_sport_slug_it) = v_market_type
    )
  LIMIT 1;
  IF v_v2_market_id IS NULL THEN RETURN NULL; END IF;

  -- Step 4: v2 outcome — line + (raw OR translated) outcome name match
  SELECT o2.id INTO v_v2_outcome_id
  FROM outcomes_v2 o2
  JOIN markets_v2 m2 ON m2.id = o2.market_id
  WHERE o2.market_id = v_v2_market_id
    AND o2.line IS NOT DISTINCT FROM v_line
    AND (
      lower(o2.outcome_key) = lower(v_outcome_name)
      OR lower(_oddsapi_translate_outcome(o2.outcome_key, m2.market_name)) = lower(v_outcome_name)
    )
  LIMIT 1;

  RETURN v_v2_outcome_id;
END;
$$;

COMMENT ON FUNCTION _resolve_v2_outcome_for_legacy IS
  'Plan D Fase 3 — best-effort mapping legacy outcomes.id → outcomes_v2.id via composite key. NULL if event not in v2 or market/outcome translation reverse fails.';

-- ============================================================
-- Helper: idempotent UPSERT to manual_overrides (outcome scope)
-- ============================================================
CREATE OR REPLACE FUNCTION _upsert_manual_override_v2(
  p_v2_outcome_id   uuid,
  p_manual_odds     numeric,
  p_manual_suspended boolean,
  p_is_suspended    boolean,
  p_expires_at      timestamptz,
  p_reason          text,
  p_created_by      text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_v2_outcome_id IS NULL THEN
    RETURN;
  END IF;

  -- Find existing active override (scope=outcome, same id, not expired)
  IF EXISTS (
    SELECT 1 FROM manual_overrides
    WHERE scope = 'outcome' AND outcome_id_v2 = p_v2_outcome_id
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    UPDATE manual_overrides SET
      manual_odds       = p_manual_odds,
      manual_suspended  = COALESCE(p_manual_suspended, false),
      is_suspended      = COALESCE(p_is_suspended, false),
      expires_at        = p_expires_at,
      reason            = p_reason,
      updated_at        = now()
    WHERE scope = 'outcome' AND outcome_id_v2 = p_v2_outcome_id
      AND (expires_at IS NULL OR expires_at > now());
  ELSE
    INSERT INTO manual_overrides (scope, outcome_id_v2, manual_odds, manual_suspended, is_suspended, expires_at, reason, created_by)
    VALUES ('outcome', p_v2_outcome_id, p_manual_odds, COALESCE(p_manual_suspended, false), COALESCE(p_is_suspended, false), p_expires_at, p_reason, p_created_by);
  END IF;
END;
$$;

-- ============================================================
-- Modify suspend_outcome — add dual-write
-- ============================================================
CREATE OR REPLACE FUNCTION suspend_outcome(
  p_outcome_id        uuid,
  p_reason            text DEFAULT NULL,
  p_duration_minutes  integer DEFAULT NULL,
  p_user_id           uuid DEFAULT NULL,
  p_consensus_id      bigint DEFAULT NULL,
  p_source            text DEFAULT 'manual'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_expires timestamptz;
  v_audit_id bigint;
  v_action text;
  v_v2_outcome_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outcomes WHERE id = p_outcome_id) THEN
    RETURN jsonb_build_object('error', 'outcome not found', 'outcome_id', p_outcome_id);
  END IF;

  v_old := _snapshot_manual_state(p_outcome_id);

  v_expires := CASE
    WHEN p_duration_minutes IS NULL THEN NULL
    ELSE now() + make_interval(mins => p_duration_minutes)
  END;

  -- Legacy write
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

  -- Plan D Fase 3: dual-write to manual_overrides (best-effort v2 mapping)
  v_v2_outcome_id := _resolve_v2_outcome_for_legacy(p_outcome_id);
  PERFORM _upsert_manual_override_v2(
    v_v2_outcome_id,
    NULL,                                -- no odds change on suspend
    true,                                -- manual_suspended
    true,                                -- is_suspended
    v_expires,
    p_reason,
    COALESCE(p_user_id::text, p_source)
  );

  RETURN jsonb_build_object(
    'success', true,
    'outcome_id', p_outcome_id,
    'v2_mapped', v_v2_outcome_id IS NOT NULL,
    'audit_id', v_audit_id,
    'expires_at', v_expires,
    'new_state', v_new
  );
END;
$$;

-- ============================================================
-- Modify override_outcome_odds — add dual-write
-- ============================================================
CREATE OR REPLACE FUNCTION override_outcome_odds(
  p_outcome_id        uuid,
  p_new_odds          numeric,
  p_reason            text DEFAULT NULL,
  p_duration_minutes  integer DEFAULT NULL,
  p_user_id           uuid DEFAULT NULL,
  p_consensus_id      bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_expires timestamptz;
  v_audit_id bigint;
  v_v2_outcome_id uuid;
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

  -- Legacy write
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

  -- Plan D Fase 3: dual-write to manual_overrides
  v_v2_outcome_id := _resolve_v2_outcome_for_legacy(p_outcome_id);
  PERFORM _upsert_manual_override_v2(
    v_v2_outcome_id,
    p_new_odds,                          -- manual_odds
    false,                               -- manual_suspended
    false,                               -- is_suspended
    v_expires,
    p_reason,
    COALESCE(p_user_id::text, 'manual')
  );

  RETURN jsonb_build_object(
    'success', true,
    'outcome_id', p_outcome_id,
    'v2_mapped', v_v2_outcome_id IS NOT NULL,
    'audit_id', v_audit_id,
    'expires_at', v_expires,
    'new_state', v_new
  );
END;
$$;

-- ============================================================
-- Modify restore_outcome — clear manual_overrides too
-- ============================================================
CREATE OR REPLACE FUNCTION restore_outcome(
  p_outcome_id    uuid,
  p_user_id       uuid DEFAULT NULL,
  p_source        text DEFAULT 'manual'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_audit_id bigint;
  v_action text;
  v_v2_outcome_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outcomes WHERE id = p_outcome_id) THEN
    RETURN jsonb_build_object('error', 'outcome not found', 'outcome_id', p_outcome_id);
  END IF;

  v_old := _snapshot_manual_state(p_outcome_id);

  IF NOT (v_old->>'manual_suspended')::boolean
     AND (v_old->>'manual_odds') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'outcome_id', p_outcome_id,
      'noop', true,
      'new_state', v_old
    );
  END IF;

  -- Legacy write
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

  -- Plan D Fase 3: clear manual_overrides for the v2 mapped outcome
  v_v2_outcome_id := _resolve_v2_outcome_for_legacy(p_outcome_id);
  IF v_v2_outcome_id IS NOT NULL THEN
    DELETE FROM manual_overrides
    WHERE scope = 'outcome' AND outcome_id_v2 = v_v2_outcome_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'outcome_id', p_outcome_id,
    'v2_mapped', v_v2_outcome_id IS NOT NULL,
    'audit_id', v_audit_id,
    'new_state', v_new
  );
END;
$$;

-- ============================================================
-- Backfill — copy active legacy overrides to manual_overrides
-- ============================================================
DO $$
DECLARE
  v_count int := 0;
  r record;
  v_v2_id uuid;
BEGIN
  FOR r IN
    SELECT id, manual_odds, manual_suspended, manual_reason, manual_expires_at, manual_set_by, manual_set_at
    FROM outcomes
    WHERE (manual_suspended = true OR manual_odds IS NOT NULL)
      AND (manual_expires_at IS NULL OR manual_expires_at > now())
  LOOP
    v_v2_id := _resolve_v2_outcome_for_legacy(r.id);
    IF v_v2_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO manual_overrides
      (scope, outcome_id_v2, manual_odds, manual_suspended, is_suspended, expires_at, reason, created_by, created_at)
    VALUES
      ('outcome', v_v2_id, r.manual_odds, COALESCE(r.manual_suspended, false), COALESCE(r.manual_suspended, false),
       r.manual_expires_at, r.manual_reason, COALESCE(r.manual_set_by::text, 'mig162-backfill'), COALESCE(r.manual_set_at, now()))
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'mig 162 backfill: % manual_overrides rows inserted from legacy outcomes', v_count;
END $$;

-- Track migration
INSERT INTO _migrations (name, applied_at, notes)
VALUES ('162_admin_overrides_dual_write', now(), 'Plan D Fase 3 / S4: RPC dual-write + backfill legacy → manual_overrides')
ON CONFLICT (name) DO NOTHING;
