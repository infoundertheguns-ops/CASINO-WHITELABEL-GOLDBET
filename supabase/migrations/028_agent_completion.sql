-- 028_agent_completion.sql — Settlement, betting limits, blacklist, risk alerts

-- 1. Settlement period on agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS settlement_period TEXT DEFAULT 'monthly';

-- 2. Approved/paid tracking on agent_settlements
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS paid_by UUID;
ALTER TABLE agent_settlements ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_settlements_unique
  ON agent_settlements(agent_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_agent_settlements_status ON agent_settlements(status);

-- 3. Betting limits (3 levels: agent, player, sport)
CREATE TABLE IF NOT EXISTS betting_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  player_id UUID REFERENCES users(id),
  sport TEXT,
  max_stake DECIMAL(12,2),
  max_win DECIMAL(12,2),
  max_daily_turnover DECIMAL(12,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_betting_limits_unique
  ON betting_limits(COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'),
                    COALESCE(player_id, '00000000-0000-0000-0000-000000000000'),
                    COALESCE(sport, '__all__'));
CREATE INDEX IF NOT EXISTS idx_betting_limits_agent ON betting_limits(agent_id);
CREATE INDEX IF NOT EXISTS idx_betting_limits_player ON betting_limits(player_id);

-- 4. Player blacklist
CREATE TABLE IF NOT EXISTS player_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES users(id),
  agent_id UUID REFERENCES agents(id),
  reason TEXT NOT NULL,
  blocked_by UUID NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklist_unique_active
  ON player_blacklist(player_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_blacklist_player ON player_blacklist(player_id);

-- 5. Risk alert config
INSERT INTO system_config (key, value) VALUES
  ('risk_alert_config', '{"max_exposure": 50000, "max_daily_win": 10000, "consecutive_wins_alert": 5, "enabled": true}'::JSONB)
ON CONFLICT (key) DO NOTHING;

-- 6. Risk alerts log
CREATE TABLE IF NOT EXISTS risk_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  player_id UUID REFERENCES users(id),
  agent_id UUID REFERENCES agents(id),
  details JSONB,
  notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_type ON risk_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_created ON risk_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_player ON risk_alerts(player_id);

-- RLS (SELECT-only, all writes via API with service role)
ALTER TABLE betting_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY betting_limits_read ON betting_limits FOR SELECT USING (true);

ALTER TABLE player_blacklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY blacklist_read ON player_blacklist FOR SELECT USING (true);

ALTER TABLE risk_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY risk_alerts_read ON risk_alerts FOR SELECT USING (true);
