-- ════════════════════════════════════════════════════════════
-- 103_consensus_perf_index.sql
--
-- Fix: /admin/consensus list query timing out (PG 57014) on v_consensus_latest.
--
-- Root cause: consensus_snapshots grew to ~1.8M rows, of which ~1.65M are
-- still in the "last 2h" window used by the UI filter. The view does
-- DISTINCT ON (kambi_event_id, market_type, outcome_name) ORDER BY snapshot_at DESC
-- with no supporting index → full table scan + external sort → statement_timeout.
--
-- Fix strategy:
-- 1) Composite index on the DISTINCT ON columns so Postgres can do an
--    index-only skip-scan for the latest snapshot per outcome.
-- 2) Supporting index on (event_starts_at, abs_delta_pct) for the UI filter
--    + order path.
-- 3) Narrow the view to event_starts_at > now() - 48h. UI only shows events
--    in the last 2h window anyway; beyond 48h is historical garbage for
--    this screen. Keeps DISTINCT ON working set small.
--
-- Application note: CONCURRENTLY needs its own transaction → no BEGIN/COMMIT
-- wrapper around the CREATE INDEX statements. The view replace stays in an
-- implicit transaction.
-- ════════════════════════════════════════════════════════════

SET statement_timeout = '600s';

-- 103.1 — Composite index supporting DISTINCT ON + snapshot_at DESC ordering.
CREATE INDEX IF NOT EXISTS idx_consensus_distinct_lookup
  ON consensus_snapshots (kambi_event_id, market_type, outcome_name, snapshot_at DESC);

-- 103.2 — Supports UI filter (event_starts_at >= X) ordered by abs_delta_pct DESC.
CREATE INDEX IF NOT EXISTS idx_consensus_starts_delta
  ON consensus_snapshots (event_starts_at, abs_delta_pct DESC);

-- 103.3 — Rewrite view with temporal filter so DISTINCT ON scans a much
-- smaller input. 48h is generous: auto_suspend_consensus_outliers cron
-- only reads outliers within the next 7 days of event_starts_at, and the
-- UI only shows last 2h. We keep 48h back-compat window for review lag.
DROP VIEW IF EXISTS v_consensus_latest;
CREATE VIEW v_consensus_latest AS
SELECT DISTINCT ON (kambi_event_id, market_type, outcome_name)
  id, kambi_event_id, twobet_event_id, betfair_event_id,
  sport, home_team, away_team, event_starts_at,
  market_type, outcome_name,
  kambi_odds, twobet_odds, betfair_odds,
  delta_pct, abs_delta_pct,
  twobet_outcomes_count, twobet_market_type_raw,
  snapshot_at, reviewed, reviewed_at, reviewed_by, notes
FROM consensus_snapshots
WHERE event_starts_at > now() - interval '48 hours'
ORDER BY kambi_event_id, market_type, outcome_name, snapshot_at DESC;

COMMENT ON VIEW v_consensus_latest IS
  'Per-outlier latest snapshot, restricted to events within 48h window (prevents DISTINCT ON scan on full 1.8M-row history). Used by /admin/consensus + auto_suspend_consensus_outliers.';
