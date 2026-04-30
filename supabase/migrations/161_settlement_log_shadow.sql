-- Migration 161 — settlement_log_shadow table (Plan D Phase 2 — engine shadow mode)
-- Records BOTH the existing FS path verdict AND the new odds-api shadow verdict for each bet leg.
-- Shadow engine writes ONLY to this table; never mutates bet_selections.result.
--
-- Usage:
-- - Cron `/api/cron/settlement-shadow` (every 5min) replays settled legs through new engine,
--   records shadow_verdict and compares with real_verdict.
-- - Daily query `settlement_shadow_mismatch_pct(hours)` returns aggregate metric.
-- - Cutover gate (Plan D §10.4): mismatch_pct ≤ 0.5% over 24h before SETTLE_VIA_ODDS_API=true.

CREATE TABLE IF NOT EXISTS settlement_log_shadow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leg_id UUID NOT NULL REFERENCES bet_selections(id) ON DELETE CASCADE,
  -- Real (existing FS-based) verdict already on bet_selections.result. Snapshot at observation time.
  real_verdict TEXT,
  -- Shadow (odds-api) verdict computed by new engine. NULL = engine couldn't classify (skipped).
  shadow_verdict TEXT,
  -- Timestamp of real settlement (from bet_selections.settled_at) and shadow computation.
  real_settled_at TIMESTAMPTZ,
  shadow_settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Source used by shadow engine: 'odds-api' | 'flashscore' | 'fallback' | 'skipped'
  source_used TEXT NOT NULL CHECK (source_used IN ('odds-api','flashscore','fallback','skipped','no_event_v2','unsupported_market')),
  -- Reason if shadow_verdict NULL (e.g. 'event not in v2', 'market type not yet supported')
  skip_reason TEXT,
  -- Generated mismatch flag: true iff both verdicts non-null AND differ
  mismatch BOOLEAN GENERATED ALWAYS AS (
    real_verdict IS NOT NULL AND shadow_verdict IS NOT NULL AND real_verdict <> shadow_verdict
  ) STORED,
  -- Bet leg snapshot for forensics (JSONB to avoid joins for analysis)
  leg_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (leg, observation_run); cron skips if leg already has a row in last 1h
CREATE INDEX IF NOT EXISTS idx_shadow_leg ON settlement_log_shadow(leg_id);
CREATE INDEX IF NOT EXISTS idx_shadow_real_settled ON settlement_log_shadow(real_settled_at DESC) WHERE real_verdict IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shadow_mismatch ON settlement_log_shadow(shadow_settled_at DESC) WHERE mismatch;

COMMENT ON TABLE settlement_log_shadow IS
  'Plan D Phase 2 — shadow mode comparison. Real (FS) verdict from bet_selections vs new odds-api engine verdict. Cutover gate ≤0.5% mismatch.';

-- ============================================================
-- Mismatch percentage RPC (daily monitoring + cutover gate)
-- ============================================================
CREATE OR REPLACE FUNCTION settlement_shadow_mismatch_pct(p_hours INT DEFAULT 24)
RETURNS TABLE (
  total_legs INT,
  shadow_classified INT,
  shadow_skipped INT,
  mismatches INT,
  mismatch_pct NUMERIC,
  classified_pct NUMERIC,
  by_source JSONB
) LANGUAGE SQL STABLE AS $$
  WITH window_legs AS (
    SELECT * FROM settlement_log_shadow
    WHERE shadow_settled_at > now() - (p_hours || ' hours')::interval
      AND real_verdict IS NOT NULL
  ),
  agg AS (
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE shadow_verdict IS NOT NULL)::int AS classified,
      count(*) FILTER (WHERE shadow_verdict IS NULL)::int AS skipped,
      count(*) FILTER (WHERE mismatch)::int AS mismatches
    FROM window_legs
  ),
  src AS (
    SELECT jsonb_object_agg(source_used, cnt) AS by_source
    FROM (
      SELECT source_used, count(*)::int AS cnt
      FROM window_legs GROUP BY source_used
    ) s
  )
  SELECT
    a.total,
    a.classified,
    a.skipped,
    a.mismatches,
    CASE WHEN a.classified > 0
      THEN round(a.mismatches::numeric * 100 / a.classified, 4)
      ELSE 0 END AS mismatch_pct,
    CASE WHEN a.total > 0
      THEN round(a.classified::numeric * 100 / a.total, 2)
      ELSE 0 END AS classified_pct,
    s.by_source
  FROM agg a CROSS JOIN src s;
$$;

COMMENT ON FUNCTION settlement_shadow_mismatch_pct IS
  'Plan D Phase 2 — aggregate mismatch metric over last N hours. Cutover gate: mismatch_pct ≤ 0.5%, classified_pct ≥ 95%.';

-- Track migration
INSERT INTO _migrations (name, applied_at)
VALUES ('161_settlement_log_shadow', now())
ON CONFLICT (name) DO NOTHING;
