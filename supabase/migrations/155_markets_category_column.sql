-- supabase/migrations/155_markets_category_column.sql
-- Plan D Phase 1.5 retry — Option A: precomputed category column on markets.
--
-- Foundation for filter-at-exposure WITHOUT inline regex in derive_legacy_from_v2().
-- The trigger pre-classifies on INSERT/UPDATE so filter queries are pure column
-- comparison (fast). Activation of the filter inside derive is a SEPARATE migration
-- (156) once this column is fully backfilled and verified.
--
-- Backfill is NOT run inside this migration to avoid autovacuum cascade. Run
-- chunked backfill via the helper RPC `backfill_markets_category(chunk_size, max_rows)`
-- defined here, called repeatedly until done.

BEGIN;

-- ========== Part A: column + index ==========

ALTER TABLE markets ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN markets.category IS
  'Plan D v2 — precomputed market category (score|stats|player|special|unclassified). Auto-populated by markets_set_category_trg trigger via classify_market_pattern(). Used for fast filter-at-exposure in derive_legacy_from_v2() v2 (mig 156, future).';

-- Partial index supports the future derive filter `WHERE category=... AND is_active`
-- without scanning all rows. Only indexes active markets to keep size small.
CREATE INDEX IF NOT EXISTS idx_markets_category_active
  ON markets (event_id, category)
  WHERE is_active = true;

-- ========== Part B: trigger to auto-populate on INSERT/UPDATE of market_type ==========

CREATE OR REPLACE FUNCTION markets_set_category_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only re-classify if market_type changed or category is NULL.
  IF TG_OP = 'INSERT' OR NEW.market_type IS DISTINCT FROM OLD.market_type OR NEW.category IS NULL THEN
    NEW.category := classify_market_pattern(NEW.market_type);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS markets_set_category ON markets;
CREATE TRIGGER markets_set_category
  BEFORE INSERT OR UPDATE OF market_type ON markets
  FOR EACH ROW EXECUTE FUNCTION markets_set_category_trg();

COMMENT ON FUNCTION markets_set_category_trg() IS
  'Plan D v2 — sets markets.category from market_type via classify_market_pattern(). Fires BEFORE INSERT and BEFORE UPDATE OF market_type. Skips re-classification if market_type unchanged.';

-- ========== Part C: chunked backfill helper ==========
-- Avoid one-shot UPDATE on 120k+ rows (autovacuum cascade). Caller invokes
-- repeatedly in a loop, each call processes up to chunk_size rows where category IS NULL.
-- Returns number of rows updated this call (0 = done).

DROP FUNCTION IF EXISTS backfill_markets_category(int);
CREATE FUNCTION backfill_markets_category(chunk_size int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated int;
BEGIN
  WITH targets AS (
    SELECT id FROM markets WHERE category IS NULL LIMIT chunk_size
  )
  UPDATE markets m SET
    category = classify_market_pattern(m.market_type)
  FROM targets t
  WHERE m.id = t.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_markets_category(int) TO anon, authenticated, service_role;

COMMIT;
