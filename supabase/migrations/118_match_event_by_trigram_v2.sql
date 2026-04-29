-- ═══════════════════════════════════════════════════
-- Migration 118: match_event_by_trigram_v2 (Sprint 2 Autopilot)
--
-- Goal: lift LLM-stage hit-rate by feeding the engine *good* candidates.
--
-- Problems with v1 (mig 087.4):
--   * No team-name normalization → "Šeško" ≠ "Sesko", "Atletico Alagoinhas (Women)" ≠ "Atletico Alagoinhas".
--   * No league/country signal → cross-country teams with same name (e.g. Premier League Ethiopia/Iraq/England) collide.
--   * No gender/reserves penalty → women's match silently matches men's match with same names.
--   * Time window 3h too tight for late-rescheduled fixtures.
--
-- Adds:
--   * normalize_team_name(text) IMMUTABLE helper: lower + unaccent + strip
--     gender suffix (women/w/femminile/donna) + strip reserves suffix
--     (II/B/U17/U19/U21/U23/(reserves)) + collapse whitespace.
--   * be_sport_name(text) helper: Italian → be_fixtures sport mapping (was inlined in v1).
--   * has_women_suffix(text), has_reserves_suffix(text) flags for penalty calc.
--   * match_event_by_trigram_v2 RPC: window 12h, score = trigram(normalized) * 0.45+0.45
--     + league boost (+0.20 exact / +0.10 trigram>=0.6) + country boost (+0.10 exact)
--     + time bonus (+0.05 within 30min) − gender penalty (−0.15) − reserves penalty (−0.15).
--   * Indexes on lower(unaccent(home/away_team)) for be_fixtures to keep scan cheap.
--
-- Backward compat:
--   * v1 RPC match_event_by_trigram is NOT dropped (kept for unrelated callers).
--   * v2 returns BOTH `score` and `similarity` (alias of clamped score) so existing
--     consumers reading `similarity` keep working when migrated to the new name.
--
-- Updates next_unmapped_events to also return country_name (from leagues.country),
-- consumed by the engine to pass p_country into v2.
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- 118.1 — normalize_team_name (IMMUTABLE)
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION normalize_team_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  -- 1. lowercase + unaccent (Šeško → sesko, Atlético → atletico)
  -- 2. strip parenthesised gender/reserves tags: (women), (w), (reserves)
  -- 3. strip trailing gender/reserves words and youth markers
  -- 4. collapse internal whitespace
  -- 5. trim
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(public.unaccent(coalesce(input, ''))),
          '\s*\((women|w|reserves|riserve|riserva|res|ii|u\s*17|u\s*19|u\s*21|u\s*23)\)\s*', ' ', 'gi'
        ),
        '\s+(women|w|femminile|donna|donne)\s*$', '', 'i'
      ),
      '\s+(ii|iii|b|reserves|riserve|riserva|res|u\s*17|u\s*19|u\s*21|u\s*23)\s*$', '', 'i'
    ),
    '\s+', ' ', 'g'
  ));
$$;

COMMENT ON FUNCTION normalize_team_name IS
  'Canonicalises team names for trigram matching: lowercase + unaccent + strip gender/reserves suffix + collapse whitespace.';

-- -----------------------------------------------------
-- 118.2 — has_women_suffix / has_reserves_suffix
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION has_women_suffix(input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(input,'')) ~ '(\(women\)|\(w\)|\swomen\s*$|\sw\s*$|\sfemminile\s*$|\sdonna\s*$|\sdonne\s*$)';
$$;

CREATE OR REPLACE FUNCTION has_reserves_suffix(input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(input,'')) ~ '(\(reserves\)|\(riserve\)|\sii\s*$|\sb\s*$|\sreserves\s*$|\sriserve\s*$|\sriserva\s*$|\sres\s*$|\su\s*1[79]\s*$|\su\s*2[13]\s*$)';
$$;

