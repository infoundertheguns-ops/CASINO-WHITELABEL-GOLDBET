-- ============================================================
-- PROMOTIONS & BONUS MODULE — COMPLETE SYSTEM
-- Run AFTER all previous schemas
-- ============================================================

-- ============================================================
-- 1. PROMOTIONS (master table for all promo types)
-- ============================================================
CREATE TABLE promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    code TEXT UNIQUE,                          -- WELCOME100, FREESPIN50, FREEBET10, etc.
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    short_description TEXT,                    -- For cards/banners
    terms_conditions TEXT,
    
    -- Visual
    banner_url TEXT,
    thumbnail_url TEXT,
    badge_text TEXT,                            -- "NUOVO", "HOT", "ESCLUSIVO"
    badge_color TEXT,
    
    -- Type
    type TEXT NOT NULL,
    -- casino_welcome, casino_deposit, casino_reload, casino_cashback,
    -- casino_no_deposit, free_spins, free_spins_no_deposit,
    -- sport_welcome, sport_free_bet, sport_enhanced_odds, sport_cashback, sport_acca_boost,
    -- slot_tournament, race, vip_reward, referral, custom
    
    category TEXT NOT NULL,                    -- casino, sport, tournament, vip, referral
    
    -- Eligibility
    eligible_countries TEXT[] DEFAULT '{}',     -- Empty = all
    excluded_countries TEXT[] DEFAULT '{}',
    eligible_user_classes TEXT[] DEFAULT '{}',  -- new, recreational, semi_pro, vip
    min_account_age_days INT DEFAULT 0,
    max_claims_per_user INT DEFAULT 1,
    requires_opt_in BOOLEAN DEFAULT FALSE,
    requires_code BOOLEAN DEFAULT FALSE,       -- Must enter promo code
    
    -- Schedule
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_rule TEXT,                       -- daily, weekly, monthly
    
    -- Budget
    max_total_claims INT,
    total_claims INT DEFAULT 0,
    max_total_budget DECIMAL(14,2),
    total_spent DECIMAL(14,2) DEFAULT 0,
    
    -- Status
    status TEXT DEFAULT 'draft',               -- draft, scheduled, active, paused, expired, archived
    is_featured BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    
    -- Metadata
    created_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promo_type ON promotions(type);
CREATE INDEX idx_promo_category ON promotions(category);
CREATE INDEX idx_promo_status ON promotions(status);
CREATE INDEX idx_promo_dates ON promotions(starts_at, ends_at);

