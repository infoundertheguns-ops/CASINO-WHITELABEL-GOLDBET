-- 044_list_source_market_types_widen.sql
-- Widen list_source_market_types: remove event.status filter.
-- Reason: the market-normalization UI catalogs market_type STRINGS across the whole source,
-- regardless of whether events are live/prematch/ended. On staging, replicated events may
-- all be 'ended' due to slow replication, making the UI appear empty.
-- market_type vocabulary doesn't change with event lifecycle, so the filter was too strict.

CREATE OR REPLACE FUNCTION public.list_source_market_types(p_source text, p_min_count integer DEFAULT 1)
RETURNS TABLE(market_type text, event_count bigint, market_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET statement_timeout TO '120s'
AS $function$
  SELECT
    m.market_type,
    count(DISTINCT e.id) AS event_count,
    count(*)             AS market_count
  FROM markets m
  JOIN events  e ON e.id = m.event_id
  WHERE m.is_active = true
    AND e.source    = p_source
  GROUP BY m.market_type
  HAVING count(*) >= p_min_count
  ORDER BY count(*) DESC;
$function$;
