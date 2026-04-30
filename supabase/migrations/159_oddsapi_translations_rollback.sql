-- Rollback for migration 159
DROP TRIGGER IF EXISTS trg_oddsapi_translations_updated_at ON oddsapi_translations;
DROP FUNCTION IF EXISTS oddsapi_translations_set_updated_at();
DROP TABLE IF EXISTS oddsapi_translations CASCADE;
DELETE FROM _migrations WHERE name = '159_oddsapi_translations';
