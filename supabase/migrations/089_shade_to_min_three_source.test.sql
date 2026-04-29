-- Verification queries for migration 089. Run after applying.

-- 1. fn_compute_displayed_odds
SELECT fn_compute_displayed_odds(2.10, true, false, 5.80, true, false, NULL, NULL, NULL, NULL, true) AS test1_shade_2source;
-- Expected: 2.10

SELECT fn_compute_displayed_odds(2.10, true, false, 2.15, true, false, 2.12, true, false, NULL, true) AS test2_aligned_returns_primary;
-- Expected: 2.10

SELECT fn_compute_displayed_odds(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.95, true) AS test3_manual_override;
-- Expected: 1.95

SELECT fn_compute_displayed_odds(5.80, true, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true) AS test4_single_high_markup;
-- Expected: 5.22

SELECT fn_compute_displayed_odds(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true) AS test5_no_source_null;
-- Expected: NULL

SELECT fn_compute_displayed_odds(2.10, true, false, 5.80, true, false, NULL, NULL, NULL, NULL, false) AS test6_unverified_primary;
-- Expected: 2.10 (unverified -> returns primary, no shade)

-- 2. Views exist
SELECT COUNT(*) > 0 AS v_canonical_exists FROM pg_views WHERE viewname = 'v_outcomes_canonical';
SELECT COUNT(*) > 0 AS v_displayed_exists FROM pg_views WHERE viewname = 'v_outcomes_displayed';

-- 3. Feature flag
SELECT key, value FROM system_config WHERE key = 'shade_enabled';
-- Expected: shade_enabled / false

-- 4. Sample view query (0 rows expected until Betfair scraper runs, but should not error)
SELECT COUNT(*) AS displayed_rows FROM v_outcomes_displayed;

-- 5. CHECK constraints widened
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('market_normalization_source_check', 'outcome_normalization_source_check');
-- Expected: both include 'betfair' in ARRAY

-- 6. events.source generated expression
SELECT generation_expression
FROM information_schema.columns
WHERE table_name='events' AND column_name='source';
-- Expected: contains "'betfair:%' THEN 'betfair'"
