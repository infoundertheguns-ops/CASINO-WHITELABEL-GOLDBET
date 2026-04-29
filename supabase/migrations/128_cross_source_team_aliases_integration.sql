-- Migration 128: integrate team_aliases (mig 121) into cross-source event
-- matching so name-variant pairs (Milan↔AC Milan, Inter↔Inter Milan↔
-- Internazionale, Bayern↔Bayern Munich, PSG↔Paris Saint-Germain, …) cluster.
--
-- Sprint 3 Phase A.2 — extension of mig 126 + 127.
--
-- New helper:
--   resolve_team_alias(p_team text) → text
--     STABLE lookup-or-passthrough. Takes a normalized team name (already
--     lowercased+unaccented per normalize_team_name from mig 118), returns
--     the canonical from team_aliases when verified=true exists, else
--     returns the input unchanged.
--
-- Rewrites:
--   * assign_event_cross_source_canonical_id (mig 126): wraps every
--     similarity(normalize_team_name(X), normalize_team_name(Y)) call with
--     resolve_team_alias() on both sides. Three trigram pair sites updated:
--     candidates CTE, propagation UPDATE WHERE, and the EXISTS-bound new
--     canonical UPDATE WHERE.
--   * canonicalization_browse_groups + inspect_event (mig 127): updates the
--     trigram fallback pairs CTE only — the canonical_id-keyed grouping
--     branch (`cs:`) does not need this since aliases are baked in upstream
--     by the assign RPC. Keeping the trigram fallback alias-aware lets the
--     Esplora page surface name-variant clusters that the assign RPC has
--     not yet been fired on (e.g. fresh ingestion not yet picked up by the
--     engine cycle).
--
-- All other RPC bodies (security flags, search_path, statement_timeout,
-- output JSON shape, idempotency) preserved verbatim.
--
-- Idempotent: CREATE OR REPLACE on all three functions.
--
-- Rollback: re-apply mig 126 + mig 127 (drops alias-awareness) and
--   DROP FUNCTION resolve_team_alias(text).
--
-- Resolver perf: single-key index lookup on team_aliases(lower(alias))
-- WHERE verified=true (mig 121 unique index covers it). Per-call cost
-- ~0.1ms. Trigram self-joins fire 4× per pair (home/away × both sides) so
-- adding aliases costs ~4× that per pair, dwarfed by similarity() itself.

SET statement_timeout = '5min';
SET lock_timeout = '2min';

