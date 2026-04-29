-- ============================================================
-- 091_shade_monitor_rpcs.sql
--
-- Read-only RPCs that power /admin/shade-monitor dashboard.
-- All are STABLE (non-volatile) — read v_outcomes_displayed view.
-- ============================================================

BEGIN;

-- KPI summary
CREATE OR REPLACE FUNCTION shade_monitor_kpis()
RETURNS TABLE(label text, value text)
LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT displayed_odds, kambi_odds, twobet_odds, betfair_odds, canonical_verified
    FROM v_outcomes_displayed
  )
  SELECT 'Total canonical outcomes'::text, COUNT(*)::text FROM latest
  UNION ALL
  SELECT 'Shade active (displayed != primary)'::text,
    COUNT(*) FILTER (WHERE canonical_verified
                       AND displayed_odds IS DISTINCT FROM COALESCE(kambi_odds, twobet_odds, betfair_odds))::text
  FROM latest
  UNION ALL
  SELECT 'Single-source fallback'::text,
    COUNT(*) FILTER (WHERE canonical_verified AND (
      (kambi_odds IS NOT NULL)::int + (twobet_odds IS NOT NULL)::int + (betfair_odds IS NOT NULL)::int = 1
    ))::text
  FROM latest
  UNION ALL
  SELECT 'Unverified canonicalizations'::text,
    COUNT(*) FILTER (WHERE NOT canonical_verified)::text
  FROM latest;
$$;

-- Top N canonical markets where shade fires most frequently
CREATE OR REPLACE FUNCTION shade_monitor_top_markets(p_limit int DEFAULT 20)
RETURNS TABLE(sport text, market_canonical_key text, canonical_outcome_key text, shade_count bigint)
LANGUAGE sql STABLE AS $$
  WITH shaded AS (
    SELECT market_canonical_key, canonical_outcome_key, sport_id
    FROM v_outcomes_displayed
    WHERE canonical_verified
      AND displayed_odds IS DISTINCT FROM COALESCE(kambi_odds, twobet_odds, betfair_odds)
  )
  SELECT COALESCE(s.slug, 'unknown')::text, v.market_canonical_key, v.canonical_outcome_key, COUNT(*)::bigint
  FROM shaded v LEFT JOIN sports s ON s.id = v.sport_id
  GROUP BY 1, 2, 3
  ORDER BY 4 DESC LIMIT p_limit;
$$;

-- Spread distribution histogram (pre-shade delta across sources)
CREATE OR REPLACE FUNCTION shade_monitor_spread_histogram()
RETURNS TABLE(bucket text, count bigint)
LANGUAGE sql STABLE AS $$
  WITH spreads AS (
    SELECT
      GREATEST(kambi_odds, twobet_odds, betfair_odds)
       / NULLIF(LEAST(kambi_odds, twobet_odds, betfair_odds), 0) - 1 AS s
    FROM v_outcomes_displayed
    WHERE canonical_verified
      AND ((kambi_odds IS NOT NULL)::int
         + (twobet_odds IS NOT NULL)::int
         + (betfair_odds IS NOT NULL)::int) >= 2
  )
  SELECT
    CASE
      WHEN s IS NULL THEN 'n/a'
      WHEN s < 0.05 THEN '0-5%'
      WHEN s < 0.15 THEN '5-15%'
      WHEN s < 0.25 THEN '15-25%'
      WHEN s < 0.50 THEN '25-50%'
      WHEN s < 1.00 THEN '50-100%'
      ELSE '>100%'
    END::text,
    COUNT(*)::bigint
  FROM spreads
  GROUP BY 1
  ORDER BY MIN(s) NULLS FIRST;
$$;

-- Service_role may invoke via RPC
GRANT EXECUTE ON FUNCTION shade_monitor_kpis() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION shade_monitor_top_markets(int) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION shade_monitor_spread_histogram() TO service_role, authenticated;

COMMIT;
