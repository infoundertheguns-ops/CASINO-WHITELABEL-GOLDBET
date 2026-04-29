-- supabase/migrations/154_derive_legacy_filter_rollback.sql
-- Rollback for mig 154 (helper + dry-run RPC + filter KPI replacement).
-- NOTE: live derive_legacy_from_v2() is NOT touched by mig 154 — that's mig 154b.

BEGIN;

DROP FUNCTION IF EXISTS derive_legacy_from_v2_filter_diff();

-- Restore mig 152 stub
DROP FUNCTION IF EXISTS settlement_coverage_filter_kpi(int);
CREATE FUNCTION settlement_coverage_filter_kpi(window_days int DEFAULT 7)
RETURNS TABLE(
  markets_filtered BIGINT, total_markets BIGINT, pct NUMERIC, reason TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT 0::BIGINT, 0::BIGINT, 0::NUMERIC, 'mig-154-pending'::TEXT;
$$;
GRANT EXECUTE ON FUNCTION settlement_coverage_filter_kpi(int) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS is_market_exposable(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS classify_market_pattern(TEXT);

DELETE FROM _migrations WHERE name = '154_derive_legacy_filter.sql';

COMMIT;
