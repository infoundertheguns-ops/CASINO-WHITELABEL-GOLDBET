-- supabase/migrations/152_settlement_coverage_rollback.sql
-- Rollback for mig 152. Run ONLY if 152 partially applied or needs unwind. Manual ops, not auto-run.

BEGIN;
DROP FUNCTION IF EXISTS next_unsettled_with_stats_legs(int);
DROP FUNCTION IF EXISTS settlement_coverage_sla_kpi(int);
DROP FUNCTION IF EXISTS settlement_coverage_filter_kpi(int);
DROP FUNCTION IF EXISTS settlement_coverage_list(int);
DROP FUNCTION IF EXISTS settlement_coverage_kpis(int);
DROP TABLE IF EXISTS market_categories_seed;
DROP INDEX IF EXISTS idx_events_v2_settled_pending;
ALTER TABLE events_v2 DROP COLUMN IF EXISTS last_settled_at;
DELETE FROM _migrations WHERE filename = '152_settlement_coverage.sql';
COMMIT;
