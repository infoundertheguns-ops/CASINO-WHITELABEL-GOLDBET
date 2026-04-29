-- 046_mv_source_market_types.sql
-- Materialized view + paged RPC for market-normalization page.
-- Previous approach (live aggregation over 500K+ markets) timed out at 120s.
-- MV refreshes every 10min via cron → queries become <200ms.

-- Session-wide statement timeout for this migration (MV creation can take >120s).
SET statement_timeout = '600s';

-- ═══ Materialized view ═══
DROP MATERIALIZED VIEW IF EXISTS mv_source_market_types;

CREATE MATERIALIZED VIEW mv_source_market_types AS
SELECT
  e.source::text          AS source,
  m.market_type::text     AS market_type,
  COUNT(DISTINCT e.id)    AS event_count,
  COUNT(*)                AS market_count
FROM markets m
JOIN events  e ON e.id = m.event_id
WHERE m.is_active = true
  AND e.source IN ('kambi','22bet')
GROUP BY e.source, m.market_type;

-- Required for CONCURRENT refresh
CREATE UNIQUE INDEX idx_mv_smt_pk ON mv_source_market_types(source, market_type);
-- For ORDER BY market_count DESC scans
CREATE INDEX idx_mv_smt_count ON mv_source_market_types(market_count DESC);
-- For source filter
CREATE INDEX idx_mv_smt_source ON mv_source_market_types(source);

-- ═══ Refresh RPC (callable by cron) ═══
CREATE OR REPLACE FUNCTION refresh_mv_source_market_types()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '300s'
AS $$
DECLARE
  v_count INT;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_source_market_types;
  SELECT COUNT(*) INTO v_count FROM mv_source_market_types;
  RETURN v_count;
END;
$$;

-- ═══ Paged query RPC ═══
-- Returns JSONB: { rows: [...], total_rows, total_mapped, total_verified }
-- Handles ALL filters server-side so the Next.js route doesn't over-fetch.
CREATE OR REPLACE FUNCTION list_markets_normalization_paged(
  p_source_filter   TEXT    DEFAULT NULL,
  p_q               TEXT    DEFAULT NULL,
  p_only_unmapped   BOOLEAN DEFAULT false,
  p_only_unverified BOOLEAN DEFAULT false,
  p_conf_bucket     TEXT    DEFAULT 'all',
  p_extracted_by    TEXT    DEFAULT NULL,
  p_page            INT     DEFAULT 1,
  p_per_page        INT     DEFAULT 100
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET statement_timeout TO '60s'
AS $$
  -- MATERIALIZED forces single-pass of the filtered base set.
  -- Without it, Postgres 12+ inlines the CTE and re-runs the scan 4 times (3 COUNTs + paged).
  WITH base AS MATERIALIZED (
    SELECT
      mv.source,
      mv.market_type                               AS source_market_type,
      mv.event_count,
      mv.market_count,
      mn.canonical_key,
      mn.canonical_line,
      mn.canonical_name_it,
      COALESCE(mn.verified, false)                 AS verified,
      mn.extracted_by,
      mn.confidence,
      mn.notes,
      mn.updated_at                                AS last_mapped_at
    FROM mv_source_market_types mv
    LEFT JOIN market_normalization mn
      ON mn.source = mv.source
     AND mn.source_market_type = mv.market_type
    WHERE (p_source_filter IS NULL OR p_source_filter = '' OR mv.source = p_source_filter)
      AND (NOT p_only_unmapped   OR mn.canonical_key IS NULL)
      AND (NOT p_only_unverified OR (mn.canonical_key IS NOT NULL AND COALESCE(mn.verified, false) = false))
      AND (p_extracted_by IS NULL OR p_extracted_by = '' OR mn.extracted_by = p_extracted_by)
      AND (
        p_conf_bucket = 'all'
        OR (p_conf_bucket = 'high' AND mn.confidence > 85)
        OR (p_conf_bucket = 'med'  AND mn.confidence >= 50 AND mn.confidence <= 85)
        OR (p_conf_bucket = 'low'  AND COALESCE(mn.confidence, 101) < 50)
      )
      AND (
        p_q IS NULL OR p_q = ''
        OR mv.market_type ILIKE '%' || p_q || '%'
        OR mn.canonical_key ILIKE '%' || p_q || '%'
        OR mn.canonical_name_it ILIKE '%' || p_q || '%'
      )
  ),
  totals AS (
    SELECT
      COUNT(*) AS total_rows,
      COUNT(*) FILTER (WHERE canonical_key IS NOT NULL) AS total_mapped,
      COUNT(*) FILTER (WHERE verified) AS total_verified
    FROM base
  ),
  paged AS (
    SELECT *
    FROM base
    ORDER BY market_count DESC
    LIMIT GREATEST(1, p_per_page)
    OFFSET GREATEST(0, (p_page - 1) * p_per_page)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.market_count DESC) FROM paged p),
      '[]'::jsonb
    ),
    'total_rows',     (SELECT total_rows     FROM totals),
    'total_mapped',   (SELECT total_mapped   FROM totals),
    'total_verified', (SELECT total_verified FROM totals)
  );
$$;

-- Initial populate
SELECT refresh_mv_source_market_types();
