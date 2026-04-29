-- ═══════════════════════════════════════════════════
-- Migration 109: event_normalization_runs table
--
-- Tracks every execution of the event-normalization engine (manual or
-- automatic cron). Used by /admin/event-normalization to show operators
-- whether automation is healthy (last auto-run within SLA) and to log
-- LLM spend per run.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_normalization_runs (
  id           bigserial PRIMARY KEY,
  source       text NOT NULL CHECK (source IN ('auto', 'manual', 'sentinel_retry_auto', 'sentinel_retry_manual')),
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed    int  NOT NULL DEFAULT 0,
  matched      int  NOT NULL DEFAULT 0,
  llm_used     int  NOT NULL DEFAULT 0,
  llm_input_tokens  bigint NOT NULL DEFAULT 0,
  llm_output_tokens bigint NOT NULL DEFAULT 0,
  duration_ms  int  NOT NULL DEFAULT 0,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evnorm_runs_source_created
  ON event_normalization_runs(source, created_at DESC);

COMMENT ON TABLE event_normalization_runs IS
  'Log of every event-normalization engine run (manual/auto + regular/sentinel-retry). Consumed by /admin/event-normalization automation health panel.';
