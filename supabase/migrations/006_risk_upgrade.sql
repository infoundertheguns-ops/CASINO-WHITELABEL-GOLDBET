-- ============================================================
-- MIGRATION 006: RISK UPGRADE — Liability, Trading Desk, AI Optimizer
-- Execute in Supabase SQL Editor
-- Version: 6.0 | February 2026
-- ============================================================

BEGIN;

-- ============================================================
-- 1. RISK FLAGS — add notes, assignment, SLA
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='risk_flags' AND column_name='notes') THEN
        ALTER TABLE risk_flags ADD COLUMN notes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='risk_flags' AND column_name='assigned_to') THEN
        ALTER TABLE risk_flags ADD COLUMN assigned_to UUID REFERENCES admin_users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='risk_flags' AND column_name='sla_deadline') THEN
        ALTER TABLE risk_flags ADD COLUMN sla_deadline TIMESTAMPTZ;
    END IF;
END $$;

-- ============================================================
-- 2. RISK ACTIONS — audit trail (who did what, when, why)
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type TEXT NOT NULL, -- resolve, dismiss, escalate, block_user, reduce_limits, adjust_odds, accept_bet, reject_bet, partial_accept
    entity_type TEXT NOT NULL, -- risk_flag, bet, user, outcome, market
    entity_id UUID NOT NULL,
    performed_by UUID REFERENCES admin_users(id),
    performed_by_system BOOLEAN DEFAULT FALSE,
    details JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_actions_entity ON risk_actions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_risk_actions_created ON risk_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_actions_performer ON risk_actions(performed_by);

-- ============================================================
-- 3. LOGIN FINGERPRINTS — IP + fingerprint for multi-account detection
-- ============================================================

CREATE TABLE IF NOT EXISTS login_fingerprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    ip_address TEXT,
    fingerprint TEXT,
    user_agent TEXT,
    country TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_fp_user ON login_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_login_fp_ip ON login_fingerprints(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_fp_fp ON login_fingerprints(fingerprint);

-- ============================================================
-- 4. ADMIN NOTIFICATIONS — realtime alerts for admins
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID REFERENCES admin_users(id), -- NULL = broadcast to all
    type TEXT NOT NULL, -- risk_alert, bet_review, liability_warning, odds_suggestion, system
    severity TEXT DEFAULT 'info', -- info, warning, critical
    title TEXT NOT NULL,
    message TEXT,
    link TEXT, -- deep link to relevant page
    related_entity_type TEXT,
    related_entity_id UUID,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notif_admin ON admin_notifications(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_notif_unread ON admin_notifications(is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_admin_notif_created ON admin_notifications(created_at DESC);

-- ============================================================
-- 5. BETS — add acceptance fields, IP, fingerprint, time-to-kickoff
-- ============================================================

DO $$ BEGIN
    -- Acceptance system
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='requested_stake') THEN
        ALTER TABLE bets ADD COLUMN requested_stake DECIMAL(14,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='accepted_stake') THEN
        ALTER TABLE bets ADD COLUMN accepted_stake DECIMAL(14,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='acceptance_mode') THEN
        ALTER TABLE bets ADD COLUMN acceptance_mode TEXT; -- auto, manual, partial
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='accepted_by') THEN
        ALTER TABLE bets ADD COLUMN accepted_by UUID REFERENCES admin_users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='acceptance_note') THEN
        ALTER TABLE bets ADD COLUMN acceptance_note TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='reviewed_at') THEN
        ALTER TABLE bets ADD COLUMN reviewed_at TIMESTAMPTZ;
    END IF;
    -- Tracking fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='placed_ip') THEN
        ALTER TABLE bets ADD COLUMN placed_ip TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='placed_fingerprint') THEN
        ALTER TABLE bets ADD COLUMN placed_fingerprint TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='time_to_kickoff_minutes') THEN
        ALTER TABLE bets ADD COLUMN time_to_kickoff_minutes INT;
    END IF;
END $$;

-- ============================================================
-- 6. OUTCOMES — add max_liability per outcome
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outcomes' AND column_name='max_liability') THEN
        ALTER TABLE outcomes ADD COLUMN max_liability DECIMAL(14,2) DEFAULT 50000;
    END IF;
END $$;

-- ============================================================
-- 7. MARKETS — add max_liability per market
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='markets' AND column_name='max_liability') THEN
        ALTER TABLE markets ADD COLUMN max_liability DECIMAL(14,2) DEFAULT 100000;
    END IF;
END $$;

-- ============================================================
-- 8. ODDS ADJUSTMENTS — log of all odds changes with reasons
-- ============================================================

