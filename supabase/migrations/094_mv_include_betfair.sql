-- 094_mv_include_betfair.sql
-- Bug fix 2026-04-23: `mv_source_market_types` filtered `source IN ('kambi','22bet')`
-- hard-coded. Betfair 3rd-source data (LIVE from mig 089 onward) was invisible
-- to the engine + coverage KPIs because of this omission.
--
-- Fix: widen filter to include 'betfair'. DROP + CREATE preserves indexes +
-- concurrent refresh later (CREATE MATERIALIZED VIEW CANNOT be altered in place).

DROP MATERIALIZED VIEW IF EXISTS mv_source_market_types CASCADE;

CREATE MATERIALIZED VIEW mv_source_market_types AS
SELECT e.source,
       m.market_type,
       count(DISTINCT e.id) AS event_count,
       count(*)             AS market_count
FROM markets m
JOIN events e ON e.id = m.event_id
WHERE m.is_active = true
  AND e.source = ANY (ARRAY['kambi'::text, '22bet'::text, 'betfair'::text])
GROUP BY e.source, m.market_type;

CREATE UNIQUE INDEX idx_mv_smt_pk     ON mv_source_market_types (source, market_type);
CREATE INDEX        idx_mv_smt_count  ON mv_source_market_types (market_count DESC);
CREATE INDEX        idx_mv_smt_source ON mv_source_market_types (source);

-- REFRESH synchronously so engine sees betfair types immediately after migration.
REFRESH MATERIALIZED VIEW mv_source_market_types;
