-- 081_wave_31_integrity_fixes.sql
-- Wave 31: integrity fixes from bulk audit of 60K+ mapped types.
-- Three mismap classes detected + fixed:
--   1) "1X2 + Ogni Squadra Segna (2)" → 1x2_btts_ft (was 1x2_ft, 1 row)
--   2) "Totale <team> + N.N" (team total + handicap compound) — DELETED
--      from total_team_* (112 rows prod, 21 staging). Not plain team totals.
--   3) "Falli totali" (fouls) — NOT equivalent to cards. Remapped from
--      total_cards_ft to new canonical total_fouls_ft (140+61 rows).

-- New canonical
INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('total_fouls_ft', 'total_fouls', 'ft', 'Totale Falli', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;

-- Fix 1: 1X2 + Ogni Squadra Segna (2) mismap
UPDATE market_normalization SET canonical_key='1x2_btts_ft', canonical_line=NULL,
  canonical_name_it='1X2 + GG/NG', extracted_by='regex', updated_at=now()
WHERE source='22bet' AND source_market_type='1X2 + Ogni Squadra Segna (2)'
  AND canonical_key='1x2_ft';

-- Fix 2: Team total + handicap compound (delete — wasn't plain total_team)
DELETE FROM market_normalization
WHERE canonical_key IN ('total_team_ft','total_team_1h','total_team_2h','total_team_3h','total_team_4h')
  AND source_market_type ~ '^Totale\s+[^(0-9]+\s+\+\s+[0-9]'
  AND verified=false;

-- Fix 3: Falli totali → total_fouls_ft (not total_cards_ft)
UPDATE market_normalization
SET canonical_key='total_fouls_ft', canonical_name_it='Totale Falli', updated_at=now()
WHERE source_market_type ~ 'Falli totali' AND canonical_key='total_cards_ft' AND verified=false;
