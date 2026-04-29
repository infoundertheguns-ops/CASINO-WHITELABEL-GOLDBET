-- ══════════════════════════════════════════════════════════════════════
-- Migration 038b — Derive which sport uses which 22bet market group
--
-- The dictionary (twobet_market_groups) is sport-agnostic, but in
-- practice each sport uses only a subset. Derive the (sport, G) pairs
-- from actual scraped data: a market's market_type is either exactly
-- the group name or it prefixes the group name followed by " (<line>".
-- ══════════════════════════════════════════════════════════════════════

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
JOIN twobet_market_groups g ON
  m.market_type = g.name_it
  OR m.market_type LIKE g.name_it || ' (%'
  OR m.market_type LIKE g.name_it || ' %'
WHERE e.source = '22bet';

COMMENT ON VIEW v_twobet_group_sports IS
  'Observed (sport, 22bet G) mappings derived from 22bet-source markets. Matches on name_it prefix so it catches both raw "Risultato Esatto" and "Risultato Esatto (line)".';

-- Aggregated per sport: counts of groups and sample
CREATE OR REPLACE VIEW v_twobet_sport_catalog_summary AS
SELECT
  sport_slug,
  sport_name,
  count(DISTINCT twobet_g) AS groups_used
FROM v_twobet_group_sports
GROUP BY sport_id, sport_slug, sport_name
ORDER BY groups_used DESC;
