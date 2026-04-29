-- ════════════════════════════════════════════════════════════
-- 101_consensus_include_betfair.sql
--
-- Phase 3 Part 3 — include Betfair in consensus outlier detection.
-- User decision 2026-04-23: Betfair weight 1.0 (full triangulation).
--
-- Semantic: consensus_mean = AVG of NON-KAMBI sources (22bet + betfair)
-- per outcome. kambi_delta = (kambi_odds - consensus_mean) / consensus_mean.
-- auto_suspend_consensus_outliers targets kambi → uses this delta directly
-- (code unchanged, just reads new data).
--
-- Pair matching: flashscore_id pivot for all 3 sources (priority 1), plus
-- regex fuzzy fallback for kambi×22bet (priority 2). Betfair-only added
-- via flashscore_id (no regex needed — betfair uses same flashscore pivot).
--
-- Schema change: ALTER consensus_snapshots ADD betfair_event_id + betfair_odds.
-- v_consensus_latest extended accordingly.
-- ════════════════════════════════════════════════════════════

SET statement_timeout='300s';

BEGIN;

-- 101.1 — Schema extension
ALTER TABLE consensus_snapshots
  ADD COLUMN IF NOT EXISTS betfair_event_id uuid,
  ADD COLUMN IF NOT EXISTS betfair_odds numeric;

-- Allow pure kambi×betfair snapshots (22bet optional)
ALTER TABLE consensus_snapshots ALTER COLUMN twobet_event_id DROP NOT NULL;
ALTER TABLE consensus_snapshots ALTER COLUMN twobet_odds DROP NOT NULL;

-- 101.2 — Rewrite RPC with 3-source consensus
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
  -- ─────────────────────────────────────────────
  -- Matched event pairs: kambi × (22bet ∪ betfair)
  -- Priority 1: flashscore_id pivot
  -- Priority 2: regex fuzzy (kambi × 22bet only)
  -- One kambi event may now have 22bet and/or betfair counterparts.
  -- ─────────────────────────────────────────────
  CREATE TEMP TABLE IF NOT EXISTS tmp_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (kambi_id)
    kambi_id, twobet_id, betfair_id, sport_id, sport_name, home_team, away_team, starts_at
  FROM (
    -- Priority 1a: flashscore_id pivot with 22bet + optional betfair
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

    -- Priority 1b: kambi × betfair via flashscore (no 22bet counterpart)
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

    -- Priority 2: regex fuzzy (kambi × 22bet, no betfair on fallback)
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

  -- ─────────────────────────────────────────────
  -- Candidates: 3-source join on canonical market_type + outcome_name.
  -- consensus_mean = AVG(non-null of twobet_odds, betfair_odds)
  -- kambi_delta_pct = (kambi - consensus_mean) / consensus_mean
  -- ─────────────────────────────────────────────
  WITH
  kambi_markets AS (
    SELECT
      p.kambi_id, p.twobet_id, p.betfair_id,
      p.sport_name, p.home_team, p.away_team, p.starts_at,
      km.id AS market_id,
      km.market_type,
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
      COALESCE(tm.market_type, bm.market_type) AS counterpart_market_type_raw,
      COALESCE(tm.outcomes_count, 0) AS twobet_outcomes_count,
      ko.name AS outcome_name,
      ko.odds AS kambi_odds,
      to_.odds AS twobet_odds,
      bo.odds AS betfair_odds
    FROM kambi_markets km
    LEFT JOIN twobet_markets tm
      ON tm.twobet_id = km.twobet_id
     AND tm.match_key = km.match_key
    LEFT JOIN betfair_markets bm
      ON bm.betfair_id = km.betfair_id
     AND bm.match_key = km.match_key
    JOIN outcomes ko ON ko.market_id = km.market_id AND ko.is_active AND ko.odds >= 1.10
    LEFT JOIN outcomes to_ ON to_.market_id = tm.market_id AND to_.is_active AND to_.odds >= 1.10
                           AND to_.name = ko.name
    LEFT JOIN outcomes bo ON bo.market_id = bm.market_id AND bo.is_active AND bo.odds >= 1.10
                          AND bo.name = ko.name
    -- require at least one counterpart source with matching outcome
    WHERE (to_.id IS NOT NULL) OR (bo.id IS NOT NULL)
  ),
  candidates AS (
    SELECT
      kambi_id, twobet_id, betfair_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, betfair_odds,
      twobet_outcomes_count, counterpart_market_type_raw,
      -- Non-kambi consensus (mean of available 22bet, betfair). Equal weight.
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
  -- DISTINCT ON: one per outcome, biggest abs delta
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
  'Refresh consensus_snapshots with 3-source triangulation (kambi vs mean(22bet, betfair)). Peso 1.0 each on non-kambi sources. Pair matching: flashscore_id for all 3 (priority 1) + regex fallback kambi×22bet (priority 2). delta_pct = (kambi - consensus_mean) / consensus_mean * 100.';

-- 101.3 — v_consensus_latest extended to expose betfair_odds
DROP VIEW IF EXISTS v_consensus_latest;
CREATE VIEW v_consensus_latest AS
SELECT DISTINCT ON (kambi_event_id, market_type, outcome_name)
  id, kambi_event_id, twobet_event_id, betfair_event_id,
  sport, home_team, away_team, event_starts_at,
  market_type, outcome_name,
  kambi_odds, twobet_odds, betfair_odds,
  delta_pct, abs_delta_pct,
  twobet_outcomes_count, twobet_market_type_raw,
  snapshot_at, reviewed, reviewed_at, reviewed_by, notes
FROM consensus_snapshots
ORDER BY kambi_event_id, market_type, outcome_name, snapshot_at DESC;

COMMENT ON VIEW v_consensus_latest IS
  'Per-outlier latest snapshot. delta_pct = kambi vs mean(22bet+betfair). Used by /admin/consensus + auto_suspend_consensus_outliers.';

COMMIT;