-- ============================================================
-- 2. PROMOTION RULES (configurable per promo)
-- ============================================================
CREATE TABLE promotion_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    
    -- ═══ DEPOSIT BONUS RULES ═══
    min_deposit DECIMAL(14,2),                 -- Minimum qualifying deposit
    bonus_type TEXT,                            -- percentage, fixed, free_spins, free_bet
    bonus_percentage INT,                      -- 100 = 100% match
    bonus_fixed_amount DECIMAL(14,2),          -- Fixed bonus amount
    max_bonus_amount DECIMAL(14,2),            -- Cap on percentage bonus
    
    -- ═══ FREE SPINS RULES ═══
    free_spins_count INT,
    free_spins_value DECIMAL(8,2),             -- Value per spin (e.g., $0.20)
    free_spins_game_ids UUID[],                -- Specific games
    free_spins_provider TEXT,                  -- Or all games from provider
    free_spins_expiry_hours INT DEFAULT 72,
    
    -- ═══ FREE BET RULES (SPORT) ═══
    free_bet_amount DECIMAL(14,2),
    free_bet_min_odds DECIMAL(6,2),            -- Min odds to use free bet
    free_bet_max_selections INT,               -- Max legs in multi
    free_bet_returns_stake BOOLEAN DEFAULT FALSE, -- Whether free bet returns stake on win
    free_bet_eligible_sports TEXT[],            -- calcio, basket, tennis, etc.
    free_bet_eligible_markets TEXT[],           -- 1x2, over_under, etc.
    
    -- ═══ CASHBACK RULES ═══
    cashback_percentage INT,                   -- 10 = 10% cashback
    cashback_max_amount DECIMAL(14,2),
    cashback_period TEXT,                       -- daily, weekly, monthly
    cashback_on TEXT,                           -- net_losses, total_wagered, ggr
    cashback_min_loss DECIMAL(14,2),           -- Min loss to qualify
    
    -- ═══ ACCA BOOST (SPORT) ═══
    acca_boost_min_legs INT,                   -- Minimum selections
    acca_boost_min_odds_per_leg DECIMAL(6,2),  -- Min odds per selection
    acca_boost_percentages JSONB,              -- {"3": 5, "4": 10, "5": 15, "6": 25, "7": 50, "8+": 100}
    acca_boost_max_bonus DECIMAL(14,2),
    
    -- ═══ ENHANCED ODDS (SPORT) ═══
    enhanced_event_id UUID,                    -- Specific event
    enhanced_market TEXT,                       -- e.g., 1x2
    enhanced_selection TEXT,                    -- e.g., home_win
    enhanced_original_odds DECIMAL(6,2),
    enhanced_boosted_odds DECIMAL(6,2),
    enhanced_max_stake DECIMAL(14,2),
    
    -- ═══ WAGERING REQUIREMENTS ═══
    wagering_multiplier INT DEFAULT 35,        -- 35x
    wagering_applies_to TEXT DEFAULT 'bonus',  -- bonus, bonus_and_deposit
    wagering_deadline_days INT DEFAULT 30,
    max_bet_while_wagering DECIMAL(14,2) DEFAULT 5,
    
    -- Game contributions for wagering
    game_contributions JSONB DEFAULT '{
        "slots": 100,
        "table_games": 10,
        "live_casino": 0,
        "scratch_cards": 100,
        "crash_games": 50,
        "video_poker": 10,
        "virtual_sports": 50,
        "sport_bets": 100
    }',
    
    -- Excluded games from wagering
    excluded_game_ids UUID[] DEFAULT '{}',
    excluded_providers TEXT[] DEFAULT '{}',
    
    -- Max win from bonus
    max_win_from_bonus DECIMAL(14,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. SLOT TOURNAMENTS
-- ============================================================
CREATE TABLE slot_tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID REFERENCES promotions(id),
    
    -- Identity
    name TEXT NOT NULL,
    description TEXT,
    
    -- Schedule
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    registration_opens TIMESTAMPTZ,
    registration_closes TIMESTAMPTZ,
    
    -- Structure
    tournament_type TEXT NOT NULL,
    -- highest_win_multiplier: biggest single win multiplier
    -- total_win_multiplier: sum of win multipliers
    -- biggest_win: single largest win in $
    -- total_wagered: most money wagered
    -- points_based: custom point system (1 spin = 1 point, wins = bonus points)
    -- race: first to reach target wins
    
    scoring_metric TEXT NOT NULL,               -- win_multiplier, total_win, total_wagered, points, races
    
    -- Entry
    entry_type TEXT DEFAULT 'free',             -- free, buy_in, deposit_required
    buy_in_amount DECIMAL(14,2),
    min_deposit_to_enter DECIMAL(14,2),
    min_bet_per_spin DECIMAL(14,2),            -- Min bet to qualify
    max_participants INT,
    
    -- Eligible games
    eligible_game_ids UUID[] DEFAULT '{}',      -- Empty = all slots
    eligible_providers TEXT[] DEFAULT '{}',
    eligible_categories TEXT[] DEFAULT '{"slots"}',
    
    -- Prize pool
    prize_pool_type TEXT DEFAULT 'fixed',       -- fixed, progressive, guaranteed
    total_prize_pool DECIMAL(14,2) NOT NULL,
    prize_pool_currency TEXT DEFAULT 'USDT',
    
    -- Prize distribution (JSONB array)
    prize_distribution JSONB NOT NULL,
    -- [
    --   {"rank": 1, "prize": 500, "type": "real_money"},
    --   {"rank": 2, "prize": 250, "type": "real_money"},
    --   {"rank": 3, "prize": 100, "type": "real_money"},
    --   {"rank_from": 4, "rank_to": 10, "prize": 50, "type": "bonus"},
    --   {"rank_from": 11, "rank_to": 25, "prize": 20, "type": "free_spins", "free_spins_count": 50}
    -- ]
    
    -- Leaderboard
    leaderboard_update_interval INT DEFAULT 60, -- seconds
    show_leaderboard_live BOOLEAN DEFAULT TRUE,
    
    -- Status
    status TEXT DEFAULT 'upcoming',            -- upcoming, registration, live, calculating, completed, cancelled
    
    participants_count INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tournament_status ON slot_tournaments(status);
CREATE INDEX idx_tournament_dates ON slot_tournaments(starts_at, ends_at);

-- ============================================================
-- 4. TOURNAMENT PARTICIPANTS & LEADERBOARD
-- ============================================================
CREATE TABLE tournament_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    tournament_id UUID NOT NULL REFERENCES slot_tournaments(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Entry
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    entry_fee_paid DECIMAL(14,2) DEFAULT 0,
    
    -- Scores (updated in real-time)
    score DECIMAL(18,4) DEFAULT 0,             -- Main scoring metric
    total_spins INT DEFAULT 0,
    total_wagered DECIMAL(14,2) DEFAULT 0,
    total_won DECIMAL(14,2) DEFAULT 0,
    biggest_win DECIMAL(14,2) DEFAULT 0,
    biggest_multiplier DECIMAL(10,2) DEFAULT 0,
    
    -- Points breakdown
    points_breakdown JSONB DEFAULT '{}',
    -- {"spins_points": 120, "win_bonus": 450, "multiplier_bonus": 200}
    
    -- Ranking
    current_rank INT,
    previous_rank INT,
    
    -- Prize
    final_rank INT,
    prize_amount DECIMAL(14,2),
    prize_type TEXT,                            -- real_money, bonus, free_spins
    prize_awarded_at TIMESTAMPTZ,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_spin_at TIMESTAMPTZ,
    
    UNIQUE(tournament_id, user_id)
);

CREATE INDEX idx_tp_tournament ON tournament_participants(tournament_id);
CREATE INDEX idx_tp_user ON tournament_participants(user_id);
CREATE INDEX idx_tp_score ON tournament_participants(tournament_id, score DESC);

-- ============================================================
-- 5. USER PROMOTIONS (claimed/active promotions per user)
-- ============================================================
CREATE TABLE user_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id),
    promotion_id UUID NOT NULL REFERENCES promotions(id),
    
    -- Activation
    claimed_at TIMESTAMPTZ DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    -- Deposit that triggered it
    qualifying_deposit_amount DECIMAL(14,2),
    qualifying_tx_id UUID,
    
    -- Bonus value
    bonus_amount DECIMAL(14,2) DEFAULT 0,      -- Bonus credited
    bonus_type TEXT,                            -- deposit_match, free_spins, free_bet, cashback
    
    -- Free Spins tracking
    free_spins_total INT DEFAULT 0,
    free_spins_used INT DEFAULT 0,
    free_spins_remaining INT DEFAULT 0,
    free_spins_winnings DECIMAL(14,2) DEFAULT 0,
    
    -- Free Bet tracking
    free_bet_amount DECIMAL(14,2) DEFAULT 0,
    free_bet_used BOOLEAN DEFAULT FALSE,
    free_bet_bet_id UUID,                      -- The bet placed with free bet
    free_bet_winnings DECIMAL(14,2) DEFAULT 0,
    
    -- Wagering tracking
    wagering_required DECIMAL(14,2) DEFAULT 0,
    wagering_completed DECIMAL(14,2) DEFAULT 0,
    wagering_remaining DECIMAL(14,2) DEFAULT 0,
    wagering_deadline TIMESTAMPTZ,
    
    -- Cashback tracking
    cashback_period_start TIMESTAMPTZ,
    cashback_period_end TIMESTAMPTZ,
    cashback_losses DECIMAL(14,2) DEFAULT 0,
    cashback_amount DECIMAL(14,2) DEFAULT 0,
    cashback_credited BOOLEAN DEFAULT FALSE,
    
    -- Acca Boost tracking  
    acca_boost_bet_id UUID,
    acca_boost_original_winnings DECIMAL(14,2),
    acca_boost_bonus DECIMAL(14,2),
    
    -- Status
    status TEXT DEFAULT 'active',
    -- active, wagering, completed, forfeited, expired, cancelled
    
    -- Completion
    completed_at TIMESTAMPTZ,
    forfeited_at TIMESTAMPTZ,
    forfeited_reason TEXT,
    
    -- Amounts
    total_won_from_bonus DECIMAL(14,2) DEFAULT 0,
    amount_converted_to_real DECIMAL(14,2) DEFAULT 0, -- After wagering complete
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_up_user ON user_promotions(user_id);
CREATE INDEX idx_up_promo ON user_promotions(promotion_id);
CREATE INDEX idx_up_status ON user_promotions(status);
CREATE INDEX idx_up_wagering ON user_promotions(status, wagering_remaining) WHERE status = 'wagering';

