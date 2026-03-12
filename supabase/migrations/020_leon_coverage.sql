-- ═══ 020: Leon-only market coverage RPC ═══
-- Replaces get_market_coverage() with Leon-centric version

CREATE OR REPLACE FUNCTION get_leon_coverage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  kpis JSONB;
  sport_summary JSONB;
  gap_events JSONB;
BEGIN
  -- KPI globali (solo Leon, escludi giocatori-%)
  SELECT jsonb_build_object(
    'total_events', COUNT(*),
    'total_source_markets', COALESCE(SUM(e.source_markets_count), 0),
    'total_db_markets', (
      SELECT COUNT(*) FROM markets m
      JOIN events ev ON ev.id = m.event_id
      WHERE ev.source = 'leon'
        AND ev.status IN ('prematch', 'live')
        AND m.is_active = true
        AND ev.sport_id NOT IN (SELECT id FROM sports WHERE slug LIKE 'giocatori-%')
    ),
    'zero_market_events', COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM markets m WHERE m.event_id = e.id AND m.is_active = true
      )
    )
  ) INTO kpis
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  WHERE e.source = 'leon'
    AND e.status IN ('prematch', 'live')
    AND s.slug NOT LIKE 'giocatori-%';

  -- Coverage %
  kpis := kpis || jsonb_build_object(
    'coverage_pct',
    CASE WHEN (kpis->>'total_source_markets')::bigint > 0
      THEN ROUND(((kpis->>'total_db_markets')::numeric / (kpis->>'total_source_markets')::numeric) * 100, 1)
      ELSE 100
    END
  );

  -- Summary per sport
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'events')::int DESC), '[]'::jsonb)
  INTO sport_summary
  FROM (
    SELECT jsonb_build_object(
      'sport_name', s.name,
      'sport_slug', s.slug,
      'events', COUNT(*),
      'avg_source', ROUND(AVG(e.source_markets_count)::numeric, 1),
      'avg_db', ROUND(AVG(sub.db_count)::numeric, 1),
      'coverage_pct',
        CASE WHEN SUM(e.source_markets_count) > 0
          THEN ROUND((SUM(sub.db_count)::numeric / SUM(e.source_markets_count)::numeric) * 100, 1)
          ELSE 100
        END,
      'gap_events', COUNT(*) FILTER (
        WHERE e.source_markets_count > sub.db_count
      ),
      'zero_markets', COUNT(*) FILTER (WHERE sub.db_count = 0)
    ) AS row_data
    FROM events e
    JOIN sports s ON s.id = e.sport_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS db_count
      FROM markets m
      WHERE m.event_id = e.id AND m.is_active = true
    ) sub ON true
    WHERE e.source = 'leon'
      AND e.status IN ('prematch', 'live')
      AND s.slug NOT LIKE 'giocatori-%'
    GROUP BY s.name, s.slug
  ) t;

  -- Top 100 gap events
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'gap')::int DESC), '[]'::jsonb)
  INTO gap_events
  FROM (
    SELECT jsonb_build_object(
      'event_id', e.id,
      'external_id', e.external_id,
      'home_team', e.home_team,
      'away_team', e.away_team,
      'sport_name', s.name,
      'sport_slug', s.slug,
      'league_name', l.name,
      'status', e.status,
      'source_count', e.source_markets_count,
      'vincitu_count', sub.db_count,
      'gap', e.source_markets_count - sub.db_count,
      'coverage_pct', CASE WHEN e.source_markets_count > 0
        THEN ROUND((sub.db_count::numeric / e.source_markets_count::numeric) * 100, 1)
        ELSE 100
      END,
      'starts_at', e.starts_at
    ) AS row_data
    FROM events e
    JOIN sports s ON s.id = e.sport_id
    LEFT JOIN leagues l ON l.id = e.league_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS db_count
      FROM markets m
      WHERE m.event_id = e.id AND m.is_active = true
    ) sub ON true
    WHERE e.source = 'leon'
      AND e.status IN ('prematch', 'live')
      AND s.slug NOT LIKE 'giocatori-%'
      AND e.source_markets_count > sub.db_count
    ORDER BY (e.source_markets_count - sub.db_count) DESC
    LIMIT 100
  ) t;

  result := jsonb_build_object(
    'kpis', kpis,
    'summary', sport_summary,
    'gap_events', gap_events,
    'generated_at', NOW()
  );

  RETURN result;
END;
$$;
