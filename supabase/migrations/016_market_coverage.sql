-- ═══════════════════════════════════════════════════════════
-- Migration 016: Market Coverage Report RPC
-- Single-pass query: events × markets, grouped by sport/source/status
-- Returns summary + low-coverage events (<30% of sport avg)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_market_coverage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '10s'
AS $$
DECLARE
    v_summary JSONB;
    v_low_coverage JSONB;
BEGIN
    -- CTE: count markets per event, compute sport avg via window function
    WITH event_market_counts AS (
        SELECT
            e.id AS event_id,
            e.external_id,
            e.home_team,
            e.away_team,
            e.starts_at,
            e.source,
            s.name AS sport_name,
            s.slug AS sport_slug,
            CASE WHEN e.status = 'live' THEN 'live' ELSE 'prematch' END AS status_bucket,
            COUNT(m.id) AS market_count
        FROM events e
        JOIN sports s ON s.id = e.sport_id
        LEFT JOIN markets m ON m.event_id = e.id AND m.is_active = TRUE
        WHERE e.status IN ('prematch', 'live')
        GROUP BY e.id, e.external_id, e.home_team, e.away_team, e.starts_at,
                 e.source, s.name, s.slug, e.status
    ),
    with_avg AS (
        SELECT
            *,
            AVG(market_count) OVER (PARTITION BY sport_slug, source, status_bucket) AS sport_avg
        FROM event_market_counts
    ),
    -- Summary aggregation
    summary AS (
        SELECT jsonb_agg(row_data ORDER BY total_events DESC) AS data
        FROM (
            SELECT jsonb_build_object(
                'sport_name', sport_name,
                'sport_slug', sport_slug,
                'source', source,
                'status', status_bucket,
                'total_events', COUNT(*),
                'avg_markets', ROUND(AVG(market_count)::NUMERIC, 1),
                'min_markets', MIN(market_count),
                'max_markets', MAX(market_count),
                'total_markets', SUM(market_count),
                'zero_market_events', COUNT(*) FILTER (WHERE market_count = 0),
                'low_coverage_events', COUNT(*) FILTER (WHERE sport_avg > 0 AND market_count < sport_avg * 0.3)
            ) AS row_data,
            COUNT(*) AS total_events
            FROM with_avg
            GROUP BY sport_name, sport_slug, source, status_bucket
        ) agg
    ),
    -- Low coverage events (<30% of sport avg, limit 200)
    low_cov AS (
        SELECT jsonb_agg(row_data ORDER BY coverage_pct ASC) AS data
        FROM (
            SELECT jsonb_build_object(
                'event_id', event_id,
                'external_id', external_id,
                'home_team', home_team,
                'away_team', away_team,
                'sport_name', sport_name,
                'sport_slug', sport_slug,
                'source', source,
                'status', status_bucket,
                'market_count', market_count,
                'sport_avg', ROUND(sport_avg::NUMERIC, 1),
                'coverage_pct', CASE WHEN sport_avg > 0 THEN ROUND((market_count / sport_avg * 100)::NUMERIC, 1) ELSE 0 END,
                'starts_at', starts_at
            ) AS row_data,
            CASE WHEN sport_avg > 0 THEN market_count / sport_avg * 100 ELSE 0 END AS coverage_pct
            FROM with_avg
            WHERE sport_avg > 0 AND market_count < sport_avg * 0.3
            ORDER BY coverage_pct ASC
            LIMIT 200
        ) lc
    )
    SELECT
        jsonb_build_object(
            'summary', COALESCE((SELECT data FROM summary), '[]'::JSONB),
            'low_coverage_events', COALESCE((SELECT data FROM low_cov), '[]'::JSONB),
            'generated_at', NOW()
        )
    INTO v_summary;

    RETURN v_summary;
END;
$$;
