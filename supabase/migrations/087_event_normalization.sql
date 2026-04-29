-- ═══════════════════════════════════════════════════
-- Migration 087: Event Normalization
--
-- Goal: boost events.flashscore_id coverage from ~42% to ≥95% via 5-stage pipeline:
--   1. flashscore_native (already mapped)
--   2. regex fuzzy (port of matchFixtures)
--   3. pg_trgm similarity + alias-dict
--   4. propagation (team_mapping cache)
--   5. LLM subagent (manual-confirmed)
--
-- New tables: event_normalization, team_mapping
-- Extended: team_aliases (ALTER)
-- New RPC: match_event_by_trigram
--
-- ADAPTATION from plan: be_fixtures column names differ from plan assumption.
-- Actual be_fixtures: id uuid, be_match_id text (= flashscore id), match_date.
-- Plan expected: flashscore_id, starts_at. RPC + helpers alias the columns.
--
-- See docs/superpowers/specs/2026-04-22-consensus-event-normalization-manual-override-design.md
-- ═══════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------
-- 087.1 — event_normalization (per-event match record)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS event_normalization (
  id bigserial PRIMARY KEY,
  event_id uuid UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  flashscore_id text NOT NULL,
  match_stage text NOT NULL
    CHECK (match_stage IN (
      'flashscore_native','regex','trigram','alias_dict','propagation','llm','manual'
    )),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  llm_reason text,
  verified boolean DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_norm_stage ON event_normalization(match_stage);
CREATE INDEX IF NOT EXISTS idx_event_norm_pending ON event_normalization(confidence)
  WHERE NOT verified AND confidence BETWEEN 0.80 AND 0.94;
CREATE INDEX IF NOT EXISTS idx_event_norm_unverified ON event_normalization(verified, created_at)
  WHERE NOT verified;

COMMENT ON TABLE event_normalization IS
  'Per-event canonical mapping to Flashscore. Row per event with match stage + confidence + optional LLM reason. Paired with events.flashscore_id for backward compat.';

-- -----------------------------------------------------
-- 087.2 — Extend team_aliases (from mig 013)
-- -----------------------------------------------------

ALTER TABLE team_aliases
  ADD COLUMN IF NOT EXISTS sport text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_team_aliases_sport ON team_aliases(sport)
  WHERE sport IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_aliases_alias ON team_aliases(alias);

-- -----------------------------------------------------
-- 087.3 — team_mapping (propagation cache)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS team_mapping (
  id bigserial PRIMARY KEY,
  sport text NOT NULL,
  source text NOT NULL,
  raw_name text NOT NULL,
  canonical_name text,
  verified boolean DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(sport, source, raw_name)
);

CREATE INDEX IF NOT EXISTS idx_team_mapping_canonical ON team_mapping(canonical_name)
  WHERE canonical_name IS NOT NULL;

COMMENT ON TABLE team_mapping IS
  'Propagation cache: (sport, source, raw_name) -> canonical_name. NULL canonical_name = negative cache (confirmed no match). Populated by event-normalization engine stage 4.';

-- -----------------------------------------------------
-- 087.4 — match_event_by_trigram RPC (stage 3a)
--
-- Queries be_fixtures (column names: be_match_id, match_date) and
-- returns flashscore_id/starts_at aliases for application consistency.
-- Sport is matched case-insensitively and against an Italian-name map
-- (events uses Italian sport names, be_fixtures uses English-ish lowercase).
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION match_event_by_trigram(
  p_sport text,
  p_home text,
  p_away text,
  p_starts_at timestamptz,
  p_window_hours int DEFAULT 3,
  p_limit int DEFAULT 5
)
RETURNS TABLE(
  flashscore_id text,
  home_team text,
  away_team text,
  starts_at timestamptz,
  similarity numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH sport_map AS (
    SELECT CASE lower(p_sport)
      WHEN 'calcio' THEN 'calcio'
      WHEN 'football' THEN 'calcio'
      WHEN 'tennis' THEN 'tennis'
      WHEN 'basket' THEN 'basket'
      WHEN 'basketball' THEN 'basket'
      WHEN 'hockey ghiaccio' THEN 'hockey'
      WHEN 'hockey' THEN 'hockey'
      WHEN 'ice_hockey' THEN 'hockey'
      WHEN 'pallamano' THEN 'pallamano'
      WHEN 'handball' THEN 'pallamano'
      WHEN 'volley' THEN 'volley'
      WHEN 'volleyball' THEN 'volley'
      WHEN 'tennis tavolo' THEN 'tennis_tavolo'
      WHEN 'table_tennis' THEN 'tennis_tavolo'
      WHEN 'baseball' THEN 'baseball'
      WHEN 'rugby' THEN 'rugby'
      WHEN 'esports' THEN 'esports'
      WHEN 'cricket' THEN 'cricket'
      ELSE lower(p_sport)
    END AS be_sport
  )
  SELECT
    f.be_match_id AS flashscore_id,
    f.home_team,
    f.away_team,
    f.match_date AS starts_at,
    ((similarity(f.home_team, p_home) + similarity(f.away_team, p_away)) / 2)::numeric AS similarity
  FROM be_fixtures f, sport_map sm
  WHERE f.sport = sm.be_sport
    AND f.match_date BETWEEN p_starts_at - (p_window_hours || ' hours')::interval
                         AND p_starts_at + (p_window_hours || ' hours')::interval
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION match_event_by_trigram IS
  'Trigram similarity search in be_fixtures. Takes Italian sport name from events and maps to be_fixtures.sport internal name. Returns top N candidates by (home+away)/2 similarity.';

-- -----------------------------------------------------
-- 087.5 — helper view v_be_fixtures_normalized
--
-- Convenience view that exposes be_fixtures with the column names the
-- application layer expects (flashscore_id, starts_at). Reduces aliasing
-- noise in application code without touching the base table.
-- -----------------------------------------------------

CREATE OR REPLACE VIEW v_be_fixtures_normalized AS
SELECT
  be_match_id AS flashscore_id,
  sport,
  country,
  league,
  home_team,
  away_team,
  match_date AS starts_at,
  match_url,
  odds_1, odds_x, odds_2,
  created_at, updated_at
FROM be_fixtures;

COMMENT ON VIEW v_be_fixtures_normalized IS
  'Aliased view of be_fixtures for event-normalization app code (flashscore_id = be_match_id, starts_at = match_date).';
