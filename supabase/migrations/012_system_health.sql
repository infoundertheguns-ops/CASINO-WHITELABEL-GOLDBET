-- ═══════════════════════════════════════════════════════════════
-- Migration 012: System Health Monitor
-- - RPC get_system_health() — single call for all health metrics
-- - Table system_health_log for historical tracking
-- - Supporting indexes for freshness queries
-- ═══════════════════════════════════════════════════════════════

-- ═══ TABLE: system_health_log ═══

CREATE TABLE IF NOT EXISTS system_health_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  overall_score SMALLINT NOT NULL,
  overall_level TEXT NOT NULL CHECK (overall_level IN ('healthy', 'degraded', 'critical')),
  subsystem_scores JSONB NOT NULL DEFAULT '{}',
  metrics JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_health_log_created ON system_health_log (created_at DESC);

-- Keep max 30 days via simple policy (manual or cron cleanup)

-- ═══ INDEXES for freshness queries ═══
-- These support the outcome/market freshness histograms

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcomes_active_updated
  ON outcomes (updated_at DESC) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_markets_active_updated
  ON markets (updated_at DESC) WHERE is_active = true;

-- ═══ RPC: get_system_health() ═══

DROP FUNCTION IF EXISTS get_system_health();

CREATE FUNCTION get_system_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '20s'
AS $$
DECLARE
  result JSONB;
  v_events JSONB;
  v_active JSONB;
  v_event_freshness JSONB;
  v_outcome_freshness JSONB;
  v_pipeline JSONB;
  v_quality JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN

  -- ═══ 1. Event counts by source × status (<5ms) ═══
  SELECT jsonb_object_agg(key, val) INTO v_events
  FROM (
    SELECT
      source || '_' || status AS key,
      COUNT(*)::INT AS val
    FROM events
    WHERE status IN ('prematch', 'live', 'finished')
    GROUP BY source, status
  ) t;
  IF v_events IS NULL THEN v_events := '{}'; END IF;

  -- ═══ 2. Active markets by source + total outcomes estimate (~100ms) ═══
  SELECT jsonb_build_object(
    'markets', (
      SELECT jsonb_object_agg(source, cnt)
      FROM (
        SELECT e.source, COUNT(*)::INT AS cnt
        FROM markets m
        JOIN events e ON e.id = m.event_id
        WHERE m.is_active = true
        GROUP BY e.source
      ) t
    ),
    'outcomes_total', (
      -- Fast estimate from partial index (avoids full table scan)
      SELECT COALESCE(
        (SELECT reltuples::INT FROM pg_class
         WHERE oid = 'idx_outcomes_active'::regclass), 0
      )
    )
  ) INTO v_active;

  -- ═══ 3. Event freshness histogram (<10ms on ~5K events) ═══
  SELECT jsonb_build_object(
    'live', (
      SELECT jsonb_object_agg(source, buckets)
      FROM (
        SELECT source, jsonb_build_object(
          'lt_30s', COUNT(*) FILTER (WHERE age_s < 30),
          '30s_2m', COUNT(*) FILTER (WHERE age_s >= 30 AND age_s < 120),
          '2m_5m', COUNT(*) FILTER (WHERE age_s >= 120 AND age_s < 300),
          '5m_15m', COUNT(*) FILTER (WHERE age_s >= 300 AND age_s < 900),
          '15m_30m', COUNT(*) FILTER (WHERE age_s >= 900 AND age_s < 1800),
          '30m_1h', COUNT(*) FILTER (WHERE age_s >= 1800 AND age_s < 3600),
          'gt_1h', COUNT(*) FILTER (WHERE age_s >= 3600)
        ) AS buckets
        FROM (
          SELECT source, EXTRACT(EPOCH FROM (v_now - updated_at))::INT AS age_s
          FROM events WHERE status = 'live'
        ) sub
        GROUP BY source
      ) t
    ),
    'prematch', (
      SELECT jsonb_object_agg(source, buckets)
      FROM (
        SELECT source, jsonb_build_object(
          'lt_30s', COUNT(*) FILTER (WHERE age_s < 30),
          '30s_2m', COUNT(*) FILTER (WHERE age_s >= 30 AND age_s < 120),
          '2m_5m', COUNT(*) FILTER (WHERE age_s >= 120 AND age_s < 300),
          '5m_15m', COUNT(*) FILTER (WHERE age_s >= 300 AND age_s < 900),
          '15m_30m', COUNT(*) FILTER (WHERE age_s >= 900 AND age_s < 1800),
          '30m_1h', COUNT(*) FILTER (WHERE age_s >= 1800 AND age_s < 3600),
          'gt_1h', COUNT(*) FILTER (WHERE age_s >= 3600)
        ) AS buckets
        FROM (
          SELECT source, EXTRACT(EPOCH FROM (v_now - updated_at))::INT AS age_s
          FROM events WHERE status = 'prematch'
        ) sub
        GROUP BY source
      ) t
    )
  ) INTO v_event_freshness;

  -- ═══ 4. Market freshness histogram (~500ms) ═══
  -- Uses market-level updated_at as proxy (scraper updates markets + outcomes together).
  -- Single query for both live + prematch via event status, pivoted into JSON.
  SELECT jsonb_build_object(
    'live', (
      SELECT jsonb_object_agg(source, buckets) FROM (
        SELECT source, jsonb_build_object(
          'lt_30s', lt_30s, '30s_2m', s30_2m, '2m_5m', m2_5m,
          '5m_15m', m5_15m, '15m_30m', m15_30m, '30m_1h', m30_1h, 'gt_1h', gt_1h
        ) AS buckets FROM (
          SELECT source,
            COUNT(*) FILTER (WHERE age_s < 30)::INT AS lt_30s,
            COUNT(*) FILTER (WHERE age_s >= 30 AND age_s < 120)::INT AS s30_2m,
            COUNT(*) FILTER (WHERE age_s >= 120 AND age_s < 300)::INT AS m2_5m,
            COUNT(*) FILTER (WHERE age_s >= 300 AND age_s < 900)::INT AS m5_15m,
            COUNT(*) FILTER (WHERE age_s >= 900 AND age_s < 1800)::INT AS m15_30m,
            COUNT(*) FILTER (WHERE age_s >= 1800 AND age_s < 3600)::INT AS m30_1h,
            COUNT(*) FILTER (WHERE age_s >= 3600)::INT AS gt_1h
          FROM (
            SELECT e.source, EXTRACT(EPOCH FROM (v_now - m.updated_at))::INT AS age_s
            FROM markets m JOIN events e ON e.id = m.event_id
            WHERE m.is_active = true AND e.status = 'live'
          ) sub GROUP BY source
        ) agg
      ) t
    ),
    'prematch', (
      SELECT jsonb_object_agg(source, buckets) FROM (
        SELECT source, jsonb_build_object(
          'lt_30s', lt_30s, '30s_2m', s30_2m, '2m_5m', m2_5m,
          '5m_15m', m5_15m, '15m_30m', m15_30m, '30m_1h', m30_1h, 'gt_1h', gt_1h
        ) AS buckets FROM (
          SELECT source,
            COUNT(*) FILTER (WHERE age_s < 30)::INT AS lt_30s,
            COUNT(*) FILTER (WHERE age_s >= 30 AND age_s < 120)::INT AS s30_2m,
            COUNT(*) FILTER (WHERE age_s >= 120 AND age_s < 300)::INT AS m2_5m,
            COUNT(*) FILTER (WHERE age_s >= 300 AND age_s < 900)::INT AS m5_15m,
            COUNT(*) FILTER (WHERE age_s >= 900 AND age_s < 1800)::INT AS m15_30m,
            COUNT(*) FILTER (WHERE age_s >= 1800 AND age_s < 3600)::INT AS m30_1h,
            COUNT(*) FILTER (WHERE age_s >= 3600)::INT AS gt_1h
          FROM (
            SELECT e.source, EXTRACT(EPOCH FROM (v_now - m.updated_at))::INT AS age_s
            FROM markets m JOIN events e ON e.id = m.event_id
            WHERE m.is_active = true AND e.status = 'prematch'
          ) sub GROUP BY source
        ) agg
      ) t
    )
  ) INTO v_outcome_freshness;

  -- ═══ 5. Pipeline metrics (fast — uses index scan limits) ═══
  SELECT jsonb_build_object(
    'outcomes_updated_5m', (
      -- Fast check: just test if recent updates exist, count from first 1000
      SELECT COUNT(*)::INT FROM (
        SELECT 1 FROM outcomes
        WHERE is_active = true AND updated_at > v_now - INTERVAL '5 minutes'
        LIMIT 1000
      ) sample
    ),
    'odds_changed_5m', (
      SELECT COUNT(*)::INT FROM (
        SELECT 1 FROM outcomes
        WHERE is_active = true AND updated_at > v_now - INTERVAL '5 minutes'
        AND previous_odds IS NOT NULL AND odds != previous_odds
        LIMIT 1000
      ) sample
    ),
    'latest_update', (
      -- First row from desc index = fastest MAX
      SELECT updated_at FROM outcomes WHERE is_active = true
      ORDER BY updated_at DESC LIMIT 1
    )
  ) INTO v_pipeline;

  -- ═══ 6. Data quality checks ═══
  SELECT jsonb_build_object(
    'orphan_markets', (
      -- Use LEFT JOIN instead of NOT EXISTS for better plan
      SELECT COUNT(*)::INT FROM markets m
      LEFT JOIN events e ON e.id = m.event_id AND e.status IN ('prematch', 'live')
      WHERE m.is_active = true AND e.id IS NULL
    ),
    'finished_backlog', (
      SELECT COUNT(*)::INT FROM events WHERE status = 'finished'
    ),
    'stale_prematch', (
      SELECT COUNT(*)::INT FROM events
      WHERE status = 'prematch' AND is_live = false
      AND starts_at < v_now - INTERVAL '30 minutes'
    ),
    'events_no_markets', (
      SELECT COUNT(*)::INT FROM events e
      WHERE e.status IN ('prematch', 'live')
      AND NOT EXISTS (SELECT 1 FROM markets m WHERE m.event_id = e.id AND m.is_active = true)
    ),
    'unsettled_bets', (
      SELECT COUNT(*)::INT FROM bets
      WHERE status = 'pending'
      AND EXISTS (
        SELECT 1 FROM bet_selections bs
        JOIN events ev ON ev.id = bs.event_id
        WHERE bs.bet_id = bets.id
        AND ev.status IN ('finished', 'ended')
      )
    )
  ) INTO v_quality;

  -- ═══ ASSEMBLE ═══
  result := jsonb_build_object(
    'events', v_events,
    'active_by_source', v_active,
    'event_freshness', v_event_freshness,
    'outcome_freshness', v_outcome_freshness,
    'pipeline', v_pipeline,
    'quality', v_quality,
    'generated_at', v_now
  );

  RETURN result;
END;
$$;
