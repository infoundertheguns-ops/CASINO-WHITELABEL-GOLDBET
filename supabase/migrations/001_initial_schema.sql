-- ============================================================
-- UNIFIED MIGRATION — SPORTSBOOK + CASINO + CRYPTO + PROMOS
-- Execute in Supabase SQL Editor as a single transaction
-- Version: 1.0 | February 2026
-- ============================================================

BEGIN;

-- ============================================================
-- MIGRATION 001: CORE (Users, Wallets, Transactions, Config)
-- ============================================================

-- System Configuration
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

-- Admin Roles
CREATE TABLE IF NOT EXISTS admin_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    permissions JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO admin_roles (name, permissions) VALUES
('super_admin', '{"all": true}'),
('risk_manager', '{"bets": true, "users": true, "risk": true, "settlement": true}'),
('finance', '{"withdrawals": true, "deposits": true, "treasury": true, "aml": true}'),
('support', '{"users": true, "bets": ["read"], "withdrawals": ["read"]}'),
('content', '{"promos": true, "casino_games": true}')
ON CONFLICT (name) DO NOTHING;

-- Users (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    email TEXT,
    display_name TEXT,
    avatar_url TEXT,
    country TEXT,
    language TEXT DEFAULT 'it',
    currency TEXT DEFAULT 'USDT',
    
    -- KYC
    kyc_status TEXT DEFAULT 'unverified', -- unverified, pending, verified, rejected
    kyc_submitted_at TIMESTAMPTZ,
    kyc_verified_at TIMESTAMPTZ,
    kyc_documents JSONB DEFAULT '{}',
    
    -- Classification
    user_class TEXT DEFAULT 'new', -- new, recreational, semi_pro, sharp, vip
    risk_score INT DEFAULT 0,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    banned_at TIMESTAMPTZ,
    
    -- Auth
    last_login TIMESTAMPTZ,
    login_count INT DEFAULT 0,
    ip_address TEXT,
    user_agent TEXT,
    
    -- Agent/Referral
    referred_by UUID REFERENCES users(id),
    agent_id UUID,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_class ON users(user_class);
CREATE INDEX IF NOT EXISTS idx_users_kyc ON users(kyc_status);

-- Admin Users
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    username TEXT UNIQUE NOT NULL,
    role_id UUID REFERENCES admin_roles(id),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets (USDT gaming balance)
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    balance DECIMAL(14,2) DEFAULT 0 CHECK (balance >= 0),
    bonus_balance DECIMAL(14,2) DEFAULT 0 CHECK (bonus_balance >= 0),
    locked_balance DECIMAL(14,2) DEFAULT 0 CHECK (locked_balance >= 0),
    display_currency TEXT DEFAULT 'USDT',
    total_deposited DECIMAL(14,2) DEFAULT 0,
    total_withdrawn DECIMAL(14,2) DEFAULT 0,
    total_wagered DECIMAL(14,2) DEFAULT 0,
    total_won DECIMAL(14,2) DEFAULT 0,
    version INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

-- Transactions (ledger)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    type TEXT NOT NULL, -- deposit, withdrawal, bet, win, bonus, refund, adjustment, fee
    amount DECIMAL(14,2) NOT NULL,
    balance_before DECIMAL(14,2),
    balance_after DECIMAL(14,2),
    payment_method TEXT,
    payment_reference TEXT,
    reference_type TEXT, -- bet, casino_round, crypto_deposit, crypto_withdrawal, promotion
    reference_id UUID,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_tx_ref ON transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at DESC);

