-- Optimize v_twobet_group_sports: join on exact base name (strip " (line)").
DROP VIEW IF EXISTS v_twobet_sport_catalog_summary;
DROP VIEW IF EXISTS v_twobet_group_sports;

CREATE OR REPLACE VIEW v_twobet_group_sports AS
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

CREATE OR REPLACE VIEW v_twobet_sport_catalog_summary AS
SELECT
  sport_slug,
  sport_name,
  count(DISTINCT twobet_g) AS groups_used
FROM v_twobet_group_sports
GROUP BY sport_id, sport_slug, sport_name
ORDER BY groups_used DESC;

-- Functional index on stripped market_type for the join
CREATE INDEX IF NOT EXISTS idx_markets_type_base
  ON markets ((split_part(market_type, ' (', 1)))
  WHERE is_active = true;
