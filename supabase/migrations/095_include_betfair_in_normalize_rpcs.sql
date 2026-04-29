-- 095_include_betfair_in_normalize_rpcs.sql
-- Bug fix companion to mig 094: normalization RPCs hard-coded
-- `source IN ('kambi','22bet')` → betfair invisible to engine + admin UI.
-- Widened to include 'betfair'. Consensus RPCs (refresh_consensus_snapshots,
-- dismiss_consensus) deliberately NOT touched — shade uses separate
-- consensus_snapshots.betfair_* columns (mig 089) and the voting semantic is
-- outside this fix's scope.

CREATE OR REPLACE FUNCTION public.list_unmapped_market_types(p_limit integer DEFAULT 500)
RETURNS TABLE(source text, market_type text, event_count bigint, market_count bigint)
LANGUAGE sql STABLE
SET statement_timeout TO '300s'
AS $$
  SELECT e.source::text, m.market_type::text, COUNT(DISTINCT e.id), COUNT(*)
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND e.source IN ('kambi','22bet','betfair')
    AND NOT EXISTS (
      SELECT 1 FROM market_normalization mn
      WHERE mn.source = e.source
        AND mn.source_market_type = m.market_type
        AND mn.canonical_key IS NOT NULL
    )
  GROUP BY e.source, m.market_type
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.count_unmapped_market_types()
RETURNS integer
LANGUAGE sql STABLE
SET statement_timeout TO '300s'
AS $$
  SELECT COUNT(DISTINCT (e.source, m.market_type))::int
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND e.source IN ('kambi','22bet','betfair')
    AND NOT EXISTS (
      SELECT 1 FROM market_normalization mn
      WHERE mn.source = e.source
        AND mn.source_market_type = m.market_type
        AND mn.canonical_key IS NOT NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.list_markets_normalization(
  p_source_filter text DEFAULT NULL::text,
  p_min_count integer DEFAULT 1,
  p_limit integer DEFAULT 100000
)
RETURNS TABLE(source text, market_type text, event_count bigint, market_count bigint)
LANGUAGE sql SECURITY DEFINER
SET statement_timeout TO '120s'
AS $$
  SELECT e.source::text, m.market_type::text,
         count(DISTINCT e.id)  AS event_count,
         count(*)              AS market_count
  FROM markets m
  JOIN events  e ON e.id = m.event_id
  WHERE m.is_active = true
    AND e.source IN ('kambi','22bet','betfair')
    AND (p_source_filter IS NULL OR p_source_filter = '' OR e.source = p_source_filter)
  GROUP BY e.source, m.market_type
  HAVING count(*) >= p_min_count
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;
