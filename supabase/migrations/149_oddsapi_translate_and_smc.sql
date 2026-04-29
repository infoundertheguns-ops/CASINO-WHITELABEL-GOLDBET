-- 149_oddsapi_translate_and_smc.sql
-- Fix two regressions surfaced after mig 148 went live:
--   1. derive_legacy_from_v2() did not populate events.source_markets_count
--      → /api/sport-counts returns [] (filters source_markets_count > 0)
--      → player sidebar empty
--   2. derive_legacy_from_v2() emits odds-api raw English market_name verbatim
--      ('ML', 'Totals 2.5', 'Spread -1.5', etc.) but the player listing route
--      whitelist is hardcoded to Italian/Kambi conventions ('1X2', 'U/O 2.5',
--      'Vincente Incontro', etc.)
--      → cards show events but with empty markets array
--
-- Fix:
--   - Helper SQL functions to translate odds-api market_name and outcome_key
--     into Italian listing-compatible naming.
--   - Re-create derive_legacy_from_v2 to use them + populate
--     source_markets_count post-derive.
--   - Wipe existing odds-api markets/outcomes (English-named) so next derive
--     cycle re-creates them with Italian names. Brief empty-markets window
--     mitigated by calling derive_legacy_from_v2() in-migration.
--
-- Idempotent: CREATE OR REPLACE everywhere, DELETE is naturally re-runnable.

BEGIN;

SET statement_timeout = '300s';

-- ─────────────────────────────────────────────────────────────────
-- Helper 1: translate odds-api market_name → Italian listing name
-- Sport-aware where it matters (ML for football vs head-to-head sports).
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._oddsapi_translate_market(
  p_name text, p_sport text
) RETURNS text LANGUAGE sql IMMUTABLE AS $func$
  SELECT CASE
    -- ML — sport-aware
    WHEN p_name = 'ML' AND p_sport = 'calcio'         THEN '1X2'
    WHEN p_name = 'ML' AND p_sport = 'pallamano'      THEN 'Tempo Regolamentare'
    WHEN p_name = 'ML' AND p_sport = 'hockey-ghiaccio' THEN 'Supplementari Inclusi'
    WHEN p_name = 'ML' AND p_sport = 'rugby'           THEN 'Tempo regolamentare (1X2)'
    WHEN p_name = 'ML'                                 THEN 'Vincente Incontro'
    -- 3-Way Result (always 3-way regulation)
    WHEN p_name = '3-Way Result'                       THEN 'Tempo Regolamentare'
    WHEN p_name = 'Game Lines 3-Way'                   THEN 'Tempo Regolamentare'
    -- Half/Quarter ML
    WHEN p_name = 'ML HT'                              THEN '1X2 - 1T'
    WHEN p_name = 'ML 2H'                              THEN '1X2 - 2T'
    WHEN p_name = 'ML Q1'                              THEN '1X2 - 1Q'
    WHEN p_name = 'ML Q2'                              THEN '1X2 - 2Q'
    WHEN p_name = 'ML Q3'                              THEN '1X2 - 3Q'
    WHEN p_name = 'ML Q4'                              THEN '1X2 - 4Q'
    WHEN p_name = 'Half Time Result'                   THEN '1X2 - 1T'
    -- Totals (over/under)
    WHEN p_name = 'Totals'                             THEN 'U/O'
    WHEN p_name = 'Totals HT'                          THEN 'U/O - 1T'
    WHEN p_name = 'Totals 1H'                          THEN 'U/O - 1T'
    WHEN p_name = 'Totals 2H'                          THEN 'U/O - 2T'
    WHEN p_name = 'Totals 1Q'                          THEN 'U/O - 1Q'
    WHEN p_name = 'Totals 2Q'                          THEN 'U/O - 2Q'
    WHEN p_name = 'Totals 3Q'                          THEN 'U/O - 3Q'
    WHEN p_name = 'Totals 4Q'                          THEN 'U/O - 4Q'
    WHEN p_name = 'Totals (Games)'                     THEN 'Totale giochi'
    WHEN p_name = 'Goals Over/Under'                   THEN 'U/O'
    WHEN p_name = 'Alternative Goal Line'              THEN 'U/O'
    WHEN p_name LIKE 'Corners Totals%'                 THEN 'Totale angoli'
    -- Team totals
    WHEN p_name LIKE 'Team Total Home%'                THEN 'Totale 1° squadra'
    WHEN p_name LIKE 'Team Total Away%'                THEN 'Totale 2° squadra'
    WHEN p_name LIKE 'Team Total Goals Home%'          THEN 'Totale 1° squadra'
    WHEN p_name LIKE 'Team Total Goals Away%'          THEN 'Totale 2° squadra'
    -- Spread / Handicap
    WHEN p_name = 'Spread'                             THEN 'Handicap'
    WHEN p_name = 'Spread HT'                          THEN 'Handicap - 1T'
    WHEN p_name = 'Spread 2H'                          THEN 'Handicap - 2T'
    WHEN p_name = 'Spread Q1'                          THEN 'Handicap - 1Q'
    WHEN p_name = 'Spread (Games)'                     THEN 'Handicap'
    WHEN p_name = 'European Handicap'                  THEN 'Handicap'
    WHEN p_name = '1st Half Handicap'                  THEN 'Handicap - 1T'
    WHEN p_name = 'Corners Spread'                     THEN 'Handicap angoli'
    -- Other calcio
    WHEN p_name = 'Double Chance'                      THEN 'DC'
    WHEN p_name = 'Both Teams To Score'                THEN 'GG/NG'
    WHEN p_name = 'Both Teams To Score 2H'             THEN 'GG/NG - 2T'
    WHEN p_name = 'Draw No Bet'                        THEN 'DNB'
    WHEN p_name = 'Correct Score'                      THEN 'Risultato Esatto'
    WHEN p_name = 'Half Time / Full Time'              THEN '1T/Finale'
    WHEN p_name = 'Odd/Even'                           THEN 'P/D'
    WHEN p_name = 'Anytime Goalscorer'                 THEN 'Marcatore'
    WHEN p_name = 'Corners'                            THEN 'Angoli'
    WHEN p_name = 'Corners 2-Way'                      THEN 'Angoli 2-Way'
    WHEN p_name LIKE 'Corners Totals HT%'              THEN 'Totale angoli - 1T'
    -- Unknown: passthrough (visible in /admin/market-catalog for future translation)
    ELSE p_name
  END;
