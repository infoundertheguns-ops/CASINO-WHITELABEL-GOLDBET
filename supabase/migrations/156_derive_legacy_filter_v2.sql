-- supabase/migrations/156_derive_legacy_filter_v2.sql
-- Plan D Phase 1.5 retry — derive v2 with column-based filter (no inline regex).
--
-- Builds on:
--   mig 154 (helpers: classify_market_pattern, is_market_exposable, dry-run diff)
--   mig 155 (markets.category column + trigger + idx_markets_category_active partial; backfill done)
--
-- Replaces failed mig 154b cutover (regex inline per row x 119k markets caused lock cascade).
-- v2 strategy: trigger from mig 155 already classifies on insert — derive uses precomputed
-- category column for filter. Hot path is column lookup, not regex evaluation.
--
-- Changes vs original derive_legacy_from_v2():
--   1. statement_timeout 180s -> 600s (margin 2x over nominal ~3min, absorbs autovacuum/MV
--      refresh contention spikes seen 2026-04-30 night).
--   2. NEW Part 3b — post-markets-insert deactivate non-exposable (category='special',
--      category IS NULL, or stats/player without flashscore_id). Single UPDATE using
--      idx_markets_category_active partial index, scope-bounded to derive's time window.
--   3. Part 4 outcomes insert adds WHERE m_legacy.is_active = true filter (skips outcomes
--      for markets just deactivated in Part 3b; saves ~5.7% upsert work).
--
-- Predicted impact at deploy (live measurement 2026-04-30 ~02:00 UTC):
--   - 5,879 / 85,845 active markets (5.69%) -> is_active=false at first run
--   - score: 69,514 unaffected (always exposable)
--   - stats: 10,563 -> 8,769 active (1,794 no-FS deactivated)
--   - player: 3,390 -> 2,683 active (707 no-FS deactivated)
--   - special: 2,378 -> 0 active (always filtered)
--   - Outcomes scope reduced ~5.7% (skips outcomes for deactivated markets)
--
-- Idempotent: safe to re-run. ON CONFLICT DO UPDATE re-activates markets, then deactivate
-- pass re-applies filter. Markets that gain flashscore_id later auto-reactivate via INSERT
-- ON CONFLICT path (next derive call sets is_active=true; deactivate skips them since
-- e.flashscore_id IS NOT NULL).

BEGIN;

CREATE OR REPLACE FUNCTION public.derive_legacy_from_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '600s'
AS $function$
DECLARE
  v_events_upserted     int := 0;
  v_markets_upserted    int := 0;
  v_markets_deactivated int := 0;
  v_outcomes_upserted   int := 0;
  v_smc_updated         int := 0;
  v_t0 timestamptz := now();
