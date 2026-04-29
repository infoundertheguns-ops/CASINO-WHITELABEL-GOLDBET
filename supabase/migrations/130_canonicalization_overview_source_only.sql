-- Migration 130: canonicalization_overview() L3 — source_only-aware coverage.
--
-- Sprint 3 Phase B follow-up to mig 129. Previously L3 returned only the raw
-- ratio fs_mapped / total_active_7d, which is diluted by ~830 events flagged
-- as is_source_only=true (Setka Cup, Esports Battle, Alternative Matches, …).
--
-- This migration rewrites canonicalization_overview() to compute:
--   - source_only_flagged          = active 7d AND is_source_only = true
--   - mappable_total               = total_active_7d - source_only_flagged
--   - coverage_among_mappable_pct  = fs_mapped / mappable_total * 100
--
-- The pre-existing fields (total_active_7d, flashscore_mapped, flashscore_pct,
-- per_stage, per_source, color, cross_source_canonical) are preserved verbatim.
--
-- Body baseline: mig 122 (the only RPC owner before this mig). Mig 122 placed
-- 'cross_source_canonical': 0 / 'source_only_flagged': 0 placeholders at lines
-- 244-246; this mig populates source_only_flagged and adds the two new fields.
-- cross_source_canonical stays 0 here (not measured by this RPC; canonical_id
-- coverage is exposed separately by canonicalization_browse_groups).
--
-- Idempotent: CREATE OR REPLACE.
-- Rollback: re-apply mig 122 SQL body for canonicalization_overview().

SET statement_timeout = '5min';
SET lock_timeout = '2min';

CREATE OR REPLACE FUNCTION canonicalization_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '120s'
AS $fn$
DECLARE
  v_result jsonb;
  v_total_sports int;
  v_total_leagues int;
  v_unknown_leagues int;
  v_betfair_unknown int;
  v_22bet_unknown int;
  v_total_events_active int;
  v_fs_mapped int;
  v_verified int;
  v_auto int;
  v_manual int;
  v_llm_auto int;
  v_kambi_total int; v_kambi_mapped int;
  v_22bet_total int; v_22bet_mapped int;
  v_betfair_total int; v_betfair_mapped int;
  v_total_markets int; v_canonical_markets int;
  v_total_outcomes int; v_canonical_outcomes int;
  v_source_only_flagged int;
  v_mappable_total int;
