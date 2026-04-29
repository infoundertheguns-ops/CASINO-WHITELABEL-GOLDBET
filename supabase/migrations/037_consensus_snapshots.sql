-- ══════════════════════════════════════════════════════════════════════
-- Migration 037 — Consensus outlier detection (Kambi vs 22bet)
--
-- Flags odds that diverge significantly between sources. Cron populates
-- this table hourly by matching events cross-source via normalized
-- team names + hour bucket on starts_at.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consensus_snapshots (
  id                bigserial PRIMARY KEY,
  kambi_event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  twobet_event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sport             text NOT NULL,
  home_team         text NOT NULL,
  away_team         text NOT NULL,
  event_starts_at   timestamptz NOT NULL,

  market_type       text NOT NULL,
  outcome_name      text NOT NULL,

  kambi_odds        numeric NOT NULL,
  twobet_odds       numeric NOT NULL,
  delta_pct         numeric NOT NULL, -- (kambi - twobet) / twobet * 100 (positive = kambi higher)
  abs_delta_pct     numeric GENERATED ALWAYS AS (abs(delta_pct)) STORED,

  snapshot_at       timestamptz NOT NULL DEFAULT now(),

  reviewed          boolean NOT NULL DEFAULT false,
  reviewed_at       timestamptz,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes             text
);

-- One row per (event pair, market, outcome, hour bucket) — prevents
-- repeated inserts by an hourly cron running multiple times in the same hour.
CREATE UNIQUE INDEX IF NOT EXISTS consensus_unique_per_hour
  ON consensus_snapshots (
    kambi_event_id, market_type, outcome_name,
    (date_trunc('hour', snapshot_at AT TIME ZONE 'UTC'))
  );

CREATE INDEX IF NOT EXISTS idx_consensus_snapshot_at   ON consensus_snapshots (snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_consensus_abs_delta     ON consensus_snapshots (abs_delta_pct DESC);
CREATE INDEX IF NOT EXISTS idx_consensus_event_starts  ON consensus_snapshots (event_starts_at);
CREATE INDEX IF NOT EXISTS idx_consensus_sport         ON consensus_snapshots (sport);
CREATE INDEX IF NOT EXISTS idx_consensus_pending       ON consensus_snapshots (snapshot_at DESC) WHERE reviewed = false;

ALTER TABLE consensus_snapshots ENABLE ROW LEVEL SECURITY;
-- Service role bypasses RLS; no public policies.

COMMENT ON TABLE consensus_snapshots IS
  'Outliers detected by comparing Kambi vs 22bet odds on matched cross-source events. Populated hourly by /api/cron/consensus-snapshot.';
COMMENT ON COLUMN consensus_snapshots.delta_pct IS
  'Signed percentage delta: (kambi - twobet) / twobet * 100. Positive = Kambi offering higher odds than 22bet.';
COMMENT ON COLUMN consensus_snapshots.abs_delta_pct IS
  'Generated: abs(delta_pct). Use for "biggest outliers" queries.';

-- ──────────────────────────────────────────────────────────────────────
-- Helper view for admin dashboard (joins current team names + sport info)
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_consensus_recent AS
SELECT
  cs.id,
  cs.sport,
  cs.home_team,
  cs.away_team,
  cs.event_starts_at,
  cs.market_type,
  cs.outcome_name,
  cs.kambi_odds,
  cs.twobet_odds,
  cs.delta_pct,
  cs.abs_delta_pct,
  cs.snapshot_at,
  cs.reviewed,
  cs.notes,
  ke.external_id AS kambi_external_id,
  te.external_id AS twobet_external_id,
  ke.league_id   AS kambi_league_id
FROM consensus_snapshots cs
JOIN events ke ON ke.id = cs.kambi_event_id
JOIN events te ON te.id = cs.twobet_event_id
WHERE cs.event_starts_at > now() - interval '6 hours'
ORDER BY cs.snapshot_at DESC;

COMMENT ON VIEW v_consensus_recent IS 'Consensus outliers for events starting within last 6h or in future, newest first.';

-- ──────────────────────────────────────────────────────────────────────
-- RPC: refresh_consensus_snapshots(threshold_pct)
--
-- Finds cross-source event pairs (kambi + 22bet), compares current odds
-- on common (market_type, outcome_name), and upserts outliers exceeding
-- the threshold into consensus_snapshots.
--
-- Returns: (inserted int, updated int, total_delta int, scanned_pairs int)
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_consensus_snapshots(
  threshold_pct numeric DEFAULT 15
)
RETURNS TABLE(
  upserted integer,
  scanned_pairs integer,
  candidate_deltas integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_upserted integer;
  v_pairs integer;
  v_candidates integer;
BEGIN
  -- Temp table of matched pairs — DISTINCT ON (kambi_id) keeps a single
  -- best-match 22bet event per kambi event, breaking ties by closest starts_at.
  CREATE TEMP TABLE IF NOT EXISTS tmp_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (k.id)
    k.id AS kambi_id,
    t.id AS twobet_id,
    k.sport_id,
    s.name AS sport_name,
    k.home_team,
    k.away_team,
    k.starts_at
  FROM events k
  JOIN events t ON
    lower(regexp_replace(k.home_team, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(t.home_team, '[^a-zA-Z0-9]', '', 'g'))
    AND lower(regexp_replace(k.away_team, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(t.away_team, '[^a-zA-Z0-9]', '', 'g'))
    AND date_trunc('hour', k.starts_at) = date_trunc('hour', t.starts_at)
  JOIN sports s ON s.id = k.sport_id
  WHERE k.source = 'kambi'
    AND t.source = '22bet'
    AND k.starts_at > now() - interval '1 hour'
    AND k.starts_at < now() + interval '7 days'
  ORDER BY k.id, abs(extract(epoch FROM (k.starts_at - t.starts_at)));

  SELECT count(*) INTO v_pairs FROM tmp_pairs;

  WITH pair_odds AS (
    SELECT
      p.kambi_id, p.twobet_id, p.sport_name, p.home_team, p.away_team, p.starts_at,
      km.market_type,
      ko.name AS outcome_name,
      ko.odds AS kambi_odds,
      to_.odds AS twobet_odds
    FROM tmp_pairs p
    JOIN markets km ON km.event_id = p.kambi_id AND km.is_active = true
    JOIN outcomes ko ON ko.market_id = km.id AND ko.is_active = true
    JOIN markets tm ON tm.event_id = p.twobet_id AND tm.is_active = true AND tm.market_type = km.market_type
    JOIN outcomes to_ ON to_.market_id = tm.id AND to_.is_active = true AND to_.name = ko.name
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
      kambi_odds   = EXCLUDED.kambi_odds,
      twobet_odds  = EXCLUDED.twobet_odds,
      delta_pct    = EXCLUDED.delta_pct,
      snapshot_at  = now()
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM upserted_rows),
    (SELECT n FROM counted_candidates)
  INTO v_upserted, v_candidates;

  DROP TABLE IF EXISTS tmp_pairs;

  upserted := v_upserted;
  scanned_pairs := v_pairs;
  candidate_deltas := v_candidates;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION refresh_consensus_snapshots IS
  'Refresh consensus_snapshots by comparing current Kambi vs 22bet odds on cross-source matched event pairs.';
