-- 105c_events_unified_mv.sql
-- 105b's ROW_NUMBER view was too slow for production traffic (statement
-- timeout). Rewrite as MATERIALIZED VIEW with cron refresh — query cost
-- goes from O(N log N) per-call to near-zero, refresh cost amortized.
--
-- Trade-off: data can be up to REFRESH_INTERVAL stale. For refresh every
-- 60s this is acceptable (events don't churn faster than that at list
-- level; individual markets/odds are fetched separately and in real-time).

BEGIN;

SET statement_timeout = '600s';

-- Replace the view with a materialized view (same name for drop-in compat).
-- Drop the view first (it's fine, no dependents).
DROP VIEW IF EXISTS v_events_unified;

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
          CASE e2.source WHEN 'kambi' THEN 0 WHEN '22bet' THEN 1 ELSE 2 END,
          COALESCE(e2.source_markets_count, 0) DESC,
          e2.id
      ) AS rn
    FROM events e2
    WHERE e2.source IN ('kambi', '22bet')
  ) r WHERE r.rn = 1
);

-- Indexes for common player queries (sport filter, league, status, starts_at range)
CREATE UNIQUE INDEX idx_v_events_unified_pk ON v_events_unified (id);
CREATE INDEX idx_v_events_unified_sport_status ON v_events_unified (sport_id, status, is_live);
CREATE INDEX idx_v_events_unified_league_status ON v_events_unified (league_id, status);
CREATE INDEX idx_v_events_unified_starts_at ON v_events_unified (starts_at);
CREATE INDEX idx_v_events_unified_fsid ON v_events_unified (flashscore_id) WHERE flashscore_id IS NOT NULL;
CREATE INDEX idx_v_events_unified_source ON v_events_unified (source);

-- Refresh RPC: callable by cron every 60s
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
  'Kambi-primary + 22bet-fallback deduplicated event catalog. '
  'Refreshed by cron every 60s via refresh_v_events_unified(). '
  'Player API reads from this MV — do NOT query events directly.';

GRANT SELECT ON v_events_unified TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_v_events_unified() TO service_role;

COMMIT;
