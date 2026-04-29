-- Migration 032: Drop NOT NULL on bet_selections sport columns
-- These columns are NULL for ippica/ippica_tote sources which use their own FK columns
-- Applied directly to prod on 2026-04-13 by ippica bet fix agent

ALTER TABLE bet_selections
  ALTER COLUMN event_id DROP NOT NULL,
  ALTER COLUMN market_id DROP NOT NULL,
  ALTER COLUMN outcome_id DROP NOT NULL;
