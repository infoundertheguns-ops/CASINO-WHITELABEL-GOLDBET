-- ============================================================
-- 099c_shade_mv_multisource_fix.sql
--
-- Fix: mv_shade_monitor_events.shade_count was counting single-source
-- *0.90 discount rows as "shade active". True shade = multi-source
-- displayed_odds < primary. Require n_sources >= 2 for shade_count.
-- ============================================================

SET statement_timeout='900s';

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS mv_shade_monitor_events;

CREATE MATERIALIZED VIEW mv_shade_monitor_events AS
WITH per_event AS (
  SELECT v.flashscore_id,
         v.sport_id,
         COUNT(*)::bigint AS outcomes_count,
         COUNT(*) FILTER (
           WHERE v.displayed_odds IS NOT NULL
             AND ((v.kambi_odds IS NOT NULL AND v.kambi_active AND NOT v.kambi_suspended)::int
                + (v.twobet_odds IS NOT NULL AND v.twobet_active AND NOT v.twobet_suspended)::int
                + (v.betfair_odds IS NOT NULL AND v.betfair_active AND NOT v.betfair_suspended)::int) >= 2
             AND v.displayed_odds IS DISTINCT FROM COALESCE(v.kambi_odds, v.twobet_odds, v.betfair_odds)
         )::bigint AS shade_count,
         COUNT(*) FILTER (
           WHERE ((v.kambi_odds IS NOT NULL AND v.kambi_active AND NOT v.kambi_suspended)::int
                + (v.twobet_odds IS NOT NULL AND v.twobet_active AND NOT v.twobet_suspended)::int
                + (v.betfair_odds IS NOT NULL AND v.betfair_active AND NOT v.betfair_suspended)::int) >= 2
         )::bigint AS multi_source_count
  FROM v_outcomes_displayed v
  WHERE v.flashscore_id IS NOT NULL
  GROUP BY v.flashscore_id, v.sport_id
),
joined AS (
  SELECT pe.flashscore_id,
         pe.sport_id,
         pe.outcomes_count,
         pe.shade_count,
         pe.multi_source_count,
         COALESCE(s.slug, 'unknown') AS sport_slug,
         COALESCE(s.name, 'Unknown') AS sport_name
  FROM per_event pe
  LEFT JOIN sports s ON s.id = pe.sport_id
),
picked AS (
  SELECT DISTINCT ON (j.flashscore_id)
         j.flashscore_id,
         j.sport_slug, j.sport_name,
         j.outcomes_count, j.shade_count, j.multi_source_count,
         e.id AS event_id,
         e.home_team AS home,
         e.away_team AS away,
         e.starts_at,
         e.status,
         l.name AS league_name
  FROM joined j
  JOIN events e ON e.flashscore_id = j.flashscore_id
  LEFT JOIN leagues l ON l.id = e.league_id
  ORDER BY j.flashscore_id, e.source
)
SELECT flashscore_id, event_id, sport_slug, sport_name,
       COALESCE(league_name, '') AS league,
       COALESCE(home, '') AS home, COALESCE(away, '') AS away,
       starts_at, COALESCE(status, '') AS status,
       outcomes_count, shade_count, multi_source_count
FROM picked;

CREATE UNIQUE INDEX ON mv_shade_monitor_events (flashscore_id);
CREATE INDEX ON mv_shade_monitor_events (sport_slug, shade_count DESC, starts_at);
CREATE INDEX ON mv_shade_monitor_events (status);

GRANT SELECT ON mv_shade_monitor_events TO service_role, authenticated;

COMMIT;

REFRESH MATERIALIZED VIEW mv_shade_monitor_events;
