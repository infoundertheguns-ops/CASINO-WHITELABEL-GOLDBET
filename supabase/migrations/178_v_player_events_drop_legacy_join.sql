-- Migration 178 — v_player_events drop legacy events JOIN
--
-- Context:
--   Mig 176 introduced a LATERAL JOIN against legacy `events` to surface
--   live data (score / period / live_data) on v_player_events. Post FS
--   matcher repoint to events_v2 (T10), the same fields are now populated
--   directly on events_v2.{period, minute, live_data, score_home, score_away}.
--   Legacy `events` has been frozen since 2026-04-28 and is read-only
--   pending S7 cleanup. The LATERAL JOIN is now dead weight.
--
-- Behaviour:
--   - score_home / score_away: read directly from e2 (no COALESCE)
--   - live_data: COALESCE(e2.live_data, e2.period_scores) — period_scores
--     is the settlement-only payload; live_data is the running live state.
--     Falling through to period_scores keeps a graceful display for the
--     few-seconds window between live and settled.
--   - minute / period: read directly from e2
--
-- Performance:
--   Drops one LATERAL subquery per row → fewer plan nodes, faster cold path.
--
-- Rollback:
--   Re-apply mig 176 (file kept in repo).

BEGIN;

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
  COALESCE(e2.live_data, e2.period_scores) AS live_data,
  e2.minute,
  e2.period,
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
  'Plan D Fase 1 — player-facing event view, reads live data directly from events_v2 (mig 178, replaces mig 176).';

INSERT INTO _migrations (name, applied_at)
VALUES ('178_v_player_events_drop_legacy_join', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;
