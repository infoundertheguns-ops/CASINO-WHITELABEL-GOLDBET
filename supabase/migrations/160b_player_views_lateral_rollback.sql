-- Rollback for migration 160b — restore CTE-based views from mig 160
-- (Note: mig 160 + 160b together are conceptually one migration; 160b is a perf refinement)

DROP VIEW IF EXISTS v_player_outcomes CASCADE;
DROP VIEW IF EXISTS v_player_markets CASCADE;

-- Restore mig 160 v_player_markets (CTE-based, slower for listing)
CREATE VIEW v_player_markets AS
WITH chosen AS (
  SELECT DISTINCT ON (m2.event_id, m2.market_name)
    m2.id, m2.event_id, m2.market_name, m2.bookmaker
  FROM markets_v2 m2
  ORDER BY m2.event_id, m2.market_name, _bookmaker_priority(m2.bookmaker)
),
active_lined AS (
  SELECT DISTINCT
    c.id AS market_id_v2, c.event_id, c.market_name, c.bookmaker,
    o2.line, e2.sport_slug, e2.flashscore_id
  FROM chosen c
  JOIN outcomes_v2 o2 ON o2.market_id = c.id AND o2.is_active = true
  JOIN events_v2 e2 ON e2.id = c.event_id
  WHERE round(o2.odds, 2) > 1.00
),
classified AS (
  SELECT al.*, classify_market_pattern(al.market_name) AS category FROM active_lined al
)
SELECT
  c.market_id_v2 AS id, c.event_id, c.bookmaker,
  c.market_name AS source_market_name,
  COALESCE(t.translated, _oddsapi_translate_market(c.market_name, c.sport_slug)) AS market_type,
  c.line, c.category,
  COALESCE(o.is_suspended, false) AS is_suspended,
  o.expires_at AS suspension_expires_at,
  c.sport_slug, c.flashscore_id
FROM classified c
LEFT JOIN LATERAL (
  SELECT translated FROM oddsapi_translations
  WHERE kind = 'market' AND source_key = c.market_name
    AND (sport_slug = c.sport_slug OR sport_slug = '')
  ORDER BY (sport_slug <> '') DESC LIMIT 1
) t ON true
LEFT JOIN manual_overrides o ON o.scope = 'market' AND o.market_id_v2 = c.market_id_v2
   AND (o.expires_at IS NULL OR o.expires_at > now())
WHERE c.category <> 'special'
  AND NOT (c.category IN ('stats','player') AND c.flashscore_id IS NULL);

CREATE VIEW v_player_outcomes AS
SELECT
  o2.id, o2.market_id, o2.outcome_key AS source_outcome_key,
  COALESCE(t.translated, _oddsapi_translate_outcome(o2.outcome_key, m2.market_name)) AS name,
  COALESCE(o.manual_odds, round(o2.odds, 2)) AS odds,
  o2.odds AS raw_odds, o2.line, o2.line_norm,
  COALESCE(o.manual_odds, NULL) AS manual_odds,
  COALESCE(o.manual_suspended, false) AS manual_suspended,
  (o2.is_suspended OR COALESCE(o.is_suspended, false)) AS is_suspended,
  o2.is_active, o.expires_at AS override_expires_at, o2.updated_at
FROM outcomes_v2 o2 JOIN markets_v2 m2 ON m2.id = o2.market_id
LEFT JOIN LATERAL (
  SELECT translated FROM oddsapi_translations
  WHERE kind = 'outcome' AND source_key = lower(o2.outcome_key)
    AND (parent_market = m2.market_name OR parent_market = '')
  ORDER BY (parent_market <> '') DESC LIMIT 1
) t ON true
LEFT JOIN manual_overrides o ON o.scope = 'outcome' AND o.outcome_id_v2 = o2.id
   AND (o.expires_at IS NULL OR o.expires_at > now());

DELETE FROM _migrations WHERE name = '160b_player_views_lateral';
