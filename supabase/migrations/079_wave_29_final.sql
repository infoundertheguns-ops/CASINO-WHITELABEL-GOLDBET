-- 079_wave_29_final.sql
-- Wave 29: final catch-all for remaining medium-volume residue.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- Individuale Totale Intervallo — 22bet "team interval total" (specific team X, over/under)
  ('team_interval_total_ft', 'team_interval_total', 'ft', 'Squadra Totale Intervallo', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team_interval_total_1h', 'team_interval_total', '1h', 'Squadra Totale Intervallo 1T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team_interval_total_2h', 'team_interval_total', '2h', 'Squadra Totale Intervallo 2T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Map N - To go into overtime (esports)
  ('map_to_overtime_ft', 'map_to_overtime', 'ft', 'Mappa Va Ai Supplementari', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Prossimo Goal, Doppia Chance (N)
  ('next_goal_dc_ft', 'next_goal_dc', 'ft', 'Prossimo Goal + DC', true,
   '[{"key":"grid","name_it":"Combo"}]'::jsonb),
  ('next_goal_dc_1h', 'next_goal_dc', '1h', 'Prossimo Goal + DC 1T', true,
   '[{"key":"grid","name_it":"Combo"}]'::jsonb),
  ('next_goal_dc_2h', 'next_goal_dc', '2h', 'Prossimo Goal + DC 2T', true,
   '[{"key":"grid","name_it":"Combo"}]'::jsonb),

  -- Prossimo Goal, Handicap (N)
  ('next_goal_handicap_ft', 'next_goal_handicap', 'ft', 'Prossimo Goal + Handicap', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('next_goal_handicap_1h', 'next_goal_handicap', '1h', 'Prossimo Goal + Handicap 1T', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('next_goal_handicap_2h', 'next_goal_handicap', '2h', 'Prossimo Goal + Handicap 2T', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;

SET statement_timeout = 600000;

-- Seed
WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- Individuale Totale Intervallo - 1/2 [- period] [(line)]
  SELECT u.source, u.smt, 'team_interval_total_ft'::text ck, (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric ln FROM unmapped u WHERE u.smt ~ '^Individuale Totale Intervallo - [12](\s+\([0-9.]+\))?$'
  UNION ALL SELECT u.source, u.smt, 'team_interval_total_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Individuale Totale Intervallo - [12](\s+\([0-9.]+\))?\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team_interval_total_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Individuale Totale Intervallo - [12](\s+\([0-9.]+\))?\s+-\s+(2T|12T)$'

  -- Map N - To go into overtime
  UNION ALL SELECT u.source, u.smt, 'map_to_overtime_ft', NULL FROM unmapped u WHERE u.smt ~ '^Map [0-9]+ - To go into overtime$'

  -- Prossimo Goal, Doppia Chance (N) [- period]
  UNION ALL SELECT u.source, u.smt, 'next_goal_dc_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Prossimo Goal, Doppia Chance \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'next_goal_dc_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Prossimo Goal, Doppia Chance \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'next_goal_dc_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Prossimo Goal, Doppia Chance \([0-9]+\) - (2T|12T)$'

  -- Prossimo Goal, Handicap (N) [- period]
  UNION ALL SELECT u.source, u.smt, 'next_goal_handicap_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Prossimo Goal, Handicap \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'next_goal_handicap_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Prossimo Goal, Handicap \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'next_goal_handicap_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Prossimo Goal, Handicap \([0-9]+\) - (2T|12T)$'

  -- Totale Home [N.N] - [period] → total_team (re-catch any remaining)
  UNION ALL SELECT u.source, u.smt,
    CASE WHEN smt ~ ' - (1T|11T)$' THEN 'total_team_1h' WHEN smt ~ ' - (2T|12T)$' THEN 'total_team_2h' ELSE 'total_team_ft' END,
    (regexp_match(u.smt, 'Home[^0-9]*([0-9.]+)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~ '^Totale Home[^0-9]*[0-9.]+'
  UNION ALL SELECT u.source, u.smt,
    CASE WHEN smt ~ ' - (1T|11T)$' THEN 'total_team_1h' WHEN smt ~ ' - (2T|12T)$' THEN 'total_team_2h' ELSE 'total_team_ft' END,
    (regexp_match(u.smt, 'Away[^0-9]*([0-9.]+)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~ '^Totale Away[^0-9]*[0-9.]+'

  -- SuperTotale (N) - NT
  UNION ALL SELECT u.source, u.smt,
    CASE WHEN smt ~ ' - (1T|11T)$' THEN 'super_total_1h' WHEN smt ~ ' - (2T|12T)$' THEN 'super_total_2h' ELSE 'super_total_ft' END,
    (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~ '^SuperTotale \([0-9.]+\)'

  -- Handicap Asiatico (N) - NT (periodless + period)
  UNION ALL SELECT u.source, u.smt,
    CASE WHEN smt ~ ' - (1T|11T)$' THEN 'asian_handicap_1h' WHEN smt ~ ' - (2T|12T)$' THEN 'asian_handicap_2h' WHEN smt ~ ' - 3T$' THEN 'asian_handicap_3h' WHEN smt ~ ' - 4T$' THEN 'asian_handicap_4h' ELSE 'asian_handicap_ft' END,
    (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~ '^Handicap Asiatico \([+-]?[0-9.]+\)'

  -- Pareggio - 1T/2T → draw_ft? Actually, "Pareggio - 1T" has outcomes Sì/No "Pareggio 0:0 - Sì". It's a draw_at_period Sì/No.
  -- Closest existing is team_scores_n_points variant. Skip — need dedicated canonical.
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck, m.ln,
       (SELECT canonical_name_it FROM canonical_markets cm WHERE cm.canonical_key=m.ck),
       false, 'regex', 75, now()
FROM matches m
WHERE (SELECT 1 FROM canonical_markets cm WHERE cm.canonical_key=m.ck) IS NOT NULL
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key = EXCLUDED.canonical_key,
      canonical_line = EXCLUDED.canonical_line,
      canonical_name_it = EXCLUDED.canonical_name_it,
      extracted_by = EXCLUDED.extracted_by,
      confidence = EXCLUDED.confidence,
      updated_at = now()
  WHERE market_normalization.verified = false
    AND market_normalization.canonical_key IS NULL;
