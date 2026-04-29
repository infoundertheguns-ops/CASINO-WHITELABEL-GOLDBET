-- Migration 115: event-normalization review #4 RPCs.
--
-- Adds:
--   1. event_normalization_coverage_pct(p_window_days) — overall + per-source
--      coverage % so the page can show "current % vs ≥95% target".
--   2. event_normalization_low_confidence(...) — server-side filter for the
--      "Bassa confidence" tab (replaces broken client-side filter that ran
--      AFTER the 200-row paginated fetch).

-- ═══ Coverage %, overall + per source ═══
CREATE OR REPLACE FUNCTION event_normalization_coverage_pct(
  p_window_days int DEFAULT 7
)
RETURNS TABLE(
  source text,
  total_events bigint,
  mapped_events bigint,
  coverage_pct numeric
)
LANGUAGE sql STABLE AS $$
  WITH window_events AS (
    SELECT id, source, flashscore_id
    FROM events
    WHERE starts_at >= now() - (p_window_days || ' days')::interval
      AND status IN ('prematch','live','ended')
  )
  SELECT
    COALESCE(source, 'unknown') AS source,
    COUNT(*)::bigint AS total_events,
    COUNT(flashscore_id)::bigint AS mapped_events,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(100.0 * COUNT(flashscore_id) / COUNT(*), 2)
    END AS coverage_pct
  FROM window_events
  GROUP BY ROLLUP(source)
  ORDER BY source NULLS FIRST;
$$;

GRANT EXECUTE ON FUNCTION event_normalization_coverage_pct(int) TO authenticated, service_role, anon;

COMMENT ON FUNCTION event_normalization_coverage_pct IS
  'Returns mapping coverage % per source plus an overall ROLLUP row (source=NULL). Used by /admin/event-normalization KPI to surface the ≥95% pipeline target.';

-- ═══ Low-confidence list (server-side filter for tab) ═══
CREATE OR REPLACE FUNCTION event_normalization_low_confidence(
  p_max_confidence numeric DEFAULT 0.85,
  p_sport text DEFAULT NULL,
  p_exclude_stage text DEFAULT 'llm',
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  id bigint,
  event_id uuid,
  flashscore_id text,
  match_stage text,
  confidence numeric,
  llm_reason text,
  verified boolean,
  verified_at timestamptz,
  created_at timestamptz,
  events jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT
    en.id, en.event_id, en.flashscore_id, en.match_stage,
    en.confidence::numeric, en.llm_reason, en.verified, en.verified_at, en.created_at,
    jsonb_build_object(
      'id', e.id,
      'home_team', e.home_team,
      'away_team', e.away_team,
      'starts_at', e.starts_at,
      'source', e.source,
      'sport_id', e.sport_id,
      'flashscore_id', e.flashscore_id,
      'sports', jsonb_build_object('name', s.name)
    ) AS events
  FROM event_normalization en
  JOIN events e ON e.id = en.event_id
  JOIN sports s ON s.id = e.sport_id
  WHERE en.verified = false
    AND en.confidence < p_max_confidence
    AND (p_exclude_stage IS NULL OR en.match_stage <> p_exclude_stage)
    AND (p_sport IS NULL OR s.name = p_sport)
  ORDER BY en.confidence ASC, en.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION event_normalization_low_confidence(numeric, text, text, int, int) TO authenticated, service_role, anon;

COMMENT ON FUNCTION event_normalization_low_confidence IS
  'Server-side replacement for the broken client-side low-confidence filter. Pre-mig 115 the page fetched 200 rows verified=false then filtered confidence<0.85 in the browser, hiding low-conf rows past the first page.';
