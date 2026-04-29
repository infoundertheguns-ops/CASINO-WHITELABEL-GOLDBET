-- Migration 126: events.canonical_id (synthetic cross-source UUID)
--                + assign_event_cross_source_canonical_id(uuid) RPC.
--
-- Sprint 3 Phase A — links events that exist as 2-3 separate rows on
-- Kambi/22bet/Betfair because they lack a flashscore_id but share team
-- names + start time. Once linked, the consensus 3-source path works
-- and `/admin/canonicalization` Esplora groups them as "🟣 cross-source"
-- instead of "❌ Single source only".
--
-- Algorithm (per target event):
--   1. Find candidates: same sport_id, different source prefix in
--      external_id, |Δstarts_at| <= 30min, status not ended, skip
--      placeholder home_team. Threshold = 0.85 on both home AND away
--      normalize_team_name similarity (mig 118).
--   2. If any candidate already has canonical_id → reuse, propagate
--      to target + any other unassigned matches.
--   3. Else if matches exist → mint new uuid, assign all.
--   4. Else → no_match.
--
-- Idempotent: if target already has canonical_id, returns 'kept'.
-- Placeholder events ('Home', 'Home (Special bets)', '% +') return
-- 'skipped_placeholder'.
--
-- Returns jsonb: { canonical_id, cluster_size, action }
-- where action ∈ 'kept' | 'reused' | 'created' | 'no_match' |
--                'skipped_placeholder' | 'event_not_found'.
--
-- Reuses normalize_team_name() from mig 118 (IMMUTABLE, public.unaccent).
-- Reuses gen_random_uuid() from extensions/pgcrypto.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS assign_event_cross_source_canonical_id(uuid);
--   DROP INDEX IF EXISTS idx_events_canonical_id;
--   ALTER TABLE events DROP COLUMN IF EXISTS canonical_id;

-- Grant ourselves headroom: ALTER TABLE on the hot events table can wait on
-- an AccessExclusive lock. Default pooler statement_timeout (~30s) is not
-- enough during peak ingestion windows.
SET statement_timeout = '10min';
SET lock_timeout = '5min';

ALTER TABLE events ADD COLUMN IF NOT EXISTS canonical_id uuid;
CREATE INDEX IF NOT EXISTS idx_events_canonical_id
  ON events(canonical_id)
  WHERE canonical_id IS NOT NULL;

CREATE OR REPLACE FUNCTION assign_event_cross_source_canonical_id(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_existing uuid;
  v_match_canonical uuid;
  v_new_id uuid;
  v_size int;
  v_has_match boolean;
  v_target events%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'event_not_found', 'canonical_id', NULL);
  END IF;

  -- Idempotency: already canonical → return kept.
  v_existing := v_target.canonical_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'canonical_id', v_existing,
      'cluster_size', NULL,
      'action', 'kept'
    );
  END IF;

  -- Skip placeholders (synthetic source-only rows from 22bet "Special bets" etc).
  IF v_target.home_team IN ('Home', 'Home (Special bets)')
     OR v_target.home_team LIKE '% +' THEN
    RETURN jsonb_build_object(
      'canonical_id', NULL,
      'cluster_size', 0,
      'action', 'skipped_placeholder'
    );
  END IF;

  -- Hunt cross-source matches. Reuse normalize_team_name (mig 118).
  -- Pull candidates with their canonical_ids in one pass; reuse the first
  -- non-null canonical_id we find.
  WITH candidates AS (
    SELECT e2.id, e2.canonical_id
    FROM events e2
    WHERE e2.id <> p_event_id
      AND e2.sport_id = v_target.sport_id
      AND e2.status IN ('prematch', 'live')
      AND substring(e2.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
      AND e2.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e2.home_team NOT LIKE '% +'
      AND abs(extract(epoch FROM (e2.starts_at - v_target.starts_at))) <= 1800
      AND similarity(normalize_team_name(e2.home_team), normalize_team_name(v_target.home_team)) >= 0.85
      AND similarity(normalize_team_name(e2.away_team), normalize_team_name(v_target.away_team)) >= 0.85
  )
  SELECT
    (array_agg(canonical_id) FILTER (WHERE canonical_id IS NOT NULL))[1],
    EXISTS (SELECT 1 FROM candidates)
  INTO v_match_canonical, v_has_match
  FROM candidates;

  IF v_match_canonical IS NOT NULL THEN
    -- Reuse: assign target + propagate to siblings still unassigned.
    UPDATE events SET canonical_id = v_match_canonical WHERE id = p_event_id;
    UPDATE events e SET canonical_id = v_match_canonical
      WHERE e.canonical_id IS NULL
        AND e.id IN (
          SELECT e2.id FROM events e2
          WHERE e2.id <> p_event_id
            AND e2.sport_id = v_target.sport_id
            AND e2.status IN ('prematch', 'live')
            AND substring(e2.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
            AND e2.home_team NOT IN ('Home', 'Home (Special bets)')
            AND e2.home_team NOT LIKE '% +'
            AND abs(extract(epoch FROM (e2.starts_at - v_target.starts_at))) <= 1800
            AND similarity(normalize_team_name(e2.home_team), normalize_team_name(v_target.home_team)) >= 0.85
            AND similarity(normalize_team_name(e2.away_team), normalize_team_name(v_target.away_team)) >= 0.85
        );
    SELECT count(*)::int INTO v_size FROM events WHERE canonical_id = v_match_canonical;
    RETURN jsonb_build_object(
      'canonical_id', v_match_canonical,
      'cluster_size', v_size,
      'action', 'reused'
    );
  END IF;

  IF v_has_match THEN
    -- Mint new canonical_id and assign target + all matches.
    v_new_id := gen_random_uuid();
    UPDATE events e SET canonical_id = v_new_id
      WHERE e.canonical_id IS NULL
        AND (
          e.id = p_event_id
          OR (
            e.sport_id = v_target.sport_id
            AND e.status IN ('prematch', 'live')
            AND substring(e.external_id from '^[^:]+') <> substring(v_target.external_id from '^[^:]+')
            AND e.home_team NOT IN ('Home', 'Home (Special bets)')
            AND e.home_team NOT LIKE '% +'
            AND abs(extract(epoch FROM (e.starts_at - v_target.starts_at))) <= 1800
            AND similarity(normalize_team_name(e.home_team), normalize_team_name(v_target.home_team)) >= 0.85
            AND similarity(normalize_team_name(e.away_team), normalize_team_name(v_target.away_team)) >= 0.85
          )
        );
    SELECT count(*)::int INTO v_size FROM events WHERE canonical_id = v_new_id;
    RETURN jsonb_build_object(
      'canonical_id', v_new_id,
      'cluster_size', v_size,
      'action', 'created'
    );
  END IF;

  RETURN jsonb_build_object(
    'canonical_id', NULL,
    'cluster_size', 0,
    'action', 'no_match'
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION assign_event_cross_source_canonical_id(uuid) TO authenticated, service_role;
