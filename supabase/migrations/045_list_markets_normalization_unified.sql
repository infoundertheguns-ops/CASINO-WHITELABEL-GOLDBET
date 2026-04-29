-- 045_list_markets_normalization_unified.sql
-- Unified RPC for market-normalization page: returns BOTH sources in one call,
-- with source as a column and an optional source filter. Supports p_limit override
-- (bypasses PostgREST max-rows default of 1000).

CREATE OR REPLACE FUNCTION public.list_markets_normalization(
  p_source_filter TEXT DEFAULT NULL,   -- NULL or '' → both sources; 'kambi' or '22bet' → filter
  p_min_count     INTEGER DEFAULT 1,
  p_limit         INTEGER DEFAULT 100000
)
RETURNS TABLE(
  source       TEXT,
  market_type  TEXT,
  event_count  BIGINT,
  market_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET statement_timeout TO '120s'
AS $function$
  SELECT
    e.source::text,
    m.market_type::text,
    count(DISTINCT e.id)  AS event_count,
    count(*)              AS market_count
  FROM markets m
  JOIN events  e ON e.id = m.event_id
  WHERE m.is_active = true
    AND e.source IN ('kambi','22bet')
    AND (p_source_filter IS NULL OR p_source_filter = '' OR e.source = p_source_filter)
  GROUP BY e.source, m.market_type
  HAVING count(*) >= p_min_count
  ORDER BY count(*) DESC
  LIMIT p_limit;
$function$;
