-- ============================================================
-- 090b_betfair_outcome_seed_italian.sql
--
-- Mig 090 seeded outcome_normalization rows with source_market_type
-- set to raw Betfair strings (OVER_UNDER_25, DOUBLE_CHANCE, etc.).
-- After transform.ts remap (commit b8dd9ac), scraper emits Italian
-- forms ("U/O 2.5", "DC", etc.) — so those seeded rows never fire.
--
-- This migration:
--   a) marks the obsolete mig 090 rows as unverified (keep for audit)
--   b) re-seeds with Italian source_market_type matching what kambi
--      scraper already uses, so Betfair outcome canonicalization
--      piggybacks on Kambi's existing infrastructure
-- ============================================================

BEGIN;

-- a) Mark obsolete UPPERCASE seeds as unverified (retain for audit trail)
UPDATE outcome_normalization
SET verified = false,
    notes = COALESCE(notes, '') || ' [obsolete: UPPERCASE form, scraper now emits Italian]',
    updated_at = NOW()
WHERE source = 'betfair'
  AND source_market_type ~ '^[A-Z_]+$';   -- UPPERCASE_WITH_UNDERSCORES only

-- b) Re-seed with Italian market_type strings
INSERT INTO outcome_normalization
  (source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key, extracted_by, verified, confidence)
VALUES
  -- GG/NG
  ('betfair','GG/NG','Yes', 'gg_ng_ft', 'gg_ng_ft_yes', 'manual', true, 100),
  ('betfair','GG/NG','No',  'gg_ng_ft', 'gg_ng_ft_no',  'manual', true, 100),

  -- DC (Betfair runner names: "Home or Draw" / "Home or Away" / "Draw or Away")
  ('betfair','DC','Home or Draw', 'dc_ft', 'dc_ft_1x', 'manual', true, 100),
  ('betfair','DC','Home or Away', 'dc_ft', 'dc_ft_12', 'manual', true, 100),
  ('betfair','DC','Draw or Away', 'dc_ft', 'dc_ft_x2', 'manual', true, 100),

  -- DNB
  ('betfair','DNB','Home', 'dnb_ft', 'dnb_ft_home', 'manual', true, 100),
  ('betfair','DNB','Away', 'dnb_ft', 'dnb_ft_away', 'manual', true, 100),

  -- U/O full-time (one seed per line)
  ('betfair','U/O 0.5','Over 0.5',  'u_o_ft', 'u_o_ft_0.5_over',  'manual', true, 100),
  ('betfair','U/O 0.5','Under 0.5', 'u_o_ft', 'u_o_ft_0.5_under', 'manual', true, 100),
  ('betfair','U/O 1.5','Over 1.5',  'u_o_ft', 'u_o_ft_1.5_over',  'manual', true, 100),
  ('betfair','U/O 1.5','Under 1.5', 'u_o_ft', 'u_o_ft_1.5_under', 'manual', true, 100),
  ('betfair','U/O 2.5','Over 2.5',  'u_o_ft', 'u_o_ft_2.5_over',  'manual', true, 100),
  ('betfair','U/O 2.5','Under 2.5', 'u_o_ft', 'u_o_ft_2.5_under', 'manual', true, 100),
  ('betfair','U/O 3.5','Over 3.5',  'u_o_ft', 'u_o_ft_3.5_over',  'manual', true, 100),
  ('betfair','U/O 3.5','Under 3.5', 'u_o_ft', 'u_o_ft_3.5_under', 'manual', true, 100),
  ('betfair','U/O 4.5','Over 4.5',  'u_o_ft', 'u_o_ft_4.5_over',  'manual', true, 100),
  ('betfair','U/O 4.5','Under 4.5', 'u_o_ft', 'u_o_ft_4.5_under', 'manual', true, 100),
  ('betfair','U/O 5.5','Over 5.5',  'u_o_ft', 'u_o_ft_5.5_over',  'manual', true, 100),
  ('betfair','U/O 5.5','Under 5.5', 'u_o_ft', 'u_o_ft_5.5_under', 'manual', true, 100),

  -- U/O first half
  ('betfair','U/O 0.5 1T','Over 0.5',  'u_o_1h', 'u_o_1h_0.5_over',  'manual', true, 100),
  ('betfair','U/O 0.5 1T','Under 0.5', 'u_o_1h', 'u_o_1h_0.5_under', 'manual', true, 100),
  ('betfair','U/O 1.5 1T','Over 1.5',  'u_o_1h', 'u_o_1h_1.5_over',  'manual', true, 100),
  ('betfair','U/O 1.5 1T','Under 1.5', 'u_o_1h', 'u_o_1h_1.5_under', 'manual', true, 100),
  ('betfair','U/O 2.5 1T','Over 2.5',  'u_o_1h', 'u_o_1h_2.5_over',  'manual', true, 100),
  ('betfair','U/O 2.5 1T','Under 2.5', 'u_o_1h', 'u_o_1h_2.5_under', 'manual', true, 100),

  -- Pari/Dispari
  ('betfair','Pari/Dispari','Odd',  'oe_ft', 'oe_ft_odd',  'manual', true, 100),
  ('betfair','Pari/Dispari','Even', 'oe_ft', 'oe_ft_even', 'manual', true, 100)

ON CONFLICT (source, source_market_type, source_outcome_name) DO UPDATE SET
  canonical_key         = EXCLUDED.canonical_key,
  canonical_outcome_key = EXCLUDED.canonical_outcome_key,
  verified              = EXCLUDED.verified,
  confidence            = EXCLUDED.confidence,
  extracted_by          = EXCLUDED.extracted_by,
  updated_at            = NOW();

COMMIT;
