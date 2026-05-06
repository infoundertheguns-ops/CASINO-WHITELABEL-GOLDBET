-- Migration 176 — v_player_events JOIN legacy events for live score data
--
-- Context:
--   The odds-api ingester (Plan D) does NOT call the /v4/sports/{sport}/scores
--   endpoint, so events_v2.score_home / score_away / period_scores are always
--   NULL. The v2 read path (READ_FROM_V2=true) flowed those NULLs into the
--   kiosk Event, leaving the live Scoreboard with no score / no period table /
--   no clock — the live page UI looked sparse for non-football sports during
--   T9 dev smoke.
--
-- Live score data IS populated in the legacy `events` table by the kambi /
-- 22bet / Bet365 / Flashscore-scraper pipeline (~32,635 rows have non-null
-- flashscore_id). After Plan D #4 (FS-id population), events_v2.flashscore_id
-- resolves to the same Flashscore event id for ~50% of v2 events globally
-- (75% football). We can JOIN on that key to expose live data on the v2 view
-- without changing the ingester.
--
-- Behaviour:
--   - For events_v2 rows where flashscore_id resolves to a legacy events row,
--     the view exposes legacy live_data (halfScoreHome/Away, stats.clock),
--     legacy minute, legacy period, and (preferentially) legacy score_home /
--     score_away. Scoreboard renders with full table + clock + period label.
--   - For events_v2 rows without flashscore_id (or no legacy match), the view
--     returns NULL for those fields. Scoreboard renders compact only — same
--     behaviour as before this migration.
--
-- Performance:
--   LATERAL subquery with LIMIT 1, gated by flashscore_id IS NOT NULL.
--   `events.flashscore_id` is the join column; verify an index exists.
--   ORDER BY updated_at DESC NULLS LAST picks the freshest legacy row when
--   multiple events share an FS id (rare).
--
-- Scope:
--   - Drops & recreates v_player_events (CASCADE).
--   - v_player_markets and v_player_outcomes do NOT depend on v_player_events
--     (verified mig 160) so CASCADE is safe.
--   - Schema is purely additive at the SELECT level: existing columns
--     (score_home, score_away, live_data) are now COALESCE(legacy, v2);
--     two new columns are added: minute, period.
--   - Frontend (lib/queries/player-event-v2.ts) needs a follow-up commit to
--     read evRaw.minute / evRaw.period and pass them into DbEvent. Without
--     that follow-up, this migration is a no-op for the kiosk.

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
  COALESCE(elg.score_home, e2.score_home) AS score_home,
  COALESCE(elg.score_away, e2.score_away) AS score_away,
  COALESCE(elg.live_data, e2.period_scores) AS live_data,
  elg.minute   AS minute,
  elg.period   AS period,
  (e2.status = 'live') AS is_live,
  e2.flashscore_id,
  e2.urls,
  e2.updated_at,
  e2.last_settled_at
FROM events_v2 e2
LEFT JOIN LATERAL (
  SELECT score_home, score_away, live_data, minute, period
  FROM events
  WHERE events.flashscore_id = e2.flashscore_id
    AND e2.flashscore_id IS NOT NULL
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1
) elg ON true
LEFT JOIN sports s
  ON s.slug = _sport_slug_en_to_it(e2.sport_slug)
LEFT JOIN leagues l
  ON l.sport_id = s.id
 AND l.slug = e2.league_slug;

COMMENT ON VIEW v_player_events IS
  'Plan D Fase 1 — player-facing event view with live score data joined from legacy events on flashscore_id (mig 176).';

INSERT INTO _migrations (name, applied_at)
VALUES ('176_v_player_events_live_data_join', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;
