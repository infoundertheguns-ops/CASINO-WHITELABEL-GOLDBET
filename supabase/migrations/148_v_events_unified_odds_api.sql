-- 148_v_events_unified_odds_api.sql
-- Switch v_events_unified MV to odds-api ONLY.
--
-- Phase 1.D step 3 of the odds-api.io migration:
--   - 22bet decommissioned (Phase 1.E will purge residual events)
--   - kambi DROPPED from MV: niche sports kambi covers (esports/tabletennis/
--     boxe/MMA/freccette/motori/...) have ~0% flashscore_id coverage, so
--     automatic settlement cannot run on them. Exposing them risks
--     eternal-pending bets. Re-introduce only when a settler exists for them.
--   - odds-api becomes the ONLY source for the player MV.
--
-- Notes:
--   - kambi-scraper keeps running and inserting niche events into the legacy
--     events table (used by admin tools), they just won't appear in the MV
--     consumed by the player frontend.
--   - Function refresh_v_events_unified() keeps identical signature so the
--     existing 60s cron job keeps working without re-scheduling.
--
-- Idempotent: DROP MATERIALIZED VIEW IF EXISTS ... CASCADE.
-- Pre-flight check (2026-04-29) confirmed zero dependent views/MVs.

BEGIN;

SET statement_timeout = '600s';

DROP MATERIALIZED VIEW IF EXISTS v_events_unified CASCADE;

CREATE MATERIALIZED VIEW v_events_unified AS
SELECT e.*
FROM events e
WHERE e.id IN (
  SELECT id FROM (
    SELECT
      e2.id,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(
          NULLIF(e2.flashscore_id, ''),
          'raw:' || e2.sport_id::text
                 || ':' || COALESCE(lower(trim(e2.home_team)), '')
                 || ':' || COALESCE(lower(trim(e2.away_team)), '')
                 || ':' || COALESCE(date_trunc('minute', e2.starts_at)::text, '')
        )
        ORDER BY
          COALESCE(e2.source_markets_count, 0) DESC,
          e2.id
      ) AS rn
    FROM events e2
    WHERE e2.source = 'odds-api'
  ) r WHERE r.rn = 1
);

-- Indexes (recreated identical to mig 105c so query plans stay stable)
CREATE UNIQUE INDEX idx_v_events_unified_pk         ON v_events_unified (id);
CREATE INDEX        idx_v_events_unified_sport_status  ON v_events_unified (sport_id, status, is_live);
CREATE INDEX        idx_v_events_unified_league_status ON v_events_unified (league_id, status);
CREATE INDEX        idx_v_events_unified_starts_at     ON v_events_unified (starts_at);
CREATE INDEX        idx_v_events_unified_fsid          ON v_events_unified (flashscore_id) WHERE flashscore_id IS NOT NULL;
CREATE INDEX        idx_v_events_unified_source        ON v_events_unified (source);

-- Refresh function (signature unchanged → cron job continues to work)
CREATE OR REPLACE FUNCTION refresh_v_events_unified()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_count INT;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY v_events_unified;
  SELECT COUNT(*) INTO v_count FROM v_events_unified;
  RETURN v_count;
END;
$$;

COMMENT ON MATERIALIZED VIEW v_events_unified IS
  'odds-api-only deduplicated event catalog (2026-04-29 mig 148). '
  'kambi was dropped: niche sports kambi covers have no flashscore_id, '
  'so automatic settlement cannot run on them. Will be re-added per-sport '
  'once a settlement source is available. '
  'Refreshed by cron every 60s via refresh_v_events_unified(). '
  'Player API reads from this MV — do NOT query events directly.';

GRANT SELECT ON v_events_unified TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_v_events_unified() TO service_role;

COMMIT;
