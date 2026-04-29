-- Migration 122: Canonicalization observability RPCs (read-only).
--
-- Two functions for /admin/canonicalization page:
--   1. canonicalization_overview() → single JSONB with 5-level KPI snapshot.
--   2. inspect_event(p_query, p_limit) → array JSONB grouped events (1-3 source cards per group).
--
-- Plus one small MV for the L5 outcomes coverage KPI (refreshed by cron).
-- Rollback: DROP FUNCTION canonicalization_overview(); DROP FUNCTION inspect_event(text, int);
--          DROP MATERIALIZED VIEW mv_outcomes_canon_coverage; DROP FUNCTION refresh_mv_outcomes_canon_coverage();

-- ═══════════════════════════════════════════════════════════════════
-- MV: mv_outcomes_canon_coverage
-- Single-row aggregate of outcome canonicalization coverage on a 12h
-- forward window (now-2h … now+12h). Live joins outcomes×markets×events
-- are 50s-120s on staging under load and unsuitable for a synchronous KPI.
-- The MV is refreshed by the same 10min cron that already drives
-- mv_source_market_types (mig 046).
-- ═══════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS mv_outcomes_canon_coverage;

CREATE MATERIALIZED VIEW mv_outcomes_canon_coverage AS
SELECT
  count(*)                                                          AS total_outcomes,
  count(*) FILTER (WHERE onz.canonical_outcome_key IS NOT NULL)     AS canonical_outcomes,
  now()                                                             AS computed_at
FROM (
  SELECT id, source FROM events
  WHERE source IN ('kambi', '22bet', 'betfair')
    AND status IN ('prematch', 'live')
    AND starts_at BETWEEN now() - interval '2 hours' AND now() + interval '12 hours'
) ev
JOIN markets m ON m.event_id = ev.id AND m.is_active = true
JOIN outcomes o ON o.market_id = m.id AND o.is_active = true
LEFT JOIN outcome_normalization onz
  ON onz.source = ev.source
 AND onz.source_market_type = m.market_type
 AND onz.source_outcome_name = o.name;

-- Single-row MV; the unique index over a constant lets us use REFRESH CONCURRENTLY.
CREATE UNIQUE INDEX idx_mv_oc_coverage_pk ON mv_outcomes_canon_coverage ((1));

GRANT SELECT ON mv_outcomes_canon_coverage TO authenticated, service_role;

CREATE OR REPLACE FUNCTION refresh_mv_outcomes_canon_coverage()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '300s'
AS $fn$
DECLARE
  v_total bigint;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_outcomes_canon_coverage;
  SELECT total_outcomes INTO v_total FROM mv_outcomes_canon_coverage LIMIT 1;
  RETURN v_total;
END;
$fn$;

GRANT EXECUTE ON FUNCTION refresh_mv_outcomes_canon_coverage() TO authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════
-- RPC 1: canonicalization_overview()
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION canonicalization_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
BEGIN
  -- Level 1: sports
  SELECT count(*) INTO v_total_sports FROM sports WHERE is_active;

  -- Level 2: leagues — Unknown sentinel = name='Unknown' OR name LIKE 'Unknown (%)'
  SELECT count(*) INTO v_total_leagues FROM leagues;
  SELECT count(*) INTO v_unknown_leagues
    FROM leagues
    WHERE name = 'Unknown' OR name LIKE 'Unknown (%)';

  -- Per-source unknown leagues — count Unknown leagues that have ANY active-14d events from each source.
  -- 14d window matches the original plan and gives enough cushion to capture mid-week leagues
  -- that scrape only on weekends. Uses idx_events_starts + idx_events_league.
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

  -- Level 3: events (active 7d, exclude 22bet placeholders, exclude ended) — same filter as event_normalization_coverage_pct
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

  SELECT count(*) INTO v_verified
    FROM event_normalization en
    JOIN events e ON e.id = en.event_id
    WHERE e.status IN ('prematch', 'live')
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
      AND e.starts_at > now() - interval '7 days'
      AND en.verified = true;

  -- per-stage breakdown (auto vs manual vs llm_auto)
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

  -- per-source: total active + flashscore-mapped
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

  -- Level 4: markets — VOLUME-weighted coverage across active source markets.
  -- The previous version counted market_normalization rows on both numerator and
  -- denominator → trivially 100% (the row only exists once a mapping is created).
  -- Real coverage = SUM(market_count of source_market_types that are mapped) /
  -- SUM(market_count of all source_market_types). This is what /admin/market-normalization
  -- exposes via list_markets_normalization_paged.kpis.coverage_pct (mig 055).
  -- mv_source_market_types is refreshed every 10min (mig 046) and includes betfair (mig 094).
  SELECT
    COALESCE(SUM(mv.market_count), 0)::int,
    COALESCE(SUM(mv.market_count) FILTER (WHERE mn.canonical_key IS NOT NULL), 0)::int
  INTO v_total_markets, v_canonical_markets
  FROM mv_source_market_types mv
  LEFT JOIN market_normalization mn
    ON mn.source = mv.source
   AND mn.source_market_type = mv.market_type;

  -- Level 5: outcomes — row-level coverage on a 12h forward active window.
  -- Read from mv_outcomes_canon_coverage (defined above, refreshed by cron).
  -- The previous synchronous version of this query (50s-120s under load) made
  -- the whole RPC unstable; the MV makes it O(1).
  SELECT
    COALESCE(total_outcomes, 0)::int,
    COALESCE(canonical_outcomes, 0)::int
  INTO v_total_outcomes, v_canonical_outcomes
  FROM mv_outcomes_canon_coverage
  LIMIT 1;

  -- Build result JSONB
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
      'source_only_flagged', 0,
      'color', CASE
        WHEN v_total_events_active = 0 THEN 'gray'
        WHEN (v_fs_mapped::numeric / v_total_events_active) >= 0.9 THEN 'green'
        WHEN (v_fs_mapped::numeric / v_total_events_active) >= 0.6 THEN 'yellow'
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

