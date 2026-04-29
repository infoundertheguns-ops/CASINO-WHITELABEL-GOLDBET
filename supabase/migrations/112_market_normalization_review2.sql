-- Migration 112: Market Normalization review #2 hardening.
--   1) Extend list_markets_normalization_paged with p_canonical_key filter
--      → fixes drill-from-canonical-markets (?canonical=foo) which was being
--        ignored by the API.
--   2) Add get_market_normalization_canonical_keys() RPC
--      → eliminates the full-table-scan in /admin/market-normalization where
--        the autocomplete datalist pulled all 63k rows on every page load.

-- 1) Drop+recreate paged RPC with new param.
DROP FUNCTION IF EXISTS list_markets_normalization_paged(
  TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT
);

CREATE OR REPLACE FUNCTION list_markets_normalization_paged(
  p_source_filter   TEXT    DEFAULT NULL,
  p_q               TEXT    DEFAULT NULL,
  p_only_unmapped   BOOLEAN DEFAULT false,
  p_only_unverified BOOLEAN DEFAULT false,
  p_conf_bucket     TEXT    DEFAULT 'all',
  p_extracted_by    TEXT    DEFAULT NULL,
  p_canonical_key   TEXT    DEFAULT NULL,
  p_page            INT     DEFAULT 1,
  p_per_page        INT     DEFAULT 100
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET statement_timeout TO '60s'
AS $$
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
      AND (p_canonical_key IS NULL OR p_canonical_key = '' OR mn.canonical_key = p_canonical_key)
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
      COUNT(*)                                                  AS total_rows,
      COUNT(*) FILTER (WHERE canonical_key IS NOT NULL)         AS total_mapped,
      COUNT(*) FILTER (WHERE verified)                          AS total_verified,
      COALESCE(SUM(market_count), 0)                            AS total_volume,
      COALESCE(SUM(market_count) FILTER (WHERE canonical_key IS NOT NULL), 0) AS mapped_volume,
      COALESCE(SUM(market_count) FILTER (WHERE verified), 0)    AS verified_volume
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
    'total_rows',       (SELECT total_rows       FROM totals),
    'total_mapped',     (SELECT total_mapped     FROM totals),
    'total_verified',   (SELECT total_verified   FROM totals),
    'total_volume',     (SELECT total_volume     FROM totals),
    'mapped_volume',    (SELECT mapped_volume    FROM totals),
    'verified_volume',  (SELECT verified_volume  FROM totals)
  );
$$;

GRANT EXECUTE ON FUNCTION list_markets_normalization_paged(
  TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, INT, INT
) TO authenticated, service_role, anon;

-- 2) Aggregated canonical-keys RPC for the autocomplete datalist.
--    Previously the API pulled every market_normalization row to compute
--    counts in JS — now done server-side with GROUP BY.
CREATE OR REPLACE FUNCTION get_market_normalization_canonical_keys()
RETURNS TABLE (
  canonical_key     TEXT,
  canonical_name_it TEXT,
  count             BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    mn.canonical_key,
    -- Take any non-null name from the group (typically all the same).
    COALESCE(MAX(mn.canonical_name_it), '') AS canonical_name_it,
    COUNT(*)::BIGINT                        AS count
  FROM market_normalization mn
  WHERE mn.canonical_key IS NOT NULL
  GROUP BY mn.canonical_key
  ORDER BY COUNT(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_market_normalization_canonical_keys() TO authenticated, service_role, anon;
