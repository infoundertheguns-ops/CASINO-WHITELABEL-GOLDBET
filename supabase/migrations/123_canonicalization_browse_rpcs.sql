-- Migration 123: Canonicalization browse RPCs (Esplora tree + CSV export).
--
-- Replaces the search-only Inspector with a hierarchical browse tree:
--   1. canonicalization_browse_sports()                          → list of sports with non-ended event counts
--   2. canonicalization_browse_leagues(p_sport_id)               → leagues under a sport with event counts
--   3. canonicalization_browse_groups(p_sport_id, p_league_id,   → grouped events (reuses mig 122 cluster CTE)
--                                    p_search, p_limit)
--   4. canonicalization_export_groups()                          → flat array, one row per group, for CSV export
--
-- Filter convention (UAT 2026-04-27): include all events EXCEPT status='ended'.
-- Cancelled / suspended remain visible (operator may refine later).
-- Always exclude 22bet placeholder synthetics (Home / Home (Special bets) / "% +").
--
-- Rollback:
--   DROP FUNCTION canonicalization_browse_sports();
--   DROP FUNCTION canonicalization_browse_leagues(uuid);
--   DROP FUNCTION canonicalization_browse_groups(uuid, uuid, text, int);
--   DROP FUNCTION canonicalization_export_groups();

-- ═══════════════════════════════════════════════════════════════════
-- RPC 1: canonicalization_browse_sports()
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION canonicalization_browse_sports()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '120s'
AS $fn$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sport_id', sport_id,
      'sport_name', sport_name,
      'event_count', event_count
    )
    ORDER BY event_count DESC, sport_name
  ), '[]'::jsonb)
  FROM (
    SELECT
      s.id AS sport_id,
      s.name AS sport_name,
      count(*) AS event_count
    FROM sports s
    JOIN events e ON e.sport_id = s.id
    WHERE e.status <> 'ended'
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
    GROUP BY s.id, s.name
    HAVING count(*) > 0
  ) t;
$fn$;

GRANT EXECUTE ON FUNCTION canonicalization_browse_sports() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- RPC 2: canonicalization_browse_leagues(p_sport_id)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION canonicalization_browse_leagues(p_sport_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '120s'
AS $fn$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'league_id', league_id,
      'league_name', league_name,
      'country', country,
      'country_code', country_code,
      'tour_code', tour_code,
      'event_count', event_count
    )
    ORDER BY event_count DESC, league_name
  ), '[]'::jsonb)
  FROM (
    SELECT
      l.id AS league_id,
      l.name AS league_name,
      l.country AS country,
      l.country_code AS country_code,
      l.tour_code AS tour_code,
      count(*) AS event_count
    FROM leagues l
    JOIN events e ON e.league_id = l.id
    WHERE e.sport_id = p_sport_id
      AND e.status <> 'ended'
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
    GROUP BY l.id, l.name, l.country, l.country_code, l.tour_code
    HAVING count(*) > 0
  ) t;
$fn$;

