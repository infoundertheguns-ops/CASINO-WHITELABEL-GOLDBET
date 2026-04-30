-- Migration 160 — v_player_events / v_player_markets / v_player_outcomes (Plan D / Elimina-derive Fase 1)
-- Player-facing read views over events_v2/markets_v2/outcomes_v2.
-- Apply translations via oddsapi_translations table (mig 159) with function fallback.
-- Apply Plan D Phase 1.5 filter: exclude special; exclude stats/player on no-FS events.
-- Apply manual_overrides for market suspension and outcome manual odds.
--
-- READ-ONLY views — no writes. Player API/UI will be migrated to read from these in Fase 2.

-- ============================================================
-- View 1: v_player_events
-- Drops legacy v_player_events from mig 141 (verified: zero code refs, zero pg deps)
-- ============================================================
DROP VIEW IF EXISTS v_player_events CASCADE;
CREATE VIEW v_player_events AS
SELECT
  e2.id,
  e2.odds_api_id,
  s.id              AS sport_id,
  s.slug            AS sport_slug,
  s.name            AS sport_name,
  s.icon            AS sport_icon,
  s.sort_order      AS sport_sort_order,
  l.id              AS league_id,
  l.slug            AS league_slug,
  l.name            AS league_name,
  l.country         AS league_country,
  l.logo_url        AS league_logo_url,
  l.sort_order      AS league_sort_order,
  e2.home           AS home_team,
  e2.away           AS away_team,
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
  END AS status,
  e2.score_home,
  e2.score_away,
  e2.period_scores  AS live_data,
  (e2.status = 'live') AS is_live,
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
  'Plan D Fase 1 — player-facing event view over events_v2 with sport/league joins and status mapping.';

-- ============================================================
-- View 2: v_player_markets
-- - DISTINCT ON (event_id, market_name) picks best bookmaker via _bookmaker_priority
-- - Filters markets without active outcomes (round(odds,2) > 1.00)
-- - Translates via oddsapi_translations (LATERAL) with function fallback
-- - Plan D Phase 1.5: excludes special; excludes stats/player on no-FS events
-- - Applies manual_overrides for is_suspended
-- ============================================================
DROP VIEW IF EXISTS v_player_markets CASCADE;
CREATE VIEW v_player_markets AS
WITH chosen AS (
  -- best bookmaker per (event, market_name)
  SELECT DISTINCT ON (m2.event_id, m2.market_name)
    m2.id, m2.event_id, m2.market_name, m2.bookmaker
  FROM markets_v2 m2
  ORDER BY m2.event_id, m2.market_name, _bookmaker_priority(m2.bookmaker)
),
active_lined AS (
  -- expand by line; only markets with at least one active priced outcome
  SELECT DISTINCT
    c.id          AS market_id_v2,
    c.event_id,
    c.market_name,
    c.bookmaker,
    o2.line,
    e2.sport_slug,
    e2.flashscore_id
  FROM chosen c
  JOIN outcomes_v2 o2
    ON o2.market_id = c.id
   AND o2.is_active = true
  JOIN events_v2 e2
    ON e2.id = c.event_id
  WHERE round(o2.odds, 2) > 1.00
),
classified AS (
  SELECT
    al.*,
    classify_market_pattern(al.market_name) AS category
  FROM active_lined al
)
SELECT
  c.market_id_v2 AS id,
  c.event_id,
  c.bookmaker,
  c.market_name AS source_market_name,
  COALESCE(t.translated, _oddsapi_translate_market(c.market_name, c.sport_slug)) AS market_type,
  c.line,
  c.category,
  COALESCE(o.is_suspended, false) AS is_suspended,
  o.expires_at AS suspension_expires_at,
  c.sport_slug,
  c.flashscore_id
FROM classified c
LEFT JOIN LATERAL (
  SELECT translated
  FROM oddsapi_translations
  WHERE kind = 'market'
    AND source_key = c.market_name
    AND (sport_slug = c.sport_slug OR sport_slug = '')
  ORDER BY (sport_slug <> '') DESC
  LIMIT 1
) t ON true
LEFT JOIN manual_overrides o
  ON o.scope = 'market'
 AND o.market_id_v2 = c.market_id_v2
 AND (o.expires_at IS NULL OR o.expires_at > now())
-- Plan D Phase 1.5 filter (mirror mig 156 derive logic)
WHERE c.category <> 'special'
  AND NOT (c.category IN ('stats','player') AND c.flashscore_id IS NULL);

COMMENT ON VIEW v_player_markets IS
  'Plan D Fase 1 — player-facing market view: best-bookmaker pick, translation, Phase 1.5 filter (no special, no stats/player on no-FS), manual_overrides.';

-- ============================================================
-- View 3: v_player_outcomes
-- - One row per outcome of selected best-bookmaker market
-- - Translation via table (LATERAL with parent_market context) + function fallback
-- - Manual override applied: manual_odds, manual_suspended, is_suspended
-- ============================================================
DROP VIEW IF EXISTS v_player_outcomes CASCADE;
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
JOIN markets_v2 m2
  ON m2.id = o2.market_id
LEFT JOIN LATERAL (
  SELECT translated
  FROM oddsapi_translations
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
  'Plan D Fase 1 — player-facing outcome view with translation, manual_overrides (manual_odds/suspended).';

-- Track migration
INSERT INTO _migrations (name, applied_at)
VALUES ('160_player_views', now())
ON CONFLICT (name) DO NOTHING;
