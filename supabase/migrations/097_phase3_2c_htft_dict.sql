-- 097_phase3_2c_htft_dict.sql
-- Phase 3 Part 2c (partial) — HT/FT outcome canonicalization.
-- Mix of dict (kambi 1/X/2 format, 22bet PT-F VxVy compact encoding) and
-- regex resolver (22bet long-form "Tempo/Tempo" with inconsistent Pareggio
-- variants: "Pareggio 1°Tempo" vs "Pareggio Nel 1°Tempo").
--
-- canonical_outcome_key convention: "{ht}_{ft}" where ht/ft ∈ {home,draw,away}.
-- team_result_total (multi-dim compound) deferred — lower consensus value.

-- ═══ Static dict entries ═══
INSERT INTO outcome_normalization
  (source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key,
   extracted_by, confidence, verified, notes, updated_at)
VALUES
  -- Kambi "1/X/2" format (both "Esito 1T/Finale" and other aliases)
  ('kambi', 'Esito 1T/Finale', '1/1', 'htft', 'home_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', '1/X', 'htft', 'home_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', '1/2', 'htft', 'home_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', 'X/1', 'htft', 'draw_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', 'X/X', 'htft', 'draw_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', 'X/2', 'htft', 'draw_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', '2/1', 'htft', 'away_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', '2/X', 'htft', 'away_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('kambi', 'Esito 1T/Finale', '2/2', 'htft', 'away_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),

  -- 22bet "PT-F VxVy" compact encoding (V1=home, V2=away, X=draw)
  ('22bet', 'PT-F', 'PT-F V1V1', 'htft', 'home_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F V1X',  'htft', 'home_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F V1V2', 'htft', 'home_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F XV1',  'htft', 'draw_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F XX',   'htft', 'draw_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F XV2',  'htft', 'draw_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F V2V1', 'htft', 'away_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F V2X',  'htft', 'away_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'PT-F', 'PT-F V2V2', 'htft', 'away_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),

  -- 22bet "Esito 1T/Finale" 1/X/2 format (alias)
  ('22bet', 'Esito 1T/Finale', '1/1', 'htft', 'home_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', '1/X', 'htft', 'home_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', '1/2', 'htft', 'home_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', 'X/1', 'htft', 'draw_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', 'X/X', 'htft', 'draw_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', 'X/2', 'htft', 'draw_away', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', '2/1', 'htft', 'away_home', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', '2/X', 'htft', 'away_draw', 'manual', 100, true, 'phase3_2c_htft_dict', now()),
  ('22bet', 'Esito 1T/Finale', '2/2', 'htft', 'away_away', 'manual', 100, true, 'phase3_2c_htft_dict', now())
ON CONFLICT (source, source_market_type, source_outcome_name) DO UPDATE SET
  canonical_outcome_key = EXCLUDED.canonical_outcome_key,
  verified = true,
  confidence = 100,
  extracted_by = 'manual',
  notes = 'phase3_2c_htft_dict',
  updated_at = now();

-- ═══ Regex resolver for 22bet long-form "Tempo/Tempo" (Pareggio variants) ═══
CREATE OR REPLACE FUNCTION resolve_htft_longform_outcomes(p_limit int DEFAULT 20000)
RETURNS TABLE(inserted int, considered int, unresolved int) AS $$
DECLARE
  v_inserted int := 0;
  v_considered int := 0;
  v_unresolved int := 0;
BEGIN
  SET LOCAL statement_timeout = '180s';

  CREATE TEMP TABLE _htft_slice ON COMMIT DROP AS
  WITH candidates AS (
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
      AND mn.canonical_key = 'htft'
      AND e.source = '22bet'
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
      -- 1st half home "Squadra 1 Vince il 1°Tempo"
      WHEN source_outcome_name ~* 'Squadra\s*1\s+Vince\s+il\s+1°?\s*Tempo' AND source_outcome_name ~* 'Squadra\s*1\s+Vince\s+il\s+2°?\s*Tempo' THEN 'home_home'
      WHEN source_outcome_name ~* 'Squadra\s*1\s+Vince\s+il\s+1°?\s*Tempo' AND source_outcome_name ~* 'Pareggio\s*(?:Nel\s+)?2°?\s*Tempo'        THEN 'home_draw'
      WHEN source_outcome_name ~* 'Squadra\s*1\s+Vince\s+il\s+1°?\s*Tempo' AND source_outcome_name ~* 'Squadra\s*2\s+Vince\s+il\s+2°?\s*Tempo' THEN 'home_away'
      -- 1st half draw "Pareggio (Nel)? 1°Tempo"
      WHEN source_outcome_name ~* 'Pareggio\s*(?:Nel\s+)?1°?\s*Tempo'      AND source_outcome_name ~* 'Squadra\s*1\s+Vince\s+il\s+2°?\s*Tempo' THEN 'draw_home'
      WHEN source_outcome_name ~* 'Pareggio\s*(?:Nel\s+)?1°?\s*Tempo'      AND source_outcome_name ~* 'Pareggio\s*(?:Nel\s+)?2°?\s*Tempo'      THEN 'draw_draw'
      WHEN source_outcome_name ~* 'Pareggio\s*(?:Nel\s+)?1°?\s*Tempo'      AND source_outcome_name ~* 'Squadra\s*2\s+Vince\s+il\s+2°?\s*Tempo' THEN 'draw_away'
      -- 1st half away "Squadra 2 Vince il 1°Tempo"
      WHEN source_outcome_name ~* 'Squadra\s*2\s+Vince\s+il\s+1°?\s*Tempo' AND source_outcome_name ~* 'Squadra\s*1\s+Vince\s+il\s+2°?\s*Tempo' THEN 'away_home'
      WHEN source_outcome_name ~* 'Squadra\s*2\s+Vince\s+il\s+1°?\s*Tempo' AND source_outcome_name ~* 'Pareggio\s*(?:Nel\s+)?2°?\s*Tempo'      THEN 'away_draw'
      WHEN source_outcome_name ~* 'Squadra\s*2\s+Vince\s+il\s+1°?\s*Tempo' AND source_outcome_name ~* 'Squadra\s*2\s+Vince\s+il\s+2°?\s*Tempo' THEN 'away_away'
      ELSE NULL
    END AS canonical_outcome_key
  FROM candidates
  LIMIT p_limit;

  SELECT COUNT(*)::int INTO v_considered FROM _htft_slice;
  SELECT COUNT(*)::int INTO v_unresolved FROM _htft_slice WHERE canonical_outcome_key IS NULL;

  WITH ins AS (
    INSERT INTO outcome_normalization
      (source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key,
       extracted_by, confidence, verified, notes, updated_at)
    SELECT source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key,
           'regex', 97, true, 'phase3_2c_htft_resolver', now()
    FROM _htft_slice
    WHERE canonical_outcome_key IS NOT NULL
    ON CONFLICT (source, source_market_type, source_outcome_name) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_inserted FROM ins;

  RETURN QUERY SELECT v_inserted, v_considered, v_unresolved;
END $$ LANGUAGE plpgsql;
