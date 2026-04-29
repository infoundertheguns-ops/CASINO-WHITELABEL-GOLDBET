-- 107_consensus_line_aware.sql
-- Causa 2 fix (Kambi quote sballate investigation 2026-04-23):
--
-- The consensus RPC (refresh_consensus_snapshots) joins markets by
-- COALESCE(canonical_key, market_type). When two distinct raw market_types
-- with different handicap/total lines collapse onto the same canonical_key
-- (e.g. 22bet `Handicap 1 (-2)` and `Handicap 1 (+1.5)` both mapped to
-- canonical `asian_handicap_1` with no canonical_line), outcomes like "Home"
-- get joined across mismatched lines — yielding nonsense deltas like Kambi
-- -2 vs 22bet +1.5 compared as equivalent, which spams the outlier queue.
--
-- Fix: include markets.line in the JOIN key. Two markets only match if they
-- share the same canonical_key AND the same line (NULL=NULL treated as match).

BEGIN;

DROP FUNCTION IF EXISTS refresh_consensus_snapshots(numeric);

CREATE OR REPLACE FUNCTION refresh_consensus_snapshots(
  threshold_pct numeric DEFAULT 15
)
RETURNS TABLE(
  upserted         integer,
  scanned_pairs    integer,
  candidate_deltas integer,
  dropped_dedup    integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_upserted       integer := 0;
  v_pairs          integer := 0;
  v_candidates     integer := 0;
  v_dropped_dedup  integer := 0;
BEGIN
  -- Matched event pairs (unchanged from 101)
  CREATE TEMP TABLE IF NOT EXISTS tmp_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (kambi_id)
    kambi_id, twobet_id, betfair_id, sport_id, sport_name, home_team, away_team, starts_at
  FROM (
    SELECT
      k.id AS kambi_id,
      t.id AS twobet_id,
      (SELECT b.id FROM events b WHERE b.source = 'betfair' AND b.flashscore_id = k.flashscore_id
         AND b.starts_at > now() - interval '1 hour' AND b.starts_at < now() + interval '7 days' LIMIT 1) AS betfair_id,
      k.sport_id, s.name AS sport_name,
      k.home_team, k.away_team, k.starts_at,
      1 AS match_priority, 0::double precision AS time_dist
    FROM events k
    JOIN events t ON k.flashscore_id = t.flashscore_id
    JOIN sports s ON s.id = k.sport_id
    WHERE k.source = 'kambi' AND t.source = '22bet'
      AND k.flashscore_id IS NOT NULL
      AND k.starts_at > now() - interval '1 hour'
      AND k.starts_at < now() + interval '7 days'

    UNION ALL

    SELECT
      k.id AS kambi_id,
      NULL::uuid AS twobet_id,
      b.id AS betfair_id,
      k.sport_id, s.name,
      k.home_team, k.away_team, k.starts_at,
      1 AS match_priority, 0::double precision AS time_dist
    FROM events k
    JOIN events b ON b.source = 'betfair' AND b.flashscore_id = k.flashscore_id
    JOIN sports s ON s.id = k.sport_id
    WHERE k.source = 'kambi'
      AND k.flashscore_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM events t2 WHERE t2.source = '22bet' AND t2.flashscore_id = k.flashscore_id
      )
      AND k.starts_at > now() - interval '1 hour'
      AND k.starts_at < now() + interval '7 days'

    UNION ALL

    SELECT
      k.id, t.id,
      NULL::uuid AS betfair_id,
      k.sport_id, s.name,
      k.home_team, k.away_team, k.starts_at,
      2 AS match_priority,
      abs(extract(epoch FROM (k.starts_at - t.starts_at))) AS time_dist
    FROM events k
    JOIN events t ON
      lower(regexp_replace(k.home_team, '[^a-zA-Z0-9]', '', 'g')) =
      lower(regexp_replace(t.home_team, '[^a-zA-Z0-9]', '', 'g'))
      AND lower(regexp_replace(k.away_team, '[^a-zA-Z0-9]', '', 'g')) =
          lower(regexp_replace(t.away_team, '[^a-zA-Z0-9]', '', 'g'))
      AND date_trunc('hour', k.starts_at) = date_trunc('hour', t.starts_at)
    JOIN sports s ON s.id = k.sport_id
    WHERE k.source = 'kambi' AND t.source = '22bet'
      AND k.starts_at > now() - interval '1 hour'
      AND k.starts_at < now() + interval '7 days'
  ) combined
  ORDER BY kambi_id, match_priority ASC, time_dist ASC;

  SELECT count(*) INTO v_pairs FROM tmp_pairs;

  WITH
  kambi_markets AS (
    SELECT
      p.kambi_id, p.twobet_id, p.betfair_id,
      p.sport_name, p.home_team, p.away_team, p.starts_at,
      km.id AS market_id,
      km.market_type,
      km.line AS market_line,                               -- CAUSA 2: include line
      COALESCE(kn.canonical_key, km.market_type) AS match_key
    FROM tmp_pairs p
    JOIN markets km ON km.event_id = p.kambi_id AND km.is_active = true
    LEFT JOIN market_normalization kn
      ON kn.source = 'kambi' AND kn.source_market_type = km.market_type
  ),
  twobet_markets AS (
    SELECT
      p.twobet_id,
      tm.id AS market_id,
      tm.market_type,
      tm.line AS market_line,                               -- CAUSA 2: include line
      COALESCE(tn.canonical_key, tm.market_type) AS match_key,
      (SELECT count(*) FROM outcomes o
         WHERE o.market_id = tm.id AND o.is_active AND o.odds >= 1.10) AS outcomes_count
    FROM tmp_pairs p
    JOIN markets tm ON tm.event_id = p.twobet_id AND tm.is_active = true
    LEFT JOIN market_normalization tn
      ON tn.source = '22bet' AND tn.source_market_type = tm.market_type
    WHERE p.twobet_id IS NOT NULL
  ),
  betfair_markets AS (
    SELECT
      p.betfair_id,
      bm.id AS market_id,
      bm.market_type,
      bm.line AS market_line,                               -- CAUSA 2: include line
      COALESCE(bn.canonical_key, bm.market_type) AS match_key
    FROM tmp_pairs p
    JOIN markets bm ON bm.event_id = p.betfair_id AND bm.is_active = true
    LEFT JOIN market_normalization bn
      ON bn.source = 'betfair' AND bn.source_market_type = bm.market_type
    WHERE p.betfair_id IS NOT NULL
  ),
  pair_odds AS (
    SELECT
      km.kambi_id, km.twobet_id, km.betfair_id,
      km.sport_name, km.home_team, km.away_team, km.starts_at,
      km.market_type,
      km.market_line,
      COALESCE(tm.market_type, bm.market_type) AS counterpart_market_type_raw,
      COALESCE(tm.outcomes_count, 0) AS twobet_outcomes_count,
      ko.name AS outcome_name,
      ko.odds AS kambi_odds,
      to_.odds AS twobet_odds,
      bo.odds AS betfair_odds
    FROM kambi_markets km
    -- CAUSA 2: include line equality so handicap lines don't collapse onto same canonical.
    -- IS NOT DISTINCT FROM treats NULL=NULL as match (needed for non-line markets like 1X2).
    LEFT JOIN twobet_markets tm
      ON tm.twobet_id = km.twobet_id
     AND tm.match_key = km.match_key
     AND tm.market_line IS NOT DISTINCT FROM km.market_line
    LEFT JOIN betfair_markets bm
      ON bm.betfair_id = km.betfair_id
     AND bm.match_key = km.match_key
     AND bm.market_line IS NOT DISTINCT FROM km.market_line
    JOIN outcomes ko ON ko.market_id = km.market_id AND ko.is_active AND ko.odds >= 1.10
    LEFT JOIN outcomes to_ ON to_.market_id = tm.market_id AND to_.is_active AND to_.odds >= 1.10
                           AND to_.name = ko.name
    LEFT JOIN outcomes bo ON bo.market_id = bm.market_id AND bo.is_active AND bo.odds >= 1.10
                          AND bo.name = ko.name
    WHERE (to_.id IS NOT NULL) OR (bo.id IS NOT NULL)
  ),
  candidates AS (
    SELECT
      kambi_id, twobet_id, betfair_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, betfair_odds,
      twobet_outcomes_count, counterpart_market_type_raw,
      (COALESCE(twobet_odds, 0) + COALESCE(betfair_odds, 0))::numeric
        / NULLIF(((twobet_odds IS NOT NULL)::int + (betfair_odds IS NOT NULL)::int), 0) AS consensus_mean
    FROM pair_odds
  ),
  scored AS (
    SELECT
      *,
      round(((kambi_odds - consensus_mean) / NULLIF(consensus_mean, 0) * 100)::numeric, 2) AS delta_pct
    FROM candidates
    WHERE consensus_mean IS NOT NULL AND consensus_mean > 0
  ),
  filtered AS (
    SELECT * FROM scored WHERE abs(delta_pct) >= threshold_pct
  ),
  dedup AS (
    SELECT DISTINCT ON (kambi_id, market_type, outcome_name)
      kambi_id, twobet_id, betfair_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, betfair_odds, delta_pct,
      twobet_outcomes_count, counterpart_market_type_raw
    FROM filtered
    ORDER BY kambi_id, market_type, outcome_name,
             abs(delta_pct) DESC,
             twobet_outcomes_count DESC NULLS LAST,
             counterpart_market_type_raw ASC
  ),
  counted_pre AS (SELECT count(*) AS n FROM filtered),
  counted_dedup AS (SELECT count(*) AS n FROM dedup),
  upserted_rows AS (
    INSERT INTO consensus_snapshots (
      kambi_event_id, twobet_event_id, betfair_event_id,
      sport, home_team, away_team, event_starts_at,
      market_type, outcome_name,
      kambi_odds, twobet_odds, betfair_odds,
      delta_pct,
      twobet_outcomes_count, twobet_market_type_raw
    )
    SELECT
      kambi_id, twobet_id, betfair_id,
      sport_name, home_team, away_team, starts_at,
      market_type, outcome_name,
      kambi_odds, twobet_odds, betfair_odds,
      delta_pct,
      twobet_outcomes_count, counterpart_market_type_raw
    FROM dedup
    ON CONFLICT (kambi_event_id, market_type, outcome_name,
                 (date_trunc('hour', snapshot_at AT TIME ZONE 'UTC')))
    DO UPDATE SET
      kambi_odds             = EXCLUDED.kambi_odds,
      twobet_odds            = EXCLUDED.twobet_odds,
      betfair_odds           = EXCLUDED.betfair_odds,
      betfair_event_id       = EXCLUDED.betfair_event_id,
      twobet_event_id        = EXCLUDED.twobet_event_id,
      delta_pct              = EXCLUDED.delta_pct,
      twobet_outcomes_count  = EXCLUDED.twobet_outcomes_count,
      twobet_market_type_raw = EXCLUDED.twobet_market_type_raw,
      snapshot_at            = now()
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM upserted_rows),
    (SELECT n FROM counted_pre),
    (SELECT n FROM counted_pre) - (SELECT n FROM counted_dedup)
  INTO v_upserted, v_candidates, v_dropped_dedup;

  DROP TABLE IF EXISTS tmp_pairs;

  upserted         := v_upserted;
  scanned_pairs    := v_pairs;
  candidate_deltas := v_candidates;
  dropped_dedup    := v_dropped_dedup;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION refresh_consensus_snapshots IS
  'Refresh consensus_snapshots with 3-source triangulation (kambi vs mean(22bet, betfair)). v107: added markets.line to JOIN key (IS NOT DISTINCT FROM) to fix Causa 2 canonical-key collapse (Handicap -2 vs +1.5 no longer compared as equivalent). Peso 1.0 each on non-kambi sources.';

COMMIT;