BEGIN
  -- Level 1: sports
  SELECT count(*) INTO v_total_sports FROM sports WHERE is_active;

  -- Level 2: leagues
  SELECT count(*) INTO v_total_leagues FROM leagues;
  SELECT count(*) INTO v_unknown_leagues
    FROM leagues
    WHERE name = 'Unknown' OR name LIKE 'Unknown (%)';

  SELECT count(DISTINCT e.league_id) INTO v_betfair_unknown
    FROM events e
    WHERE e.external_id LIKE 'betfair:%'
      AND e.starts_at > now() - interval '14 days'
      AND e.league_id IN (
        SELECT id FROM leagues WHERE name = 'Unknown' OR name LIKE 'Unknown (%)'
      );

  SELECT count(DISTINCT e.league_id) INTO v_22bet_unknown
    FROM events e
    WHERE e.external_id LIKE '22bet:%'
      AND e.starts_at > now() - interval '14 days'
      AND e.league_id IN (
        SELECT id FROM leagues WHERE name = 'Unknown' OR name LIKE 'Unknown (%)'
      );

  -- Level 3: events (active 7d, exclude 22bet placeholders, exclude ended)
  SELECT count(*) INTO v_total_events_active
    FROM events
    WHERE status IN ('prematch', 'live')
      AND home_team NOT IN ('Home', 'Home (Special bets)')
      AND home_team NOT LIKE '% +'
      AND starts_at > now() - interval '7 days';

  SELECT count(*) INTO v_fs_mapped
    FROM events
    WHERE status IN ('prematch', 'live')
      AND home_team NOT IN ('Home', 'Home (Special bets)')
      AND home_team NOT LIKE '% +'
      AND starts_at > now() - interval '7 days'
      AND flashscore_id IS NOT NULL;

  -- Sprint 3 Phase B (mig 129): source_only events on the same 7d window.
  -- Same denominator filter as v_total_events_active so subtraction is clean.
  SELECT count(*) INTO v_source_only_flagged
    FROM events
    WHERE status IN ('prematch', 'live')
      AND home_team NOT IN ('Home', 'Home (Special bets)')
      AND home_team NOT LIKE '% +'
      AND starts_at > now() - interval '7 days'
      AND is_source_only = true;

  v_mappable_total := GREATEST(v_total_events_active - v_source_only_flagged, 0);

  SELECT count(*) INTO v_verified
    FROM event_normalization en
    JOIN events e ON e.id = en.event_id
    WHERE e.status IN ('prematch', 'live')
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
      AND e.starts_at > now() - interval '7 days'
      AND en.verified = true;

  SELECT
    count(*) FILTER (WHERE en.verified_by IS NULL AND en.match_stage <> 'llm') AS auto_count,
    count(*) FILTER (WHERE en.verified_by IS NOT NULL) AS manual_count,
    count(*) FILTER (WHERE en.verified_by IS NULL AND en.match_stage = 'llm') AS llm_auto_count
  INTO v_auto, v_manual, v_llm_auto
  FROM event_normalization en
  JOIN events e ON e.id = en.event_id
  WHERE e.status IN ('prematch', 'live')
    AND e.home_team NOT IN ('Home', 'Home (Special bets)')
    AND e.home_team NOT LIKE '% +'
    AND e.starts_at > now() - interval '7 days'
    AND en.verified = true;

  SELECT
    count(*) FILTER (WHERE external_id LIKE 'kambi:%'),
    count(*) FILTER (WHERE external_id LIKE 'kambi:%' AND flashscore_id IS NOT NULL),
    count(*) FILTER (WHERE external_id LIKE '22bet:%'),
    count(*) FILTER (WHERE external_id LIKE '22bet:%' AND flashscore_id IS NOT NULL),
    count(*) FILTER (WHERE external_id LIKE 'betfair:%'),
    count(*) FILTER (WHERE external_id LIKE 'betfair:%' AND flashscore_id IS NOT NULL)
  INTO v_kambi_total, v_kambi_mapped, v_22bet_total, v_22bet_mapped, v_betfair_total, v_betfair_mapped
  FROM events
  WHERE status IN ('prematch', 'live')
    AND home_team NOT IN ('Home', 'Home (Special bets)')
    AND home_team NOT LIKE '% +'
    AND starts_at > now() - interval '7 days';

  -- Level 4: markets (volume-weighted)
  SELECT
    COALESCE(SUM(mv.market_count), 0)::int,
    COALESCE(SUM(mv.market_count) FILTER (WHERE mn.canonical_key IS NOT NULL), 0)::int
  INTO v_total_markets, v_canonical_markets
  FROM mv_source_market_types mv
  LEFT JOIN market_normalization mn
    ON mn.source = mv.source
   AND mn.source_market_type = mv.market_type;

  -- Level 5: outcomes
  SELECT
    COALESCE(total_outcomes, 0)::int,
    COALESCE(canonical_outcomes, 0)::int
  INTO v_total_outcomes, v_canonical_outcomes
  FROM mv_outcomes_canon_coverage
  LIMIT 1;

  v_result := jsonb_build_object(
    'generated_at', now(),
    'level_1_sports', jsonb_build_object(
      'total', v_total_sports,
      'canonical', v_total_sports,
      'pct', 100.0,
      'color', 'green'
    ),
    'level_2_leagues', jsonb_build_object(
      'total', v_total_leagues,
      'identified', v_total_leagues - v_unknown_leagues,
      'unknown', v_unknown_leagues,
      'pct', CASE WHEN v_total_leagues > 0
        THEN round(((v_total_leagues - v_unknown_leagues)::numeric / v_total_leagues) * 100, 1)
        ELSE 0 END,
      'color', CASE
        WHEN v_total_leagues = 0 THEN 'gray'
        WHEN ((v_total_leagues - v_unknown_leagues)::numeric / v_total_leagues) >= 0.9 THEN 'green'
        WHEN ((v_total_leagues - v_unknown_leagues)::numeric / v_total_leagues) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END,
      'per_source', jsonb_build_object(
        'kambi', jsonb_build_object('unknown', 0),
        '22bet', jsonb_build_object('unknown', v_22bet_unknown),
        'betfair', jsonb_build_object('unknown', v_betfair_unknown)
      )
    ),
    'level_3_events', jsonb_build_object(
      'total_active_7d', v_total_events_active,
      'flashscore_mapped', v_fs_mapped,
      'flashscore_pct', CASE WHEN v_total_events_active > 0
        THEN round((v_fs_mapped::numeric / v_total_events_active) * 100, 1)
        ELSE 0 END,
      'verified', v_verified,
      'verified_pct', CASE WHEN v_fs_mapped > 0
        THEN round((v_verified::numeric / v_fs_mapped) * 100, 1)
        ELSE 0 END,
      'per_stage', jsonb_build_object(
        'auto', v_auto,
        'manual', v_manual,
        'llm_auto', v_llm_auto
      ),
      'cross_source_canonical', 0,
      'cross_source_pct', 0.0,
      'source_only_flagged', v_source_only_flagged,
      'mappable_total', v_mappable_total,
      'coverage_among_mappable_pct', CASE WHEN v_mappable_total > 0
        THEN round((v_fs_mapped::numeric / v_mappable_total) * 100, 1)
        ELSE 0 END,
      'color', CASE
        WHEN v_mappable_total = 0 THEN 'gray'
        WHEN (v_fs_mapped::numeric / v_mappable_total) >= 0.9 THEN 'green'
        WHEN (v_fs_mapped::numeric / v_mappable_total) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END,
      'per_source', jsonb_build_object(
        'kambi', jsonb_build_object(
          'total', v_kambi_total, 'mapped', v_kambi_mapped,
          'pct', CASE WHEN v_kambi_total > 0 THEN round((v_kambi_mapped::numeric / v_kambi_total) * 100, 1) ELSE 0 END
        ),
        '22bet', jsonb_build_object(
          'total', v_22bet_total, 'mapped', v_22bet_mapped,
          'pct', CASE WHEN v_22bet_total > 0 THEN round((v_22bet_mapped::numeric / v_22bet_total) * 100, 1) ELSE 0 END
        ),
        'betfair', jsonb_build_object(
          'total', v_betfair_total, 'mapped', v_betfair_mapped,
          'pct', CASE WHEN v_betfair_total > 0 THEN round((v_betfair_mapped::numeric / v_betfair_total) * 100, 1) ELSE 0 END
        )
      )
    ),
    'level_4_markets', jsonb_build_object(
      'total', v_total_markets,
      'canonical', v_canonical_markets,
      'pct', CASE WHEN v_total_markets > 0
        THEN round((v_canonical_markets::numeric / v_total_markets) * 100, 1)
        ELSE 0 END,
      'color', CASE
        WHEN v_total_markets = 0 THEN 'gray'
        WHEN (v_canonical_markets::numeric / v_total_markets) >= 0.9 THEN 'green'
        WHEN (v_canonical_markets::numeric / v_total_markets) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END
    ),
    'level_5_outcomes', jsonb_build_object(
      'total_distinct', v_total_outcomes,
      'canonical_seed', v_canonical_outcomes,
      'window', '12h_forward_active',
      'pct', CASE WHEN v_total_outcomes > 0
        THEN round((v_canonical_outcomes::numeric / v_total_outcomes) * 100, 1)
        ELSE 0 END,
      'color', CASE
        WHEN v_total_outcomes = 0 THEN 'gray'
        WHEN (v_canonical_outcomes::numeric / v_total_outcomes) >= 0.9 THEN 'green'
        WHEN (v_canonical_outcomes::numeric / v_total_outcomes) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END
    )
  );

  RETURN v_result;
END;
$fn$;

GRANT EXECUTE ON FUNCTION canonicalization_overview() TO authenticated;
