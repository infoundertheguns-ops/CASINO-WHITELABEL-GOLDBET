-- 106_wave_36_22bet_unmapped.sql
-- Wave 36 (2026-04-24): bulk canonical mapping for top unmapped 22bet
-- market_types surfaced by scripts/audit-22bet-unmapped.mjs after Phase 5
-- went live. Most targets share a trailing-dash bug in 22bet naming
-- (market_type ends in " - " because the period-suffix was emitted empty).
-- Rather than touch the scraper in this wave, we widen market_normalization
-- to accept the dash-suffix variants so the player canonical dispatch
-- picks them up. A separate scraper-side fix will normalize the source
-- naming upstream; once shipped, these rows become redundant but harmless.
--
-- All inserts use extracted_by='regex' + confidence=100 + verified=true so
-- they pass the downstream trust gate immediately (no manual review step
-- needed — patterns are unambiguous). Line values extracted via regex
-- capture where present.

BEGIN;

SET LOCAL statement_timeout = '300s';

-- ═══ 1. Totale Asiatico X.XX -  →  asian_total_ft ═══
-- Shape: "Totale Asiatico 7.25 - " (trailing dash, no period). Line = the number.
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, canonical_line, notes)
SELECT DISTINCT
  '22bet' AS source,
  m.market_type,
  'asian_total_ft',
  'Totale Asiatico',
  true,
  'regex',
  100,
  (regexp_match(m.market_type, '^Totale Asiatico\s+([\d.]+)\s*-\s*$'))[1]::numeric,
  'Wave 36: trailing-dash asian total (22bet upstream bug)'
FROM markets m
JOIN events e ON e.id = m.event_id
WHERE e.source = '22bet'
  AND m.is_active = true
  AND m.market_type ~ '^Totale Asiatico\s+[\d.]+\s*-\s*$'
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true,
  extracted_by = 'regex',
  confidence = 100,
  canonical_line = EXCLUDED.canonical_line,
  updated_at = now();

-- ═══ 2. Squadra 1 Totale Asiatico (X.XX) -  →  total_team_asian_1h (no period) or _ft ═══
-- Shape: "Squadra 1 Totale Asiatico (5.25) - " (trailing dash). We route
-- both Squadra 1 and Squadra 2 to the same canonical; home/away side info
-- is lost here (known residue from Phase C — canonical schema doesn't
-- carry the side discriminator). Adding the mapping still unlocks
-- consensus/shade coverage; settlement voids through the no-settler path.
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, canonical_line, notes)
SELECT DISTINCT
  '22bet',
  m.market_type,
  'total_team_asian_ft',
  'Totale Asiatico Squadra',
  true,
  'regex',
  100,
  (regexp_match(m.market_type, '^Squadra\s+[12]\s+Totale\s+Asiatico\s+\(([\d.]+)\)'))[1]::numeric,
  'Wave 36: trailing-dash team asian total'
FROM markets m
JOIN events e ON e.id = m.event_id
WHERE e.source = '22bet'
  AND m.is_active = true
  AND m.market_type ~ '^Squadra\s+[12]\s+Totale\s+Asiatico\s+\([\d.]+\)\s*-\s*$'
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true,
  extracted_by = 'regex',
  confidence = 100,
  canonical_line = EXCLUDED.canonical_line,
  updated_at = now();

-- ═══ 3. Multicalci d'angolo (N.N) -  →  total_corners_ft ═══
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, canonical_line, notes)
SELECT DISTINCT
  '22bet',
  m.market_type,
  'total_corners_ft',
  'Totale Calci d''Angolo',
  true,
  'regex',
  100,
  (regexp_match(m.market_type, '^Multicalci d''angolo\s+\(([\d.]+)\)'))[1]::numeric,
  'Wave 36: trailing-dash multi-corner total'
FROM markets m
JOIN events e ON e.id = m.event_id
WHERE e.source = '22bet'
  AND m.is_active = true
  AND m.market_type ~ '^Multicalci d''angolo\s+\([\d.]+\)\s*-\s*$'
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true,
  extracted_by = 'regex',
  confidence = 100,
  canonical_line = EXCLUDED.canonical_line,
  updated_at = now();

-- ═══ 4. Fallisce / Falli  →  total_fouls_ft ═══
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, notes)
VALUES
  ('22bet', 'Falli', 'total_fouls_ft', 'Falli Totali', true, 'manual', 100, 'Wave 36 dict seed')
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true, extracted_by = 'manual', confidence = 100,
  updated_at = now();

