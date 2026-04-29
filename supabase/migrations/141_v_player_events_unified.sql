-- Migration 141: v_player_events — unified view for player frontend.
--
-- Routes events to the correct source based on sport:
--   * Major sports (football/basket/tennis/baseball/etc) → events_v2 (odds-api.io)
--   * Niche sports (esports/snooker/tennis-tavolo/etc)   → events (kambi legacy)
--
-- Italian-slugs from legacy `sports` table are mapped to odds-api English slugs
-- via a CASE in the JOIN. Result row shape matches legacy `events` columns so
-- the frontend can swap `from("events")` → `from("v_player_events")` without
-- other changes.
--
-- Dedup: each event appears EXACTLY ONCE (events_v2 wins on major sports;
-- events kambi wins on niche). No need for canonical_id resolution at this
-- layer because routing is sport-disjoint.
--
-- Idempotent: CREATE OR REPLACE VIEW.
-- Rollback: DROP VIEW v_player_events;

BEGIN;

CREATE OR REPLACE VIEW public.v_player_events AS
  -- ── v2 events: major sports ──
  SELECT
    e2.id,
    sp.id                                              AS sport_id,
    NULL::uuid                                         AS league_id,
    ('odds-api:' || e2.odds_api_id::text)              AS external_id,
    e2.home                                            AS home_team,
    e2.away                                            AS away_team,
    NULL::text                                         AS home_logo,
    NULL::text                                         AS away_logo,
    e2.starts_at,
    CASE e2.status
      WHEN 'pending'   THEN 'prematch'
      WHEN 'live'      THEN 'live'
      WHEN 'settled'   THEN 'ended'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'postponed' THEN 'postponed'
      ELSE e2.status
    END                                                AS status,
    e2.score_home,
    e2.score_away,
    NULL::int                                          AS minute,
    NULL::text                                         AS period,
    e2.period_scores                                   AS live_data,
    NULL::jsonb                                        AS result,
    false                                              AS is_featured,
    (e2.status = 'live')                               AS is_live,
    NULL::timestamptz                                  AS settled_at,
    e2.created_at,
    e2.updated_at,
    e2.flashscore_id,
    NULL::int                                          AS source_markets_count,
    'odds-api'::text                                   AS source,
    e2.sport_slug                                      AS v2_sport_slug,   -- exposed for filtering convenience
    e2.league_slug                                     AS v2_league_slug,
    e2.league_name                                     AS v2_league_name
  FROM public.events_v2 e2
  LEFT JOIN public.sports sp ON sp.slug = (
    CASE e2.sport_slug
      WHEN 'football'    THEN 'calcio'
      WHEN 'basketball'  THEN 'basket'
      WHEN 'handball'    THEN 'pallamano'
      WHEN 'volleyball'  THEN 'volley'
      WHEN 'ice-hockey'  THEN 'hockey-ghiaccio'
      ELSE e2.sport_slug
    END
  )
  WHERE e2.sport_slug IN (
    'football', 'basketball', 'tennis', 'baseball', 'ice-hockey',
    'american-football', 'volleyball', 'handball', 'rugby', 'cricket'
  )

  UNION ALL

  -- ── legacy events: niche only (kambi source) ──
  SELECT
    e.id,
    e.sport_id,
    e.league_id,
    e.external_id,
    e.home_team,
    e.away_team,
    e.home_logo,
    e.away_logo,
    e.starts_at,
    e.status,
    e.score_home,
    e.score_away,
    e.minute,
    e.period,
    e.live_data,
    e.result,
    e.is_featured,
    e.is_live,
    e.settled_at,
    e.created_at,
    e.updated_at,
    e.flashscore_id,
    e.source_markets_count,
    e.source,
    NULL::text                                         AS v2_sport_slug,
    NULL::text                                         AS v2_league_slug,
    NULL::text                                         AS v2_league_name
  FROM public.events e
  JOIN public.sports s ON s.id = e.sport_id
  WHERE e.source = 'kambi'
    -- Exclude major sports (Italian slugs) — those come from events_v2
    AND s.slug NOT IN (
      'calcio', 'basket', 'tennis', 'baseball', 'rugby', 'cricket',
      'volley', 'pallamano', 'hockey-ghiaccio'
    );

GRANT SELECT ON public.v_player_events TO anon, authenticated, service_role;

COMMIT;
