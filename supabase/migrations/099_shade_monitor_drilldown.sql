-- ============================================================
-- 099_shade_monitor_drilldown.sql
--
-- Drill-down RPCs for /admin/shade-monitor:
--   1. shade_monitor_sports()        — sports list with shade activity
--   2. shade_monitor_events()        — events for a sport sorted by shade activity
--   3. shade_monitor_event_detail()  — per-event 3-source outcome breakdown
--
-- All STABLE read-only. Powers the new drill-down UI showing how each
-- source quotes a market and which one wins display (MIN).
-- ============================================================

BEGIN;

-- Sports with canonical pivot coverage + shade activity
CREATE OR REPLACE FUNCTION shade_monitor_sports()
RETURNS TABLE(slug text, name text, events_count bigint, shade_active_count bigint)
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT v.sport_id,
           COUNT(DISTINCT v.flashscore_id) AS events_count,
           COUNT(*) FILTER (
             WHERE v.displayed_odds IS NOT NULL
               AND v.displayed_odds IS DISTINCT FROM COALESCE(v.kambi_odds, v.twobet_odds, v.betfair_odds)
           ) AS shade_active_count
    FROM v_outcomes_displayed v
    GROUP BY v.sport_id
  )
  SELECT COALESCE(s.slug, 'unknown')::text,
         COALESCE(s.name, 'Unknown')::text,
         a.events_count,
         a.shade_active_count
  FROM agg a LEFT JOIN sports s ON s.id = a.sport_id
  ORDER BY a.events_count DESC;
$$;

-- Events for a sport, sorted by shade count DESC then starts_at ASC.
-- Empty p_sport means all sports.
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
  WITH per_event AS (
    SELECT v.flashscore_id,
           v.sport_id,
           COUNT(*) AS outcomes_count,
           COUNT(*) FILTER (
             WHERE v.displayed_odds IS NOT NULL
               AND v.displayed_odds IS DISTINCT FROM COALESCE(v.kambi_odds, v.twobet_odds, v.betfair_odds)
           ) AS shade_count,
           COUNT(*) FILTER (
             WHERE ((v.kambi_odds IS NOT NULL)::int
                  + (v.twobet_odds IS NOT NULL)::int
                  + (v.betfair_odds IS NOT NULL)::int) >= 2
           ) AS multi_source_count
    FROM v_outcomes_displayed v
    WHERE v.flashscore_id IS NOT NULL
    GROUP BY v.flashscore_id, v.sport_id
  ),
  joined AS (
    SELECT pe.*,
           COALESCE(s.slug, 'unknown')::text AS sport_slug,
           COALESCE(s.name, 'Unknown')::text AS sport_name
    FROM per_event pe
    LEFT JOIN sports s ON s.id = pe.sport_id
  ),
  picked AS (
    SELECT j.*,
           -- Pick any one source event row to get home/away/starts_at/league
           (SELECT e.id      FROM events e WHERE e.flashscore_id = j.flashscore_id ORDER BY e.source LIMIT 1) AS event_id,
           (SELECT e.home_team    FROM events e WHERE e.flashscore_id = j.flashscore_id ORDER BY e.source LIMIT 1) AS home_name,
           (SELECT e.away_team    FROM events e WHERE e.flashscore_id = j.flashscore_id ORDER BY e.source LIMIT 1) AS away_name,
           (SELECT e.starts_at FROM events e WHERE e.flashscore_id = j.flashscore_id ORDER BY e.source LIMIT 1) AS starts_at,
           (SELECT e.status  FROM events e WHERE e.flashscore_id = j.flashscore_id ORDER BY e.source LIMIT 1) AS status,
           (SELECT l.name    FROM events e JOIN leagues l ON l.id = e.league_id WHERE e.flashscore_id = j.flashscore_id ORDER BY e.source LIMIT 1) AS league_name
    FROM joined j
  )
  SELECT p.flashscore_id::text,
         p.event_id,
         p.sport_slug,
         COALESCE(p.league_name, '')::text,
         COALESCE(p.home_name, '')::text,
         COALESCE(p.away_name, '')::text,
         p.starts_at,
         p.outcomes_count,
         p.shade_count,
         p.multi_source_count,
         COALESCE(p.status, '')::text
  FROM picked p
  WHERE p.status IN ('prematch','live')
    AND (p_sport IS NULL OR p_sport = '' OR p.sport_slug = p_sport)
  ORDER BY p.shade_count DESC, p.starts_at ASC NULLS LAST
  LIMIT p_limit;
$$;

-- Per-event: all canonical outcomes with 3-source odds
CREATE OR REPLACE FUNCTION shade_monitor_event_detail(p_flashscore_id text)
RETURNS TABLE(
  market_canonical_key text,
  canonical_outcome_key text,
  kambi_odds numeric,
  kambi_active boolean,
  kambi_suspended boolean,
  twobet_odds numeric,
  twobet_active boolean,
  twobet_suspended boolean,
  betfair_odds numeric,
  betfair_active boolean,
  betfair_suspended boolean,
  manual_odds numeric,
  manual_suspended boolean,
  canonical_verified boolean,
  displayed_odds numeric,
  n_sources int,
  min_source text
)
LANGUAGE sql STABLE AS $$
  SELECT v.market_canonical_key,
         v.canonical_outcome_key,
         v.kambi_odds, v.kambi_active, v.kambi_suspended,
         v.twobet_odds, v.twobet_active, v.twobet_suspended,
         v.betfair_odds, v.betfair_active, v.betfair_suspended,
         v.manual_odds, v.manual_suspended,
         v.canonical_verified,
         v.displayed_odds,
         (CASE WHEN v.kambi_odds   IS NOT NULL AND v.kambi_active   AND NOT v.kambi_suspended   THEN 1 ELSE 0 END
        + CASE WHEN v.twobet_odds  IS NOT NULL AND v.twobet_active  AND NOT v.twobet_suspended  THEN 1 ELSE 0 END
        + CASE WHEN v.betfair_odds IS NOT NULL AND v.betfair_active AND NOT v.betfair_suspended THEN 1 ELSE 0 END)::int AS n_sources,
         (SELECT src FROM (
            VALUES
              ('kambi',   CASE WHEN v.kambi_active   AND NOT v.kambi_suspended   THEN v.kambi_odds   END),
              ('22bet',   CASE WHEN v.twobet_active  AND NOT v.twobet_suspended  THEN v.twobet_odds  END),
              ('betfair', CASE WHEN v.betfair_active AND NOT v.betfair_suspended THEN v.betfair_odds END)
          ) t(src, o)
          WHERE o IS NOT NULL
          ORDER BY o ASC
          LIMIT 1) AS min_source
  FROM v_outcomes_displayed v
  WHERE v.flashscore_id = p_flashscore_id
  ORDER BY v.market_canonical_key, v.canonical_outcome_key;
$$;

GRANT EXECUTE ON FUNCTION shade_monitor_sports()                     TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION shade_monitor_events(text, int)            TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION shade_monitor_event_detail(text)           TO service_role, authenticated;

COMMIT;
