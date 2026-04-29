-- Replace views with materialized views (refresh hourly via cron).
-- Plain view times out on large market tables at statement-timeout.

DROP VIEW IF EXISTS v_twobet_sport_catalog_summary;
DROP VIEW IF EXISTS v_twobet_group_sports;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_twobet_group_sports AS
SELECT DISTINCT
  s.id      AS sport_id,
  s.slug    AS sport_slug,
  s.name    AS sport_name,
  g.twobet_g,
  g.name_it
FROM events e
JOIN sports s ON s.id = e.sport_id
JOIN markets m ON m.event_id = e.id AND m.is_active = true
JOIN twobet_market_groups g ON split_part(m.market_type, ' (', 1) = g.name_it
WHERE e.source = '22bet';

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_twobet_group_sports_uniq
  ON mv_twobet_group_sports (sport_id, twobet_g);

CREATE INDEX IF NOT EXISTS idx_mv_twobet_group_sports_sport
  ON mv_twobet_group_sports (sport_slug);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_twobet_sport_catalog_summary AS
SELECT
  sport_id,
  sport_slug,
  sport_name,
  count(DISTINCT twobet_g) AS groups_used
FROM mv_twobet_group_sports
GROUP BY sport_id, sport_slug, sport_name
ORDER BY groups_used DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_twobet_sport_summary_uniq
  ON mv_twobet_sport_catalog_summary (sport_id);

-- Helper to refresh both (call concurrently when possible).
CREATE OR REPLACE FUNCTION refresh_twobet_catalog_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_twobet_group_sports;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_twobet_sport_catalog_summary;
END;
$$;