CREATE TABLE IF NOT EXISTS odds_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outcome_id UUID NOT NULL REFERENCES outcomes(id),
    market_id UUID REFERENCES markets(id),
    event_id UUID REFERENCES events(id),
    old_odds DECIMAL(8,4) NOT NULL,
    new_odds DECIMAL(8,4) NOT NULL,
    reason TEXT NOT NULL, -- ai_suggestion, manual, liability_balance, market_movement, scraper_update
    suggested_by TEXT, -- ai, admin, system, scraper
    approved_by UUID REFERENCES admin_users(id),
    auto_applied BOOLEAN DEFAULT FALSE,
    liability_snapshot JSONB DEFAULT '{}', -- state at time of adjustment
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odds_adj_outcome ON odds_adjustments(outcome_id);
CREATE INDEX IF NOT EXISTS idx_odds_adj_event ON odds_adjustments(event_id);
CREATE INDEX IF NOT EXISTS idx_odds_adj_created ON odds_adjustments(created_at DESC);

-- ============================================================
-- 9. ACCEPTANCE CONFIG — seed in risk_config
-- ============================================================

INSERT INTO risk_config (key, value, description) VALUES
('acceptance', '{
    "mode": "auto",
    "partial_accept_enabled": true,
    "manual_review_stake_threshold": 5000,
    "live_bet_delay_seconds": 5,
    "max_liability_per_outcome": 50000,
    "max_liability_per_event": 100000,
    "max_liability_per_market": 75000,
    "sharp_player_mode": "manual",
    "odds_change_tolerance": 0.05,
    "auto_accept_max_stake": 1000,
    "always_manual_classes": ["sharp", "syndicate"]
}', 'Bet acceptance configuration — mode, liability limits, partial accept'),
('liability', '{
    "global_max_liability": 500000,
    "alert_threshold_pct": 80,
    "auto_suspend_threshold_pct": 95,
    "rebalance_trigger_pct": 70,
    "ai_optimizer_enabled": true,
    "ai_optimizer_model": "claude-sonnet-4-20250514",
    "min_margin_pct": 2.5
}', 'Liability management thresholds and AI optimizer settings')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 10. FUNCTION: compute_outcome_liability — real-time liability per outcome
-- ============================================================

CREATE OR REPLACE FUNCTION compute_outcome_liability(p_outcome_id UUID)
RETURNS DECIMAL AS $$
    SELECT COALESCE(SUM(
        CASE
            WHEN b.status IN ('open', 'pending_acceptance')
            THEN COALESCE(b.accepted_stake, b.stake) * (bs.odds_at_placement - 1)
            ELSE 0
        END
    ), 0)
    FROM bet_selections bs
    JOIN bets b ON b.id = bs.bet_id
    WHERE bs.outcome_id = p_outcome_id
      AND b.status IN ('open', 'pending_acceptance');
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- 11. FUNCTION: compute_event_liability — max liability across all outcomes of an event
-- ============================================================

CREATE OR REPLACE FUNCTION compute_event_liability(p_event_id UUID)
RETURNS TABLE(
    outcome_id UUID,
    outcome_name TEXT,
    market_id UUID,
    market_name TEXT,
    liability DECIMAL,
    max_liability DECIMAL,
    pct_used DECIMAL
) AS $$
    SELECT
        o.id AS outcome_id,
        o.name AS outcome_name,
        m.id AS market_id,
        m.name AS market_name,
        compute_outcome_liability(o.id) AS liability,
        o.max_liability,
        CASE WHEN o.max_liability > 0
            THEN ROUND(compute_outcome_liability(o.id) / o.max_liability * 100, 1)
            ELSE 0
        END AS pct_used
    FROM outcomes o
    JOIN markets m ON m.id = o.market_id
    WHERE m.event_id = p_event_id
      AND m.is_active = TRUE
      AND o.is_active = TRUE
    ORDER BY compute_outcome_liability(o.id) DESC;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- 12. ENABLE REALTIME on new tables
-- ============================================================

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE admin_notifications;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE odds_adjustments;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE bets;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- 13. RLS policies for new tables
-- ============================================================

ALTER TABLE risk_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds_adjustments ENABLE ROW LEVEL SECURITY;

-- Admin read policies
DO $$ BEGIN
    CREATE POLICY admin_read_risk_actions ON risk_actions FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY admin_read_login_fp ON login_fingerprints FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY admin_read_notifications ON admin_notifications FOR SELECT USING (
        admin_user_id IS NULL OR
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND id = admin_user_id AND is_active = true)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY admin_update_notifications ON admin_notifications FOR UPDATE USING (
        admin_user_id IS NULL OR
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND id = admin_user_id AND is_active = true)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY admin_read_odds_adj ON odds_adjustments FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
