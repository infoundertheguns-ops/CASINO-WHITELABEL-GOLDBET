-- 093_phase3_team_name_resolver.sql
-- Phase 3 Part 2a — resolve outcome names that are team/player names or 1/X/2
-- literals into canonical_outcome_key {home,away,draw}, via events.home_team
-- and events.away_team.
--
-- Target markets: 1X2 family, DNB, head-to-head, set winner, set handicap,
-- handicap variants — any canonical where outcomes shape is "pick a side".
--
-- Unblocks shade-to-min flip: `v_outcomes_displayed.canonical_verified=true`
-- currently 0; this seeds ~150K+ verified outcome_normalization rows.

CREATE OR REPLACE FUNCTION resolve_team_name_outcomes(
  p_source text DEFAULT NULL,
  p_limit int DEFAULT 50000
)
RETURNS TABLE(inserted int, considered int, unresolved int) AS $$
DECLARE
  v_inserted int := 0;
  v_considered int := 0;
  v_unresolved int := 0;
BEGIN
  -- Statement timeout guard — resolver touches outcomes×markets×events, must cap.
  SET LOCAL statement_timeout = '180s';

  CREATE TEMP TABLE _slice ON COMMIT DROP AS
  WITH target_canonicals AS (
    SELECT canonical_key FROM canonical_markets
    WHERE base_key IN ('1x2','dnb','winner','h2h','set_n_winner','set_handicap',
                       'set_result','2way_handicap','1x2_handicap','asian_handicap')
  ),
  candidates AS (
    SELECT DISTINCT ON (e.source, mk.market_type, o.name)
      e.source,
      mk.market_type AS source_market_type,
      mn.canonical_key,
      o.name AS source_outcome_name,
      e.home_team,
      e.away_team
    FROM markets mk
    JOIN events e  ON e.id = mk.event_id
    JOIN outcomes o ON o.market_id = mk.id
    JOIN market_normalization mn
      ON mn.source = e.source AND mn.source_market_type = mk.market_type
    WHERE mk.is_active = true
      AND mn.canonical_key IN (SELECT canonical_key FROM target_canonicals)
      AND (p_source IS NULL OR e.source = p_source)
      AND e.home_team IS NOT NULL
      AND e.away_team IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM outcome_normalization oo
        WHERE oo.source = e.source
          AND oo.source_market_type = mk.market_type
          AND oo.source_outcome_name = o.name
      )
    ORDER BY e.source, mk.market_type, o.name
  )
  SELECT *,
    CASE
      -- Kambi 1X2 literals
      WHEN source_outcome_name = '1' THEN 'home'
      WHEN source_outcome_name = '2' THEN 'away'
      WHEN source_outcome_name = 'X' THEN 'draw'
      -- Team/player name exact match (case-insensitive, trimmed)
      WHEN lower(btrim(source_outcome_name)) = lower(btrim(home_team)) THEN 'home'
      WHEN lower(btrim(source_outcome_name)) = lower(btrim(away_team)) THEN 'away'
      -- Draw variants across languages
      WHEN source_outcome_name ~* '^(pareggio|draw|unentschieden|empate|pari|nulo|remis)$' THEN 'draw'
      -- 22bet "Squadra 1" / "Squadra 2" literal
      WHEN source_outcome_name ~* '^squadra\s+1$' THEN 'home'
      WHEN source_outcome_name ~* '^squadra\s+2$' THEN 'away'
      ELSE NULL
    END AS canonical_outcome_key
  FROM candidates
  LIMIT p_limit;

  SELECT COUNT(*)::int INTO v_considered FROM _slice;
  SELECT COUNT(*)::int INTO v_unresolved FROM _slice WHERE canonical_outcome_key IS NULL;

  WITH ins AS (
    INSERT INTO outcome_normalization
      (source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key,
       extracted_by, confidence, verified, notes, updated_at)
    SELECT source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key,
           'regex', 98, true, 'phase3_2a_team_resolver', now()
    FROM _slice
    WHERE canonical_outcome_key IS NOT NULL
    ON CONFLICT (source, source_market_type, source_outcome_name) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_inserted FROM ins;

  RETURN QUERY SELECT v_inserted, v_considered, v_unresolved;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_team_name_outcomes IS
  'Phase 3 Part 2a. Populates outcome_normalization for pick-a-side markets '
  '(1X2/DNB/winner/set_n_winner/etc.) by matching outcome.name against '
  'events.home_team/away_team or canonical literals (1/X/2/pareggio/draw). '
  'Safe to re-run: ON CONFLICT DO NOTHING, idempotent via outcome_normalization UNIQUE.';
