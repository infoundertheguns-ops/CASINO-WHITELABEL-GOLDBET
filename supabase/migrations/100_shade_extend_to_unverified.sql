-- ============================================================
-- 100_shade_extend_to_unverified.sql
--
-- User requirement: push the MIN of 3 sources to frontend even when
-- canonical_verified=false (mapping exists but operator hasn't reviewed).
--
-- Change: remove the `IF NOT canonical_verified THEN RETURN v_primary` gate
-- in fn_compute_displayed_odds. All canonically-pivoted rows now get the
-- full shade treatment (MIN when spread > 25%, primary otherwise).
--
-- Rationale:
--   - 29% of canonical rows are unverified (71% verified coverage today)
--   - With gate, those return raw primary → shade inert on them
--   - Dropping gate exposes wrong mappings quickly (operator sees weird odds
--     on display, fixes mapping) — creates verification pressure
--
-- Single-source behavior unchanged: >3.0 gets 0.90 discount, <=3.0 as-is.
-- Shade-enabled flag still governs whether lib/shade.ts reads this view.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_compute_displayed_odds(
  p_kambi_odds numeric, p_kambi_active boolean, p_kambi_suspended boolean,
  p_twobet_odds numeric, p_twobet_active boolean, p_twobet_suspended boolean,
  p_betfair_odds numeric, p_betfair_active boolean, p_betfair_suspended boolean,
  p_manual_odds numeric, p_canonical_verified boolean
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_available numeric[];
  v_min numeric; v_max numeric;
  v_spread numeric;
  v_primary numeric;
BEGIN
  IF p_manual_odds IS NOT NULL THEN RETURN p_manual_odds; END IF;

  v_available := ARRAY[]::numeric[];
  IF p_kambi_odds IS NOT NULL AND COALESCE(p_kambi_active, false) AND NOT COALESCE(p_kambi_suspended, false) THEN
    v_available := array_append(v_available, p_kambi_odds);
  END IF;
  IF p_twobet_odds IS NOT NULL AND COALESCE(p_twobet_active, false) AND NOT COALESCE(p_twobet_suspended, false) THEN
    v_available := array_append(v_available, p_twobet_odds);
  END IF;
  IF p_betfair_odds IS NOT NULL AND COALESCE(p_betfair_active, false) AND NOT COALESCE(p_betfair_suspended, false) THEN
    v_available := array_append(v_available, p_betfair_odds);
  END IF;

  IF array_length(v_available, 1) IS NULL THEN RETURN NULL; END IF;

  v_primary := COALESCE(
    CASE WHEN COALESCE(p_kambi_active,false)   AND NOT COALESCE(p_kambi_suspended,false)   THEN p_kambi_odds   END,
    CASE WHEN COALESCE(p_twobet_active,false)  AND NOT COALESCE(p_twobet_suspended,false)  THEN p_twobet_odds  END,
    CASE WHEN COALESCE(p_betfair_active,false) AND NOT COALESCE(p_betfair_suspended,false) THEN p_betfair_odds END
  );

  -- NB: canonical_verified gate REMOVED here (was: RETURN v_primary if false)
  -- Shade applies uniformly to all canonically-pivoted rows. Parameter kept
  -- in signature for backward compat with view + callers.

  IF array_length(v_available, 1) = 1 THEN
    IF v_available[1] > 3.0 THEN
      RETURN ROUND(v_available[1] * 0.90, 2);
    ELSE
      RETURN v_available[1];
    END IF;
  END IF;

  SELECT MIN(x), MAX(x) INTO v_min, v_max FROM unnest(v_available) x;
  v_spread := (v_max / v_min) - 1;
  IF v_spread > 0.25 THEN RETURN v_min; END IF;
  RETURN v_primary;
END $$;

-- Update shade_monitor_kpis to count shade activity on ALL canonically-pivoted
-- rows (not just verified), reflecting the new fn behavior.
CREATE OR REPLACE FUNCTION shade_monitor_kpis()
RETURNS TABLE(label text, value text)
LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT displayed_odds, kambi_odds, twobet_odds, betfair_odds, canonical_verified,
           ((kambi_odds IS NOT NULL)::int + (twobet_odds IS NOT NULL)::int + (betfair_odds IS NOT NULL)::int) AS n_sources
    FROM v_outcomes_displayed
  )
  SELECT 'Total canonical outcomes'::text, COUNT(*)::text FROM latest
  UNION ALL
  SELECT 'Shade active (displayed != primary)'::text,
    COUNT(*) FILTER (
      WHERE displayed_odds IS NOT NULL
        AND n_sources >= 2
        AND displayed_odds IS DISTINCT FROM COALESCE(kambi_odds, twobet_odds, betfair_odds)
    )::text
  FROM latest
  UNION ALL
  SELECT 'Multi-source (2+) verified'::text,
    COUNT(*) FILTER (WHERE canonical_verified AND n_sources >= 2)::text
  FROM latest
  UNION ALL
  SELECT 'Multi-source (2+) unverified'::text,
    COUNT(*) FILTER (WHERE NOT canonical_verified AND n_sources >= 2)::text
  FROM latest
  UNION ALL
  SELECT 'Single-source fallback'::text,
    COUNT(*) FILTER (WHERE n_sources = 1)::text
  FROM latest
  UNION ALL
  SELECT 'Unverified canonicalizations'::text,
    COUNT(*) FILTER (WHERE NOT canonical_verified)::text
  FROM latest;
$$;

-- Update shade_monitor_top_markets + spread_histogram to drop verified filter
CREATE OR REPLACE FUNCTION shade_monitor_top_markets(p_limit int DEFAULT 20)
RETURNS TABLE(sport text, market_canonical_key text, canonical_outcome_key text, shade_count bigint)
LANGUAGE sql STABLE AS $$
  WITH shaded AS (
    SELECT market_canonical_key, canonical_outcome_key, sport_id
    FROM v_outcomes_displayed
    WHERE displayed_odds IS NOT NULL
      AND displayed_odds IS DISTINCT FROM COALESCE(kambi_odds, twobet_odds, betfair_odds)
  )
  SELECT COALESCE(s.slug, 'unknown')::text, v.market_canonical_key, v.canonical_outcome_key, COUNT(*)::bigint
  FROM shaded v LEFT JOIN sports s ON s.id = v.sport_id
  GROUP BY 1, 2, 3
  ORDER BY 4 DESC LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION shade_monitor_spread_histogram()
RETURNS TABLE(bucket text, count bigint)
LANGUAGE sql STABLE AS $$
  WITH spreads AS (
    SELECT
      GREATEST(kambi_odds, twobet_odds, betfair_odds)
       / NULLIF(LEAST(kambi_odds, twobet_odds, betfair_odds), 0) - 1 AS s
    FROM v_outcomes_displayed
    WHERE ((kambi_odds IS NOT NULL)::int
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

COMMIT;
