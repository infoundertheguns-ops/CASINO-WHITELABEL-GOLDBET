-- ═══════════════════════════════════════════════════
-- Migration 086: Consensus Fix
--
-- Fixes 4 bugs on /admin/consensus:
-- 1. RPC crash (ON CONFLICT duplicate) after mig 040 via canonical_key collapse.
-- 2. Duplicate UI rows (time-series without latest-dedup).
-- 3. Mono-sport dropdown (regex-only pair matching, no flashscore pivot).
-- 4. Prepares ground for future canonical_event_id migration (089).
--
-- Q1=B: DISTINCT ON ordering = abs(delta_pct) DESC, twobet_outcomes_count DESC,
--       twobet_market_type_raw ASC.
--
-- Preserves mig 040 performance pattern: event time filter (now-1h, now+7d)
-- and pre-aggregated market size via subquery (no window function).
-- See docs/superpowers/specs/2026-04-22-consensus-event-normalization-manual-override-design.md
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- 086.1 — Add metadata columns for dedup visibility
-- -----------------------------------------------------

ALTER TABLE consensus_snapshots
  ADD COLUMN IF NOT EXISTS twobet_outcomes_count integer,
  ADD COLUMN IF NOT EXISTS twobet_market_type_raw text;

-- -----------------------------------------------------
-- 086.2 — Rewrite refresh_consensus_snapshots RPC
-- Return type changes (adds dropped_dedup column) so must DROP first.
-- -----------------------------------------------------

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
  -- ─────────────────────────────────────────────────
  -- Matched event pairs (kambi × 22bet)
  -- Priority 1: flashscore_id pivot (exact match, any sport).
  -- Priority 2: regex fuzzy fallback (preserved from mig 040).
  -- Time filter applied to prune historical events.
  -- ─────────────────────────────────────────────────
  CREATE TEMP TABLE IF NOT EXISTS tmp_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (kambi_id)
    kambi_id, twobet_id, sport_id, sport_name, home_team, away_team, starts_at
  FROM (
    -- Priority 1: flashscore_id pivot
    SELECT
      k.id AS kambi_id, t.id AS twobet_id,
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

    -- Priority 2: regex fuzzy fallback
    SELECT
      k.id, t.id, k.sport_id, s.name,
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

  -- ─────────────────────────────────────────────────
  -- Candidates: joined kambi × 22bet markets/outcomes with delta above threshold.
  -- Uses LEFT JOIN market_normalization per mig 040 pattern.
  -- Pre-aggregates twobet market size via scalar subquery (no window function).
  -- ─────────────────────────────────────────────────
  WITH
  kambi_markets AS (
    SELECT
      p.kambi_id, p.twobet_id, p.sport_name, p.home_team, p.away_team, p.starts_at,
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
  ),
  pair_odds AS (
    SELECT
      km.kambi_id, km.twobet_id, km.sport_name, km.home_team, km.away_team, km.starts_at,
      km.market_type,
      tm.market_type AS twobet_market_type_raw,
      tm.outcomes_count AS twobet_outcomes_count,
      ko.name AS outcome_name,
      ko.odds AS kambi_odds,
      to_.odds AS twobet_odds
    FROM kambi_markets km
    JOIN twobet_markets tm
      ON tm.twobet_id = km.twobet_id
     AND tm.match_key = km.match_key
    JOIN outcomes ko ON ko.market_id = km.market_id AND ko.is_active AND ko.odds >= 1.10
    JOIN outcomes to_ ON to_.market_id = tm.market_id AND to_.is_active AND to_.odds >= 1.10
                      AND to_.name = ko.name
  ),
  candidates AS (
    SELECT
      kambi_id, twobet_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds,
      twobet_outcomes_count, twobet_market_type_raw,
      round(((kambi_odds - twobet_odds) / twobet_odds * 100)::numeric, 2) AS delta_pct
    FROM pair_odds
    WHERE abs((kambi_odds - twobet_odds) / twobet_odds * 100) >= threshold_pct
  ),
  -- DISTINCT ON dedup: per (kambi_id, market_type, outcome_name) keep biggest abs delta
  dedup AS (
    SELECT DISTINCT ON (kambi_id, market_type, outcome_name)
      kambi_id, twobet_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, delta_pct,
      twobet_outcomes_count, twobet_market_type_raw
    FROM candidates
    ORDER BY kambi_id, market_type, outcome_name,
             abs(delta_pct) DESC,
             twobet_outcomes_count DESC NULLS LAST,
             twobet_market_type_raw ASC
  ),
  counted_pre AS (
    SELECT count(*) AS n FROM candidates
  ),
  counted_dedup AS (
    SELECT count(*) AS n FROM dedup
  ),
  upserted_rows AS (
    INSERT INTO consensus_snapshots (
      kambi_event_id, twobet_event_id, sport, home_team, away_team, event_starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, delta_pct,
      twobet_outcomes_count, twobet_market_type_raw
    )
    SELECT
      kambi_id, twobet_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, delta_pct,
      twobet_outcomes_count, twobet_market_type_raw
    FROM dedup
    ON CONFLICT (kambi_event_id, market_type, outcome_name,
                 (date_trunc('hour', snapshot_at AT TIME ZONE 'UTC')))
    DO UPDATE SET
      kambi_odds             = EXCLUDED.kambi_odds,
      twobet_odds            = EXCLUDED.twobet_odds,
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

  IF v_dropped_dedup > 0 THEN
    RAISE NOTICE 'consensus dedup: % candidates collapsed (% upserted, % dropped)',
      v_candidates, v_upserted, v_dropped_dedup;
  END IF;

  upserted         := v_upserted;
  scanned_pairs    := v_pairs;
  candidate_deltas := v_candidates;
  dropped_dedup    := v_dropped_dedup;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION refresh_consensus_snapshots IS
  'Refresh consensus_snapshots comparing Kambi vs 22bet odds on matched event pairs. Pair matching: flashscore_id pivot (priority 1) with regex fuzzy fallback (priority 2). Market join via market_normalization canonical_key with fallback. DISTINCT ON dedup on (kambi_event_id, market_type, outcome_name) keeps biggest delta, then biggest twobet outcomes_count, then market_type ASC (Q1=B).';

-- -----------------------------------------------------
-- 086.3 — View v_consensus_latest for UI
-- -----------------------------------------------------

CREATE OR REPLACE VIEW v_consensus_latest AS
SELECT DISTINCT ON (kambi_event_id, market_type, outcome_name)
  id, kambi_event_id, twobet_event_id, sport, home_team, away_team, event_starts_at,
  market_type, outcome_name, kambi_odds, twobet_odds, delta_pct, abs_delta_pct,
  twobet_outcomes_count, twobet_market_type_raw,
  snapshot_at, reviewed, reviewed_at, reviewed_by, notes
FROM consensus_snapshots
ORDER BY kambi_event_id, market_type, outcome_name, snapshot_at DESC;

COMMENT ON VIEW v_consensus_latest IS
  'Per-outlier latest snapshot for UI. Read by /admin/consensus listOutliers. KPIs + refresh still use consensus_snapshots base.';
