-- Migration 140: outcomes_v2 — replace expression unique index with generated
-- column + regular UNIQUE constraint, so supabase-js ON CONFLICT can target it.
--
-- Bug observed in POC Day 1 follow-up to mig 139:
--   The expression unique index `(market_id, outcome_key, COALESCE(line, -999999))`
--   correctly enforces uniqueness on duplicate inserts, BUT the upsert from
--   @supabase/supabase-js sets `ON CONFLICT (market_id, outcome_key, line)`
--   which Postgres rejects with: "there is no unique or exclusion constraint
--   matching the ON CONFLICT specification". You can only reference an actual
--   constraint by its column list, not an expression index.
--
-- Fix: introduce `line_norm` as a STORED generated column = COALESCE(line, -999999),
-- and put a regular UNIQUE constraint on (market_id, outcome_key, line_norm).
-- Then update application code to set `onConflict: 'market_id,outcome_key,line_norm'`.
-- Generated columns are referenceable in ON CONFLICT targets.
--
-- Cleanup: TRUNCATE outcomes_v2 (table is already empty post-mig-139, but defensively).
-- Drop the previous expression index (now redundant).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT (will error if exists, so skip via DO block).
-- Rollback: drop generated column + constraint, restore expression index from mig 139.

BEGIN;

TRUNCATE TABLE public.outcomes_v2;

ALTER TABLE public.outcomes_v2
  ADD COLUMN IF NOT EXISTS line_norm numeric NOT NULL GENERATED ALWAYS AS (COALESCE(line, -999999)) STORED;

DROP INDEX IF EXISTS public.outcomes_v2_market_outcome_line_uidx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outcomes_v2_market_outcome_linenorm_uniq'
  ) THEN
    ALTER TABLE public.outcomes_v2
      ADD CONSTRAINT outcomes_v2_market_outcome_linenorm_uniq
      UNIQUE (market_id, outcome_key, line_norm);
  END IF;
END $$;

COMMIT;
