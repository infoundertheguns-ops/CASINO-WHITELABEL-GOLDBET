-- ══════════════════════════════════════════════════════════════════════
-- Migration 039 — RPC for the market-normalization editor
--
-- Returns one row per distinct (source, market_type) pair with how many
-- events and active markets currently carry that type. Feeds the admin
-- page at /admin/market-normalization.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION list_source_market_types(
  p_source   text,
  p_min_count integer DEFAULT 1
)
RETURNS TABLE(
  market_type   text,
  event_count   bigint,
  market_count  bigint
)
LANGUAGE sql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
  SELECT
    m.market_type,
    count(DISTINCT e.id)            AS event_count,
    count(*)                        AS market_count
  FROM markets m
  JOIN events  e ON e.id = m.event_id
  WHERE m.is_active = true
    AND e.source    = p_source
    AND e.status IN ('prematch', 'live')
  GROUP BY m.market_type
  HAVING count(*) >= p_min_count
  ORDER BY count(*) DESC;
$$;

COMMENT ON FUNCTION list_source_market_types IS
  'Distinct market_type values for a scraper source, counted across active markets of current prematch/live events. Drives the normalization editor.';
