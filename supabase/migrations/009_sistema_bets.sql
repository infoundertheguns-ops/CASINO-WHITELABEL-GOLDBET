-- 009_sistema_bets.sql
-- Adds support for system bets (scommesse a sistema)
-- Parent bet holds the system overview, child bets are individual combos

ALTER TABLE bets ADD COLUMN IF NOT EXISTS parent_bet_id UUID REFERENCES bets(id);
ALTER TABLE bets ADD COLUMN IF NOT EXISTS combo_type TEXT;        -- "2/3", "3/5", etc.
ALTER TABLE bets ADD COLUMN IF NOT EXISTS combo_count INT;        -- C(N,K) number of combos
ALTER TABLE bets ADD COLUMN IF NOT EXISTS combos_won INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bets_parent ON bets(parent_bet_id) WHERE parent_bet_id IS NOT NULL;
