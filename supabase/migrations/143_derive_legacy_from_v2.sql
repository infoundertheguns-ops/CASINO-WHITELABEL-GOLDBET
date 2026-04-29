-- Migration 143: derive_legacy_from_v2() RPC.
--
-- Reads from events_v2 / markets_v2 / outcomes_v2 (multi-bookmaker source of
-- truth) and derives single-bookmaker rows in events / markets / outcomes
-- (legacy schema) so the existing player frontend can read them transparently.
--
-- For each event:
--   1. Sport: map English odds-api sport_slug to Italian sports.slug
--      (football → calcio, basketball → basket, ecc.). Unknown sports skipped.
--   2. League: lookup or auto-create row in `leagues` with country_code parsed
--      from league_slug (e.g. 'italy-serie-a' → 'italy').
--   3. Event: upsert with external_id='odds-api:NNN' (source generated col
--      auto-resolves to 'odds-api' via mig 142).
--   4. Markets: for each unique market_name, choose ONE bookmaker by priority
--      (Bet365 > BetUK > LeoVegas > Unibet > paf > BetWinner > Pamestoixima >
--      Stake > 18bet > others). Upsert into `markets`.
--   5. Outcomes: write that chosen bookmaker's outcomes into `outcomes`.
--
-- Multi-bookmaker depth is preserved in events_v2 (admin tools can query that).
-- Player frontend sees only the chosen bookmaker per market, which is fine
-- because BetsSolution presents a single quote per market to players.
--
-- Idempotent: ON CONFLICT DO UPDATE for events/markets/outcomes.
-- Returns: jsonb summary {events_upserted, markets_upserted, outcomes_upserted, skipped_unknown_sport}
-- Performance: full scan of events_v2 last 7 days. Targets ~500 events / 80k outcomes per call.

BEGIN;

