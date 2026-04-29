-- ══════════════════════════════════════════════════════════════════════
-- Migration 040 — Consensus refresh uses canonical_key when available
--
-- Previous implementation matched markets literally on market_type across
-- sources. Kambi writes "1X2" while 22bet writes "Vincente Incontro" for
-- the same concept, so the join dropped them silently.
--
-- This version joins through `market_normalization`: if BOTH sides have
-- a canonical_key, match on that; otherwise fall back to the literal
-- market_type comparison (backwards compatible with unmapped data).
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_consensus_snapshots(
  threshold_pct numeric DEFAULT 15
)
RETURNS TABLE(
  upserted         integer,
  scanned_pairs    integer,
  candidate_deltas integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_upserted   integer;
  v_pairs      integer;
  v_candidates integer;
BEGIN
  -- Matched event pairs (kambi × 22bet) — DISTINCT ON picks the closest-in-time 22bet event per kambi event.
  CREATE TEMP TABLE IF NOT EXISTS tmp_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (k.id)
    k.id       AS kambi_id,
    t.id       AS twobet_id,
    k.sport_id,
    s.name     AS sport_name,
    k.home_team,
    k.away_team,
    k.starts_at
  FROM events k
  JOIN events t ON
      lower(regexp_replace(k.home_team, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(t.home_team, '[^a-zA-Z0-9]', '', 'g'))
      AND lower(regexp_replace(k.away_team, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(t.away_team, '[^a-zA-Z0-9]', '', 'g'))
      AND date_trunc('hour', k.starts_at) = date_trunc('hour', t.starts_at)
  JOIN sports s ON s.id = k.sport_id
  WHERE k.source    = 'kambi'
    AND t.source    = '22bet'
    AND k.starts_at > now() - interval '1 hour'
    AND k.starts_at < now() + interval '7 days'
  ORDER BY k.id, abs(extract(epoch FROM (k.starts_at - t.starts_at)));

  SELECT count(*) INTO v_pairs FROM tmp_pairs;

  WITH
  -- Enrich each side's active markets with the canonical key (fallback to raw market_type)
  kambi_markets AS (
    SELECT
      p.kambi_id,
      p.twobet_id,
      p.sport_name,
      p.home_team,
      p.away_team,
      p.starts_at,
      km.id                                 AS market_id,
      km.market_type                        AS market_type,
      COALESCE(kn.canonical_key, km.market_type) AS match_key
    FROM tmp_pairs p
    JOIN markets km ON km.event_id = p.kambi_id AND km.is_active = true
    LEFT JOIN market_normalization kn
      ON kn.source = 'kambi' AND kn.source_market_type = km.market_type
  ),
  twobet_markets AS (
    SELECT
      p.twobet_id,
      tm.id                                 AS market_id,
      tm.market_type                        AS market_type,
      COALESCE(tn.canonical_key, tm.market_type) AS match_key
    FROM tmp_pairs p
    JOIN markets tm ON tm.event_id = p.twobet_id AND tm.is_active = true
    LEFT JOIN market_normalization tn
      ON tn.source = '22bet' AND tn.source_market_type = tm.market_type
  ),
  pair_odds AS (
    SELECT
      km.kambi_id, km.twobet_id, km.sport_name, km.home_team, km.away_team, km.starts_at,
      km.market_type,
      ko.name  AS outcome_name,
      ko.odds  AS kambi_odds,
      to_.odds AS twobet_odds
    FROM kambi_markets km
    JOIN twobet_markets tm
      ON tm.twobet_id = km.twobet_id
     AND tm.match_key = km.match_key
    JOIN outcomes ko  ON ko.market_id  = km.market_id AND ko.is_active  = true
    JOIN outcomes to_ ON to_.market_id = tm.market_id AND to_.is_active = true AND to_.name = ko.name
    WHERE ko.odds >= 1.10 AND to_.odds >= 1.10
  ),
  candidates AS (
    SELECT
      kambi_id, twobet_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds,
      round(((kambi_odds - twobet_odds) / twobet_odds * 100)::numeric, 2) AS delta_pct
    FROM pair_odds
  ),
  counted_candidates AS (
    SELECT count(*) AS n FROM candidates WHERE abs(delta_pct) >= threshold_pct
  ),
  upserted_rows AS (
    INSERT INTO consensus_snapshots (
      kambi_event_id, twobet_event_id, sport, home_team, away_team, event_starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, delta_pct
    )
    SELECT
      kambi_id, twobet_id, sport_name, home_team, away_team, starts_at,
      market_type, outcome_name, kambi_odds, twobet_odds, delta_pct
    FROM candidates
    WHERE abs(delta_pct) >= threshold_pct
    ON CONFLICT (kambi_event_id, market_type, outcome_name, (date_trunc('hour', snapshot_at AT TIME ZONE 'UTC')))
    DO UPDATE SET
      kambi_odds  = EXCLUDED.kambi_odds,
      twobet_odds = EXCLUDED.twobet_odds,
      delta_pct   = EXCLUDED.delta_pct,
      snapshot_at = now()
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM upserted_rows),
    (SELECT n FROM counted_candidates)
  INTO v_upserted, v_candidates;

  DROP TABLE IF EXISTS tmp_pairs;

  upserted         := v_upserted;
  scanned_pairs    := v_pairs;
  candidate_deltas := v_candidates;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION refresh_consensus_snapshots IS
  'Refresh consensus_snapshots by comparing Kambi vs 22bet odds on matched event pairs; joins markets on canonical_key when available, falls back to literal market_type.';
