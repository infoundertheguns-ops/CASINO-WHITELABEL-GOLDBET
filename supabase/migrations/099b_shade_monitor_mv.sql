-- ============================================================
-- 099b_shade_monitor_mv.sql
--
-- Backing MV for shade_monitor_events / shade_monitor_sports.
-- v_outcomes_displayed full-scan is >60s — pre-aggregate per event.
-- Refresh cron every 5min on scraper-vps.
-- ============================================================

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS mv_shade_monitor_events;

CREATE MATERIALIZED VIEW mv_shade_monitor_events AS
WITH per_event AS (
  SELECT v.flashscore_id,
         v.sport_id,
         COUNT(*)::bigint AS outcomes_count,
         COUNT(*) FILTER (
           WHERE v.displayed_odds IS NOT NULL
             AND v.displayed_odds IS DISTINCT FROM COALESCE(v.kambi_odds, v.twobet_odds, v.betfair_odds)
         )::bigint AS shade_count,
         COUNT(*) FILTER (
           WHERE ((v.kambi_odds IS NOT NULL)::int
                + (v.twobet_odds IS NOT NULL)::int
                + (v.betfair_odds IS NOT NULL)::int) >= 2
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
  ORDER BY j.flashscore_id, e.source  -- deterministic pick
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

-- Now rewrite the RPCs to query the MV
CREATE OR REPLACE FUNCTION shade_monitor_sports()
RETURNS TABLE(slug text, name text, events_count bigint, shade_active_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT sport_slug::text, sport_name::text,
         COUNT(*)::bigint AS events_count,
         COALESCE(SUM(shade_count), 0)::bigint AS shade_active_count
  FROM mv_shade_monitor_events
  WHERE status IN ('prematch','live')
  GROUP BY 1, 2
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION shade_monitor_events(p_sport text DEFAULT NULL, p_limit int DEFAULT 100)
RETURNS TABLE(
  flashscore_id text,
  event_id uuid,
  sport text,
  league text,
  home text,
  away text,
  starts_at timestamptz,
  outcomes_count bigint,
  shade_count bigint,
  multi_source_count bigint,
  status text
)
LANGUAGE sql STABLE AS $$
  SELECT mv.flashscore_id::text,
         mv.event_id,
         mv.sport_slug::text,
         mv.league::text,
         mv.home::text,
         mv.away::text,
         mv.starts_at,
         mv.outcomes_count,
         mv.shade_count,
         mv.multi_source_count,
         mv.status::text
  FROM mv_shade_monitor_events mv
  WHERE mv.status IN ('prematch','live')
    AND (p_sport IS NULL OR p_sport = '' OR mv.sport_slug = p_sport)
  ORDER BY mv.shade_count DESC, mv.starts_at ASC NULLS LAST
  LIMIT p_limit;
$$;

GRANT SELECT ON mv_shade_monitor_events TO service_role, authenticated;

COMMIT;

-- Initial populate
REFRESH MATERIALIZED VIEW mv_shade_monitor_events;