-- -----------------------------------------------------
-- 118.3 — be_sport_name (Italian → be_fixtures sport)
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION be_sport_name(p_sport text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_sport,''))
    WHEN 'calcio' THEN 'calcio'
    WHEN 'football' THEN 'calcio'
    WHEN 'soccer' THEN 'calcio'
    WHEN 'tennis' THEN 'tennis'
    WHEN 'basket' THEN 'basket'
    WHEN 'basketball' THEN 'basket'
    WHEN 'pallacanestro' THEN 'basket'
    WHEN 'hockey' THEN 'hockey'
    WHEN 'hockey ghiaccio' THEN 'hockey'
    WHEN 'ice_hockey' THEN 'hockey'
    WHEN 'ice hockey' THEN 'hockey'
    WHEN 'pallamano' THEN 'pallamano'
    WHEN 'handball' THEN 'pallamano'
    WHEN 'volley' THEN 'volley'
    WHEN 'pallavolo' THEN 'volley'
    WHEN 'volleyball' THEN 'volley'
    WHEN 'tennis tavolo' THEN 'tennis_tavolo'
    WHEN 'tennistavolo' THEN 'tennis_tavolo'
    WHEN 'table_tennis' THEN 'tennis_tavolo'
    WHEN 'table tennis' THEN 'tennis_tavolo'
    WHEN 'baseball' THEN 'baseball'
    WHEN 'rugby' THEN 'rugby'
    WHEN 'rugby league' THEN 'rugby'
    WHEN 'rugby union' THEN 'rugby'
    WHEN 'esports' THEN 'esports'
    WHEN 'cricket' THEN 'cricket'
    WHEN 'darts' THEN 'darts'
    WHEN 'freccette' THEN 'darts'
    WHEN 'snooker' THEN 'snooker'
    WHEN 'mma' THEN 'mma'
    WHEN 'boxe' THEN 'boxing'
    WHEN 'boxing' THEN 'boxing'
    ELSE lower(coalesce(p_sport,''))
  END;
$$;