BEGIN
  -- ===== Part 1: leagues (unchanged) =====
  WITH needed AS (
    SELECT DISTINCT
      sp.id AS sport_id,
      e2.league_slug AS slug,
      e2.league_name AS name,
      _parse_league_country(e2.league_slug) AS country_code,
      CASE WHEN _parse_league_country(e2.league_slug) IS NULL
           THEN COALESCE(NULLIF(split_part(e2.league_slug, '-', 1), ''), 'world')
           ELSE NULL END AS tour_code
    FROM events_v2 e2
    JOIN sports sp ON sp.slug = _sport_slug_en_to_it(e2.sport_slug)
    WHERE e2.starts_at > now() - interval '2 days'
      AND e2.starts_at < now() + interval '14 days'
  )
  INSERT INTO leagues (sport_id, slug, name, country_code, tour_code, is_active)
  SELECT sport_id, slug, name, country_code, tour_code, true FROM needed
  ON CONFLICT (sport_id, slug, COALESCE(country_code, tour_code)) DO NOTHING;

  -- ===== Part 2: events (unchanged) =====
  WITH ev_src AS (
    SELECT
      e2.odds_api_id,
      sp.id AS sport_id,
      l.id AS league_id,
      'odds-api:' || e2.odds_api_id::text AS external_id,
      e2.home AS home_team,
      e2.away AS away_team,
      e2.starts_at,
      CASE e2.status
        WHEN 'pending'   THEN 'prematch'
        WHEN 'live'      THEN 'live'
        WHEN 'settled'   THEN 'ended'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'postponed' THEN 'postponed'
        ELSE 'prematch'
      END AS status,
      e2.score_home,
      e2.score_away,
      e2.period_scores AS live_data,
      (e2.status = 'live') AS is_live
    FROM events_v2 e2
    JOIN sports sp ON sp.slug = _sport_slug_en_to_it(e2.sport_slug)
    JOIN leagues l ON l.sport_id = sp.id AND l.slug = e2.league_slug
    WHERE e2.starts_at > now() - interval '2 days'
      AND e2.starts_at < now() + interval '14 days'
  )
  INSERT INTO events (
    sport_id, league_id, external_id, home_team, away_team,
    starts_at, status, score_home, score_away, live_data, is_live
  )
  SELECT
    sport_id, league_id, external_id, home_team, away_team,
    starts_at, status, score_home, score_away, live_data, is_live
  FROM ev_src
  ON CONFLICT (external_id) DO UPDATE SET
    home_team    = EXCLUDED.home_team,
    away_team    = EXCLUDED.away_team,
    starts_at    = EXCLUDED.starts_at,
    status       = EXCLUDED.status,
    score_home   = EXCLUDED.score_home,
    score_away   = EXCLUDED.score_away,
    live_data    = EXCLUDED.live_data,
    is_live      = EXCLUDED.is_live,
    league_id    = EXCLUDED.league_id,
    updated_at   = now();
  GET DIAGNOSTICS v_events_upserted = ROW_COUNT;

  -- ===== Part 3: markets (unchanged — trigger from mig 155 sets category) =====
  WITH chosen_bookmaker AS (
    SELECT DISTINCT ON (m2.event_id, m2.market_name)
      m2.id          AS v2_market_id,
      m2.event_id    AS v2_event_id,
      m2.bookmaker,
      m2.market_name
    FROM markets_v2 m2
    JOIN events_v2 e2 ON e2.id = m2.event_id
    WHERE e2.starts_at > now() - interval '2 days'
      AND e2.starts_at < now() + interval '14 days'
    ORDER BY m2.event_id, m2.market_name, _bookmaker_priority(m2.bookmaker)
  ),
  market_lines AS (
    SELECT DISTINCT
      cb.v2_market_id,
      cb.v2_event_id,
      cb.bookmaker,
      cb.market_name,
      o2.line
    FROM chosen_bookmaker cb
    JOIN outcomes_v2 o2 ON o2.market_id = cb.v2_market_id
    WHERE round(o2.odds, 2) > 1.00
  ),
  legacy_markets_src AS (
    SELECT
      e_legacy.id AS legacy_event_id,
      sp.slug AS sport_slug,
      ml.v2_market_id,
      ml.bookmaker,
      ml.market_name AS raw_name,
      _oddsapi_translate_market(ml.market_name, sp.slug) AS translated_name,
      ml.line,
      CASE WHEN ml.line IS NULL
           THEN _oddsapi_translate_market(ml.market_name, sp.slug)
           ELSE _oddsapi_translate_market(ml.market_name, sp.slug) || ' ' || ml.line::text
      END AS market_type_label
    FROM market_lines ml
    JOIN events_v2 e2 ON e2.id = ml.v2_event_id
    JOIN sports sp ON sp.slug = _sport_slug_en_to_it(e2.sport_slug)
    JOIN events e_legacy ON e_legacy.external_id = 'odds-api:' || e2.odds_api_id::text
  ),
  legacy_markets_dedup AS (
    SELECT DISTINCT ON (legacy_event_id, market_type_label)
      legacy_event_id, market_type_label, line, raw_name
    FROM legacy_markets_src
    ORDER BY legacy_event_id, market_type_label, raw_name
  )
  INSERT INTO markets (event_id, name, slug, market_type, line, is_active)
  SELECT
    legacy_event_id,
    market_type_label,
    lower(replace(market_type_label, ' ', '-')),
    market_type_label,
    line,
    true
  FROM legacy_markets_dedup
  ON CONFLICT (event_id, market_type) DO UPDATE SET
    line       = EXCLUDED.line,
    is_active  = true,
    updated_at = now();
  GET DIAGNOSTICS v_markets_upserted = ROW_COUNT;

  -- ===== Part 3b: NEW — deactivate non-exposable markets via category column =====
  -- Uses idx_markets_category_active partial index (mig 155). No inline regex.
  -- Scope-bounded to derive's window so we don't sweep historical markets.
  WITH non_exposable AS (
    SELECT m.id
    FROM markets m
    JOIN events e ON e.id = m.event_id
    WHERE m.is_active = true
      AND e.source = 'odds-api'
      AND e.starts_at > now() - interval '2 days'
      AND e.starts_at < now() + interval '14 days'
      AND (
        m.category = 'special'
        OR m.category IS NULL
        OR (m.category IN ('stats', 'player') AND e.flashscore_id IS NULL)
      )
  )
  UPDATE markets m SET
    is_active  = false,
    updated_at = now()
  WHERE m.id IN (SELECT id FROM non_exposable);
  GET DIAGNOSTICS v_markets_deactivated = ROW_COUNT;

  -- ===== Part 4: outcomes (NEW filter: skip just-deactivated markets) =====
  WITH chosen_bookmaker AS (
    SELECT DISTINCT ON (m2.event_id, m2.market_name)
      m2.id          AS v2_market_id,
      m2.event_id    AS v2_event_id,
      m2.bookmaker,
      m2.market_name
    FROM markets_v2 m2
    JOIN events_v2 e2 ON e2.id = m2.event_id
    WHERE e2.starts_at > now() - interval '2 days'
      AND e2.starts_at < now() + interval '14 days'
    ORDER BY m2.event_id, m2.market_name, _bookmaker_priority(m2.bookmaker)
  ),
  out_src AS (
    SELECT
      m_legacy.id        AS legacy_market_id,
      _oddsapi_translate_outcome(o2.outcome_key, cb.market_name) AS name,
      round(o2.odds, 2)  AS odds
    FROM chosen_bookmaker cb
    JOIN events_v2 e2 ON e2.id = cb.v2_event_id
    JOIN sports sp ON sp.slug = _sport_slug_en_to_it(e2.sport_slug)
    JOIN events e_legacy ON e_legacy.external_id = 'odds-api:' || e2.odds_api_id::text
    JOIN outcomes_v2 o2 ON o2.market_id = cb.v2_market_id
    JOIN markets m_legacy
      ON m_legacy.event_id = e_legacy.id
     AND m_legacy.market_type = (
        CASE WHEN o2.line IS NULL
             THEN _oddsapi_translate_market(cb.market_name, sp.slug)
             ELSE _oddsapi_translate_market(cb.market_name, sp.slug) || ' ' || o2.line::text
        END
     )
    WHERE round(o2.odds, 2) > 1.00
      AND m_legacy.is_active = true  -- NEW: skip outcomes for just-deactivated markets
  ),
  out_dedup AS (
    SELECT DISTINCT ON (legacy_market_id, name)
      legacy_market_id, name, odds
    FROM out_src
    ORDER BY legacy_market_id, name, odds DESC
  )
  INSERT INTO outcomes (market_id, name, odds, is_active)
  SELECT legacy_market_id, name, odds, true FROM out_dedup
  ON CONFLICT (market_id, name) DO UPDATE SET
    odds          = EXCLUDED.odds,
    previous_odds = outcomes.odds,
    is_active     = true,
    updated_at    = now();
  GET DIAGNOSTICS v_outcomes_upserted = ROW_COUNT;

  -- ===== Part 5: source_markets_count (unchanged — already filters is_active=true) =====
  UPDATE events e SET
    source_markets_count = sub.cnt,
    updated_at = now()
  FROM (
    SELECT m.event_id, COUNT(*)::int AS cnt
    FROM markets m
    JOIN events e2 ON e2.id = m.event_id
    WHERE e2.source = 'odds-api' AND m.is_active = true
    GROUP BY m.event_id
  ) sub
  WHERE e.id = sub.event_id
    AND e.source = 'odds-api'
    AND COALESCE(e.source_markets_count, -1) <> sub.cnt;
  GET DIAGNOSTICS v_smc_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'events_upserted',     v_events_upserted,
    'markets_upserted',    v_markets_upserted,
    'markets_deactivated', v_markets_deactivated,
    'outcomes_upserted',   v_outcomes_upserted,
    'smc_updated',         v_smc_updated,
    'duration_ms',         extract(milliseconds from (now() - v_t0))::int
  );
END;
$function$;

COMMIT;
