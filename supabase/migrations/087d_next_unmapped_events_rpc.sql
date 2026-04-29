-- ═══════════════════════════════════════════════════
-- Migration 087d: next_unmapped_events RPC
--
-- Problem: backfill endpoint was doing:
--   SELECT events.* WHERE flashscore_id IS NULL AND id NOT IN (<excluded 500-5000 uuids>)
-- Supabase-js passes the NOT IN as URL query string. For ≥300 UUIDs the URL
-- exceeds ~8KB and the request 414s or silently returns 0 rows. Backfill
-- stalled at iter=2 with 0 processed despite 3500+ unmapped events.
--
-- Solution: server-side anti-join via LEFT JOIN/WHERE NOT EXISTS, exposed as
-- an RPC that returns the next batch of unmapped events.
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION next_unmapped_events(
  p_limit int DEFAULT 500,
  p_sport text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  home_team text,
  away_team text,
  starts_at timestamptz,
  source text,
  flashscore_id text,
  sport_name text,
  league_name text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.id, e.home_team, e.away_team, e.starts_at, e.source, e.flashscore_id,
    s.name AS sport_name,
    l.name AS league_name
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  LEFT JOIN leagues l ON l.id = e.league_id
  WHERE e.flashscore_id IS NULL
    AND e.status IN ('prematch','live')
    AND NOT EXISTS (SELECT 1 FROM event_normalization en WHERE en.event_id = e.id)
    AND (p_sport IS NULL OR s.name = p_sport)
  ORDER BY e.starts_at ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION next_unmapped_events IS
  'Server-side anti-join for backfill: returns next N events that have no event_normalization row yet. Avoids PostgREST URL-too-long on NOT IN with many uuids.';