-- -----------------------------------------------------
-- 118.4 — Indexes for normalized trigram matching
--
-- pg_trgm GIN index on the unaccent-lowered name speeds up the v2 search
-- (similarity is computed against normalized form, not raw column).
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_be_fixtures_home_norm_trgm
  ON be_fixtures USING gin (normalize_team_name(home_team) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_be_fixtures_away_norm_trgm
  ON be_fixtures USING gin (normalize_team_name(away_team) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_be_fixtures_sport_match_date
  ON be_fixtures (sport, match_date);

-- -----------------------------------------------------
-- 118.5 — match_event_by_trigram_v2 RPC
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION match_event_by_trigram_v2(
  p_sport text,
  p_home text,
  p_away text,
  p_starts_at timestamptz,
  p_league text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_window_hours int DEFAULT 12,
  p_limit int DEFAULT 10
)
RETURNS TABLE(
  flashscore_id text,
  home_team text,
  away_team text,
  starts_at timestamptz,
  league text,
  country text,
  trigram_home numeric,
  trigram_away numeric,
  league_boost numeric,
  country_boost numeric,
  time_bonus numeric,
  gender_penalty numeric,
  reserves_penalty numeric,
  score numeric,
  similarity numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH inputs AS (
    SELECT
      be_sport_name(p_sport) AS be_sport,
      normalize_team_name(p_home) AS norm_home,
      normalize_team_name(p_away) AS norm_away,
      lower(btrim(coalesce(p_league, ''))) AS norm_league,
      lower(btrim(coalesce(p_country, ''))) AS norm_country,
      has_women_suffix(p_home) OR has_women_suffix(p_away) AS event_is_women,
      has_reserves_suffix(p_home) OR has_reserves_suffix(p_away) AS event_is_reserves
  ),
  scored AS (
    SELECT
      f.be_match_id,
      f.home_team,
      f.away_team,
      f.match_date,
      f.league,
      f.country,
      similarity(normalize_team_name(f.home_team), i.norm_home) AS sh,
      similarity(normalize_team_name(f.away_team), i.norm_away) AS sa,
      -- league boost: exact match → 0.20; trigram >= 0.6 → 0.10
      CASE
        WHEN i.norm_league = '' OR f.league IS NULL THEN 0.0
        WHEN lower(f.league) = i.norm_league THEN 0.20
        WHEN similarity(lower(f.league), i.norm_league) >= 0.6 THEN 0.10
        ELSE 0.0
      END AS lb,
      -- country boost: exact match → 0.10
      CASE
        WHEN i.norm_country = '' OR f.country IS NULL THEN 0.0
        WHEN lower(f.country) = i.norm_country THEN 0.10
        ELSE 0.0
      END AS cb,
      -- time bonus: within 30min → 0.05
      CASE
        WHEN abs(extract(epoch FROM (f.match_date - p_starts_at))) <= 1800 THEN 0.05
        ELSE 0.0
      END AS tb,
      -- gender mismatch: one side has women suffix, the other doesn't
      CASE
        WHEN (i.event_is_women) <>
             (has_women_suffix(f.home_team) OR has_women_suffix(f.away_team))
          THEN -0.15
        ELSE 0.0
      END AS gp,
      -- reserves mismatch
      CASE
        WHEN (i.event_is_reserves) <>
             (has_reserves_suffix(f.home_team) OR has_reserves_suffix(f.away_team))
          THEN -0.15
        ELSE 0.0
      END AS rp
    FROM be_fixtures f, inputs i
    WHERE f.sport = i.be_sport
      AND f.match_date BETWEEN p_starts_at - (p_window_hours || ' hours')::interval
                           AND p_starts_at + (p_window_hours || ' hours')::interval
      AND (
        normalize_team_name(f.home_team) % i.norm_home
        OR normalize_team_name(f.away_team) % i.norm_away
      )
  )
  SELECT
    s.be_match_id AS flashscore_id,
    s.home_team,
    s.away_team,
    s.match_date AS starts_at,
    s.league,
    s.country,
    s.sh::numeric AS trigram_home,
    s.sa::numeric AS trigram_away,
    s.lb::numeric AS league_boost,
    s.cb::numeric AS country_boost,
    s.tb::numeric AS time_bonus,
    s.gp::numeric AS gender_penalty,
    s.rp::numeric AS reserves_penalty,
    GREATEST(
      0,
      LEAST(
        1,
        (s.sh * 0.45 + s.sa * 0.45 + s.lb + s.cb + s.tb + s.gp + s.rp)::numeric
      )
    ) AS score,
    GREATEST(
      0,
      LEAST(
        1,
        (s.sh * 0.45 + s.sa * 0.45 + s.lb + s.cb + s.tb + s.gp + s.rp)::numeric
      )
    ) AS similarity
  FROM scored s
  ORDER BY score DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION match_event_by_trigram_v2 IS
  'Sprint 2 v2: trigram match in be_fixtures with name normalization (gender/reserves suffix strip + diacritics fold) + league boost + country boost + time bonus + gender/reserves mismatch penalty. Returns top N candidates by composite score (clamped 0..1). Backward-compat: `similarity` mirrors `score`.';

-- -----------------------------------------------------
-- 118.6 — next_unmapped_events: add country_name
--
-- Drop first because we extend the RETURNS TABLE shape (added country_name).
-- Postgres rejects CREATE OR REPLACE when the return signature changes.
-- -----------------------------------------------------

DROP FUNCTION IF EXISTS next_unmapped_events(int, text);

CREATE OR REPLACE FUNCTION next_unmapped_events(
  p_limit int DEFAULT 500,
  p_sport text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  home_team text,
  away_team text,
  starts_at timestamptz,
  source text,
  flashscore_id text,
  sport_name text,
  league_name text,
  country_name text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.id, e.home_team, e.away_team, e.starts_at, e.source, e.flashscore_id,
    s.name AS sport_name,
    l.name AS league_name,
    l.country AS country_name
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  LEFT JOIN leagues l ON l.id = e.league_id
  WHERE e.flashscore_id IS NULL
    AND e.status IN ('prematch','live')
    AND NOT EXISTS (SELECT 1 FROM event_normalization en WHERE en.event_id = e.id)
    AND (p_sport IS NULL OR s.name = p_sport)
  ORDER BY e.starts_at ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION next_unmapped_events IS
  'Sprint 2: now also returns leagues.country (consumed by engine for v2 RPC country boost).';
