-- 096_phase3_2b_correct_score.sql
-- Phase 3 Part 2b — correct score grid outcome canonicalization.
-- Matches outcomes of cs_* markets (cs_ft / cs_1h / cs_2h / cs_etp etc.) and
-- resolves their canonical_outcome_key.
--
-- Strategy:
--  * "N-M" literal (both kambi + 22bet clean shape) → canonical_outcome_key = 'N-M'
--    both sources agree on the same literal → consensus-ready.
--  * "Altro" / "Altro risultato" / "Any other" → canonical_outcome_key = 'other'
--  * Team-named series outcomes (NHL "Team wins 4-0", NBA "Team vincono 4-0") →
--    left unmapped in this RPC (semantically "series outcome" not regular cs;
--    small volume <100 rows).
--  * 22bet garbage `Risultato Esatto 0.002-0.002 (17Opzioni)` (odds-as-line bug) →
--    left unmapped. Upstream scraper fix required (see 22bet upstream TODO).

CREATE OR REPLACE FUNCTION resolve_correct_score_outcomes(
  p_source text DEFAULT NULL,
  p_limit int DEFAULT 50000
)
RETURNS TABLE(inserted int, considered int, unresolved int) AS $$
DECLARE
  v_inserted int := 0;
  v_considered int := 0;
  v_unresolved int := 0;
BEGIN
  SET LOCAL statement_timeout = '300s';

  CREATE TEMP TABLE _cs_slice ON COMMIT DROP AS
  WITH cs_canonicals AS (
    SELECT canonical_key FROM canonical_markets WHERE base_key = 'correct_score'
  ),
  candidates AS (
    SELECT DISTINCT ON (e.source, mk.market_type, o.name)
      e.source,
      mk.market_type AS source_market_type,
      mn.canonical_key,
      o.name AS source_outcome_name
    FROM markets mk
    JOIN events e ON e.id = mk.event_id
    JOIN outcomes o ON o.market_id = mk.id
    JOIN market_normalization mn
      ON mn.source = e.source AND mn.source_market_type = mk.market_type
    WHERE mk.is_active = true
      AND mn.canonical_key IN (SELECT canonical_key FROM cs_canonicals)
      AND (p_source IS NULL OR e.source = p_source)
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
      -- Clean "N-M" literal score. Preserve score in outcome key for cross-source consensus.
      WHEN source_outcome_name ~ '^[0-9]+-[0-9]+$' THEN source_outcome_name
      -- "Altro risultato" (kambi) / "Altro" (22bet) / "Any other score"
      WHEN source_outcome_name ~* '^(altro|altro\s+risultato|any\s+other(\s+score)?|other\s+score)$' THEN 'other'
      ELSE NULL
    END AS canonical_outcome_key
  FROM candidates
  LIMIT p_limit;

  SELECT COUNT(*)::int INTO v_considered FROM _cs_slice;
  SELECT COUNT(*)::int INTO v_unresolved FROM _cs_slice WHERE canonical_outcome_key IS NULL;

  WITH ins AS (
    INSERT INTO outcome_normalization
      (source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key,
       extracted_by, confidence, verified, notes, updated_at)
    SELECT source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key,
           'regex', 98, true, 'phase3_2b_correct_score', now()
    FROM _cs_slice
    WHERE canonical_outcome_key IS NOT NULL
    ON CONFLICT (source, source_market_type, source_outcome_name) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_inserted FROM ins;

  RETURN QUERY SELECT v_inserted, v_considered, v_unresolved;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_correct_score_outcomes IS
  'Phase 3 Part 2b. Canonicalizes correct-score outcome names (N-M literal + Altro/other). '
  'Idempotent via outcome_normalization UNIQUE.';
