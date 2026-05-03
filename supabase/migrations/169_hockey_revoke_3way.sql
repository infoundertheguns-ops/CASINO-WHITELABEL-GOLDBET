-- Migration 169: hockey - revoke 3-Way -> 1X2 TR (Bet365 weird outcomes)
--
-- Bet365 emits "3-Way" market_name with outcome_keys like
-- "Money Line (1)", "Money Line (Tie)", "Money Line (2)" — non-canonical.
-- Other bookmakers emit "3-Way Result" with canonical outcome_keys (1/X/2).
-- Both were mapped to "1X2 TR" in mig 168 → frontend picked Bet365's
-- broken row first.
--
-- Revoke 3-Way -> 1X2 TR mapping for hockey only (keep for other sports
-- like handball Game Lines 3-Way that may legitimately use it).

DELETE FROM oddsapi_translations
WHERE kind = 'market'
  AND source_key = '3-Way'
  AND sport_slug IN ('ice-hockey', 'hockey-ghiaccio')
  AND translated = '1X2 TR';

DO $$
DECLARE n_remaining int;
BEGIN
  SELECT count(*) INTO n_remaining FROM oddsapi_translations
    WHERE kind = 'market' AND source_key = '3-Way'
    AND sport_slug IN ('ice-hockey','hockey-ghiaccio');
  RAISE NOTICE 'Hockey 3-Way mappings remaining: % (expected 0)', n_remaining;
END $$;
