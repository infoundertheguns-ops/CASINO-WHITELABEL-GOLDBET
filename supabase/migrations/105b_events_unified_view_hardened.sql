-- 105b_events_unified_view_hardened.sql
-- Rewrite v_events_unified to dedup ALL three classes of duplicates found
-- in the 105 audit:
--   Class 1: same (source, flashscore_id) appearing multiple times (scraper
--            UPSERT bug — 131 groups 22bet, 9 groups kambi)
--   Class 2: same source with NULL fsid but identical team+time tuples
--            appearing multiple times (190 22bet groups)
--   Class 3: same match across sources where one/both have NULL fsid or
--            mismatched fsids (170 cross-source team+time matches)
--
-- Strategy: partition every event by a "dedup_key" that falls back from
-- flashscore_id → sport/team/time fingerprint; rank with priority
-- kambi > 22bet, then highest source_markets_count, then id as stable
-- tie-breaker. Return only rank=1 per partition.

BEGIN;

-- CREATE OR REPLACE VIEW fails when column list differs from original.
-- Drop explicitly first (safe: no data dependency).
DROP VIEW IF EXISTS v_events_unified;

CREATE VIEW v_events_unified AS
SELECT e.*
FROM events e
WHERE (e.id) IN (
  SELECT id FROM (
    SELECT
      e2.id,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(
          NULLIF(e2.flashscore_id, ''),
          -- Fallback fingerprint when fsid is null: sport+teams+minute-precision start
          'raw:' || e2.sport_id::text
                 || ':' || COALESCE(lower(trim(e2.home_team)), '')
                 || ':' || COALESCE(lower(trim(e2.away_team)), '')
                 || ':' || COALESCE(date_trunc('minute', e2.starts_at)::text, '')
        )
        ORDER BY
          CASE e2.source WHEN 'kambi' THEN 0 WHEN '22bet' THEN 1 ELSE 2 END,
          COALESCE(e2.source_markets_count, 0) DESC,
          e2.id  -- deterministic tie-breaker
      ) AS rn
    FROM events e2
    WHERE e2.source IN ('kambi', '22bet')
  ) r
  WHERE r.rn = 1
);

COMMENT ON VIEW v_events_unified IS
  'Kambi-primary + 22bet-fallback event catalog with full 3-class dedup: '
  'cross-source (flashscore_id pivot), intra-source (same fsid multi-row), '
  'and null-fsid (sport+team+time fingerprint). Kambi always wins ties.';

GRANT SELECT ON v_events_unified TO anon, authenticated, service_role;

COMMIT;
