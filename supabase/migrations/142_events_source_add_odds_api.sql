-- Migration 142: events.source generated column — add 'odds-api' and 'ippica' branches.
--
-- Pre: source CASE only handled kambi/leon/22bet/betfair, with ELSE → 'goldbet'.
-- New events from odds-api ingester (external_id='odds-api:NNN') would have been
-- mis-classified as 'goldbet'. Same for ippica events (external_id='ippica:NNN').
--
-- Idempotent: ALTER COLUMN ... SET EXPRESSION (PG17+).
-- Rollback: re-apply original CASE.

BEGIN;

-- PG17 supports ALTER COLUMN SET EXPRESSION for stored generated columns.
-- This avoids the need to drop+recreate the column (which would cascade to
-- views, indexes, RLS policies, etc.).
ALTER TABLE public.events
  ALTER COLUMN source SET EXPRESSION AS (
    CASE
      WHEN external_id LIKE 'kambi:%'    THEN 'kambi'
      WHEN external_id LIKE 'leon:%'     THEN 'leon'
      WHEN external_id LIKE '22bet:%'    THEN '22bet'
      WHEN external_id LIKE 'betfair:%'  THEN 'betfair'
      WHEN external_id LIKE 'odds-api:%' THEN 'odds-api'
      WHEN external_id LIKE 'ippica:%'   THEN 'ippica'
      ELSE 'goldbet'
    END
  );

COMMIT;
