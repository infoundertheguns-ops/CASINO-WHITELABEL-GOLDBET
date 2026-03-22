-- 025_ippica_betting.sql
-- Add ippica support to bet_selections

ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sport';
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS ippica_race_id UUID REFERENCES ippica_races(id);
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS ippica_market_id UUID REFERENCES ippica_markets(id);
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS ippica_odds_id UUID REFERENCES ippica_odds(id);

-- Index for ippica settlement queries
CREATE INDEX IF NOT EXISTS idx_bet_selections_ippica_race ON bet_selections(ippica_race_id) WHERE source = 'ippica';
CREATE INDEX IF NOT EXISTS idx_bet_selections_ippica_odds ON bet_selections(ippica_odds_id) WHERE source = 'ippica';
