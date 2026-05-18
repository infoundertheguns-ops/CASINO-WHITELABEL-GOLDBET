-- 183: settlement_dual_source_log for cross-source disagreement tracking
-- During M3 settlement rollout (Phase 1B Tier C), every leg settled via
-- api-football canonical also runs a shadow settle via FS data and logs
-- the disagreement here. Threshold <1% over 14d gates removal of FS shadow path.

CREATE TABLE IF NOT EXISTS settlement_dual_source_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL,
  market_type TEXT NOT NULL,
  canonical_source TEXT NOT NULL,
  canonical_verdict TEXT,
  shadow_source TEXT,
  shadow_verdict TEXT,
  disagreement BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dual_source_log_disagreement
  ON settlement_dual_source_log(disagreement, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_dual_source_log_bet
  ON settlement_dual_source_log(bet_id);

-- Rollback: DROP TABLE IF EXISTS settlement_dual_source_log;
