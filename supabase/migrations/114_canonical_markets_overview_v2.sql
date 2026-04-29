-- Migration 114: get_canonical_markets_overview() v2 — adds outcome_count.
--
-- Background: review #1bis (2026-04-25) discovered that the v1 RPC (mig 111)
-- only counted market_normalization references. This caused 3 real bugs:
--   1. KPI "Orphans" mis-classified canonicals that had outcome_normalization
--      refs but no market_normalization refs.
--   2. Modal `canDelete = mapped_count === 0` allowed deleting a canonical
--      while outcome_normalization rows still pointed at it → orphaned outcomes.
--   3. Drill `↗` only routed to market-normalization, never to outcome-norm.
--
-- v2 adds outcome_count from outcome_normalization. The page splits the
-- mapped column into two drill links (markets, outcomes) and the DELETE
-- endpoint blocks if either count > 0.

-- Return type changed (added outcome_count) → must DROP before CREATE.
DROP FUNCTION IF EXISTS get_canonical_markets_overview();

CREATE OR REPLACE FUNCTION get_canonical_markets_overview()
RETURNS TABLE (
  canonical_key     text,
  base_key          text,
  period            text,
  canonical_name_it text,
  has_line          boolean,
  outcomes          jsonb,
  notes             text,
  created_at        timestamptz,
  updated_at        timestamptz,
  mapped_count      bigint,
  outcome_count     bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    cm.canonical_key,
    cm.base_key,
    cm.period,
    cm.canonical_name_it,
    cm.has_line,
    cm.outcomes,
    cm.notes,
    cm.created_at,
    cm.updated_at,
    COALESCE(mn.cnt, 0)::bigint AS mapped_count,
    COALESCE(on_.cnt, 0)::bigint AS outcome_count
  FROM canonical_markets cm
  LEFT JOIN (
    SELECT canonical_key, COUNT(*)::bigint AS cnt
    FROM market_normalization
    WHERE canonical_key IS NOT NULL
    GROUP BY canonical_key
  ) mn ON mn.canonical_key = cm.canonical_key
  LEFT JOIN (
    SELECT canonical_key, COUNT(*)::bigint AS cnt
    FROM outcome_normalization
    WHERE canonical_key IS NOT NULL
    GROUP BY canonical_key
  ) on_ ON on_.canonical_key = cm.canonical_key
  ORDER BY cm.base_key, cm.period;
$$;

GRANT EXECUTE ON FUNCTION get_canonical_markets_overview() TO authenticated, service_role, anon;
