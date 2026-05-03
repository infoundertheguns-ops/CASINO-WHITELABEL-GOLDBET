-- Migration 170 ROLLBACK — restores v_player_markets and v_player_outcomes
-- to pre-mig-170 definitions captured from prod 2026-05-03 ~09:29 UTC.
-- Apply only if mig 170 needs to be reverted.
--
-- Source: pg_get_viewdef('v_player_markets'::regclass, true)
--         pg_get_viewdef('v_player_outcomes'::regclass, true)
-- Captured by Task 1 of plan 2026-05-03-bookmaker-priority.md.

DROP VIEW IF EXISTS v_player_outcomes CASCADE;
DROP VIEW IF EXISTS v_player_markets CASCADE;

CREATE VIEW v_player_markets AS
 SELECT best.id,
    e2.id AS event_id,
    best.bookmaker,
    best.market_name AS source_market_name,
    COALESCE(t.translated, _oddsapi_translate_market(best.market_name, e2.sport_slug)) AS market_type,
    best.line,
    best.category,
    COALESCE(o.is_suspended, false) AS is_suspended,
    o.expires_at AS suspension_expires_at,
    e2.sport_slug,
    e2.flashscore_id
   FROM events_v2 e2
     JOIN LATERAL ( SELECT DISTINCT ON (m2.market_name, o2.line) m2.id,
            m2.market_name,
            m2.bookmaker,
            o2.line,
            classify_market_pattern(m2.market_name) AS category
           FROM markets_v2 m2
             JOIN outcomes_v2 o2 ON o2.market_id = m2.id AND o2.is_active = true AND round(o2.odds, 2) > 1.00
          WHERE m2.event_id = e2.id
          ORDER BY m2.market_name, o2.line, (_bookmaker_priority(m2.bookmaker))) best ON true
     LEFT JOIN LATERAL ( SELECT oddsapi_translations.translated
           FROM oddsapi_translations
          WHERE oddsapi_translations.kind = 'market'::text AND oddsapi_translations.source_key = best.market_name AND (oddsapi_translations.sport_slug = e2.sport_slug OR oddsapi_translations.sport_slug = ''::text)
          ORDER BY (oddsapi_translations.sport_slug <> ''::text) DESC
         LIMIT 1) t ON true
     LEFT JOIN manual_overrides o ON o.scope = 'market'::text AND o.market_id_v2 = best.id AND (o.expires_at IS NULL OR o.expires_at > now())
  WHERE best.category <> 'special'::text AND NOT ((best.category = ANY (ARRAY['stats'::text, 'player'::text])) AND e2.flashscore_id IS NULL);

COMMENT ON VIEW v_player_markets IS 'Restored to pre-mig-170 definition (priority-only pickup, mig 160b body).';

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

COMMENT ON VIEW v_player_outcomes IS 'Restored to pre-mig-170 definition (mig 160b body).';