-- ═══════════════════════════════════════════════════════════════════
-- RPC 2: inspect_event(p_query text, p_limit int default 20)
-- ═══════════════════════════════════════════════════════════════════
--
-- Search events by team name / external_id / flashscore_id, group with cascading rules:
--   1. Same flashscore_id → group_type='flashscore'
--   2. Same sport + trigram(home_norm) ≥ 0.85 + trigram(away_norm) ≥ 0.85 + |starts_at delta| ≤ 60min → group_type='trigram'
--   3. Else isolated → group_type='isolated'
--
-- Returns array of groups with 1-3 events each (Kambi, 22bet, Betfair max).

CREATE OR REPLACE FUNCTION inspect_event(
  p_query text,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- CTE chain: filter → join → cluster → group
  -- NOTE: explicit column selection (not e.*) to avoid clash with events.source column
  -- which was added in mig 010/018/036/089. We expose the URL-prefix-derived source as `src_kind`.
  WITH RECURSIVE filtered AS (
    SELECT
      e.id,
      e.external_id,
      e.sport_id,
      e.league_id,
      e.home_team,
      e.away_team,
      e.starts_at,
      e.status,
      e.flashscore_id,
      l.name AS league_name,
      l.country AS league_country,
      l.country_code AS league_country_code,
      l.tour_code AS league_tour_code,
      s.name AS sport_name,
      en.match_stage,
      en.confidence,
      en.verified,
      en.verified_by,
      en.llm_verify,
      CASE
        WHEN e.external_id LIKE 'kambi:%'   THEN 'kambi'
        WHEN e.external_id LIKE '22bet:%'   THEN '22bet'
        WHEN e.external_id LIKE 'betfair:%' THEN 'betfair'
        ELSE 'unknown'
      END AS src_kind
    FROM events e
    LEFT JOIN leagues l ON l.id = e.league_id
    LEFT JOIN sports s ON s.id = e.sport_id
    LEFT JOIN event_normalization en ON en.event_id = e.id
    WHERE
      e.home_team ILIKE '%' || p_query || '%'
      OR e.away_team ILIKE '%' || p_query || '%'
      OR e.external_id = p_query
      OR e.flashscore_id = p_query
    ORDER BY e.starts_at DESC
    LIMIT 50
  ),
  -- Compute market/outcome counts per event
  enriched AS (
    SELECT
      f.*,
      (SELECT count(*) FROM markets m WHERE m.event_id = f.id AND m.is_active) AS markets_count,
      (SELECT count(*) FROM outcomes o JOIN markets m2 ON m2.id = o.market_id
        WHERE m2.event_id = f.id AND o.is_active) AS outcomes_count
    FROM filtered f
  ),
  -- Trigram cluster: find pairs with score ≥ 0.85 in same sport ±60min
  pairs AS (
    SELECT a.id AS a_id, b.id AS b_id
    FROM enriched a, enriched b
    WHERE a.id < b.id
      AND a.sport_id = b.sport_id
      AND a.flashscore_id IS NULL
      AND b.flashscore_id IS NULL
      AND abs(extract(epoch FROM (a.starts_at - b.starts_at))) <= 3600
      AND similarity(normalize_team_name(a.home_team), normalize_team_name(b.home_team)) >= 0.85
      AND similarity(normalize_team_name(a.away_team), normalize_team_name(b.away_team)) >= 0.85
  ),
  -- Connected components via recursive CTE on undirected pair graph.
  -- For each event, compute MIN(id) reachable through pairs → that's the cluster_id.
  -- Handles transitive merges (A-B + B-C → all 3 in one cluster).
  pairs_undir AS (
    SELECT a_id AS x, b_id AS y FROM pairs
    UNION ALL
    SELECT b_id, a_id FROM pairs
  ),
  reachable(start_id, reach_id) AS (
    SELECT id, id FROM enriched
    UNION
    SELECT r.start_id, p.y
    FROM reachable r
    JOIN pairs_undir p ON p.x = r.reach_id
  ),
  cluster_min AS (
    -- UUID type has no MIN aggregate; use array_agg ORDER BY to pick deterministic representative.
    SELECT start_id AS id,
           (array_agg(reach_id ORDER BY reach_id))[1] AS cluster_id
    FROM reachable
    GROUP BY start_id
  ),
  grouping AS (
    SELECT en.*,
      CASE
        WHEN en.flashscore_id IS NOT NULL THEN 'fs:' || en.flashscore_id
        WHEN EXISTS (SELECT 1 FROM pairs p WHERE p.a_id = en.id OR p.b_id = en.id)
          THEN 'trigram:' || cm.cluster_id::text
        ELSE 'iso:' || en.id::text
      END AS group_key
    FROM enriched en
    JOIN cluster_min cm ON cm.id = en.id
  ),
  agg AS (
    SELECT
      group_key,
      -- Derive group_type deterministically from group_key prefix (stable across rows)
      CASE
        WHEN group_key LIKE 'fs:%'      THEN 'flashscore'
        WHEN group_key LIKE 'trigram:%' THEN 'trigram'
        ELSE 'isolated'
      END AS group_type,
      MIN(starts_at) AS group_starts_at,
      -- Stable label: pick first by sort order (src_kind then external_id) instead of MAX (non-deterministic)
      (array_agg(home_team || ' vs ' || away_team ORDER BY src_kind, external_id))[1] AS group_label,
      (array_agg(sport_name ORDER BY src_kind, external_id))[1] AS group_sport,
      jsonb_agg(
        jsonb_build_object(
          'source', src_kind,
          'external_id', external_id,
          'home_team', home_team,
          'away_team', away_team,
          'sport', sport_name,
          'league_name', league_name,
          'league_id', league_id,
          'country', league_country,
          'country_code', league_country_code,
          'tour_code', league_tour_code,
          'starts_at', starts_at,
          'status', status,
          'flashscore_id', flashscore_id,
          'match_stage', match_stage,
          'confidence', confidence,
          'verified', verified,
          'verified_by', verified_by,
          'llm_verify', llm_verify,
          'canonical_id', NULL,            -- Task #2 placeholder
          'is_source_only', NULL,           -- Task #2 placeholder
          'markets_count', markets_count,
          'outcomes_count', outcomes_count,
          'field_signals', jsonb_build_object(
            'league_name', CASE
              WHEN league_name IS NULL THEN 'absent_problem'
              WHEN league_name = 'Unknown' OR league_name LIKE 'Unknown (%)' THEN 'variant'
              ELSE 'ok' END,
            'country',  CASE WHEN league_country IS NULL THEN 'absent_ok' ELSE 'ok' END,
            'tour_code', CASE WHEN league_tour_code IS NULL THEN 'absent_ok' ELSE 'ok' END,
            'flashscore_id', CASE
              WHEN flashscore_id IS NULL THEN 'absent_problem'
              WHEN verified = true THEN 'ok_verified'
              ELSE 'ok' END,
            'canonical_id',  'feature_pending',
            'is_source_only','feature_pending'
          )
        )
        ORDER BY src_kind
      ) AS events
    FROM grouping
    GROUP BY group_key
    ORDER BY MIN(starts_at) DESC
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'group_key', group_key,
      'group_type', group_type,
      'real_world_label', group_label || ' · ' || to_char(group_starts_at, 'YYYY-MM-DD HH24:MI') || ' · ' || group_sport,
      'events', events
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM agg;

  RETURN v_result;
END;
$fn$;

GRANT EXECUTE ON FUNCTION inspect_event(text, int) TO authenticated;

-- Both RPCs do multi-table scans; bump per-function timeout above the pooler default.
ALTER FUNCTION canonicalization_overview() SET statement_timeout = '120s';
ALTER FUNCTION inspect_event(text, int)    SET statement_timeout = '120s';
