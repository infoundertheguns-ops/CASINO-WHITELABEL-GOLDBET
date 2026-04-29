-- Migration 144: derive_legacy_from_v2() v2 — handle multi-line markets correctly.
--
-- Bug in mig 143: legacy outcomes table has UNIQUE (market_id, name), but
-- odds-api Totals/Spread/AH markets have multiple lines (e.g. Totals at hdp 0.5,
-- 1.5, 2.5, ..., 8.5). All those lines would map to outcome_key='over' and
-- collide on the unique constraint.
--
-- Pattern from existing kambi markets:
--   1X2          (line null, simple)
--   U/O 4.5      (line embedded in market_type)
--   T/T Handicap (-1.5)  (line in market_type with parens)
--
-- For odds-api: replicate the pattern. Each unique (event, market_name, line)
-- becomes ONE legacy market with market_type that includes the line:
--   ML           (line null)
--   Totals 2.5   (line embedded)
--   Spread -1    (line embedded)
--   Both Teams To Score   (line null)
-- This way (event_id, market_type) stays unique, and outcomes within a market
-- have unique names (over/under, home/draw/away, yes/no, etc.).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION public.derive_legacy_from_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $$
DECLARE
  v_events_upserted    int := 0;
  v_markets_upserted   int := 0;
  v_outcomes_upserted  int := 0;
  v_t0 timestamptz := now();
BEGIN
  -- Step 1: ensure leagues exist for every events_v2.league_slug we will write.
  WITH needed AS (
    SELECT DISTINCT
      sp.id              AS sport_id,
      e2.league_slug     AS slug,
      e2.league_name     AS name,
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

  -- Step 2: upsert events from events_v2.
  WITH ev_src AS (
    SELECT
      e2.odds_api_id,
      sp.id              AS sport_id,
      l.id               AS league_id,
      'odds-api:' || e2.odds_api_id::text AS external_id,
      e2.home            AS home_team,
      e2.away            AS away_team,
      e2.starts_at,
      CASE e2.status
        WHEN 'pending'   THEN 'prematch'
        WHEN 'live'      THEN 'live'
        WHEN 'settled'   THEN 'ended'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'postponed' THEN 'postponed'
        ELSE 'prematch'
      END                AS status,
      e2.score_home,
      e2.score_away,
      e2.period_scores   AS live_data,
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

  -- Step 3: pick best bookmaker per (event, market_name) — same logic as before.
  -- Then explode by line: each unique (event, market_name, line) becomes one
  -- legacy `markets` row with market_type embedding the line value.
  WITH chosen_bookmaker AS (
    SELECT DISTINCT ON (m2.event_id, m2.market_name)
      m2.id              AS v2_market_id,
      m2.event_id        AS v2_event_id,
      m2.bookmaker,
      m2.market_name
    FROM markets_v2 m2
    JOIN events_v2 e2 ON e2.id = m2.event_id
    WHERE e2.starts_at > now() - interval '2 days'
      AND e2.starts_at < now() + interval '14 days'
    ORDER BY m2.event_id, m2.market_name, _bookmaker_priority(m2.bookmaker)
  ),
  -- For each chosen market, list all distinct lines present in its outcomes
  market_lines AS (
    SELECT DISTINCT
      cb.v2_market_id,
      cb.v2_event_id,
      cb.bookmaker,
      cb.market_name,
      o2.line
    FROM chosen_bookmaker cb
    JOIN outcomes_v2 o2 ON o2.market_id = cb.v2_market_id
  ),
  -- Resolve to legacy event id, build legacy market_type
  legacy_markets_src AS (
    SELECT
      e_legacy.id        AS legacy_event_id,
      ml.v2_market_id,
      ml.bookmaker,
      ml.market_name,
      ml.line,
      -- Build market_type: just market_name if line is null, else "name line"
      CASE WHEN ml.line IS NULL
           THEN ml.market_name
           ELSE ml.market_name || ' ' || ml.line::text
      END                AS market_type_label
    FROM market_lines ml
    JOIN events_v2 e2 ON e2.id = ml.v2_event_id
    JOIN events e_legacy ON e_legacy.external_id = 'odds-api:' || e2.odds_api_id::text
  )
  INSERT INTO markets (event_id, name, slug, market_type, line, is_active)
  SELECT
    legacy_event_id,
    market_type_label                                 AS name,
    lower(replace(market_type_label, ' ', '-'))       AS slug,
    market_type_label                                 AS market_type,
    line,
    true
  FROM legacy_markets_src
  ON CONFLICT (event_id, market_type) DO UPDATE SET
    line       = EXCLUDED.line,
    is_active  = true,
    updated_at = now();
  GET DIAGNOSTICS v_markets_upserted = ROW_COUNT;

  -- Step 4: outcomes — for each (event, market_name, line) pair, copy outcomes
  -- from the chosen bookmaker matching that line.
  WITH chosen_bookmaker AS (
    SELECT DISTINCT ON (m2.event_id, m2.market_name)
      m2.id              AS v2_market_id,
      m2.event_id        AS v2_event_id,
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
      o2.outcome_key     AS name,
      o2.odds
    FROM chosen_bookmaker cb
    JOIN events_v2 e2 ON e2.id = cb.v2_event_id
    JOIN events e_legacy ON e_legacy.external_id = 'odds-api:' || e2.odds_api_id::text
    JOIN outcomes_v2 o2 ON o2.market_id = cb.v2_market_id
    JOIN markets m_legacy
      ON m_legacy.event_id = e_legacy.id
     AND m_legacy.market_type = (
        CASE WHEN o2.line IS NULL
             THEN cb.market_name
             ELSE cb.market_name || ' ' || o2.line::text
        END
     )
  )
  INSERT INTO outcomes (market_id, name, odds, is_active)
  SELECT legacy_market_id, name, odds, true FROM out_src
  ON CONFLICT (market_id, name) DO UPDATE SET
    odds          = EXCLUDED.odds,
    previous_odds = outcomes.odds,
    is_active     = true,
    updated_at    = now();
  GET DIAGNOSTICS v_outcomes_upserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'events_upserted',   v_events_upserted,
    'markets_upserted',  v_markets_upserted,
    'outcomes_upserted', v_outcomes_upserted,
    'duration_ms',       extract(milliseconds from (now() - v_t0))::int
  );
END;
$$;

COMMIT;
