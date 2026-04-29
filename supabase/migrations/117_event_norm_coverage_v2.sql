-- Migration 117: event_normalization_coverage_pct v2.
--
-- Fixes 3 issues from review #4 mig 115:
--
-- 1) ROLLUP source NULL was COALESCE'd to 'unknown' so the page rendered the
--    overall total as a separate "unknown" source instead of the Overall card.
--    Now NULL is preserved.
--
-- 2) Default counted status IN ('prematch','live','ended'). Ended events
--    inserted before the event-normalization pipeline became active dilute
--    the denominator for no good reason. Default is now 'prematch','live'
--    only — i.e. "events we can still bet on or are kicking off". Optional
--    p_include_ended switches back to the old behavior for historical view.
--
-- 3) 22bet emits placeholder synthetic events ("Home", "Home (Special bets)",
--    or team names ending in " +" for accumulator combos). These are not
--    real matches and have no Flashscore counterpart — they were polluting
--    the denominator. Excluded server-side here so the coverage % reflects
--    real-world matchable events.

DROP FUNCTION IF EXISTS event_normalization_coverage_pct(int);

CREATE OR REPLACE FUNCTION event_normalization_coverage_pct(
  p_window_days int DEFAULT 7,
  p_include_ended boolean DEFAULT false
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
    FROM events e
    WHERE starts_at >= now() - (p_window_days || ' days')::interval
      AND (
        CASE
          WHEN p_include_ended THEN status IN ('prematch','live','ended')
          ELSE status IN ('prematch','live')
        END
      )
      -- Filter 22bet placeholder/synthetic events: they have no real
      -- counterpart in be_fixtures and can never be canonically mapped.
      AND e.home_team IS NOT NULL
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
  )
  SELECT
    source,  -- NULL preserved for ROLLUP overall row
    COUNT(*)::bigint AS total_events,
    COUNT(flashscore_id)::bigint AS mapped_events,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(100.0 * COUNT(flashscore_id) / COUNT(*), 2)
    END AS coverage_pct
  FROM window_events
  GROUP BY ROLLUP(source)
  ORDER BY source NULLS FIRST;
$$;

GRANT EXECUTE ON FUNCTION event_normalization_coverage_pct(int, boolean) TO authenticated, service_role, anon;

COMMENT ON FUNCTION event_normalization_coverage_pct IS
  'Mapping coverage % per source + ROLLUP overall (source=NULL). Defaults to active events (prematch+live), excludes 22bet placeholder synthetics. Mig 117 supersedes mig 115.';
