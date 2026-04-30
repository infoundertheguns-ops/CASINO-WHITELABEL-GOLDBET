-- Plan D Phase 0.5 — baseline settlement metrics
-- Read-only. Safe to run on prod. Captures latency + FS volume + category mix.
-- Usage:
--   PGPASSWORD=<prod_pwd> psql 'postgresql://postgres@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' \
--     -f scripts/diagnostic/baseline-settlement-metrics.sql

\echo '========== Q1: bet legs by heuristic category (last 30d) =========='
WITH classified AS (
  SELECT bs.id, bs.result, m.market_type, b.created_at,
    CASE
      WHEN m.market_type ~* '(corner|cartellin|card|tiri|shot|tackle|fall|foul|salvataggi|saves)' THEN 'stats'
      WHEN m.market_type ~* '(marcator|player|scorer|assist|giocatore)' THEN 'player'
      WHEN m.market_type ~* '(method|metodo|first 10|primi 10|specials?)' THEN 'special'
      ELSE 'score'
    END AS heuristic_category
  FROM bet_selections bs
  JOIN bets b ON b.id = bs.bet_id
  JOIN markets m ON m.id = bs.market_id
  WHERE b.created_at > NOW() - INTERVAL '30 days'
)
SELECT heuristic_category,
  count(*) AS legs,
  round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 1) AS pct,
  count(*) FILTER (WHERE result = 'won') AS won,
  count(*) FILTER (WHERE result = 'lost') AS lost,
  count(*) FILTER (WHERE result = 'void') AS void_,
  count(*) FILTER (WHERE result IS NULL) AS pending
FROM classified
GROUP BY heuristic_category
ORDER BY legs DESC;

\echo ''
\echo '========== Q2: settlement latency p50/p90 — finished events last 7d =========='
SELECT
  count(*) AS settled_events,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.settled_at - e.starts_at))/60))::numeric, 1) AS p50_min,
  round((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.settled_at - e.starts_at))/60))::numeric, 1) AS p90_min,
  round((percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.settled_at - e.starts_at))/60))::numeric, 1) AS p99_min
FROM events e
WHERE e.settled_at > NOW() - INTERVAL '7 days'
  AND e.status IN ('finished', 'ended');

\echo ''
\echo '========== Q3a: FS call volume proxy — events with FS-fetched stats last 24h =========='
SELECT
  count(*) AS events_with_fs_stats_24h,
  count(*) FILTER (WHERE updated_at > NOW() - INTERVAL '1 hour') AS in_last_1h,
  count(*) FILTER (WHERE updated_at > NOW() - INTERVAL '6 hours') AS in_last_6h
FROM events
WHERE updated_at > NOW() - INTERVAL '24 hours'
  AND live_data ? 'stats';

\echo ''
\echo '========== Q3b: FS call volume proxy — verify-results cron heartbeat (last 24h activity) =========='
-- If a settlement_log table tracks per-event FS calls, surface it. Otherwise skip.
SELECT
  date_trunc('hour', sl.created_at) AS hour,
  count(*) AS settlements_logged
FROM settlement_log sl
WHERE sl.created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 24;

\echo ''
\echo '========== Q4: % events_v2 with mapped_event_id (Trigger A coverage predictor) =========='
SELECT
  count(*) FILTER (WHERE mapped_event_id IS NOT NULL) AS mapped,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE mapped_event_id IS NOT NULL) / NULLIF(count(*), 0), 1) AS pct_mapped
FROM events_v2
WHERE date_iso > NOW() - INTERVAL '30 days';