-- User Limits
CREATE TABLE IF NOT EXISTS user_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    limit_type TEXT NOT NULL, -- max_stake, max_daily_deposit, max_daily_withdrawal, max_single_bet
    limit_value DECIMAL(14,2) NOT NULL,
    reason TEXT,
    set_by UUID REFERENCES admin_users(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admin_users(id),
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    before_state JSONB,
    after_state JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    parent_agent_id UUID REFERENCES agents(id),
    level INT DEFAULT 1,
    commission_type TEXT DEFAULT 'ggr_share', -- ggr_share, turnover_share, hybrid
    commission_rate DECIMAL(5,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    total_players INT DEFAULT 0,
    total_ggr DECIMAL(14,2) DEFAULT 0,
    total_commission DECIMAL(14,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Risk Events
CREATE TABLE IF NOT EXISTS risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL, -- low, medium, high, critical
    description TEXT,
    metadata JSONB DEFAULT '{}',
    status TEXT DEFAULT 'open', -- open, acknowledged, resolved, dismissed
    resolved_by UUID REFERENCES admin_users(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_user ON risk_events(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_status ON risk_events(status);
CREATE INDEX IF NOT EXISTS idx_risk_severity ON risk_events(severity);

-- ============================================================
-- MIGRATION 002: SPORTSBOOK
-- ============================================================

CREATE TABLE IF NOT EXISTS sports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon TEXT,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO sports (name, slug, icon, sort_order) VALUES
('Calcio', 'calcio', '⚽', 1), ('Basket', 'basket', '🏀', 2),
('Tennis', 'tennis', '🎾', 3), ('Hockey', 'hockey', '🏒', 4),
('Pallavolo', 'pallavolo', '🏐', 5)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id UUID NOT NULL REFERENCES sports(id),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    country TEXT,
    logo_url TEXT,
    api_football_id INT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id UUID NOT NULL REFERENCES sports(id),
    league_id UUID REFERENCES leagues(id),
    external_id TEXT,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_logo TEXT,
    away_logo TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'prematch', -- prematch, live, finished, cancelled, postponed
    score_home INT,
    score_away INT,
    minute INT,
    period TEXT,
    live_data JSONB DEFAULT '{}',
    result JSONB,
    is_featured BOOLEAN DEFAULT FALSE,
    is_live BOOLEAN DEFAULT FALSE,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_league ON events(league_id);
CREATE INDEX IF NOT EXISTS idx_events_live ON events(is_live) WHERE is_live = TRUE;

CREATE TABLE IF NOT EXISTS markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    market_type TEXT NOT NULL,
    line DECIMAL(8,2),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_suspended BOOLEAN DEFAULT FALSE,
    result TEXT,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_event ON markets(event_id);
CREATE INDEX IF NOT EXISTS idx_markets_type ON markets(market_type);

CREATE TABLE IF NOT EXISTS outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    odds DECIMAL(8,2) NOT NULL CHECK (odds > 1),
    previous_odds DECIMAL(8,2),
    probability DECIMAL(6,4),
    is_active BOOLEAN DEFAULT TRUE,
    is_suspended BOOLEAN DEFAULT FALSE,
    result TEXT, -- won, lost, void, half_won, half_lost
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcomes_market ON outcomes(market_id);

CREATE TABLE IF NOT EXISTS bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    bet_type TEXT NOT NULL, -- singola, multi, sistema
    stake DECIMAL(14,2) NOT NULL CHECK (stake > 0),
    total_odds DECIMAL(12,4),
    potential_win DECIMAL(14,2),
    actual_win DECIMAL(14,2) DEFAULT 0,
    status TEXT DEFAULT 'open', -- open, won, lost, void, cashout, partial
    is_live BOOLEAN DEFAULT FALSE,
    is_free_bet BOOLEAN DEFAULT FALSE,
    free_bet_id UUID,
    selections_count INT DEFAULT 1,
    ip_address TEXT,
    risk_score INT DEFAULT 0,
    risk_flags JSONB DEFAULT '[]',
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_created ON bets(created_at DESC);

CREATE TABLE IF NOT EXISTS bet_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bet_id UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    outcome_id UUID NOT NULL REFERENCES outcomes(id),
    odds_at_placement DECIMAL(8,2) NOT NULL,
    result TEXT, -- won, lost, void, half_won, half_lost
    settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bs_bet ON bet_selections(bet_id);
CREATE INDEX IF NOT EXISTS idx_bs_event ON bet_selections(event_id);

CREATE TABLE IF NOT EXISTS settlement_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id),
    market_id UUID REFERENCES markets(id),
    action TEXT NOT NULL,
    result JSONB,
    bets_affected INT DEFAULT 0,
    total_payout DECIMAL(14,2) DEFAULT 0,
    settled_by TEXT, -- auto, admin_username
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MIGRATION 003: CASINO
-- ============================================================

CREATE TABLE IF NOT EXISTS casino_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    api_url TEXT,
    api_key_encrypted TEXT,
    api_secret_encrypted TEXT,
    callback_url TEXT,
    integration_type TEXT DEFAULT 'seamless', -- seamless, transfer
    supported_currencies TEXT[] DEFAULT '{"USDT"}',
    logo_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_maintenance BOOLEAN DEFAULT FALSE,
    default_rtp DECIMAL(5,2),
    ggr_share DECIMAL(5,2),
    games_count INT DEFAULT 0,
    total_ggr DECIMAL(14,2) DEFAULT 0,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS casino_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES casino_providers(id),
    external_game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL, -- slots, live_casino, table_games, crash, scratch, video_poker, virtual_sports
    subcategory TEXT,
    thumbnail_url TEXT,
    banner_url TEXT,
    description TEXT,
    rtp_theoretical DECIMAL(5,2),
    rtp_actual DECIMAL(5,2),
    volatility TEXT, -- low, medium, high, very_high
    min_bet DECIMAL(14,2),
    max_bet DECIMAL(14,2),
    max_win_multiplier DECIMAL(10,2),
    has_jackpot BOOLEAN DEFAULT FALSE,
    has_free_spins BOOLEAN DEFAULT FALSE,
    has_bonus_buy BOOLEAN DEFAULT FALSE,
    is_live BOOLEAN DEFAULT FALSE,
    is_new BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    tags TEXT[] DEFAULT '{}',
    launch_count INT DEFAULT 0,
    total_rounds INT DEFAULT 0,
    total_bet DECIMAL(14,2) DEFAULT 0,
    total_win DECIMAL(14,2) DEFAULT 0,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cg_provider ON casino_games(provider_id);
CREATE INDEX IF NOT EXISTS idx_cg_category ON casino_games(category);
CREATE INDEX IF NOT EXISTS idx_cg_active ON casino_games(is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    game_id UUID NOT NULL REFERENCES casino_games(id),
    provider_id UUID NOT NULL REFERENCES casino_providers(id),
    session_token TEXT UNIQUE NOT NULL,
    balance_start DECIMAL(14,2),
    balance_end DECIMAL(14,2),
    total_bet DECIMAL(14,2) DEFAULT 0,
    total_win DECIMAL(14,2) DEFAULT 0,
    rounds_played INT DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, closed, expired
    ip_address TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gs_user ON game_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_gs_token ON game_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_gs_status ON game_sessions(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS game_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES game_sessions(id),
    user_id UUID NOT NULL REFERENCES users(id),
    game_id UUID NOT NULL REFERENCES casino_games(id),
    provider_id UUID NOT NULL REFERENCES casino_providers(id),
    external_round_id TEXT NOT NULL,
    bet_amount DECIMAL(14,2) DEFAULT 0,
    win_amount DECIMAL(14,2) DEFAULT 0,
    jackpot_contribution DECIMAL(14,2) DEFAULT 0,
    jackpot_win DECIMAL(14,2) DEFAULT 0,
    is_free_spin BOOLEAN DEFAULT FALSE,
    is_bonus_round BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'open', -- open, closed, cancelled
    created_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gr_session ON game_rounds(session_id);
CREATE INDEX IF NOT EXISTS idx_gr_user ON game_rounds(user_id);
CREATE INDEX IF NOT EXISTS idx_gr_external ON game_rounds(external_round_id);

CREATE TABLE IF NOT EXISTS game_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES game_rounds(id),
    user_id UUID NOT NULL REFERENCES users(id),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    type TEXT NOT NULL, -- bet, win, rollback, jackpot_win, free_spin_win
    amount DECIMAL(14,2) NOT NULL,
    balance_before DECIMAL(14,2),
    balance_after DECIMAL(14,2),
    external_tx_id TEXT NOT NULL,
    provider_id UUID NOT NULL REFERENCES casino_providers(id),
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(external_tx_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_gt_round ON game_transactions(round_id);
CREATE INDEX IF NOT EXISTS idx_gt_user ON game_transactions(user_id);

-- ============================================================
-- MIGRATION 004: CRYPTO PAYMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS crypto_currencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    network TEXT NOT NULL,
    chain_name TEXT NOT NULL,
    is_token BOOLEAN DEFAULT FALSE,
    contract_address TEXT,
    decimals INT DEFAULT 8,
    icon TEXT,
    color TEXT,
    min_deposit DECIMAL(18,8),
    min_withdrawal DECIMAL(18,8),
    max_withdrawal_auto DECIMAL(18,8),
    withdrawal_fee DECIMAL(18,8),
    confirmations_required INT DEFAULT 3,
    price_eur DECIMAL(18,8) DEFAULT 0,
    price_usd DECIMAL(18,8) DEFAULT 0,
    price_updated_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    is_deposit_enabled BOOLEAN DEFAULT TRUE,
    is_withdrawal_enabled BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO crypto_currencies (symbol, name, network, chain_name, is_token, decimals, icon, color, min_deposit, min_withdrawal, max_withdrawal_auto, withdrawal_fee, confirmations_required, sort_order) VALUES
('USDT_TRC', 'Tether (TRC-20)', 'tron', 'TRON', TRUE, 6, '₮', '#26A17B', 5, 10, 5000, 1, 20, 1),
('USDT_ERC', 'Tether (ERC-20)', 'ethereum', 'Ethereum', TRUE, 6, '₮', '#26A17B', 20, 50, 5000, 15, 12, 2),
('USDT_SOL', 'Tether (Solana)', 'solana', 'Solana', TRUE, 6, '₮', '#26A17B', 5, 10, 5000, 0.50, 1, 3),
('BTC', 'Bitcoin', 'bitcoin', 'Bitcoin', FALSE, 8, '₿', '#F7931A', 0.0001, 0.0005, 0.05, 0.00002, 3, 5),
('ETH', 'Ethereum', 'ethereum', 'Ethereum', FALSE, 18, 'Ξ', '#627EEA', 0.005, 0.01, 2, 0.001, 12, 6),
('SOL', 'Solana', 'solana', 'Solana', FALSE, 9, '◎', '#9945FF', 0.05, 0.1, 50, 0.01, 1, 7),
('LTC', 'Litecoin', 'litecoin', 'Litecoin', FALSE, 8, 'Ł', '#BFBBBB', 0.01, 0.05, 5, 0.001, 6, 8),
('TRX', 'TRON', 'tron', 'TRON', FALSE, 6, '◆', '#FF0013', 10, 50, 50000, 1, 20, 9),
('DOGE', 'Dogecoin', 'dogecoin', 'Dogecoin', FALSE, 8, 'Ð', '#C2A633', 10, 50, 50000, 2, 20, 10),
('BNB', 'BNB', 'bsc', 'BSC', FALSE, 18, '◇', '#F3BA2F', 0.01, 0.05, 5, 0.0005, 15, 11)
ON CONFLICT (symbol) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_crypto_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES crypto_currencies(id),
    deposit_address TEXT,
    deposit_address_memo TEXT,
    balance DECIMAL(18,8) DEFAULT 0,
    total_deposited DECIMAL(18,8) DEFAULT 0,
    total_withdrawn DECIMAL(18,8) DEFAULT 0,
    version INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, currency_id)
);

CREATE TABLE IF NOT EXISTS crypto_deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES crypto_currencies(id),
    tx_hash TEXT UNIQUE,
    from_address TEXT,
    to_address TEXT NOT NULL,
    amount_crypto DECIMAL(18,8) NOT NULL,
    amount_usdt DECIMAL(14,2),
    exchange_rate DECIMAL(18,8),
    network_fee DECIMAL(18,8),
    confirmations INT DEFAULT 0,
    confirmations_required INT,
    status TEXT DEFAULT 'pending', -- pending, confirming, confirmed, credited, failed
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    credited_at TIMESTAMPTZ,
    wallet_tx_id UUID,
    block_number BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cd_user ON crypto_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_cd_status ON crypto_deposits(status);
CREATE INDEX IF NOT EXISTS idx_cd_hash ON crypto_deposits(tx_hash);

CREATE TABLE IF NOT EXISTS crypto_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES crypto_currencies(id),
    amount_usdt DECIMAL(14,2) NOT NULL,
    amount_crypto DECIMAL(18,8) NOT NULL,
    exchange_rate DECIMAL(18,8),
    to_address TEXT NOT NULL,
    to_address_memo TEXT,
    network_fee_crypto DECIMAL(18,8),
    platform_fee_crypto DECIMAL(18,8),
    total_deducted_usdt DECIMAL(14,2),
    status TEXT DEFAULT 'pending', -- pending, approved, processing, sent, confirmed, completed, rejected
    is_auto_approved BOOLEAN DEFAULT FALSE,
    reviewed_by UUID REFERENCES admin_users(id),
    reviewed_at TIMESTAMPTZ,
    reject_reason TEXT,
    risk_score INT DEFAULT 0,
    risk_flags JSONB DEFAULT '[]',
    aml_check_passed BOOLEAN,
    tx_hash TEXT,
    sent_from_wallet TEXT,
    block_number BIGINT,
    confirmations INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cw_user ON crypto_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_cw_status ON crypto_withdrawals(status);

CREATE TABLE IF NOT EXISTS hot_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    network TEXT NOT NULL,
    address TEXT NOT NULL,
    balance DECIMAL(18,8) DEFAULT 0,
    balance_updated_at TIMESTAMPTZ,
    min_balance DECIMAL(18,8),
    max_balance DECIMAL(18,8),
    is_active BOOLEAN DEFAULT TRUE,
    is_primary BOOLEAN DEFAULT FALSE,
    total_sent DECIMAL(18,8) DEFAULT 0,
    total_received DECIMAL(18,8) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cold_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    network TEXT NOT NULL,
    address TEXT NOT NULL,
    balance_estimate DECIMAL(18,8) DEFAULT 0,
    last_verified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_wallet_type TEXT NOT NULL,
    from_wallet_id UUID,
    from_address TEXT NOT NULL,
    to_wallet_type TEXT NOT NULL,
    to_wallet_id UUID,
    to_address TEXT NOT NULL,
    network TEXT NOT NULL,
    amount DECIMAL(18,8) NOT NULL,
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    reason TEXT,
    initiated_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crypto_price_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    price_eur DECIMAL(18,8),
    price_usd DECIMAL(18,8),
    source TEXT DEFAULT 'coingecko',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpl_symbol ON crypto_price_log(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawal_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    conditions JSONB NOT NULL,
    action TEXT NOT NULL, -- hold, require_kyc, require_2fa, reject, flag
    priority INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO withdrawal_rules (name, conditions, action, priority) VALUES
('Large Withdrawal', '{"amount_usdt_gt": 5000}', 'hold', 1),
('Unverified + Medium', '{"user_kyc_status": "unverified", "amount_usdt_gt": 500}', 'require_kyc', 2),
('New Account', '{"account_age_days_lt": 3}', 'hold', 3),
('Low Wagering', '{"wagering_ratio_lt": 0.5}', 'hold', 4),
('Multiple Today', '{"withdrawals_today_gt": 3}', 'hold', 5),
('First Withdrawal Large', '{"lifetime_withdrawals_eq": 0, "amount_usdt_gt": 200}', 'hold', 6)
ON CONFLICT DO NOTHING;

-- ============================================================
-- MIGRATION 005: PROMOTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    short_description TEXT,
    terms_conditions TEXT,
    banner_url TEXT,
    thumbnail_url TEXT,
    badge_text TEXT,
    badge_color TEXT,
    type TEXT NOT NULL,
    category TEXT NOT NULL, -- casino, sport, tournament, vip, referral
    eligible_countries TEXT[] DEFAULT '{}',
    excluded_countries TEXT[] DEFAULT '{}',
    eligible_user_classes TEXT[] DEFAULT '{}',
    min_account_age_days INT DEFAULT 0,
    max_claims_per_user INT DEFAULT 1,
    requires_opt_in BOOLEAN DEFAULT FALSE,
    requires_code BOOLEAN DEFAULT FALSE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_rule TEXT,
    max_total_claims INT,
    total_claims INT DEFAULT 0,
    max_total_budget DECIMAL(14,2),
    total_spent DECIMAL(14,2) DEFAULT 0,
    status TEXT DEFAULT 'draft',
    is_featured BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    created_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_status ON promotions(status);
CREATE INDEX IF NOT EXISTS idx_promo_category ON promotions(category);

CREATE TABLE IF NOT EXISTS promotion_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    min_deposit DECIMAL(14,2),
    bonus_type TEXT,
    bonus_percentage INT,
    bonus_fixed_amount DECIMAL(14,2),
    max_bonus_amount DECIMAL(14,2),
    free_spins_count INT,
    free_spins_value DECIMAL(8,2),
    free_spins_game_ids UUID[],
    free_spins_provider TEXT,
    free_spins_expiry_hours INT DEFAULT 72,
    free_bet_amount DECIMAL(14,2),
    free_bet_min_odds DECIMAL(6,2),
    free_bet_max_selections INT,
    free_bet_returns_stake BOOLEAN DEFAULT FALSE,
    free_bet_eligible_sports TEXT[],
    cashback_percentage INT,
    cashback_max_amount DECIMAL(14,2),
    cashback_period TEXT,
    cashback_on TEXT,
    cashback_min_loss DECIMAL(14,2),
    acca_boost_min_legs INT,
    acca_boost_min_odds_per_leg DECIMAL(6,2),
    acca_boost_percentages JSONB,
    acca_boost_max_bonus DECIMAL(14,2),
    enhanced_event_id UUID,
    enhanced_original_odds DECIMAL(6,2),
    enhanced_boosted_odds DECIMAL(6,2),
    enhanced_max_stake DECIMAL(14,2),
    wagering_multiplier INT DEFAULT 35,
    wagering_applies_to TEXT DEFAULT 'bonus',
    wagering_deadline_days INT DEFAULT 30,
    max_bet_while_wagering DECIMAL(14,2) DEFAULT 5,
    game_contributions JSONB DEFAULT '{"slots":100,"table_games":10,"live_casino":0,"scratch_cards":100,"crash_games":50,"video_poker":10,"sport_bets":100}',
    excluded_game_ids UUID[] DEFAULT '{}',
    excluded_providers TEXT[] DEFAULT '{}',
    max_win_from_bonus DECIMAL(14,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slot_tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID REFERENCES promotions(id),
    name TEXT NOT NULL,
    description TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    registration_opens TIMESTAMPTZ,
    registration_closes TIMESTAMPTZ,
    tournament_type TEXT NOT NULL,
    scoring_metric TEXT NOT NULL,
    entry_type TEXT DEFAULT 'free',
    buy_in_amount DECIMAL(14,2),
    min_deposit_to_enter DECIMAL(14,2),
    min_bet_per_spin DECIMAL(14,2),
    max_participants INT,
    eligible_game_ids UUID[] DEFAULT '{}',
    eligible_providers TEXT[] DEFAULT '{}',
    total_prize_pool DECIMAL(14,2) NOT NULL,
    prize_pool_currency TEXT DEFAULT 'USDT',
    prize_distribution JSONB NOT NULL,
    leaderboard_update_interval INT DEFAULT 60,
    show_leaderboard_live BOOLEAN DEFAULT TRUE,
    status TEXT DEFAULT 'upcoming',
    participants_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES slot_tournaments(id),
    user_id UUID NOT NULL REFERENCES users(id),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    entry_fee_paid DECIMAL(14,2) DEFAULT 0,
    score DECIMAL(18,4) DEFAULT 0,
    total_spins INT DEFAULT 0,
    total_wagered DECIMAL(14,2) DEFAULT 0,
    total_won DECIMAL(14,2) DEFAULT 0,
    biggest_win DECIMAL(14,2) DEFAULT 0,
    biggest_multiplier DECIMAL(10,2) DEFAULT 0,
    current_rank INT,
    previous_rank INT,
    final_rank INT,
    prize_amount DECIMAL(14,2),
    prize_type TEXT,
    prize_awarded_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    last_spin_at TIMESTAMPTZ,
    UNIQUE(tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tp_score ON tournament_participants(tournament_id, score DESC);

CREATE TABLE IF NOT EXISTS user_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    promotion_id UUID NOT NULL REFERENCES promotions(id),
    claimed_at TIMESTAMPTZ DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    qualifying_deposit_amount DECIMAL(14,2),
    qualifying_tx_id UUID,
    bonus_amount DECIMAL(14,2) DEFAULT 0,
    bonus_type TEXT,
    free_spins_total INT DEFAULT 0,
    free_spins_used INT DEFAULT 0,
    free_spins_remaining INT DEFAULT 0,
    free_spins_winnings DECIMAL(14,2) DEFAULT 0,
    free_bet_amount DECIMAL(14,2) DEFAULT 0,
    free_bet_used BOOLEAN DEFAULT FALSE,
    free_bet_bet_id UUID,
    free_bet_winnings DECIMAL(14,2) DEFAULT 0,
    wagering_required DECIMAL(14,2) DEFAULT 0,
    wagering_completed DECIMAL(14,2) DEFAULT 0,
    wagering_remaining DECIMAL(14,2) DEFAULT 0,
    wagering_deadline TIMESTAMPTZ,
    cashback_losses DECIMAL(14,2) DEFAULT 0,
    cashback_amount DECIMAL(14,2) DEFAULT 0,
    cashback_credited BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active',
    completed_at TIMESTAMPTZ,
    forfeited_at TIMESTAMPTZ,
    forfeited_reason TEXT,
    total_won_from_bonus DECIMAL(14,2) DEFAULT 0,
    amount_converted_to_real DECIMAL(14,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_up_user ON user_promotions(user_id);
CREATE INDEX IF NOT EXISTS idx_up_status ON user_promotions(status);

CREATE TABLE IF NOT EXISTS wagering_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_promotion_id UUID NOT NULL REFERENCES user_promotions(id),
    user_id UUID NOT NULL REFERENCES users(id),
    source_type TEXT NOT NULL,
    source_id UUID NOT NULL,
    bet_amount DECIMAL(14,2) NOT NULL,
    game_category TEXT,
    contribution_pct INT NOT NULL,
    contributed_amount DECIMAL(14,2) NOT NULL,
    wagering_before DECIMAL(14,2),
    wagering_after DECIMAL(14,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Process crypto deposit (convert to USDT, credit wallet)
CREATE OR REPLACE FUNCTION process_crypto_deposit(p_deposit_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_deposit crypto_deposits%ROWTYPE;
    v_price DECIMAL;
    v_usdt_amount DECIMAL;
    v_wallet wallets%ROWTYPE;
BEGIN
    SELECT * INTO v_deposit FROM crypto_deposits WHERE id = p_deposit_id FOR UPDATE;
    IF NOT FOUND OR v_deposit.status != 'confirmed' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;
    
    SELECT price_usd INTO v_price FROM crypto_currencies WHERE id = v_deposit.currency_id;
    v_usdt_amount := ROUND(v_deposit.amount_crypto * v_price, 2);
    
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_deposit.user_id FOR UPDATE;
    
    UPDATE wallets SET balance = balance + v_usdt_amount, total_deposited = total_deposited + v_usdt_amount, updated_at = NOW() WHERE user_id = v_deposit.user_id;
    
    INSERT INTO transactions (user_id, wallet_id, type, amount, balance_before, balance_after, payment_method, reference_type, reference_id)
    VALUES (v_deposit.user_id, v_wallet.id, 'deposit', v_usdt_amount, v_wallet.balance, v_wallet.balance + v_usdt_amount, 'crypto', 'crypto_deposit', p_deposit_id);
    
    UPDATE crypto_deposits SET status = 'credited', amount_usdt = v_usdt_amount, exchange_rate = v_price, credited_at = NOW() WHERE id = p_deposit_id;
    
    RETURN jsonb_build_object('status', 'ok', 'usdt_credited', v_usdt_amount, 'rate', v_price);
END;
$$ LANGUAGE plpgsql;

-- Request crypto withdrawal
CREATE OR REPLACE FUNCTION request_crypto_withdrawal(p_user_id UUID, p_currency_symbol TEXT, p_amount_usdt DECIMAL, p_to_address TEXT)
RETURNS JSONB AS $$
DECLARE
    v_currency crypto_currencies%ROWTYPE;
    v_wallet wallets%ROWTYPE;
    v_amount_crypto DECIMAL;
    v_fee DECIMAL;
    v_total_usdt DECIMAL;
    v_auto_approve BOOLEAN;
    v_withdrawal_id UUID;
BEGIN
    SELECT * INTO v_currency FROM crypto_currencies WHERE symbol = p_currency_symbol AND is_active AND is_withdrawal_enabled;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'currency_unavailable'); END IF;
    
    v_amount_crypto := p_amount_usdt / v_currency.price_usd;
    v_fee := v_currency.withdrawal_fee;
    v_total_usdt := p_amount_usdt + (v_fee * v_currency.price_usd);
    
    IF v_amount_crypto < v_currency.min_withdrawal THEN
        RETURN jsonb_build_object('status', 'below_minimum');
    END IF;
    
    SELECT * INTO v_wallet FROM wallets WHERE user_id = p_user_id FOR UPDATE;
    IF v_wallet.balance < v_total_usdt THEN
        RETURN jsonb_build_object('status', 'insufficient_balance');
    END IF;
    
    v_auto_approve := v_amount_crypto <= v_currency.max_withdrawal_auto;
    
    UPDATE wallets SET balance = balance - v_total_usdt, total_withdrawn = total_withdrawn + p_amount_usdt, updated_at = NOW() WHERE user_id = p_user_id;
    
    INSERT INTO crypto_withdrawals (user_id, currency_id, amount_usdt, amount_crypto, exchange_rate, to_address, network_fee_crypto, platform_fee_crypto, total_deducted_usdt, status, is_auto_approved)
    VALUES (p_user_id, v_currency.id, p_amount_usdt, v_amount_crypto, v_currency.price_usd, p_to_address, v_fee, 0, v_total_usdt, CASE WHEN v_auto_approve THEN 'approved' ELSE 'pending' END, v_auto_approve)
    RETURNING id INTO v_withdrawal_id;
    
    INSERT INTO transactions (user_id, wallet_id, type, amount, balance_before, balance_after, payment_method, reference_type, reference_id)
    VALUES (p_user_id, v_wallet.id, 'withdrawal', -v_total_usdt, v_wallet.balance + v_total_usdt, v_wallet.balance, 'crypto', 'crypto_withdrawal', v_withdrawal_id);
    
    RETURN jsonb_build_object('status', 'ok', 'withdrawal_id', v_withdrawal_id, 'amount_crypto', v_amount_crypto, 'auto_approved', v_auto_approve);
END;
$$ LANGUAGE plpgsql;

-- Process wagering contribution
CREATE OR REPLACE FUNCTION process_wagering(p_user_id UUID, p_source_type TEXT, p_source_id UUID, p_bet_amount DECIMAL, p_game_category TEXT)
RETURNS JSONB AS $$
DECLARE
    v_promo user_promotions%ROWTYPE;
    v_rules promotion_rules%ROWTYPE;
    v_pct INT;
    v_contributed DECIMAL;
BEGIN
    SELECT * INTO v_promo FROM user_promotions WHERE user_id = p_user_id AND status = 'wagering' AND (wagering_deadline IS NULL OR wagering_deadline > NOW()) ORDER BY claimed_at ASC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_active_wagering'); END IF;
    
    SELECT * INTO v_rules FROM promotion_rules WHERE promotion_id = v_promo.promotion_id LIMIT 1;
    
    IF v_rules.max_bet_while_wagering IS NOT NULL AND p_bet_amount > v_rules.max_bet_while_wagering THEN
        RETURN jsonb_build_object('status', 'exceeds_max_bet');
    END IF;
    
    v_pct := COALESCE((v_rules.game_contributions->>p_game_category)::INT, 0);
    v_contributed := p_bet_amount * v_pct / 100.0;
    IF v_contributed <= 0 THEN RETURN jsonb_build_object('status', 'zero_contribution'); END IF;
    
    INSERT INTO wagering_log (user_promotion_id, user_id, source_type, source_id, bet_amount, game_category, contribution_pct, contributed_amount, wagering_before, wagering_after)
    VALUES (v_promo.id, p_user_id, p_source_type, p_source_id, p_bet_amount, p_game_category, v_pct, v_contributed, v_promo.wagering_completed, v_promo.wagering_completed + v_contributed);
    
    UPDATE user_promotions SET wagering_completed = wagering_completed + v_contributed, wagering_remaining = GREATEST(0, wagering_required - (wagering_completed + v_contributed)), updated_at = NOW() WHERE id = v_promo.id;
    
    IF (v_promo.wagering_completed + v_contributed) >= v_promo.wagering_required THEN
        UPDATE user_promotions SET status = 'completed', completed_at = NOW() WHERE id = v_promo.id;
        UPDATE wallets SET balance = balance + v_promo.bonus_amount WHERE user_id = p_user_id;
    END IF;
    
    RETURN jsonb_build_object('status', 'ok', 'contributed', v_contributed, 'remaining', GREATEST(0, v_promo.wagering_required - (v_promo.wagering_completed + v_contributed)));
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "users_own" ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY "wallets_own" ON wallets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tx_own" ON transactions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "bets_own" ON bets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "bs_own" ON bet_selections FOR SELECT USING (bet_id IN (SELECT id FROM bets WHERE user_id = auth.uid()));
CREATE POLICY "cd_own" ON crypto_deposits FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "cw_own" ON crypto_withdrawals FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "up_own" ON user_promotions FOR SELECT USING (user_id = auth.uid());

-- Public read
ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_sports" ON sports FOR SELECT USING (is_active);
CREATE POLICY "public_leagues" ON leagues FOR SELECT USING (is_active);
CREATE POLICY "public_events" ON events FOR SELECT USING (TRUE);
CREATE POLICY "public_markets" ON markets FOR SELECT USING (is_active);
CREATE POLICY "public_outcomes" ON outcomes FOR SELECT USING (is_active);
CREATE POLICY "public_providers" ON casino_providers FOR SELECT USING (is_active);
CREATE POLICY "public_games" ON casino_games FOR SELECT USING (is_active);
CREATE POLICY "public_crypto" ON crypto_currencies FOR SELECT USING (is_active);
CREATE POLICY "public_promos" ON promotions FOR SELECT USING (status = 'active');
CREATE POLICY "public_tournaments" ON slot_tournaments FOR SELECT USING (status IN ('upcoming','registration','live','completed'));
CREATE POLICY "public_leaderboard" ON tournament_participants FOR SELECT USING (TRUE);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE outcomes;
ALTER PUBLICATION supabase_realtime ADD TABLE crypto_deposits;
ALTER PUBLICATION supabase_realtime ADD TABLE crypto_withdrawals;
ALTER PUBLICATION supabase_realtime ADD TABLE tournament_participants;

-- ============================================================
-- SYSTEM CONFIG SEED
-- ============================================================

INSERT INTO system_config (key, value) VALUES
('platform', '{"name":"VinciTu","currency":"USDT","timezone":"Europe/Rome"}'),
('limits', '{"max_single_bet":5000,"max_daily_withdrawal":50000,"max_multi_selections":15,"max_odds_per_selection":1000}'),
('crypto_payments', '{"auto_convert_to_usdt":true,"price_feed_source":"coingecko","price_feed_interval_seconds":60}'),
('kyc', '{"require_above_usdt":2000,"provider":"manual"}'),
('bonuses', '{"first_deposit_bonus_pct":100,"first_deposit_max_usdt":1000,"wagering_requirement":35}')
ON CONFLICT (key) DO NOTHING;

COMMIT;