-- Bookmaker priority lookup: smaller priority wins. Used for picking the
-- "best" bookmaker per (event, market_name) when deriving legacy rows.
CREATE OR REPLACE FUNCTION public._bookmaker_priority(p_bookmaker text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_bookmaker
    WHEN 'Bet365'        THEN 1
    WHEN 'BetUK'         THEN 2
    WHEN 'LeoVegas'      THEN 3
    WHEN 'Unibet'        THEN 4
    WHEN 'paf'           THEN 5
    WHEN 'BetWinner'     THEN 6
    WHEN 'Pamestoixima'  THEN 7
    WHEN 'Stake'         THEN 8
    WHEN 'DraftKings'    THEN 9
    WHEN '1xbet'         THEN 10
    WHEN 'Coral'         THEN 11
    WHEN 'Ladbrokes'     THEN 12
    WHEN 'Stoiximan'     THEN 13
    WHEN '888Sport'      THEN 14
    WHEN '18bet'         THEN 15
    WHEN 'Paddy Power'   THEN 16
    WHEN 'William Hill'  THEN 17
    ELSE 99
  END
$$;

-- Map English odds-api sport_slug → Italian legacy sports.slug.
CREATE OR REPLACE FUNCTION public._sport_slug_en_to_it(p_en text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_en
    WHEN 'football'    THEN 'calcio'
    WHEN 'basketball'  THEN 'basket'
    WHEN 'handball'    THEN 'pallamano'
    WHEN 'volleyball'  THEN 'volley'
    WHEN 'ice-hockey'  THEN 'hockey-ghiaccio'
    WHEN 'tennis'      THEN 'tennis'
    WHEN 'baseball'    THEN 'baseball'
    WHEN 'rugby'       THEN 'rugby'
    WHEN 'cricket'     THEN 'cricket'
    WHEN 'american-football' THEN 'american-football'
    ELSE NULL  -- unknown → skip
  END
$$;

-- Parse country_code from a league slug like 'italy-serie-a' → 'italy'.
-- For international/intercontinental leagues (slug starts with 'international'
-- or 'europe'), returns NULL → caller will use tour_code instead.
CREATE OR REPLACE FUNCTION public._parse_league_country(p_slug text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_slug LIKE 'international%' THEN NULL
    WHEN p_slug LIKE 'europe%'        THEN NULL
    WHEN p_slug LIKE 'world%'         THEN NULL
    ELSE split_part(p_slug, '-', 1)
  END
$$;

CREATE OR REPLACE FUNCTION public.derive_legacy_from_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_events_upserted     int := 0;
  v_markets_upserted    int := 0;
  v_outcomes_upserted   int := 0;
  v_skipped_unknown_sport int := 0;
  v_t0 timestamptz := now();
BEGIN
  -- Step 1: ensure leagues exist for every events_v2.league_slug we will write.
  -- We use a CTE to compute distinct (sport_id, league_slug, country_code) tuples
  -- and INSERT ... ON CONFLICT DO NOTHING.
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

  -- Step 3: pick best bookmaker per (event, market_name) from markets_v2,
  -- upsert into legacy `markets` with raw English market_name.
  WITH ranked AS (
    SELECT
      m2.id              AS v2_market_id,
      m2.event_id        AS v2_event_id,
      m2.bookmaker,
      m2.market_name,
      ROW_NUMBER() OVER (
        PARTITION BY m2.event_id, m2.market_name
        ORDER BY _bookmaker_priority(m2.bookmaker)
      ) AS rn
    FROM markets_v2 m2
    JOIN events_v2 e2 ON e2.id = m2.event_id
    WHERE e2.starts_at > now() - interval '2 days'
      AND e2.starts_at < now() + interval '14 days'
  ),
  chosen AS (
    SELECT v2_market_id, v2_event_id, bookmaker, market_name FROM ranked WHERE rn = 1
  ),
  -- For each chosen v2 market, derive the legacy event id
  resolved AS (
    SELECT
      e_legacy.id        AS legacy_event_id,
      c.v2_market_id,
      c.bookmaker,
      c.market_name,
      -- pick a representative line from outcomes_v2: most common, fallback to NULL
      (SELECT o2.line FROM outcomes_v2 o2 WHERE o2.market_id = c.v2_market_id ORDER BY o2.line NULLS FIRST LIMIT 1) AS line_value
    FROM chosen c
    JOIN events_v2 e2 ON e2.id = c.v2_event_id
    JOIN events e_legacy ON e_legacy.external_id = 'odds-api:' || e2.odds_api_id::text
  )
  INSERT INTO markets (event_id, name, slug, market_type, line, is_active)
  SELECT
    legacy_event_id,
    market_name                                     AS name,
    lower(replace(market_name, ' ', '-'))           AS slug,
    market_name                                     AS market_type,
    line_value                                      AS line,
    true
  FROM resolved
  ON CONFLICT (event_id, market_type) DO UPDATE SET
    line       = EXCLUDED.line,
    is_active  = true,
    updated_at = now();
  GET DIAGNOSTICS v_markets_upserted = ROW_COUNT;

  -- Step 4: for each chosen market, copy outcomes from the chosen bookmaker.
  WITH ranked AS (
    SELECT
      m2.id              AS v2_market_id,
      m2.event_id        AS v2_event_id,
      m2.bookmaker,
      m2.market_name,
      ROW_NUMBER() OVER (
        PARTITION BY m2.event_id, m2.market_name
        ORDER BY _bookmaker_priority(m2.bookmaker)
      ) AS rn
    FROM markets_v2 m2
    JOIN events_v2 e2 ON e2.id = m2.event_id
    WHERE e2.starts_at > now() - interval '2 days'
      AND e2.starts_at < now() + interval '14 days'
  ),
  chosen AS (
    SELECT v2_market_id, v2_event_id, bookmaker, market_name FROM ranked WHERE rn = 1
  ),
  out_src AS (
    SELECT
      m_legacy.id        AS legacy_market_id,
      o2.outcome_key     AS name,
      o2.odds
    FROM chosen c
    JOIN events_v2 e2 ON e2.id = c.v2_event_id
    JOIN events e_legacy ON e_legacy.external_id = 'odds-api:' || e2.odds_api_id::text
    JOIN markets m_legacy ON m_legacy.event_id = e_legacy.id AND m_legacy.market_type = c.market_name
    JOIN outcomes_v2 o2 ON o2.market_id = c.v2_market_id
  )
  INSERT INTO outcomes (market_id, name, odds, is_active)
  SELECT legacy_market_id, name, odds, true FROM out_src
  ON CONFLICT (market_id, name) DO UPDATE SET
    odds          = EXCLUDED.odds,
    previous_odds = outcomes.odds,  -- preserve previous_odds for animation
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

GRANT EXECUTE ON FUNCTION public.derive_legacy_from_v2() TO service_role;

COMMIT;
