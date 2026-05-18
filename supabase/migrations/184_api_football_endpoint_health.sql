-- 184: api_football_endpoint_health for per-endpoint failure tracking
-- The api-football-ingester records last success/failure per endpoint
-- and applies 5min cooldown after 3 consecutive 5xx. Read by admin dashboard.

CREATE TABLE IF NOT EXISTS api_football_endpoint_health (
  endpoint TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Rollback: DROP TABLE IF EXISTS api_football_endpoint_health;
