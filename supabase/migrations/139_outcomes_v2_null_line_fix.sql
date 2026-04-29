-- Migration 139: outcomes_v2 — replace UNIQUE constraint with expression index
-- using COALESCE(line, sentinel) to handle NULL lines.
--
-- Bug observed in POC Day 1 (Bet365 ingestion run twice):
--   outcomes_v2 grew from 7315 -> 12511 rows on second run, with duplicate
--   ML/DNB/BTTS/Double Chance outcomes (all markets where line IS NULL).
--   ON CONFLICT (market_id, outcome_key, line) silently bypasses the
--   UNIQUE check when line IS NULL, because Postgres treats NULL as not-equal
--   in UNIQUE constraints. Result: every re-upsert appends a new row.
--
-- Fix: replace the regular UNIQUE constraint with a partial expression unique
-- index using COALESCE(line, -999999). Sentinel chosen to be far outside any
-- real handicap value (handicaps observed: -7 .. +7).
--
-- Cleanup: TRUNCATE outcomes_v2 first to discard duplicates created during POC.
-- The next POC run will re-populate cleanly.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS, CREATE INDEX IF NOT EXISTS.
-- Rollback: DROP INDEX outcomes_v2_market_outcome_line_uidx;
--           ALTER TABLE outcomes_v2 ADD CONSTRAINT outcomes_v2_market_id_outcome_key_line_key UNIQUE (market_id, outcome_key, line);

BEGIN;

-- 1. Wipe existing outcomes (we'll re-ingest cleanly)
TRUNCATE TABLE public.outcomes_v2;

-- 2. Drop the broken UNIQUE constraint (auto-named by mig 138)
ALTER TABLE public.outcomes_v2
  DROP CONSTRAINT IF EXISTS outcomes_v2_market_id_outcome_key_line_key;

-- 3. Add expression unique index that treats NULL as a sentinel value
CREATE UNIQUE INDEX IF NOT EXISTS outcomes_v2_market_outcome_line_uidx
  ON public.outcomes_v2 (market_id, outcome_key, COALESCE(line, -999999));

COMMIT;
