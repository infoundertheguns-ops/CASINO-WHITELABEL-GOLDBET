-- supabase/migrations/152_settlement_coverage.sql
-- Plan D Phase 1.3 — settlement coverage observability schema + RPCs (D.1).
-- Single atomic migration. Apply via: node scripts/db/apply-mig.mjs --target <env> --file <this>.
-- Rollback: 152_settlement_coverage_rollback.sql.

BEGIN;

-- ========== Part A: events_v2.last_settled_at (Trigger A dedup token) ==========

ALTER TABLE events_v2
  ADD COLUMN IF NOT EXISTS last_settled_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_events_v2_settled_pending
  ON events_v2 (starts_at ASC)
  WHERE status = 'settled' AND last_settled_at IS NULL;

COMMENT ON COLUMN events_v2.last_settled_at IS
  'Plan D Trigger A dedup: set by /api/cron/odds-api-settle when score-only legs on this event have been processed.';

-- ========== Part B: market_categories_seed table + 86-row seed ==========
-- IMPORTANT: rows MUST match lib/settlement/market-categories-seed.json exactly.
-- The TS dict in lib/settlement/market-classification.ts is the source of truth;
-- equality enforced by tests/lib/settlement/market-categories-seed.equality.test.ts.

CREATE TABLE IF NOT EXISTS market_categories_seed (
  market_type TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('score','stats','player','special')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE market_categories_seed IS
  'Plan D — mirror of lib/settlement/market-classification.ts MARKET_CATEGORIES dict. Updates: regenerate JSON via npm run build:market-categories, then ship a new migration that re-INSERTs ON CONFLICT DO UPDATE. Never edit directly in prod.';

INSERT INTO market_categories_seed (market_type, category) VALUES
  -- score (40)
  ('1X2', 'score'),
  ('1X2 1T', 'score'),
  ('1X2 2T', 'score'),
  ('Vincente Incontro', 'score'),
  ('Doppia Chance', 'score'),
  ('Doppia Chance 1T', 'score'),
  ('Doppia Chance 2T', 'score'),
  ('Pareggio Escluso', 'score'),
  ('Handicap Asiatico', 'score'),
  ('Handicap Europeo', 'score'),
  ('Spread', 'score'),
  ('Spread 1T', 'score'),
  ('Spread 2T', 'score'),
  ('U/O 0.5', 'score'),
  ('U/O 1.5', 'score'),
  ('U/O 2.5', 'score'),
  ('U/O 3.5', 'score'),
  ('U/O 4.5', 'score'),
  ('U/O 5.5', 'score'),
  ('U/O 0.5 1T', 'score'),
  ('U/O 1.5 1T', 'score'),
  ('U/O 2.5 1T', 'score'),
  ('U/O 0.5 2T', 'score'),
  ('U/O 1.5 2T', 'score'),
  ('GG/NG', 'score'),
  ('GG/NG 1T', 'score'),
  ('GG/NG 2T', 'score'),
  ('HT/FT', 'score'),
  ('Risultato Esatto', 'score'),
  ('Risultato Esatto 1T', 'score'),
  ('Esatto', 'score'),
  ('Numero Goal', 'score'),
  ('Pari/Dispari Goal', 'score'),
  ('Pari/Dispari', 'score'),
  ('Goal/No Goal Squadra Casa', 'score'),
  ('Goal/No Goal Squadra Trasferta', 'score'),
  ('Totale Goal Squadra Casa', 'score'),
  ('Totale Goal Squadra Trasferta', 'score'),
  ('Risultato Finale', 'score'),
  ('Linea Goal', 'score'),
  -- stats (31)
  ('Corner', 'stats'),
  ('Totale Corner', 'stats'),
  ('Corner 2-Way', 'stats'),
  ('Corner Race', 'stats'),
  ('Corner Spread', 'stats'),
  ('Corner Handicap', 'stats'),
  ('U/O Corner 7.5', 'stats'),
  ('U/O Corner 8.5', 'stats'),
  ('U/O Corner 9.5', 'stats'),
  ('U/O Corner 10.5', 'stats'),
  ('U/O Corner 11.5', 'stats'),
  ('U/O Corner 12.5', 'stats'),
  ('Corner 1T', 'stats'),
  ('Totale Corner 1T', 'stats'),
  ('Corner Squadra Casa', 'stats'),
  ('Corner Squadra Trasferta', 'stats'),
  ('Cartellini', 'stats'),
  ('Totale Cartellini', 'stats'),
  ('U/O Cartellini 3.5', 'stats'),
  ('U/O Cartellini 4.5', 'stats'),
  ('U/O Cartellini 5.5', 'stats'),
  ('Tiri Totali', 'stats'),
  ('Tiri in Porta', 'stats'),
  ('Tiri Squadra Casa', 'stats'),
  ('Tiri Squadra Trasferta', 'stats'),
  ('Tiri in Porta Casa', 'stats'),
  ('Tiri in Porta Trasferta', 'stats'),
  ('Salvataggi Portiere', 'stats'),
  ('Tackles Totali', 'stats'),
  ('Tackles Squadra Casa', 'stats'),
  ('Tackles Squadra Trasferta', 'stats'),
  -- player (12)
  ('Marcatore', 'player'),
  ('Primo Marcatore', 'player'),
  ('Ultimo Marcatore', 'player'),
  ('Multi Marcatori', 'player'),
  ('Marcatore Squadra Casa', 'player'),
  ('Marcatore Squadra Trasferta', 'player'),
  ('Marca o Assist', 'player'),
  ('Tiri Giocatore', 'player'),
  ('Tiri in Porta Giocatore', 'player'),
  ('Falli Commessi Giocatore', 'player'),
  ('Falli Subiti Giocatore', 'player'),
  ('Tackles Giocatore', 'player'),
  -- special (3)
  ('Metodo Goal', 'special'),
  ('Primi 10 Minuti', 'special'),
  ('Specials', 'special')
ON CONFLICT (market_type) DO UPDATE SET
  category = EXCLUDED.category,
  updated_at = NOW();

-- ========== Part C: 5 RPCs ==========

-- C.1: settlement_coverage_kpis(window_days) — top-strip aggregation by category
DROP FUNCTION IF EXISTS settlement_coverage_kpis(int);
CREATE FUNCTION settlement_coverage_kpis(window_days int DEFAULT 7)
RETURNS TABLE(
  category TEXT, legs_total BIGINT, legs_won BIGINT, legs_lost BIGINT,
  legs_void BIGINT, legs_pending BIGINT, stake_total NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(mcs.category, 'unclassified') AS category,
    count(*) AS legs_total,
    count(*) FILTER (WHERE bs.result = 'won') AS legs_won,
    count(*) FILTER (WHERE bs.result = 'lost') AS legs_lost,
    count(*) FILTER (WHERE bs.result = 'void') AS legs_void,
    count(*) FILTER (WHERE bs.result IS NULL) AS legs_pending,
    COALESCE(sum(b.stake), 0) AS stake_total
  FROM bet_selections bs
  JOIN bets b ON b.id = bs.bet_id
  JOIN markets m ON m.id = bs.market_id
  LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
  WHERE b.created_at > NOW() - (window_days || ' days')::interval
  GROUP BY COALESCE(mcs.category, 'unclassified');
$$;

GRANT EXECUTE ON FUNCTION settlement_coverage_kpis(int) TO anon, authenticated, service_role;

-- C.2: settlement_coverage_list(window_days) — per-market_type catalog table
DROP FUNCTION IF EXISTS settlement_coverage_list(int);
CREATE FUNCTION settlement_coverage_list(window_days int DEFAULT 30)
RETURNS TABLE(
  market_type TEXT, category TEXT, sport TEXT, bet_count BIGINT,
  auto_settled BIGINT, manual_settled BIGINT, void_settled BIGINT,
  pending BIGINT, last_seen_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.market_type,
    COALESCE(mcs.category, 'unclassified') AS category,
    s.name AS sport,
    count(*) AS bet_count,
    count(*) FILTER (WHERE bs.result IN ('won','lost')) AS auto_settled,
    0::BIGINT AS manual_settled,
    count(*) FILTER (WHERE bs.result = 'void') AS void_settled,
    count(*) FILTER (WHERE bs.result IS NULL) AS pending,
    max(b.created_at) AS last_seen_at
  FROM bet_selections bs
  JOIN bets b ON b.id = bs.bet_id
  JOIN markets m ON m.id = bs.market_id
  JOIN events e ON e.id = m.event_id
  JOIN sports s ON s.id = e.sport_id
  LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
  WHERE b.created_at > NOW() - (window_days || ' days')::interval
  GROUP BY m.market_type, COALESCE(mcs.category, 'unclassified'), s.name
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION settlement_coverage_list(int) TO anon, authenticated, service_role;

-- C.3: settlement_coverage_filter_kpi(window_days) — STUB.
-- Body replaced in mig 154 (Part C) once derive_legacy_from_v2_filter_diff() exists.
-- Returns single-row zeros so frontend renders without erroring before mig 154.
DROP FUNCTION IF EXISTS settlement_coverage_filter_kpi(int);
CREATE FUNCTION settlement_coverage_filter_kpi(window_days int DEFAULT 7)
RETURNS TABLE(
  markets_filtered BIGINT, total_markets BIGINT, pct NUMERIC, reason TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT 0::BIGINT, 0::BIGINT, 0::NUMERIC, 'mig-154-pending'::TEXT;
$$;

GRANT EXECUTE ON FUNCTION settlement_coverage_filter_kpi(int) TO anon, authenticated, service_role;

-- C.4: settlement_coverage_sla_kpi(window_days) — % bets settled within target latency.
-- Targets: score legs ≤2 min from event status='settled', stats/player legs ≤24h from event finish.
DROP FUNCTION IF EXISTS settlement_coverage_sla_kpi(int);
CREATE FUNCTION settlement_coverage_sla_kpi(window_days int DEFAULT 7)
RETURNS TABLE(
  category TEXT, legs_settled BIGINT, legs_within_sla BIGINT, settled_within_sla_pct NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH classified AS (
    SELECT
      COALESCE(mcs.category, 'unclassified') AS category,
      bs.id,
      bs.result,
      e.starts_at,
      e.settled_at
    FROM bet_selections bs
    JOIN bets b ON b.id = bs.bet_id
    JOIN markets m ON m.id = bs.market_id
    JOIN events e ON e.id = m.event_id
    LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
    WHERE b.created_at > NOW() - (window_days || ' days')::interval
      AND bs.result IN ('won','lost','void','push')
  )
  SELECT
    category,
    count(*) AS legs_settled,
    count(*) FILTER (
      WHERE (category = 'score' AND settled_at IS NOT NULL AND EXTRACT(EPOCH FROM (settled_at - starts_at)) <= 7200)
         OR (category IN ('stats','player') AND settled_at IS NOT NULL AND EXTRACT(EPOCH FROM (settled_at - starts_at)) <= 86400)
    ) AS legs_within_sla,
    round(100.0 * count(*) FILTER (
      WHERE (category = 'score' AND settled_at IS NOT NULL AND EXTRACT(EPOCH FROM (settled_at - starts_at)) <= 7200)
         OR (category IN ('stats','player') AND settled_at IS NOT NULL AND EXTRACT(EPOCH FROM (settled_at - starts_at)) <= 86400)
    ) / NULLIF(count(*), 0), 2) AS settled_within_sla_pct
  FROM classified
  GROUP BY category;
$$;

GRANT EXECUTE ON FUNCTION settlement_coverage_sla_kpi(int) TO anon, authenticated, service_role;

-- C.5: next_unsettled_with_stats_legs(lim) — Trigger B helper (verify-results scope filter).
-- Returns events.id with at least one pending leg of category stats/player/special/unclassified,
-- excluding events whose pending legs are exclusively score (those are settled by Trigger A).
DROP FUNCTION IF EXISTS next_unsettled_with_stats_legs(int);
CREATE FUNCTION next_unsettled_with_stats_legs(lim int DEFAULT 100)
RETURNS TABLE(
  event_id UUID, external_id TEXT, flashscore_id TEXT,
  starts_at TIMESTAMPTZ, sport_name TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (e.id)
    e.id, e.external_id, e.flashscore_id, e.starts_at, s.name AS sport_name
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  JOIN markets m ON m.event_id = e.id
  JOIN bet_selections bs ON bs.market_id = m.id
  LEFT JOIN market_categories_seed mcs ON mcs.market_type = m.market_type
  WHERE e.status IN ('finished', 'ended')
    AND e.settled_at IS NULL
    AND bs.result IS NULL
    AND COALESCE(mcs.category, 'unclassified') IN ('stats', 'player', 'special', 'unclassified')
  ORDER BY e.id, e.updated_at ASC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION next_unsettled_with_stats_legs(int) TO anon, authenticated, service_role;

COMMIT;
