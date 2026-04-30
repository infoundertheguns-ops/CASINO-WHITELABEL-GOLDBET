-- Rollback for migration 158
DROP TRIGGER IF EXISTS trg_manual_overrides_updated_at ON manual_overrides;
DROP FUNCTION IF EXISTS manual_overrides_set_updated_at();
DROP TABLE IF EXISTS manual_overrides CASCADE;
DELETE FROM _migrations WHERE name = '158_manual_overrides';
