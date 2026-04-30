-- Migration 158 — manual_overrides table (Plan D / Elimina-derive Fase 1)
-- Additive. Replaces legacy markets.is_suspended / outcomes.manual_odds / outcomes.manual_suspended.
-- Player views (mig 160) read from this table; admin write paths refactored in Fase 3.

CREATE TABLE IF NOT EXISTS manual_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('market','outcome')),
  market_id_v2 UUID REFERENCES markets_v2(id) ON DELETE CASCADE,
  outcome_id_v2 UUID REFERENCES outcomes_v2(id) ON DELETE CASCADE,
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  manual_odds NUMERIC(10,3),
  manual_suspended BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT manual_overrides_scope_consistency CHECK (
    (scope='market'  AND market_id_v2 IS NOT NULL AND outcome_id_v2 IS NULL) OR
    (scope='outcome' AND outcome_id_v2 IS NOT NULL AND market_id_v2 IS NULL)
  ),
  CONSTRAINT manual_overrides_odds_only_outcome CHECK (
    manual_odds IS NULL OR scope = 'outcome'
  )
);

-- Partial indexes (no expires_at filter — now() not immutable in partial index)
CREATE INDEX IF NOT EXISTS idx_manual_overrides_market_id_v2
  ON manual_overrides(market_id_v2)
  WHERE scope = 'market';

CREATE INDEX IF NOT EXISTS idx_manual_overrides_outcome_id_v2
  ON manual_overrides(outcome_id_v2)
  WHERE scope = 'outcome';

-- updated_at trigger
CREATE OR REPLACE FUNCTION manual_overrides_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_overrides_updated_at ON manual_overrides;
CREATE TRIGGER trg_manual_overrides_updated_at
  BEFORE UPDATE ON manual_overrides
  FOR EACH ROW EXECUTE FUNCTION manual_overrides_set_updated_at();

COMMENT ON TABLE manual_overrides IS
  'Plan D Fase 1 — admin-controlled override of market suspension / outcome manual odds. Replaces legacy markets.is_suspended and outcomes.manual_*.';

-- Track migration
INSERT INTO _migrations (name, applied_at)
VALUES ('158_manual_overrides', now())
ON CONFLICT (name) DO NOTHING;
