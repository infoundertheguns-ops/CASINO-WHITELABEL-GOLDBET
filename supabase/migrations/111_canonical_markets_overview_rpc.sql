-- Migration 111: get_canonical_markets_overview() RPC.
-- Eliminates the full-table scan in /admin/canonical-markets list:
-- previous code pulled ALL market_normalization rows (~62k in prod) just to
-- count mapped rows per canonical. This RPC aggregates server-side via GROUP BY.

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
  mapped_count      bigint
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
    COALESCE(mn.cnt, 0)::bigint AS mapped_count
  FROM canonical_markets cm
  LEFT JOIN (
    SELECT canonical_key, COUNT(*)::bigint AS cnt
    FROM market_normalization
    WHERE canonical_key IS NOT NULL
    GROUP BY canonical_key
  ) mn ON mn.canonical_key = cm.canonical_key
  ORDER BY cm.base_key, cm.period;
$$;

GRANT EXECUTE ON FUNCTION get_canonical_markets_overview() TO authenticated, service_role, anon;
