-- ============================================================
-- MIGRATION 005: ADMIN UPGRADE — Risk Engine + Analytics
-- Execute in Supabase SQL Editor
-- Version: 5.0 | February 2026
-- ============================================================

BEGIN;

-- ============================================================
-- 1. RISK FLAGS (formalized alerts — replaces ad-hoc risk_flags)
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    flag_type TEXT NOT NULL, -- auto_block, manual_review, kyc_required, limit_reduce, monitoring
    severity TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
    description TEXT,
    ai_analysis JSONB DEFAULT '{}', -- full Claude AI output
    related_entity_type TEXT, -- bet, deposit, withdrawal, session
    related_entity_id UUID,
    status TEXT DEFAULT 'open', -- open, acknowledged, resolved, dismissed, escalated
    resolved_by UUID REFERENCES admin_users(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_flags_user ON risk_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_flags_status ON risk_flags(status);
CREATE INDEX IF NOT EXISTS idx_risk_flags_severity ON risk_flags(severity);
CREATE INDEX IF NOT EXISTS idx_risk_flags_created ON risk_flags(created_at DESC);

-- ============================================================
-- 2. PLAYER PROFILES (denormalized risk profile per player)
-- ============================================================

CREATE TABLE IF NOT EXISTS player_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    classification TEXT DEFAULT 'recreational', -- recreational, semi_pro, sharp, syndicate, vip
    risk_score INT DEFAULT 0,
    total_bets INT DEFAULT 0,
    total_stake DECIMAL(14,2) DEFAULT 0,
    total_won DECIMAL(14,2) DEFAULT 0,
    total_lost DECIMAL(14,2) DEFAULT 0,
    win_rate DECIMAL(5,4) DEFAULT 0, -- 0.0000 to 1.0000
    avg_stake DECIMAL(14,2) DEFAULT 0,
    avg_odds DECIMAL(8,2) DEFAULT 0,
    max_stake DECIMAL(14,2) DEFAULT 0,
    total_deposits DECIMAL(14,2) DEFAULT 0,
    total_withdrawals DECIMAL(14,2) DEFAULT 0,
    lifetime_ggr DECIMAL(14,2) DEFAULT 0, -- gross gaming revenue
    last_bet_at TIMESTAMPTZ,
    last_deposit_at TIMESTAMPTZ,
    flags_count INT DEFAULT 0,
    device_fingerprints JSONB DEFAULT '[]',
    ip_addresses JSONB DEFAULT '[]',
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pp_user ON player_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_pp_class ON player_profiles(classification);
CREATE INDEX IF NOT EXISTS idx_pp_risk ON player_profiles(risk_score DESC);

-- ============================================================
-- 3. RISK CONFIG (configurable thresholds + auto-actions)
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES admin_users(id)
);

-- Seed default risk config
INSERT INTO risk_config (key, value, description) VALUES
('thresholds', '{
    "auto_block": 85,
    "auto_flag": 50,
    "auto_reduce_limits": 60,
    "auto_kyc": 40,
    "ai_threshold": 60
}', 'Score thresholds for automatic actions'),
('auto_actions', '{
    "enabled": true,
    "block_account": true,
    "reduce_limits": true,
    "require_kyc": true,
    "notify_admin": true
}', 'Toggle auto-actions on/off'),
('rules', '{
    "stake_spike_multiplier": 5,
    "high_stake": 1000,
    "very_high_stake": 5000,
    "new_account_days": 1,
    "young_account_days": 7,
    "high_odds": 20,
    "extreme_odds": 50,
    "velocity_1h": 10,
    "extreme_velocity_1h": 25,
    "win_rate_threshold": 0.7,
    "win_rate_min_bets": 20,
    "unverified_stake": 200,
    "free_bet_high_odds": 10
}', 'Configurable rule parameters'),
('ai_settings', '{
    "enabled": true,
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1500,
    "auto_analyze_above": 60
}', 'Claude AI integration settings')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. DAILY STATS (pre-computed aggregates for dashboard charts)
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE UNIQUE NOT NULL,
    bet_count INT DEFAULT 0,
    total_stake DECIMAL(14,2) DEFAULT 0,
    total_payout DECIMAL(14,2) DEFAULT 0,
    ggr DECIMAL(14,2) DEFAULT 0, -- stake - payout
    margin_pct DECIMAL(5,2) DEFAULT 0,
    deposit_count INT DEFAULT 0,
    deposit_volume DECIMAL(14,2) DEFAULT 0,
    withdrawal_count INT DEFAULT 0,
    withdrawal_volume DECIMAL(14,2) DEFAULT 0,
    new_users INT DEFAULT 0,
    active_users INT DEFAULT 0,
    risk_alerts INT DEFAULT 0,
    sport_breakdown JSONB DEFAULT '{}', -- { "calcio": { count: X, stake: Y }, ... }
    casino_ggr DECIMAL(14,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date DESC);

-- ============================================================
-- 5. ADD is_blocked column to users if missing
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'is_blocked'
    ) THEN
        ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- ============================================================
-- 6. USER LIMITS table (for auto-reduce-limits action)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    limit_type TEXT NOT NULL, -- max_bet, max_daily_bet, max_deposit
    limit_value DECIMAL(14,2) NOT NULL,
    reason TEXT,
    set_by TEXT DEFAULT 'system', -- system, admin
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_limits_user ON user_limits(user_id);

-- ============================================================
-- 7. ENABLE REALTIME on risk_flags
-- ============================================================

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE risk_flags;
EXCEPTION WHEN OTHERS THEN
    NULL; -- already added or publication doesn't exist
END $$;

-- ============================================================
-- 8. RLS policies for new tables (admin read-all)
-- ============================================================

ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_limits ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, but add admin read policies
CREATE POLICY admin_read_risk_flags ON risk_flags FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

CREATE POLICY admin_read_player_profiles ON player_profiles FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

CREATE POLICY admin_read_risk_config ON risk_config FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

CREATE POLICY admin_read_daily_stats ON daily_stats FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

CREATE POLICY admin_read_user_limits ON user_limits FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

COMMIT;