-- ============================================================
-- 6. WAGERING LOG (tracks every contributing bet)
-- ============================================================
CREATE TABLE wagering_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_promotion_id UUID NOT NULL REFERENCES user_promotions(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Source bet/round
    source_type TEXT NOT NULL,                  -- casino_round, sport_bet
    source_id UUID NOT NULL,                   -- game_rounds.id or bets.id
    
    -- Calculation
    bet_amount DECIMAL(14,2) NOT NULL,
    game_category TEXT,                        -- slots, live_casino, table_games, sport_bets
    contribution_pct INT NOT NULL,             -- 100, 50, 10, 0
    contributed_amount DECIMAL(14,2) NOT NULL, -- bet_amount * contribution_pct / 100
    
    -- Running totals
    wagering_before DECIMAL(14,2),
    wagering_after DECIMAL(14,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wl_user_promo ON wagering_log(user_promotion_id);
CREATE INDEX idx_wl_user ON wagering_log(user_id);

-- ============================================================
-- 7. PROCESS WAGERING CONTRIBUTION
-- ============================================================
CREATE OR REPLACE FUNCTION process_wagering(
    p_user_id UUID,
    p_source_type TEXT,
    p_source_id UUID,
    p_bet_amount DECIMAL,
    p_game_category TEXT
) RETURNS JSONB AS $$
DECLARE
    v_promo user_promotions%ROWTYPE;
    v_rules promotion_rules%ROWTYPE;
    v_contribution_pct INT;
    v_contributed DECIMAL;
    v_completed BOOLEAN := FALSE;
BEGIN
    -- Find active wagering promo for user
    SELECT up.* INTO v_promo
    FROM user_promotions up
    WHERE up.user_id = p_user_id
      AND up.status = 'wagering'
      AND (up.wagering_deadline IS NULL OR up.wagering_deadline > NOW())
    ORDER BY up.claimed_at ASC
    LIMIT 1
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'no_active_wagering');
    END IF;
    
    -- Get rules
    SELECT pr.* INTO v_rules
    FROM promotion_rules pr
    WHERE pr.promotion_id = v_promo.promotion_id
    LIMIT 1;
    
    -- Check max bet
    IF v_rules.max_bet_while_wagering IS NOT NULL AND p_bet_amount > v_rules.max_bet_while_wagering THEN
        RETURN jsonb_build_object('status', 'exceeds_max_bet', 'max_bet', v_rules.max_bet_while_wagering);
    END IF;
    
    -- Get contribution percentage
    v_contribution_pct := COALESCE(
        (v_rules.game_contributions->>p_game_category)::INT,
        0
    );
    
    v_contributed := p_bet_amount * v_contribution_pct / 100.0;
    
    IF v_contributed <= 0 THEN
        RETURN jsonb_build_object('status', 'zero_contribution', 'category', p_game_category);
    END IF;
    
    -- Log
    INSERT INTO wagering_log (user_promotion_id, user_id, source_type, source_id, bet_amount, game_category, contribution_pct, contributed_amount, wagering_before, wagering_after)
    VALUES (v_promo.id, p_user_id, p_source_type, p_source_id, p_bet_amount, p_game_category, v_contribution_pct, v_contributed, v_promo.wagering_completed, v_promo.wagering_completed + v_contributed);
    
    -- Update wagering
    UPDATE user_promotions SET
        wagering_completed = wagering_completed + v_contributed,
        wagering_remaining = GREATEST(0, wagering_required - (wagering_completed + v_contributed)),
        updated_at = NOW()
    WHERE id = v_promo.id;
    
    -- Check if completed
    IF (v_promo.wagering_completed + v_contributed) >= v_promo.wagering_required THEN
        v_completed := TRUE;
        
        -- Convert bonus to real balance
        UPDATE user_promotions SET
            status = 'completed',
            completed_at = NOW(),
            amount_converted_to_real = LEAST(bonus_amount + total_won_from_bonus, COALESCE(
                (SELECT max_win_from_bonus FROM promotion_rules WHERE promotion_id = v_promo.promotion_id LIMIT 1),
                bonus_amount + total_won_from_bonus
            ))
        WHERE id = v_promo.id;
        
        -- Credit real wallet
        UPDATE wallets SET
            balance = balance + LEAST(v_promo.bonus_amount + v_promo.total_won_from_bonus, COALESCE(
                (SELECT max_win_from_bonus FROM promotion_rules WHERE promotion_id = v_promo.promotion_id LIMIT 1),
                v_promo.bonus_amount + v_promo.total_won_from_bonus
            )),
            updated_at = NOW()
        WHERE user_id = p_user_id;
    END IF;
    
    RETURN jsonb_build_object(
        'status', 'ok',
        'contributed', v_contributed,
        'contribution_pct', v_contribution_pct,
        'wagering_completed', v_promo.wagering_completed + v_contributed,
        'wagering_required', v_promo.wagering_required,
        'wagering_remaining', GREATEST(0, v_promo.wagering_required - (v_promo.wagering_completed + v_contributed)),
        'completed', v_completed
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 8. TOURNAMENT SCORE UPDATE FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_tournament_score(
    p_tournament_id UUID,
    p_user_id UUID,
    p_bet_amount DECIMAL,
    p_win_amount DECIMAL,
    p_multiplier DECIMAL
) RETURNS JSONB AS $$
DECLARE
    v_tournament slot_tournaments%ROWTYPE;
    v_participant tournament_participants%ROWTYPE;
    v_score_delta DECIMAL;
BEGIN
    SELECT * INTO v_tournament FROM slot_tournaments WHERE id = p_tournament_id AND status = 'live';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'tournament_not_live');
    END IF;
    
    SELECT * INTO v_participant FROM tournament_participants
    WHERE tournament_id = p_tournament_id AND user_id = p_user_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_registered');
    END IF;
    
    -- Calculate score based on tournament type
    CASE v_tournament.scoring_metric
        WHEN 'win_multiplier' THEN v_score_delta := GREATEST(p_multiplier, 0);
        WHEN 'total_win' THEN v_score_delta := GREATEST(p_win_amount, 0);
        WHEN 'total_wagered' THEN v_score_delta := p_bet_amount;
        WHEN 'points' THEN v_score_delta := 1 + (CASE WHEN p_win_amount > 0 THEN p_multiplier * 2 ELSE 0 END);
        ELSE v_score_delta := p_win_amount;
    END CASE;
    
    UPDATE tournament_participants SET
        score = score + v_score_delta,
        total_spins = total_spins + 1,
        total_wagered = total_wagered + p_bet_amount,
        total_won = total_won + p_win_amount,
        biggest_win = GREATEST(biggest_win, p_win_amount),
        biggest_multiplier = GREATEST(biggest_multiplier, p_multiplier),
        last_spin_at = NOW()
    WHERE id = v_participant.id;
    
    RETURN jsonb_build_object('status', 'ok', 'score_added', v_score_delta, 'new_score', v_participant.score + v_score_delta);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 9. SEED PROMOTIONS
-- ============================================================
INSERT INTO promotions (code, name, slug, short_description, type, category, status, starts_at, ends_at, max_claims_per_user, is_featured, sort_order) VALUES
-- Casino
('WELCOME100', 'Bonus Benvenuto Casino', 'welcome-casino', '100% fino a $1,000 + 200 Free Spins', 'casino_welcome', 'casino', 'active', '2026-01-01', '2026-12-31', 1, TRUE, 1),
('RELOAD50', 'Bonus Ricarica', 'reload-bonus', '50% fino a $500 ogni Venerdì', 'casino_reload', 'casino', 'active', '2026-01-01', '2026-12-31', 52, FALSE, 5),
('CASHBACK10', 'Cashback Settimanale', 'weekly-cashback', '10% cashback sulle perdite nette, fino a $200', 'casino_cashback', 'casino', 'active', '2026-01-01', '2026-12-31', 52, FALSE, 6),
('NODEP25', 'Bonus Senza Deposito', 'no-deposit-bonus', '$25 gratis alla registrazione', 'casino_no_deposit', 'casino', 'active', '2026-01-01', '2026-12-31', 1, TRUE, 2),
('FREESPIN50', '50 Giri Gratis', 'free-spins-friday', '50 Free Spins su Sweet Bonanza ogni Venerdì', 'free_spins', 'casino', 'active', '2026-01-01', '2026-12-31', 52, FALSE, 7),

-- Sport
('SPORTWELCOME', 'Bonus Sport Benvenuto', 'welcome-sport', 'Scommessa Gratis $50 + 100% primo deposito', 'sport_welcome', 'sport', 'active', '2026-01-01', '2026-12-31', 1, TRUE, 3),
('FREEBET10', 'Free Bet $10', 'free-bet-daily', '$10 Free Bet al giorno su eventi live', 'sport_free_bet', 'sport', 'active', '2026-01-01', '2026-12-31', 365, FALSE, 8),
('ACCABOOST', 'Acca Boost', 'acca-boost', 'Fino a +100% sulle vincite delle multiple', 'sport_acca_boost', 'sport', 'active', '2026-01-01', '2026-12-31', 999, FALSE, 4),
('ENHANCED01', 'Super Quota Inter ML', 'enhanced-inter', 'Inter vince @5.00 (era 1.80)', 'sport_enhanced_odds', 'sport', 'active', '2026-02-14', '2026-02-15', 500, TRUE, 0),

-- Tournaments
('MEGASPIN', 'Mega Spin Tournament', 'mega-spin', 'Montepremi $10,000 — Slot Tournament settimanale', 'slot_tournament', 'tournament', 'active', '2026-02-10', '2026-02-17', 1, TRUE, 0),
('VALRACE', 'Valentine Race', 'valentine-race', '$2,000 Race di San Valentino', 'race', 'tournament', 'active', '2026-02-12', '2026-02-18', 1, TRUE, 0);

-- Rules for each
INSERT INTO promotion_rules (promotion_id, min_deposit, bonus_type, bonus_percentage, max_bonus_amount, free_spins_count, free_spins_value, wagering_multiplier, wagering_deadline_days, max_bet_while_wagering, max_win_from_bonus) VALUES
((SELECT id FROM promotions WHERE code = 'WELCOME100'), 20, 'percentage', 100, 1000, 200, 0.20, 35, 30, 5, 10000),
((SELECT id FROM promotions WHERE code = 'RELOAD50'), 20, 'percentage', 50, 500, 0, NULL, 30, 14, 5, 5000),
((SELECT id FROM promotions WHERE code = 'NODEP25'), NULL, 'fixed', NULL, 25, 0, NULL, 60, 7, 2, 100);

INSERT INTO promotion_rules (promotion_id, cashback_percentage, cashback_max_amount, cashback_period, cashback_on, cashback_min_loss, wagering_multiplier, wagering_deadline_days) VALUES
((SELECT id FROM promotions WHERE code = 'CASHBACK10'), 10, 200, 'weekly', 'net_losses', 10, 5, 7);

INSERT INTO promotion_rules (promotion_id, free_spins_count, free_spins_value, free_spins_expiry_hours, wagering_multiplier, wagering_deadline_days, max_win_from_bonus) VALUES
((SELECT id FROM promotions WHERE code = 'FREESPIN50'), 50, 0.20, 72, 30, 7, 200);

INSERT INTO promotion_rules (promotion_id, min_deposit, bonus_type, bonus_percentage, max_bonus_amount, free_bet_amount, free_bet_min_odds, free_bet_returns_stake, wagering_multiplier, wagering_deadline_days) VALUES
((SELECT id FROM promotions WHERE code = 'SPORTWELCOME'), 20, 'percentage', 100, 500, 50, 1.50, FALSE, 8, 30);

INSERT INTO promotion_rules (promotion_id, free_bet_amount, free_bet_min_odds, free_bet_returns_stake, free_bet_eligible_sports) VALUES
((SELECT id FROM promotions WHERE code = 'FREEBET10'), 10, 2.00, FALSE, '{"calcio","basket","tennis"}');

INSERT INTO promotion_rules (promotion_id, acca_boost_min_legs, acca_boost_min_odds_per_leg, acca_boost_percentages, acca_boost_max_bonus) VALUES
((SELECT id FROM promotions WHERE code = 'ACCABOOST'), 3, 1.20, '{"3": 5, "4": 10, "5": 20, "6": 35, "7": 50, "8": 75, "9": 100}', 5000);

INSERT INTO promotion_rules (promotion_id, enhanced_original_odds, enhanced_boosted_odds, enhanced_max_stake, free_bet_min_odds) VALUES
((SELECT id FROM promotions WHERE code = 'ENHANCED01'), 1.80, 5.00, 50, 5.00);

-- Tournament entries
INSERT INTO slot_tournaments (promotion_id, name, description, starts_at, ends_at, tournament_type, scoring_metric, entry_type, min_bet_per_spin, total_prize_pool, prize_distribution, status) VALUES
((SELECT id FROM promotions WHERE code = 'MEGASPIN'), 'Mega Spin Tournament', 'Il torneo slot più grande della settimana! Gioca a qualsiasi slot e scala la classifica.', '2026-02-10', '2026-02-17', 'highest_win_multiplier', 'win_multiplier', 'free', 0.20, 10000,
'[{"rank":1,"prize":3000,"type":"real_money"},{"rank":2,"prize":1500,"type":"real_money"},{"rank":3,"prize":1000,"type":"real_money"},{"rank_from":4,"rank_to":10,"prize":300,"type":"bonus"},{"rank_from":11,"rank_to":25,"prize":50,"type":"free_spins","free_spins_count":100},{"rank_from":26,"rank_to":50,"prize":20,"type":"free_spins","free_spins_count":25}]',
'live'),

((SELECT id FROM promotions WHERE code = 'VALRACE'), 'Valentine Race', 'Corsa di San Valentino! Chi wagera di più vince!', '2026-02-12', '2026-02-18', 'total_wagered', 'total_wagered', 'free', 0.10, 2000,
'[{"rank":1,"prize":500,"type":"real_money"},{"rank":2,"prize":300,"type":"real_money"},{"rank":3,"prize":200,"type":"real_money"},{"rank_from":4,"rank_to":10,"prize":50,"type":"bonus"},{"rank_from":11,"rank_to":25,"prize":25,"type":"free_spins","free_spins_count":50}]',
'live');

-- ============================================================
-- 10. RLS
-- ============================================================
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wagering_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_promos" ON promotions FOR SELECT USING (status = 'active');
CREATE POLICY "public_read_tournaments" ON slot_tournaments FOR SELECT USING (status IN ('upcoming', 'registration', 'live', 'completed'));
CREATE POLICY "public_read_leaderboard" ON tournament_participants FOR SELECT USING (TRUE);

CREATE POLICY "service_all_promos" ON promotions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_rules" ON promotion_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_tournaments" ON slot_tournaments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_tp" ON tournament_participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_up" ON user_promotions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_wl" ON wagering_log FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE tournament_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE slot_tournaments;
