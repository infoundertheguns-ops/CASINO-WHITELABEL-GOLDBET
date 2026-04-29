-- ═══════════════════════════════════════════════════════════
-- Migration 031 — Ippica Totalizzatore (pool-style betting)
--
-- MST Channel exposes Italian tote data at:
--   GET /rest/palinsesti/corsa/full/{palinsesto}/{avvenimento}
--   → quote_generali (Vincente), quote_plurime (Piazzato/H2H),
--     quote_combinazioni_psr (Accoppiata/Trio/Tris/Quarté/Quinté)
--
-- We store the latest pool snapshot per race so the UI renders
-- odds that "look like tote" while placement + settlement run on
-- our own book (legally, a fixed-odds bet priced at the tote pool
-- value that was live at the moment of placement).
-- ═══════════════════════════════════════════════════════════

-- 1) Extend ippica_races with Sogei pool identifiers
ALTER TABLE ippica_races
  ADD COLUMN IF NOT EXISTS palinsesto integer,
  ADD COLUMN IF NOT EXISTS avvenimento integer,
  ADD COLUMN IF NOT EXISTS has_tote boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ippica_races_pal_avv
  ON ippica_races(palinsesto, avvenimento)
  WHERE palinsesto IS NOT NULL AND avvenimento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ippica_races_has_tote
  ON ippica_races(has_tote)
  WHERE has_tote = true;

-- 2) Single-horse tote markets (Vincente + Piazzato, per runner)
--    market_code enumeration:
--      'vincente' — single horse to win (pool quote from quote_generali)
--      'piazzato' — single horse to place (pool quote from quote_plurime)
CREATE TABLE IF NOT EXISTS ippica_tote_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES ippica_races(id) ON DELETE CASCADE,
  market_code text NOT NULL CHECK (market_code IN ('vincente','piazzato')),
  runner_number integer NOT NULL,
  odds numeric(10,2),               -- decimal odds (e.g. 10.38)
  odds_min numeric(10,2),            -- when API returns a range ("15894 - 16599")
  odds_max numeric(10,2),
  pool_amount bigint DEFAULT 0,      -- montante in cents (integer cents)
  status text NOT NULL DEFAULT 'active',  -- active | suspended | closed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(race_id, market_code, runner_number)
);

CREATE INDEX IF NOT EXISTS idx_ippica_tote_pools_race
  ON ippica_tote_pools(race_id);

-- 3) Multi-horse combination tote markets
--    market_code enumeration:
--      'accoppiata'   — 2 horses, exact order (1st, 2nd)
--      'accoppiata_p' — 2 horses, any order
--      'trio'         — 3 horses, any order
--      'tris'         — 3 horses, exact order
--      'quartet'      — 4 horses, exact order (Quarté)
--      'quinte'       — 5 horses, exact order (Quinté)
CREATE TABLE IF NOT EXISTS ippica_tote_combinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES ippica_races(id) ON DELETE CASCADE,
  market_code text NOT NULL
    CHECK (market_code IN ('accoppiata','accoppiata_p','trio','tris','quartet','quinte')),
  combination text NOT NULL,          -- e.g. "3-10" or "3-10-12"
  runner_numbers integer[] NOT NULL,  -- [3,10] or [3,10,12] — order matters for exact markets
  odds numeric(12,2),
  pool_amount bigint DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(race_id, market_code, combination)
);

CREATE INDEX IF NOT EXISTS idx_ippica_tote_combinations_race
  ON ippica_tote_combinations(race_id);
CREATE INDEX IF NOT EXISTS idx_ippica_tote_combinations_market
  ON ippica_tote_combinations(race_id, market_code);

-- 4) RLS — public read (odds display); writes via service role only
ALTER TABLE ippica_tote_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE ippica_tote_combinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read tote pools" ON ippica_tote_pools;
CREATE POLICY "public read tote pools" ON ippica_tote_pools
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read tote combos" ON ippica_tote_combinations;
CREATE POLICY "public read tote combos" ON ippica_tote_combinations
  FOR SELECT USING (true);

-- 5) bet_selections: extend for tote source
--    (ippica_tote_pool_id / ippica_tote_combo_id resolve via one-of pattern)
ALTER TABLE bet_selections
  ADD COLUMN IF NOT EXISTS ippica_tote_pool_id uuid REFERENCES ippica_tote_pools(id),
  ADD COLUMN IF NOT EXISTS ippica_tote_combo_id uuid REFERENCES ippica_tote_combinations(id);

-- 6) Drop + recreate source check to allow the new value
ALTER TABLE bet_selections DROP CONSTRAINT IF EXISTS bet_selections_source_check;
ALTER TABLE bet_selections ADD CONSTRAINT bet_selections_source_check
  CHECK (source IN ('sport','ippica','ippica_tote'));