GRANT EXECUTE ON FUNCTION canonicalization_browse_leagues(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- RPC 3: canonicalization_browse_groups(p_sport_id, p_league_id, p_search, p_limit)
--
-- Reuses the trigram-cluster CTE chain from mig 122's inspect_event() verbatim,
-- only the `filtered` CTE WHERE clause changes. Returns the same EventGroup[]
-- shape so the existing <EventGroup>/<SourceCard> components render unchanged.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION canonicalization_browse_groups(
  p_sport_id uuid,
  p_league_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '120s'
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
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
      e.sport_id = p_sport_id
      AND (p_league_id IS NULL OR e.league_id = p_league_id)
      AND e.status <> 'ended'
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
      AND (
        p_search IS NULL OR length(trim(p_search)) < 2
        OR e.home_team ILIKE '%' || p_search || '%'
        OR e.away_team ILIKE '%' || p_search || '%'
        OR e.external_id = p_search
        OR e.flashscore_id = p_search
      )
    ORDER BY e.starts_at DESC
    LIMIT 500
  ),
  enriched AS (
    SELECT
      f.*,
      (SELECT count(*) FROM markets m WHERE m.event_id = f.id AND m.is_active) AS markets_count,
      (SELECT count(*) FROM outcomes o JOIN markets m2 ON m2.id = o.market_id
        WHERE m2.event_id = f.id AND o.is_active) AS outcomes_count
    FROM filtered f
  ),
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
      CASE
        WHEN group_key LIKE 'fs:%'      THEN 'flashscore'
        WHEN group_key LIKE 'trigram:%' THEN 'trigram'
        ELSE 'isolated'
      END AS group_type,
      MIN(starts_at) AS group_starts_at,
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
          'canonical_id', NULL,
          'is_source_only', NULL,
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

GRANT EXECUTE ON FUNCTION canonicalization_browse_groups(uuid, uuid, text, int) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- RPC 4: canonicalization_export_groups()
--
-- Returns one row per group across the entire (non-ended) dataset.
-- Output is a flat JSONB array — the API route serializes to CSV.
-- Cap at 50k rows for safety.
--
-- IMPORTANT performance note: a global O(n²) trigram self-join across
-- the whole non-ended set (~10-15k events on staging, more on prod)
-- exceeds even a 5-min timeout. So global export uses a SIMPLER grouping
-- strategy: group only by flashscore_id (the canonical link). Events
-- without flashscore_id become 1-source 'isolated' rows. The Esplora
-- tree still uses the full trigram cluster scoped per league (cheap),
-- so cross-source via heuristic remains inspectable interactively;
-- only the bulk CSV trades that off for global tractability.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION canonicalization_export_groups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '300s'
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  -- Strategy: pre-aggregate market/outcome counts in two single-pass GROUP BY
  -- on markets and (markets+outcomes) over the relevant event_id set, then
  -- LEFT JOIN those into the per-event row. Avoids 6× correlated subqueries
  -- × 50k groups (was 300k inner scans). Single GROUP BY uses idx_markets_event.
  WITH filtered AS (
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
    WHERE e.status <> 'ended'
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
  ),
  -- Pre-aggregate markets per event in one pass (uses idx_markets_event_id).
  -- NOTE: outcome counts are intentionally excluded from the CSV export. The
  -- outcomes table is ~5-10M rows on prod and a per-event outcome count
  -- aggregate exceeds the 5-minute statement timeout even with filtering.
  -- The Esplora groups RPC (limited to LIMIT 200 per league) does include
  -- outcome counts via correlated subqueries; the bulk CSV substitutes 0
  -- for outcomes so the file remains downloadable in <30s.
  market_counts AS (
    SELECT m.event_id, count(*)::int AS markets_count
    FROM markets m
    WHERE m.is_active
      AND m.event_id IN (SELECT id FROM filtered)
    GROUP BY m.event_id
  ),
  enriched AS (
    SELECT
      f.*,
      COALESCE(mc.markets_count, 0) AS markets_count,
      0                              AS outcomes_count
    FROM filtered f
    LEFT JOIN market_counts mc ON mc.event_id = f.id
  ),
  grouping AS (
    SELECT en.*,
      CASE
        WHEN en.flashscore_id IS NOT NULL THEN 'fs:' || en.flashscore_id
        ELSE 'iso:' || en.id::text
      END AS group_key
    FROM enriched en
  ),
  agg AS (
    SELECT
      group_key,
      CASE
        WHEN group_key LIKE 'fs:%' THEN 'flashscore'
        ELSE 'isolated'
      END AS group_type,
      MIN(starts_at) AS group_starts_at,
      (array_agg(home_team || ' vs ' || away_team ORDER BY src_kind, external_id))[1] AS group_label,
      (array_agg(sport_name ORDER BY src_kind, external_id))[1] AS group_sport,
      (array_agg(league_name ORDER BY src_kind, external_id))[1] AS group_league,
      (array_agg(league_country ORDER BY src_kind, external_id))[1] AS group_country,
      (array_agg(league_country_code ORDER BY src_kind, external_id))[1] AS group_country_code,
      (array_agg(league_tour_code ORDER BY src_kind, external_id))[1] AS group_tour_code,
      (array_agg(flashscore_id ORDER BY src_kind, external_id))[1] AS group_flashscore_id,
      (array_agg(verified ORDER BY src_kind, external_id))[1] AS group_verified,
      (array_agg(match_stage ORDER BY src_kind, external_id))[1] AS group_match_stage,
      (array_agg(confidence ORDER BY src_kind, external_id))[1] AS group_confidence,
      (array_agg(llm_verify ORDER BY src_kind, external_id))[1] AS group_llm_verify,
      (array_agg(verified_by ORDER BY src_kind, external_id))[1] AS group_verified_by,
      -- per-source columns picked via FILTER (WHERE src_kind = ...). NULL means absent for that source.
      (array_agg(external_id    ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'kambi'))[1]   AS kambi_external_id,
      (array_agg(status         ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'kambi'))[1]   AS kambi_status,
      (array_agg(markets_count  ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'kambi'))[1]   AS kambi_markets,
      (array_agg(outcomes_count ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'kambi'))[1]   AS kambi_outcomes,
      (array_agg(external_id    ORDER BY src_kind, external_id) FILTER (WHERE src_kind = '22bet'))[1]   AS twobet_external_id,
      (array_agg(status         ORDER BY src_kind, external_id) FILTER (WHERE src_kind = '22bet'))[1]   AS twobet_status,
      (array_agg(markets_count  ORDER BY src_kind, external_id) FILTER (WHERE src_kind = '22bet'))[1]   AS twobet_markets,
      (array_agg(outcomes_count ORDER BY src_kind, external_id) FILTER (WHERE src_kind = '22bet'))[1]   AS twobet_outcomes,
      (array_agg(external_id    ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'betfair'))[1] AS betfair_external_id,
      (array_agg(status         ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'betfair'))[1] AS betfair_status,
      (array_agg(markets_count  ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'betfair'))[1] AS betfair_markets,
      (array_agg(outcomes_count ORDER BY src_kind, external_id) FILTER (WHERE src_kind = 'betfair'))[1] AS betfair_outcomes
    FROM grouping
    GROUP BY group_key
    ORDER BY group_sport, group_league, MIN(starts_at)
    LIMIT 50000
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'group_type', group_type,
      'real_world_label', group_label || ' · ' || to_char(group_starts_at, 'YYYY-MM-DD HH24:MI') || ' · ' || group_sport,
      'sport', group_sport,
      'league', group_league,
      'country', group_country,
      'country_code', group_country_code,
      'tour_code', group_tour_code,
      'starts_at', group_starts_at,
      'flashscore_id', group_flashscore_id,
      'verified', group_verified,
      'match_stage', group_match_stage,
      'confidence', group_confidence,
      'llm_verify', group_llm_verify,
      'verified_by', group_verified_by,
      'kambi_external_id', kambi_external_id,
      'kambi_status', kambi_status,
      'kambi_markets', COALESCE(kambi_markets, 0),
      'kambi_outcomes', COALESCE(kambi_outcomes, 0),
      '22bet_external_id', twobet_external_id,
      '22bet_status', twobet_status,
      '22bet_markets', COALESCE(twobet_markets, 0),
      '22bet_outcomes', COALESCE(twobet_outcomes, 0),
      'betfair_external_id', betfair_external_id,
      'betfair_status', betfair_status,
      'betfair_markets', COALESCE(betfair_markets, 0),
      'betfair_outcomes', COALESCE(betfair_outcomes, 0)
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM agg;

  RETURN v_result;
END;
$fn$;

GRANT EXECUTE ON FUNCTION canonicalization_export_groups() TO authenticated;