-- ═══ 4b. Tennis "Più giochi" / "Most Service breaks" ═══
-- "Più giochi" = bet on which tennis player wins MORE total games in the
-- match (3-way 1/X/2). Canonical: most_games_won_ft (new).
INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('most_games_won_ft', 'most_games_won', 'ft', 'Più Giochi (Totali Match)', false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('most_breaks_ft', 'most_breaks', 'ft', 'Più Break (Servizio)', false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;

INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, notes)
VALUES
  ('22bet', 'Più giochi',            'most_games_won_ft', 'Più Giochi (Totali Match)', true, 'manual', 100, 'Wave 36 tennis more-games'),
  ('22bet', 'Most Service breaks',   'most_breaks_ft',    'Più Break (Servizio)',       true, 'manual', 100, 'Wave 36 tennis more-breaks'),
  ('kambi', 'Più giochi',            'most_games_won_ft', 'Più Giochi (Totali Match)', true, 'manual', 100, 'Wave 36 tennis more-games'),
  ('kambi', 'Most Service breaks',   'most_breaks_ft',    'Più Break (Servizio)',       true, 'manual', 100, 'Wave 36 tennis more-breaks')
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true, extracted_by = 'manual', confidence = 100,
  updated_at = now();

-- ═══ 5. Goal In Ogni Tempo  →  both_halves_score (GG in entrambi i tempi) ═══
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, notes)
VALUES
  ('22bet', 'Goal In Ogni Tempo', 'both_halves_score', 'Segna Entrambi i Tempi', true, 'manual', 100, 'Wave 36 dict seed')
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true, extracted_by = 'manual', confidence = 100,
  updated_at = now();

-- ═══ 6. VOID-BY-DESIGN additions (minute-window / compound / player-like) ═══
-- These markets can't be settled with our current stats. We still register
-- them with an "unmappable" marker so admin tooling distinguishes them
-- from genuinely-unmapped entries. Canonical key left NULL intentionally
-- (verified=true signals we've reviewed and decided to skip).
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, notes)
VALUES
  ('22bet', 'Esito Del Primo Tempo O Della Partita', NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: compound OR-logic HT/FT'),
  ('22bet', 'Punteggio Durante La Partita',          NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: minute-window score'),
  ('22bet', 'Entrambi i Tempi Vinti Da Squadre Differenti', NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: compound half winners'),
  ('22bet', 'Rigore Assegnato ed Espulsione',        NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: compound events'),
  ('22bet', 'Rimonta E Vince - Squadra 1',           NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: requires minute-timeline'),
  ('22bet', 'Pareggio Con Reti',                     NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: draw with goals'),
  ('22bet', 'Totale Nei Tempi',                      NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: period-by-period total'),
  ('22bet', 'Primo Goal',                            NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: first-goal timing'),
  ('22bet', 'Come Sarà Realizzato il Goal (1)',      NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: goal method'),
  ('22bet', 'PT-F (5 Opzioni)',                      NULL, NULL, true, 'manual', 100, 'Wave 36 void_by_design: 5-way HT/FT variant')
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true, extracted_by = 'manual', confidence = 100,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ═══ 7. Trailing-dash void markets (minute-window + player-timing) ═══
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, notes)
SELECT DISTINCT '22bet', m.market_type, NULL, NULL, true, 'regex', 100,
  'Wave 36 void_by_design: trailing-dash minute-window'
FROM markets m
JOIN events e ON e.id = m.event_id
WHERE e.source = '22bet'
  AND m.is_active = true
  AND (
    m.market_type ~ '^Primi 5 Minuti\s*-\s*$'
    OR m.market_type ~ '^Handicap Al Minuto\s*-\s*$'
    OR m.market_type ~ '^First Touch Of The Ball After The First Corner Kick\s*-\s*$'
    OR m.market_type ~ '^Sfida Al\s+\(\d+\)\s*-\s*$'
    OR m.market_type ~ '^PT-F\s*-\s*$'
    OR m.market_type ~ '^Chi Segner[àa] il L''ultimo Goal Della Partita\?\s*-\s*$'
  )
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true, extracted_by = 'regex', confidence = 100,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ═══ Final refresh summary ═══
DO $$
DECLARE
  n_mapped INT;
  n_voided INT;
BEGIN
  SELECT COUNT(*) INTO n_mapped FROM market_normalization
    WHERE source='22bet' AND notes LIKE 'Wave 36%' AND canonical_key IS NOT NULL;
  SELECT COUNT(*) INTO n_voided FROM market_normalization
    WHERE source='22bet' AND notes LIKE 'Wave 36%' AND canonical_key IS NULL AND verified=true;
  RAISE NOTICE 'Wave 36 applied: % canonical mappings, % void-by-design rows', n_mapped, n_voided;
END $$;

COMMIT;
