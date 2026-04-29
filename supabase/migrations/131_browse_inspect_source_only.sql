-- Migration 131: surface events.is_source_only in browse + inspect RPCs.
--
-- Sprint 3 Phase B finalisation. Mig 128 emitted JSON `is_source_only: NULL`
-- (placeholder) and `field_signals.is_source_only: 'feature_pending'`. Now
-- that mig 129 populated the column, this migration:
--   - Selects events.is_source_only into the SELECT clause.
--   - Emits the actual boolean in the per-event JSON.
--   - Rewrites field_signals.is_source_only:
--       true  → 'variant'        (structural, not in FS by design)
--       false → 'absent_ok'      (mappable, just not yet mapped)
--
-- Two functions are CREATE OR REPLACE'd, copied verbatim from mig 128 except
-- for the three modifications above:
--   - canonicalization_browse_groups
--   - inspect_event
--
-- The trigram fallback CTE (alias-aware, mig 128) and the cross-source/
-- canonical_id grouping ('cs:' branch from mig 127) are preserved verbatim.
--
-- Idempotent: CREATE OR REPLACE.
-- Rollback: re-apply mig 128 (drops is_source_only surfacing; fields revert
--   to NULL / 'feature_pending').

SET statement_timeout = '5min';
SET lock_timeout = '2min';

-- ═══════════════════════════════════════════════════════════════════
-- canonicalization_browse_groups — surface is_source_only
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION canonicalization_browse_groups(
  p_sport_id uuid,
  p_league_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100
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
      e.canonical_id,
      e.is_source_only,
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
    LIMIT 200
  ),
  markets_agg AS (
    SELECT m.event_id, count(*) AS markets_count
    FROM markets m
    WHERE m.event_id IN (SELECT id FROM filtered)
      AND m.is_active
    GROUP BY m.event_id
  ),
  outcomes_agg AS (
    SELECT m.event_id, count(o.id) AS outcomes_count
    FROM outcomes o
    JOIN markets m ON m.id = o.market_id AND m.is_active
    WHERE m.event_id IN (SELECT id FROM filtered)
      AND o.is_active
    GROUP BY m.event_id
  ),
  enriched AS (
    SELECT
      f.*,
      COALESCE(ma.markets_count, 0) AS markets_count,
      COALESCE(oa.outcomes_count, 0) AS outcomes_count
    FROM filtered f
    LEFT JOIN markets_agg ma ON ma.event_id = f.id
    LEFT JOIN outcomes_agg oa ON oa.event_id = f.id
  ),
  fs_null_events AS (
    SELECT * FROM enriched
    WHERE flashscore_id IS NULL AND canonical_id IS NULL
  ),
  pairs AS (
    SELECT a.id AS a_id, b.id AS b_id
    FROM fs_null_events a, fs_null_events b
    WHERE a.id < b.id
      AND a.sport_id = b.sport_id
      AND abs(extract(epoch FROM (a.starts_at - b.starts_at))) <= 3600
      AND similarity(
            resolve_team_alias(normalize_team_name(a.home_team)),
            resolve_team_alias(normalize_team_name(b.home_team))
          ) >= 0.85
      AND similarity(
            resolve_team_alias(normalize_team_name(a.away_team)),
            resolve_team_alias(normalize_team_name(b.away_team))
          ) >= 0.85
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
        WHEN en.canonical_id  IS NOT NULL THEN 'cs:' || en.canonical_id::text
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
        WHEN group_key LIKE 'cs:%'      THEN 'cross_source'
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
          'canonical_id', canonical_id,
          'is_source_only', is_source_only,
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
            'canonical_id', CASE
              WHEN canonical_id IS NOT NULL THEN 'ok_synthetic'
              WHEN flashscore_id IS NOT NULL THEN 'absent_ok'
              ELSE 'absent_problem' END,
            'is_source_only', CASE
              WHEN is_source_only = true THEN 'variant'
              ELSE 'absent_ok' END
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
-- inspect_event — surface is_source_only
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION inspect_event(
  p_query text,
  p_limit int DEFAULT 20
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
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

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
      e.canonical_id,
      e.is_source_only,
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
  markets_agg AS (
    SELECT m.event_id, count(*) AS markets_count
    FROM markets m
    WHERE m.event_id IN (SELECT id FROM filtered)
      AND m.is_active
    GROUP BY m.event_id
  ),
  outcomes_agg AS (
    SELECT m.event_id, count(o.id) AS outcomes_count
    FROM outcomes o
    JOIN markets m ON m.id = o.market_id AND m.is_active
    WHERE m.event_id IN (SELECT id FROM filtered)
      AND o.is_active
    GROUP BY m.event_id
  ),
  enriched AS (
    SELECT
      f.*,
      COALESCE(ma.markets_count, 0) AS markets_count,
      COALESCE(oa.outcomes_count, 0) AS outcomes_count
    FROM filtered f
    LEFT JOIN markets_agg ma ON ma.event_id = f.id
    LEFT JOIN outcomes_agg oa ON oa.event_id = f.id
  ),
  pairs AS (
    SELECT a.id AS a_id, b.id AS b_id
    FROM enriched a, enriched b
    WHERE a.id < b.id
      AND a.sport_id = b.sport_id
      AND a.flashscore_id IS NULL AND a.canonical_id IS NULL
      AND b.flashscore_id IS NULL AND b.canonical_id IS NULL
      AND abs(extract(epoch FROM (a.starts_at - b.starts_at))) <= 3600
      AND similarity(
            resolve_team_alias(normalize_team_name(a.home_team)),
            resolve_team_alias(normalize_team_name(b.home_team))
          ) >= 0.85
      AND similarity(
            resolve_team_alias(normalize_team_name(a.away_team)),
            resolve_team_alias(normalize_team_name(b.away_team))
          ) >= 0.85
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
        WHEN en.canonical_id  IS NOT NULL THEN 'cs:' || en.canonical_id::text
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
        WHEN group_key LIKE 'cs:%'      THEN 'cross_source'
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
          'canonical_id', canonical_id,
          'is_source_only', is_source_only,
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
            'canonical_id', CASE
              WHEN canonical_id IS NOT NULL THEN 'ok_synthetic'
              WHEN flashscore_id IS NOT NULL THEN 'absent_ok'
              ELSE 'absent_problem' END,
            'is_source_only', CASE
              WHEN is_source_only = true THEN 'variant'
              ELSE 'absent_ok' END
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
