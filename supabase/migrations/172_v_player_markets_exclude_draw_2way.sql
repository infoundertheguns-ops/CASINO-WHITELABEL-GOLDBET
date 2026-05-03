-- Migration 172: v_player_markets — exclude 'draw' outcome from ML pickup
-- for sports where ML is conceptually 2-way (T/T).
--
-- Problem (mig 170 regression): post-mig-170, basket/baseball/mma now show
-- 'draw' outcome in pickup for ML markets where some bookmakers emit a
-- "tie at end of regulation" exotic outcome (557/812 basketball events,
-- 86/611 baseball, 13/49 mma). These sports are conceptually 2-way; the
-- draw is a bookmaker-specific exotic that should NOT appear in T/T listing.
--
-- Convention from mig 171:
--   3-way (1X2):  football, calcio, rugby, american-football(*)
--   2-way (T/T):  tennis, basketball, baseball, ice-hockey, hockey-ghiaccio,
--                 volleyball, darts, cricket, mma, boxing, snooker, esports,
--                 handball, pallamano
-- (*) american-football has tie possible but rare; treated as 2-way per
--     user taxonomy.
--
-- This migration adds a per-sport filter at the active_counts CTE level:
-- for ML market in 2-way sports, outcome_key='draw' rows are excluded
-- before the COUNT and DISTINCT ON pickup. Bookmakers offering ML 2-way
-- naturally win the pickup tie (vs bookmakers offering 3 outcomes including
-- the spurious draw).
--
-- Sports with separate 3-Way Result market (basket/baseball/handball) keep
-- their draw via that distinct market_name (mapped to "1X2" in mig 171).

DROP VIEW IF EXISTS v_player_outcomes CASCADE;
DROP VIEW IF EXISTS v_player_markets CASCADE;

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
  WITH per_market AS (
    SELECT m2.id,
           m2.market_name,
           m2.bookmaker,
           o2.line,
           classify_market_pattern(m2.market_name) AS category,
           COUNT(*) OVER (PARTITION BY m2.market_name, o2.line, m2.bookmaker) AS active_count
    FROM markets_v2 m2
    JOIN outcomes_v2 o2
      ON o2.market_id = m2.id
     AND o2.is_active = true
     AND round(o2.odds, 2) > 1.00
     -- mig 172: exclude spurious 'draw' outcomes from ML pickup for 2-way sports.
     -- For these sports, ML is conceptually T/T (home/away only); some bookmakers
     -- offer a "tie at regulation" exotic that we hide. The 3-Way Result market
     -- (where present) carries the draw outcome separately.
     AND NOT (
       m2.market_name = 'ML'
       AND lower(o2.outcome_key) = 'draw'
       AND e2.sport_slug IN (
         'tennis','basketball','baseball','ice-hockey','hockey-ghiaccio',
         'volleyball','darts','cricket','mma','boxing','american-football',
         'snooker','esports','handball','pallamano'
       )
     )
    WHERE m2.event_id = e2.id
  )
  SELECT DISTINCT ON (market_name, line)
    id, market_name, bookmaker, line, category
  FROM per_market
  ORDER BY market_name, line,
           active_count DESC,
           _bookmaker_priority(bookmaker) ASC,
           bookmaker ASC
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
WHERE best.category <> 'special'
  AND NOT (best.category IN ('stats','player') AND e2.flashscore_id IS NULL);

COMMENT ON VIEW v_player_markets IS
  'Plan D Fase 1 — pickup: max active_count, then _bookmaker_priority, then bookmaker ASC. mig 172 excludes spurious draw from ML pickup for 2-way sports.';

-- Re-create v_player_outcomes (verbatim from mig 160b body, unchanged).
-- mig 172 also filters draw outcomes for 2-way sports' ML at outcome view level
-- to prevent event-page detail from displaying the draw outcome that the
-- pickup hid. Bookmaker selected via v_player_markets only emits home/away
-- outcomes anyway, but defensive.

CREATE VIEW v_player_outcomes AS
 SELECT o2.id,
    o2.market_id,
    o2.outcome_key AS source_outcome_key,
    COALESCE(t.translated, _oddsapi_translate_outcome(o2.outcome_key, m2.market_name)) AS name,
    COALESCE(o.manual_odds, round(o2.odds, 2)) AS odds,
    o2.odds AS raw_odds,
    o2.line,
    o2.line_norm,
    COALESCE(o.manual_odds, NULL::numeric) AS manual_odds,
    COALESCE(o.manual_suspended, false) AS manual_suspended,
    o2.is_suspended OR COALESCE(o.is_suspended, false) AS is_suspended,
    o2.is_active,
    o.expires_at AS override_expires_at,
    o2.updated_at
   FROM outcomes_v2 o2
     JOIN markets_v2 m2 ON m2.id = o2.market_id
     LEFT JOIN events_v2 e2v ON e2v.id = m2.event_id
     LEFT JOIN LATERAL ( SELECT oddsapi_translations.translated
           FROM oddsapi_translations
          WHERE oddsapi_translations.kind = 'outcome'::text AND oddsapi_translations.source_key = lower(o2.outcome_key) AND (oddsapi_translations.parent_market = m2.market_name OR oddsapi_translations.parent_market = ''::text)
          ORDER BY (oddsapi_translations.parent_market <> ''::text) DESC
         LIMIT 1) t ON true
     LEFT JOIN manual_overrides o ON o.scope = 'outcome'::text AND o.outcome_id_v2 = o2.id AND (o.expires_at IS NULL OR o.expires_at > now())
  WHERE NOT (
    m2.market_name = 'ML'
    AND lower(o2.outcome_key) = 'draw'
    AND e2v.sport_slug IN (
      'tennis','basketball','baseball','ice-hockey','hockey-ghiaccio',
      'volleyball','darts','cricket','mma','boxing','american-football',
      'snooker','esports','handball','pallamano'
    )
  );

COMMENT ON VIEW v_player_outcomes IS
  'Plan D Fase 1 — outcome view (mig 172 mirrors mig 172 ML draw filter for 2-way sports).';

INSERT INTO _migrations (name, applied_at, notes)
VALUES ('172_v_player_markets_exclude_draw_2way', now(), 'Exclude spurious draw outcomes from ML pickup for 2-way sports (basket/baseball/mma/handball/etc).')
ON CONFLICT (name) DO NOTHING;
