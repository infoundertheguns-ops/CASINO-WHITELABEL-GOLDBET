-- 080_wave_30_squadra_compounds.sql
-- Wave 30: Squadra compound markets + remaining residue.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('team1_halftime_total_ft', 'team1_halftime_total', 'ft', 'Squadra 1 Totale Intermedio', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team2_halftime_total_ft', 'team2_halftime_total', 'ft', 'Squadra 2 Totale Intermedio', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),

  ('team_win_and_total_corners_ft', 'team_win_and_total_corners', 'ft', 'Squadra Vince + Tot Corner', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  ('team1_first_goal_and_result_ft', 'team1_first_goal_and_result', 'ft', 'Squadra 1 Primo Goal + Esito', false,
   '[{"key":"grid","name_it":"Combo"}]'::jsonb),
  ('team2_first_goal_and_result_ft', 'team2_first_goal_and_result', 'ft', 'Squadra 2 Primo Goal + Esito', false,
   '[{"key":"grid","name_it":"Combo"}]'::jsonb),

  ('team1_win_by_1_or_draw_ft', 'team1_win_by_1_or_draw', 'ft', 'Squadra 1 Vince Di 1 O Pareggia', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_win_by_1_or_draw_ft', 'team2_win_by_1_or_draw', 'ft', 'Squadra 2 Vince Di 1 O Pareggia', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  ('team_wins_quarter_and_match_ft', 'team_wins_quarter_and_match', 'ft', 'Squadra Vince Quarto + Partita', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('team_wins_half_and_match_ft', 'team_wins_half_and_match', 'ft', 'Squadra Vince Tempo + Partita', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('team_wins_all_quarters_ft', 'team_wins_all_quarters', 'ft', 'Squadra Vince Tutti Quarti', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuna"}]'::jsonb),
  ('team_wins_both_halves_any_ft', 'team_wins_both_halves_any', 'ft', 'Squadra Vince Entrambi Tempi', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuna"}]'::jsonb),

  ('team_quarters_same_points_ft', 'team_quarters_same_points', 'ft', 'Quarti Con Stesso Numero Punti', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Squadra X Totale Nel Minuto (bugged scraper — market only)
  ('team_total_at_minute_grid_ft', 'team_total_at_minute_grid', 'ft', 'Totale Squadra Al Minuto', false,
   '[{"key":"grid","name_it":"Bugged"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  SELECT u.source, u.smt, 'team1_halftime_total_ft'::text ck, NULL::numeric ln FROM unmapped u WHERE u.smt ~ '^Squadra 1, Totale Intermedio( -)?$'
  UNION ALL SELECT u.source, u.smt, 'team2_halftime_total_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 2, Totale Intermedio( -)?$'
  UNION ALL SELECT u.source, u.smt, 'team_total_at_minute_grid_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra [12] Totale Nel Minuto(\s+\([0-9.]+\))?\s*(-\s*)?$'
  UNION ALL SELECT u.source, u.smt, 'team_win_and_total_corners_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra Vince e Totale Calci D''angolo Under/Over \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team1_first_goal_and_result_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 1, Primo Goal \+ Esito Della Partita$'
  UNION ALL SELECT u.source, u.smt, 'team2_first_goal_and_result_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 2, Primo Goal \+ Esito Della Partita$'
  UNION ALL SELECT u.source, u.smt, 'team1_win_by_1_or_draw_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 1 Vince Esattamente Di Un Goal O Pareggia$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_by_1_or_draw_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 2 Vince Esattamente Di Un Goal O Pareggia$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_quarter_and_match_ft', 1 FROM unmapped u WHERE u.smt ~ '^Squadra Vince il 1° Quarto e La Partita$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_quarter_and_match_ft', 2 FROM unmapped u WHERE u.smt ~ '^Squadra Vince il 2° Quarto e La Partita$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_quarter_and_match_ft', 3 FROM unmapped u WHERE u.smt ~ '^Squadra Vince il 3° Quarto e La Partita$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_quarter_and_match_ft', 4 FROM unmapped u WHERE u.smt ~ '^Squadra Vince il 4° Quarto e La Partita$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_half_and_match_ft', 1 FROM unmapped u WHERE u.smt ~ '^Squadra Vince il 1° Tempo e La Partita$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_half_and_match_ft', 2 FROM unmapped u WHERE u.smt ~ '^Squadra Vince il 2° Tempo e La Partita$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_all_quarters_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra Vince Tutti i Quarti$'
  UNION ALL SELECT u.source, u.smt, 'team_wins_both_halves_any_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra Vince Entrambi i Tempi$'
  UNION ALL SELECT u.source, u.smt, 'team_quarters_same_points_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra [12], Totale Quarti Con Lo Stesso Numero Di Punti \([0-9.]+\)$'

  -- Additional: Vince Di variants without parens already exist, no more needed
  -- U/O residue (U in prefix)
  UNION ALL SELECT u.source, u.smt, 'u_o_ft', (regexp_match(u.smt, 'U/O ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^U/O [0-9.]+$' AND u.smt !~ 'Incl'
  UNION ALL SELECT u.source, u.smt, 'u_o_et', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^U/O Incl\.'
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
