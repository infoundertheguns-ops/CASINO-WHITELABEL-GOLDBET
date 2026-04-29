-- ════════════════════════════════════════════════════════════
-- 102_outcome_normalization_rpcs.sql
--
-- Read-side helpers for /admin/outcome-normalization UI.
-- Parallel to market-normalization RPCs but simpler (single level mapping).
-- ════════════════════════════════════════════════════════════

BEGIN;

-- KPI per source (or 'all')
CREATE OR REPLACE FUNCTION outcome_norm_kpis(p_source text DEFAULT 'all')
RETURNS TABLE(
  total       bigint,
  mapped      bigint,
  unmapped    bigint,
  verified    bigint,
  unverified  bigint,
  coverage_pct numeric
)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT * FROM outcome_normalization
    WHERE p_source = 'all' OR source = p_source
  )
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE canonical_outcome_key IS NOT NULL)::bigint AS mapped,
    COUNT(*) FILTER (WHERE canonical_outcome_key IS NULL)::bigint AS unmapped,
    COUNT(*) FILTER (WHERE verified)::bigint AS verified,
    COUNT(*) FILTER (WHERE NOT verified AND canonical_outcome_key IS NOT NULL)::bigint AS unverified,
    ROUND(100.0 * COUNT(*) FILTER (WHERE canonical_outcome_key IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS coverage_pct
  FROM base;
$$;

-- Paginated list with filters
CREATE OR REPLACE FUNCTION outcome_norm_list(
  p_source text DEFAULT 'all',
  p_q text DEFAULT NULL,
  p_only_unmapped boolean DEFAULT false,
  p_only_unverified boolean DEFAULT false,
  p_canonical_market text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_per_page int DEFAULT 100
)
RETURNS TABLE(
  id bigint,
  source text,
  source_market_type text,
  source_outcome_name text,
  canonical_key text,
  canonical_outcome_key text,
  extracted_by text,
  confidence smallint,
  verified boolean,
  notes text,
  updated_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT *
    FROM outcome_normalization
    WHERE (p_source = 'all' OR source = p_source)
      AND (NOT p_only_unmapped OR canonical_outcome_key IS NULL)
      AND (NOT p_only_unverified OR (NOT verified AND canonical_outcome_key IS NOT NULL))
      AND (p_canonical_market IS NULL OR p_canonical_market = '' OR canonical_key = p_canonical_market)
      AND (
        p_q IS NULL OR p_q = ''
        OR source_market_type ILIKE '%' || p_q || '%'
        OR source_outcome_name ILIKE '%' || p_q || '%'
        OR canonical_outcome_key ILIKE '%' || p_q || '%'
      )
  ),
  counted AS (SELECT COUNT(*) AS n FROM filtered)
  SELECT f.id, f.source, f.source_market_type, f.source_outcome_name,
         f.canonical_key, f.canonical_outcome_key, f.extracted_by, f.confidence,
         f.verified, f.notes, f.updated_at,
         c.n AS total_count
  FROM filtered f CROSS JOIN counted c
  ORDER BY f.verified ASC, f.confidence DESC NULLS LAST, f.source_market_type, f.source_outcome_name
  OFFSET GREATEST(0, (p_page - 1)) * p_per_page
  LIMIT p_per_page;
$$;

-- Canonical market keys list (for dropdown in UI)
CREATE OR REPLACE FUNCTION outcome_norm_canonical_list()
RETURNS TABLE(canonical_key text, canonical_name_it text)
LANGUAGE sql STABLE AS $$
  SELECT canonical_key, canonical_name_it
  FROM canonical_markets
  ORDER BY canonical_key;
$$;

GRANT EXECUTE ON FUNCTION outcome_norm_kpis(text)                             TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION outcome_norm_list(text, text, boolean, boolean, text, int, int) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION outcome_norm_canonical_list()                       TO service_role, authenticated;

COMMIT;
