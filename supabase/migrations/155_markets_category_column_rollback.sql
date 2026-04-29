-- supabase/migrations/155_markets_category_column_rollback.sql
-- Rollback for mig 155 (column + trigger + backfill helper).

BEGIN;

DROP FUNCTION IF EXISTS backfill_markets_category(int);
DROP TRIGGER IF EXISTS markets_set_category ON markets;
DROP FUNCTION IF EXISTS markets_set_category_trg();
DROP INDEX IF EXISTS idx_markets_category_active;
ALTER TABLE markets DROP COLUMN IF EXISTS category;

DELETE FROM _migrations WHERE name = '155_markets_category_column.sql';

COMMIT;
