-- 026_agent_tree.sql — Extend agent system with permissions, wallet models, transactions

-- Extend agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wallet_model TEXT NOT NULL DEFAULT 'postpaid';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{
  "dashboard": "viewer",
  "players": "editor",
  "sub_agents": "none",
  "credit": "editor",
  "tickets": "editor",
  "reports": "viewer",
  "commissions": "viewer",
  "bets": "viewer",
  "risk": "none"
}'::JSONB;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Rename parent_agent_id to parent_id for consistency
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'parent_agent_id') THEN
    ALTER TABLE agents RENAME COLUMN parent_agent_id TO parent_id;
  END IF;
END $$;

-- Add player_type to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS player_type TEXT DEFAULT 'online';

-- Agent wallets support
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'player';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);

-- Agent transactions
CREATE TABLE IF NOT EXISTS agent_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2),
  target_user_id UUID,
  reference_id UUID,
  notes TEXT,
  performed_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tx_agent ON agent_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tx_created ON agent_transactions(created_at);

-- Agent settlements
CREATE TABLE IF NOT EXISTS agent_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_turnover DECIMAL(12,2) DEFAULT 0,
  total_winnings DECIMAL(12,2) DEFAULT 0,
  ggr DECIMAL(12,2) DEFAULT 0,
  commission_pct DECIMAL(5,2),
  commission_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_settlements_agent ON agent_settlements(agent_id);

-- System config: betting permissions + ticket limits
INSERT INTO system_config (key, value) VALUES
  ('betting_permissions', '{"disabled_sports":[],"disabled_leagues":[],"disabled_market_types":[],"event_blacklist":[]}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (key, value) VALUES
  ('ticket_limits', '{"max_stake_single":5000,"max_stake_multi":2000,"max_stake_system":1000,"max_stake_day":10000,"max_stake_night":5000,"day_hours_start":"08:00","day_hours_end":"22:00","max_potential_win":50000,"max_daily_bets":100,"max_repeat_bets":3,"max_odds_single":1000,"max_odds_multi":50000}')
ON CONFLICT (key) DO NOTHING;

-- RLS
ALTER TABLE agent_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS agent_tx_read ON agent_transactions FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS agent_settlements_read ON agent_settlements FOR SELECT USING (true);
