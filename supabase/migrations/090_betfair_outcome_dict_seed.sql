BEGIN;

-- Betfair outcome name seeds.
-- Team names are NOT seeded — Betfair uses per-event team names (e.g. "Juventus"
-- rather than "Home"), resolved downstream by trigram against event_normalization.
-- These entries cover markets where Betfair uses fixed English keywords.
--
-- canonical_key values must reference canonical_markets.canonical_key (FK).
-- U/O markets: line is stored in canonical_line at market_normalization stage;
-- the canonical_key here is the line-agnostic parent (u_o_ft, u_o_1h, etc.).
-- Odd/Even canonical_key is oe_ft (not odd_even_ft).

INSERT INTO outcome_normalization
  (source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key, extracted_by, verified, confidence)
VALUES
  -- BOTH_TEAMS_TO_SCORE (gg_ng_ft)
  ('betfair','BOTH_TEAMS_TO_SCORE','Yes', 'gg_ng_ft', 'gg_ng_ft_yes', 'manual', true, 100),
  ('betfair','BOTH_TEAMS_TO_SCORE','No',  'gg_ng_ft', 'gg_ng_ft_no',  'manual', true, 100),

  -- DOUBLE_CHANCE (dc_ft)
  ('betfair','DOUBLE_CHANCE','Home or Draw', 'dc_ft', 'dc_ft_1x', 'manual', true, 100),
  ('betfair','DOUBLE_CHANCE','Home or Away', 'dc_ft', 'dc_ft_12', 'manual', true, 100),
  ('betfair','DOUBLE_CHANCE','Draw or Away', 'dc_ft', 'dc_ft_x2', 'manual', true, 100),

  -- OVER_UNDER_* — canonical_key is line-agnostic u_o_ft (line stored at normalization stage)
  ('betfair','OVER_UNDER_05','Over 0.5',  'u_o_ft', 'u_o_ft_0.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_05','Under 0.5', 'u_o_ft', 'u_o_ft_0.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_15','Over 1.5',  'u_o_ft', 'u_o_ft_1.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_15','Under 1.5', 'u_o_ft', 'u_o_ft_1.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_25','Over 2.5',  'u_o_ft', 'u_o_ft_2.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_25','Under 2.5', 'u_o_ft', 'u_o_ft_2.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_35','Over 3.5',  'u_o_ft', 'u_o_ft_3.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_35','Under 3.5', 'u_o_ft', 'u_o_ft_3.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_45','Over 4.5',  'u_o_ft', 'u_o_ft_4.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_45','Under 4.5', 'u_o_ft', 'u_o_ft_4.5_under', 'manual', true, 100),
  ('betfair','OVER_UNDER_55','Over 5.5',  'u_o_ft', 'u_o_ft_5.5_over',  'manual', true, 100),
  ('betfair','OVER_UNDER_55','Under 5.5', 'u_o_ft', 'u_o_ft_5.5_under', 'manual', true, 100),

  -- FIRST_HALF_GOALS_* — canonical_key u_o_1h (half-time U/O, line stored at norm stage)
  ('betfair','FIRST_HALF_GOALS_05','Over 0.5',  'u_o_1h', 'u_o_1h_0.5_over',  'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_05','Under 0.5', 'u_o_1h', 'u_o_1h_0.5_under', 'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_15','Over 1.5',  'u_o_1h', 'u_o_1h_1.5_over',  'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_15','Under 1.5', 'u_o_1h', 'u_o_1h_1.5_under', 'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_25','Over 2.5',  'u_o_1h', 'u_o_1h_2.5_over',  'manual', true, 100),
  ('betfair','FIRST_HALF_GOALS_25','Under 2.5', 'u_o_1h', 'u_o_1h_2.5_under', 'manual', true, 100),

  -- DRAW_NO_BET
  ('betfair','DRAW_NO_BET','Home', 'dnb_ft', 'dnb_ft_home', 'manual', true, 100),
  ('betfair','DRAW_NO_BET','Away', 'dnb_ft', 'dnb_ft_away', 'manual', true, 100),

  -- ODD_OR_EVEN — canonical_key is oe_ft (odd_even base_key maps to oe_* canonical)
  ('betfair','ODD_OR_EVEN','Odd',  'oe_ft', 'oe_ft_odd',  'manual', true, 100),
  ('betfair','ODD_OR_EVEN','Even', 'oe_ft', 'oe_ft_even', 'manual', true, 100)

ON CONFLICT (source, source_market_type, source_outcome_name) DO UPDATE SET
  canonical_key         = EXCLUDED.canonical_key,
  canonical_outcome_key = EXCLUDED.canonical_outcome_key,
  verified              = EXCLUDED.verified,
  confidence            = EXCLUDED.confidence,
  extracted_by          = EXCLUDED.extracted_by,
  updated_at            = NOW();

COMMIT;
