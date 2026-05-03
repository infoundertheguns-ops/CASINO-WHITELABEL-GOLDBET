-- Migration 170: v_player_markets — max-outcomes pickup with priority tiebreaker.
--
-- Problem: previous pickup rule selected ONE bookmaker per (event, market_name, line)
-- via _bookmaker_priority alone. When the top-priority bookmaker emitted a SUBSET
-- of outcomes (e.g. rugby ML on Bet365: home/away only, no draw), the missing
-- outcomes disappeared from the listing/event page even though other bookmakers
-- (Pamestoixima for rugby) emitted them.
--
-- New rule: pick the bookmaker with the MAX number of active outcomes per
-- (event, market_name, line). Use _bookmaker_priority ASC as a tiebreaker, then
-- bookmaker name ASC for full determinism (avoids non-deterministic ordering for
-- multiple unknown bookmakers tied at priority 99).
--
-- Audit (2026-05-03 ~09:32 UTC): 4179/566693 markets (0.74%) change pickup,
-- 100% of changes ALSO gain outcomes. avg_outcomes_gained = 1.01.
-- See spec docs/superpowers/specs/2026-05-03-bookmaker-priority-design.md.

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
  'Plan D Fase 1 — pickup: max active_count, then _bookmaker_priority, then bookmaker ASC (mig 170).';

-- v_player_outcomes — re-create body verbatim from prod pg_get_viewdef
-- (saved by Task 1 to /c/Users/philp/v_player_outcomes-current.sql, mig 160b shape).
-- No logic change in mig 170; the CASCADE drop above forced re-creation.

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
     LEFT JOIN LATERAL ( SELECT oddsapi_translations.translated
           FROM oddsapi_translations
          WHERE oddsapi_translations.kind = 'outcome'::text AND oddsapi_translations.source_key = lower(o2.outcome_key) AND (oddsapi_translations.parent_market = m2.market_name OR oddsapi_translations.parent_market = ''::text)
          ORDER BY (oddsapi_translations.parent_market <> ''::text) DESC
         LIMIT 1) t ON true
     LEFT JOIN manual_overrides o ON o.scope = 'outcome'::text AND o.outcome_id_v2 = o2.id AND (o.expires_at IS NULL OR o.expires_at > now());

COMMENT ON VIEW v_player_outcomes IS
  'Plan D Fase 1 — outcome view (re-created from mig 160b body, no logic change in mig 170).';

INSERT INTO _migrations (name, applied_at, notes)
VALUES ('170_v_player_markets_max_outcomes', now(), 'Pickup: max active_count, then priority, then bookmaker ASC')
ON CONFLICT (name) DO NOTHING;
