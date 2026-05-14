-- Migration 187 — v_player_events COALESCE league fallback to events_v2.league_name
--
-- Context:
--   Mig 178 v_player_events JOIN-s leagues table by (sport_id, league_slug).
--   When the events_v2 league_slug has no matching row in leagues (common
--   for tennis tournaments, esports, freccette, pallamano - lifecycle dei
--   tornei tennis e' faster than leagues seeding cycle), the view returns
--   NULL for league_slug/league_name/league_id, hiding the tournament name
--   in the player listing UI.
--
--   events_v2 has denormalized league_slug and league_name populated by
--   the OddsAPI ingester / FS scraper. The fix is to COALESCE the JOIN
--   result with the events_v2 fields.
--
-- Observed impact (2026-05-14 probe):
--   tennis    : 21/21  live + 374/500 prematch with NULL league (100%/75%)
--   freccette :  1/1   live (100%)
--   pallamano :  1/1   live (100%)
--   esports   :  6/6   live (100%)
--   calcio    :  9/58  live (16%)
--
-- Behavior post-fix:
--   league_slug : COALESCE(l.slug, e2.league_slug) - falls back to events_v2
--   league_name : COALESCE(l.name, e2.league_name) - falls back to events_v2
--   league_id   : l.id (NULL when JOIN misses, no UUID to fabricate)
--   league_country / league_logo_url: l.* (NULL when JOIN misses, no fallback
--     in events_v2 — UI degrades gracefully, country flag falls back to ISO
--     extraction via lib/mappers.ts:186 extractCountryCode)
--
-- Rollback:
--   Re-apply mig 178 (file kept in repo).

BEGIN;

DROP VIEW IF EXISTS v_player_events CASCADE;

CREATE VIEW v_player_events AS
SELECT
  e2.id,
  e2.odds_api_id,
  s.id                                       AS sport_id,
  s.slug                                     AS sport_slug,
  s.name                                     AS sport_name,
  s.icon                                     AS sport_icon,
  s.sort_order                               AS sport_sort_order,
  l.id                                       AS league_id,
  COALESCE(l.slug, e2.league_slug)           AS league_slug,
  COALESCE(l.name, e2.league_name)           AS league_name,
  l.country                                  AS league_country,
  l.logo_url                                 AS league_logo_url,
  l.sort_order                               AS league_sort_order,
  e2.home                                    AS home_team,
  e2.away                                    AS away_team,
  e2.home_id,
  e2.away_id,
  e2.starts_at,
  CASE e2.status
    WHEN 'pending'   THEN 'prematch'
    WHEN 'live'      THEN 'live'
    WHEN 'settled'   THEN 'ended'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'postponed' THEN 'postponed'
    ELSE e2.status
  END                                        AS status,
  e2.score_home,
  e2.score_away,
  COALESCE(e2.live_data, e2.period_scores)   AS live_data,
  e2.minute,
  e2.period,
  (e2.status = 'live')                       AS is_live,
  e2.flashscore_id,
  e2.urls,
  e2.updated_at,
  e2.last_settled_at
FROM events_v2 e2
LEFT JOIN sports s
  ON s.slug = _sport_slug_en_to_it(e2.sport_slug)
LEFT JOIN leagues l
  ON l.sport_id = s.id
 AND l.slug = e2.league_slug;

COMMENT ON VIEW v_player_events IS
  'Plan D Fase 1 — player-facing event view. Mig 187: COALESCE league fields to events_v2 denormalized fallback when leagues JOIN misses.';

INSERT INTO _migrations (name, applied_at)
VALUES ('187_v_player_events_league_fallback', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;