-- ═══════════════════════════════════════════════════════════════════
-- 1a. resolve_team_alias helper
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION resolve_team_alias(p_team text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT COALESCE(
    (SELECT canonical FROM team_aliases
     WHERE verified = true
       AND lower(alias) = lower(p_team)
     LIMIT 1),
    p_team
  );
$fn$;

COMMENT ON FUNCTION resolve_team_alias(text) IS
  'Sprint 3 Phase A.2: canonical-or-passthrough name lookup against team_aliases (verified rows only). Used by assign_event_cross_source_canonical_id + canonicalization_browse_groups + inspect_event to fold Milan↔AC Milan, Inter↔Internazionale, etc. into the same trigram cluster.';

GRANT EXECUTE ON FUNCTION resolve_team_alias(text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 1b. assign_event_cross_source_canonical_id — alias-aware
-- (re-creation of mig 126 RPC; only the three similarity() pair sites
-- change. Everything else preserved verbatim.)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION assign_event_cross_source_canonical_id(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_existing uuid;
  v_match_canonical uuid;
  v_new_id uuid;
  v_size int;
  v_has_match boolean;
  v_target events%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'event_not_found', 'canonical_id', NULL);
  END IF;

  -- Idempotency: already canonical → return kept.
  v_existing := v_target.canonical_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'canonical_id', v_existing,
      'cluster_size', NULL,
      'action', 'kept'
    );
  END IF;

  -- Skip placeholders (synthetic source-only rows from 22bet "Special bets" etc).
  IF v_target.home_team IN ('Home', 'Home (Special bets)')
     OR v_target.home_team LIKE '% +' THEN
    RETURN jsonb_build_object(
      'canonical_id', NULL,
      'cluster_size', 0,
      'action', 'skipped_placeholder'
    );
  END IF;

  -- Hunt cross-source matches. Reuse normalize_team_name (mig 118) +
  -- resolve_team_alias (this migration) so name-variant pairs cluster.
  WITH candidates AS (
    SELECT e2.id, e2.canonical_id
    FROM events e2
    WHERE e2.id <> p_event_id
      AND e2.sport_id = v_target.sport_id
      AND e2.status IN ('prematch', 'live')
      AND substring(e2.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
      AND e2.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e2.home_team NOT LIKE '% +'
      AND abs(extract(epoch FROM (e2.starts_at - v_target.starts_at))) <= 1800
      AND similarity(
            resolve_team_alias(normalize_team_name(e2.home_team)),
            resolve_team_alias(normalize_team_name(v_target.home_team))
          ) >= 0.85
      AND similarity(
            resolve_team_alias(normalize_team_name(e2.away_team)),
            resolve_team_alias(normalize_team_name(v_target.away_team))
          ) >= 0.85
  )
  SELECT
    (array_agg(canonical_id) FILTER (WHERE canonical_id IS NOT NULL))[1],
    EXISTS (SELECT 1 FROM candidates)
  INTO v_match_canonical, v_has_match
  FROM candidates;

  IF v_match_canonical IS NOT NULL THEN
    -- Reuse: assign target + propagate to siblings still unassigned.
    UPDATE events SET canonical_id = v_match_canonical WHERE id = p_event_id;
    UPDATE events e SET canonical_id = v_match_canonical
      WHERE e.canonical_id IS NULL
        AND e.id IN (
          SELECT e2.id FROM events e2
          WHERE e2.id <> p_event_id
            AND e2.sport_id = v_target.sport_id
            AND e2.status IN ('prematch', 'live')
            AND substring(e2.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
            AND e2.home_team NOT IN ('Home', 'Home (Special bets)')
            AND e2.home_team NOT LIKE '% +'
            AND abs(extract(epoch FROM (e2.starts_at - v_target.starts_at))) <= 1800
            AND similarity(
                  resolve_team_alias(normalize_team_name(e2.home_team)),
                  resolve_team_alias(normalize_team_name(v_target.home_team))
                ) >= 0.85
            AND similarity(
                  resolve_team_alias(normalize_team_name(e2.away_team)),
                  resolve_team_alias(normalize_team_name(v_target.away_team))
                ) >= 0.85
        );
    SELECT count(*)::int INTO v_size FROM events WHERE canonical_id = v_match_canonical;
    RETURN jsonb_build_object(
      'canonical_id', v_match_canonical,
      'cluster_size', v_size,
      'action', 'reused'
    );
  END IF;

  IF v_has_match THEN
    -- Mint new canonical_id and assign target + all matches.
    v_new_id := gen_random_uuid();
    UPDATE events e SET canonical_id = v_new_id
      WHERE e.canonical_id IS NULL
        AND (
          e.id = p_event_id
          OR (
            e.sport_id = v_target.sport_id
            AND e.status IN ('prematch', 'live')
            AND substring(e.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
            AND e.home_team NOT IN ('Home', 'Home (Special bets)')
            AND e.home_team NOT LIKE '% +'
            AND abs(extract(epoch FROM (e.starts_at - v_target.starts_at))) <= 1800
            AND similarity(
                  resolve_team_alias(normalize_team_name(e.home_team)),
                  resolve_team_alias(normalize_team_name(v_target.home_team))
                ) >= 0.85
            AND similarity(
                  resolve_team_alias(normalize_team_name(e.away_team)),
                  resolve_team_alias(normalize_team_name(v_target.away_team))
                ) >= 0.85
          )
        );
    SELECT count(*)::int INTO v_size FROM events WHERE canonical_id = v_new_id;
    RETURN jsonb_build_object(
      'canonical_id', v_new_id,
      'cluster_size', v_size,
      'action', 'created'
    );
  END IF;

  RETURN jsonb_build_object(
    'canonical_id', NULL,
    'cluster_size', 0,
    'action', 'no_match'
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION assign_event_cross_source_canonical_id(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 1c. canonicalization_browse_groups — alias-aware trigram fallback
-- (re-creation of mig 127 RPC; only pairs CTE changes.)
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
  -- Trigram fast-path remains: only events still missing both flashscore_id AND
  -- canonical_id need on-the-fly trigram clustering. Everything with canonical_id
  -- is already explicitly grouped via the 'cs:' branch.
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
            'canonical_id', CASE
              WHEN canonical_id IS NOT NULL THEN 'ok_synthetic'
              WHEN flashscore_id IS NOT NULL THEN 'absent_ok'
              ELSE 'absent_problem' END,
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
-- 1d. inspect_event — alias-aware trigram fallback
-- (re-creation of mig 127 RPC; only pairs CTE changes.)
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
  -- Pairs only computed for events still missing both flashscore_id AND canonical_id.
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
            'canonical_id', CASE
              WHEN canonical_id IS NOT NULL THEN 'ok_synthetic'
              WHEN flashscore_id IS NOT NULL THEN 'absent_ok'
              ELSE 'absent_problem' END,
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
