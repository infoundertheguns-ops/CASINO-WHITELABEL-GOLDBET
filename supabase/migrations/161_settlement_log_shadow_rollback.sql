-- Rollback for migration 161
DROP FUNCTION IF EXISTS settlement_shadow_mismatch_pct(INT);
DROP TABLE IF EXISTS settlement_log_shadow CASCADE;
DELETE FROM _migrations WHERE name = '161_settlement_log_shadow';
