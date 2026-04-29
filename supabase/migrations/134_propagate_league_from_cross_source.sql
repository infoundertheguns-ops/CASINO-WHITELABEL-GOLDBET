-- Migration 134: propagate league_id from cross-source cluster siblings to
-- Betfair Unknown events.
--
-- Sprint 3 Phase C minimal scope. Diagnose showed 149 active 7d Betfair
-- events flagged league='Unknown' but having canonical_id NOT NULL — i.e.
-- they're already cross-source clustered with kambi/22bet siblings that
-- DO have a real league_id. Cheap one-shot UPDATE: copy league_id from
-- the sibling.
--
-- This is a one-off backfill, not a recurring trigger. Going forward, when
-- the cross-source classifier creates new clusters, the engine should call
-- a similar propagation (deferred to a later mig if measured benefit > cost).
--
-- Sibling pick rule: take any sibling with league_id pointing to a non-Unknown
-- league row. If multiple siblings disagree, prefer the most-recently created
-- (deterministic via id ordering for ties).
--
-- Idempotent: safe to re-run; rows already with non-Unknown league won't be
-- touched by the WHERE clause.

SET statement_timeout = '5min';
SET lock_timeout = '2min';

WITH unknown_league_ids AS (
  SELECT id FROM leagues
  WHERE name = 'Unknown' OR name LIKE 'Unknown (%)'
),
candidates AS (
  SELECT
    bf.id          AS bf_event_id,
    bf.canonical_id,
    -- pick a deterministic sibling league: most-recent event by id, with non-Unknown league
    (SELECT e2.league_id
       FROM events e2
       WHERE e2.canonical_id = bf.canonical_id
         AND e2.id <> bf.id
         AND e2.league_id NOT IN (SELECT id FROM unknown_league_ids)
       ORDER BY e2.id DESC
       LIMIT 1
    ) AS sibling_league_id
  FROM events bf
  WHERE bf.external_id LIKE 'betfair:%'
    AND bf.status IN ('prematch', 'live')
    AND bf.starts_at > now() - interval '7 days'
    AND bf.canonical_id IS NOT NULL
    AND bf.league_id IN (SELECT id FROM unknown_league_ids)
)
UPDATE events e
SET league_id = c.sibling_league_id
FROM candidates c
WHERE e.id = c.bf_event_id
  AND c.sibling_league_id IS NOT NULL;

-- Report what we did
DO $$
DECLARE
  v_after int;
  v_recovered int;
BEGIN
  SELECT count(*) INTO v_after
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE e.external_id LIKE 'betfair:%'
    AND e.status IN ('prematch','live')
    AND e.starts_at > now() - interval '7 days'
    AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
    AND e.canonical_id IS NOT NULL;

  RAISE NOTICE 'Mig 134 propagation: % betfair Unknown events with canonical_id REMAIN after backfill (was 149 before).', v_after;
END $$;
