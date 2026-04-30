-- Migration 160b — restructure v_player_markets/v_player_outcomes to use LATERAL
-- Goal: enable event_id filter pushdown so listing queries don't materialize full markets_v2.
-- Replaces views from mig 160 (functionally equivalent SELECT shape, different execution plan).

DROP VIEW IF EXISTS v_player_outcomes CASCADE;
DROP VIEW IF EXISTS v_player_markets CASCADE;

-- ============================================================
-- View 2 (rewrite): v_player_markets — event-anchored LATERAL
-- ============================================================
CREATE VIEW v_player_markets AS
SELECT
  best.id            AS id,
  e2.id              AS event_id,
  best.bookmaker,
  best.market_name   AS source_market_name,
  COALESCE(t.translated, _oddsapi_translate_market(best.market_name, e2.sport_slug)) AS market_type,
  best.line,
  best.category,
  COALESCE(o.is_suspended, false) AS is_suspended,
  o.expires_at AS suspension_expires_at,
  e2.sport_slug,
  e2.flashscore_id
FROM events_v2 e2
JOIN LATERAL (
  -- For each event, pick best bookmaker per market_name with active priced outcomes
  SELECT DISTINCT ON (m2.market_name, o2.line)
    m2.id, m2.market_name, m2.bookmaker, o2.line,
    classify_market_pattern(m2.market_name) AS category
  FROM markets_v2 m2
  JOIN outcomes_v2 o2
    ON o2.market_id = m2.id
   AND o2.is_active = true
   AND round(o2.odds, 2) > 1.00
  WHERE m2.event_id = e2.id
  ORDER BY m2.market_name, o2.line, _bookmaker_priority(m2.bookmaker)
) best ON true
LEFT JOIN LATERAL (
  SELECT translated FROM oddsapi_translations
  WHERE kind = 'market'
    AND source_key = best.market_name
    AND (sport_slug = e2.sport_slug OR sport_slug = '')
  ORDER BY (sport_slug <> '') DESC
  LIMIT 1
) t ON true
LEFT JOIN manual_overrides o
  ON o.scope = 'market'
 AND o.market_id_v2 = best.id
 AND (o.expires_at IS NULL OR o.expires_at > now())
-- Plan D Phase 1.5 filter
WHERE best.category <> 'special'
  AND NOT (best.category IN ('stats','player') AND e2.flashscore_id IS NULL);

COMMENT ON VIEW v_player_markets IS
  'Plan D Fase 1 — event-anchored LATERAL: per-event DISTINCT ON enables event_id filter pushdown.';

-- ============================================================
-- View 3 (re-create unchanged from mig 160)
-- ============================================================
CREATE VIEW v_player_outcomes AS
SELECT
  o2.id,
  o2.market_id,
  o2.outcome_key AS source_outcome_key,
  COALESCE(t.translated, _oddsapi_translate_outcome(o2.outcome_key, m2.market_name)) AS name,
  COALESCE(o.manual_odds, round(o2.odds, 2)) AS odds,
  o2.odds AS raw_odds,
  o2.line,
  o2.line_norm,
  COALESCE(o.manual_odds, NULL) AS manual_odds,
  COALESCE(o.manual_suspended, false) AS manual_suspended,
  (o2.is_suspended OR COALESCE(o.is_suspended, false)) AS is_suspended,
  o2.is_active,
  o.expires_at AS override_expires_at,
  o2.updated_at
FROM outcomes_v2 o2
JOIN markets_v2 m2 ON m2.id = o2.market_id
LEFT JOIN LATERAL (
  SELECT translated FROM oddsapi_translations
  WHERE kind = 'outcome'
    AND source_key = lower(o2.outcome_key)
    AND (parent_market = m2.market_name OR parent_market = '')
  ORDER BY (parent_market <> '') DESC
  LIMIT 1
) t ON true
LEFT JOIN manual_overrides o
  ON o.scope = 'outcome'
 AND o.outcome_id_v2 = o2.id
 AND (o.expires_at IS NULL OR o.expires_at > now());

COMMENT ON VIEW v_player_outcomes IS
  'Plan D Fase 1 — outcome view with translation + manual_overrides (mig 160b restructure).';

INSERT INTO _migrations (name, applied_at, notes)
VALUES ('160b_player_views_lateral', now(), 'Restructure v_player_markets to event-anchored LATERAL for filter pushdown')
ON CONFLICT (name) DO NOTHING;