$func$;

COMMENT ON FUNCTION public._oddsapi_translate_market(text, text) IS
  'Translate odds-api English market_name to Italian listing-compatible name. '
  'Used by derive_legacy_from_v2(). Extend per top-volume new market types.';

-- ─────────────────────────────────────────────────────────────────
-- Helper 2: translate odds-api outcome_key → Italian outcome name
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._oddsapi_translate_outcome(
  p_key text, p_market text
) RETURNS text LANGUAGE sql IMMUTABLE AS $func$
  SELECT CASE
    WHEN lower(p_key) = 'yes'           THEN 'Si'
    WHEN lower(p_key) = 'no'            THEN 'No'
    WHEN lower(p_key) = 'odd'           THEN 'Dispari'
    WHEN lower(p_key) = 'even'          THEN 'Pari'
    WHEN lower(p_key) = 'over'          THEN 'Over'
    WHEN lower(p_key) = 'under'         THEN 'Under'
    WHEN lower(p_key) = 'home_or_draw'  THEN '1X'
    WHEN lower(p_key) = 'away_or_draw'  THEN 'X2'
    WHEN lower(p_key) = 'home_or_away'  THEN '12'
    WHEN lower(p_key) = 'home'          THEN '1'
    WHEN lower(p_key) = 'draw'          THEN 'X'
    WHEN lower(p_key) = 'away'          THEN '2'
    WHEN p_key IN ('1','X','2','1X','X2','12') THEN p_key
    ELSE p_key
  END;
$func$;

COMMENT ON FUNCTION public._oddsapi_translate_outcome(text, text) IS
  'Translate odds-api outcome_key to Italian. Used by derive_legacy_from_v2().';

-- ─────────────────────────────────────────────────────────────────
-- New derive_legacy_from_v2: translation + source_markets_count
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_legacy_from_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $func$
DECLARE
  v_events_upserted    int := 0;
  v_markets_upserted   int := 0;
  v_outcomes_upserted  int := 0;
  v_smc_updated        int := 0;
  v_t0 timestamptz := now();
BEGIN
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
    -- Translation collapses distinct odds-api market_names to the same Italian
    -- label (e.g. "Goals Over/Under" + "Totals" → "U/O"). Pick one row per
    -- (event, label) to avoid ON CONFLICT firing twice per target row.
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
  ),
  out_dedup AS (
    -- When multiple odds-api market_names collapse to the same legacy market,
    -- their outcome rows can collide on (market_id, translated_name). Keep
    -- the row with the highest odds (best price for the bettor).
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

  -- Step 5 NEW: populate events.source_markets_count for odds-api events.
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
    'events_upserted',   v_events_upserted,
    'markets_upserted',  v_markets_upserted,
    'outcomes_upserted', v_outcomes_upserted,
    'smc_updated',       v_smc_updated,
    'duration_ms',       extract(milliseconds from (now() - v_t0))::int
  );
END;
$func$;

-- ─────────────────────────────────────────────────────────────────
-- Wipe existing odds-api markets/outcomes (English-named)
-- ─────────────────────────────────────────────────────────────────
DELETE FROM outcomes
WHERE market_id IN (
  SELECT m.id FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE e.source = 'odds-api'
);

DELETE FROM markets
WHERE event_id IN (
  SELECT id FROM events WHERE source = 'odds-api'
);

-- Repopulate immediately (avoid empty-markets window)
SELECT public.derive_legacy_from_v2();

COMMIT;
