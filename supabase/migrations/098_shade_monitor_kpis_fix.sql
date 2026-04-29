-- 098_shade_monitor_kpis_fix.sql
-- Fix 2026-04-23: shade_monitor_kpis() "Shade active" count was inflated ~14x
-- (713K reported, 46K actual) because it counted outcomes where displayed_odds
-- is NULL (inactive/suspended per fn_compute_displayed_odds guards) as distinct
-- from the primary odds.
--
-- Root cause: `NULL IS DISTINCT FROM 2.54` = TRUE. The filter didn't exclude
-- rows where the computed displayed is NULL due to active=false/suspended=true.
--
-- Effect: KPI made shade flip look 10x over spec target (67% vs 3-8%). Actual
-- multi-source shade activity is 4.4% — within spec.
--
-- Also adds "Shade active (multi-source only)" breakdown row for clarity.

CREATE OR REPLACE FUNCTION public.shade_monitor_kpis()
RETURNS TABLE(label text, value text) LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT displayed_odds, kambi_odds, twobet_odds, betfair_odds, canonical_verified,
           ((kambi_odds IS NOT NULL)::int
            + (twobet_odds IS NOT NULL)::int
            + (betfair_odds IS NOT NULL)::int) AS n_sources
    FROM v_outcomes_displayed
  )
  SELECT 'Total canonical outcomes'::text, COUNT(*)::text FROM latest
  UNION ALL
  SELECT 'Shade active (displayed != primary, multi-source, displayed NOT NULL)'::text,
    COUNT(*) FILTER (
      WHERE canonical_verified
        AND displayed_odds IS NOT NULL
        AND n_sources >= 2
        AND displayed_odds IS DISTINCT FROM COALESCE(kambi_odds, twobet_odds, betfair_odds)
    )::text
  FROM latest
  UNION ALL
  SELECT 'Multi-source verified outcomes'::text,
    COUNT(*) FILTER (WHERE canonical_verified AND n_sources >= 2)::text
  FROM latest
  UNION ALL
  SELECT 'Single-source fallback'::text,
    COUNT(*) FILTER (WHERE canonical_verified AND n_sources = 1)::text
  FROM latest
  UNION ALL
  SELECT 'Unverified canonicalizations'::text,
    COUNT(*) FILTER (WHERE NOT canonical_verified)::text
  FROM latest;
$$;
