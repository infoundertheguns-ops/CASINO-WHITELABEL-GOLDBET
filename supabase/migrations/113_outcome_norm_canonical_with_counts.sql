-- Migration 113: outcome_norm_canonical_list returns only canonicals
-- that actually appear in outcome_normalization (in-use) plus a usage count.
-- Fixes: dropdown in /admin/outcome-normalization showed all 446 canonical_markets
-- regardless of relevance, making the filter unusable.

DROP FUNCTION IF EXISTS outcome_norm_canonical_list();

CREATE OR REPLACE FUNCTION outcome_norm_canonical_list()
RETURNS TABLE(
  canonical_key     text,
  canonical_name_it text,
  count             bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    cm.canonical_key,
    cm.canonical_name_it,
    COUNT(o.id)::bigint AS count
  FROM canonical_markets cm
  JOIN outcome_normalization o ON o.canonical_key = cm.canonical_key
  GROUP BY cm.canonical_key, cm.canonical_name_it
  ORDER BY COUNT(o.id) DESC, cm.canonical_key;
$$;

GRANT EXECUTE ON FUNCTION outcome_norm_canonical_list() TO service_role, authenticated, anon;
