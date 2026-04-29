-- 068b_wave_18_seed.sql
-- Wave 18 seed: first_goal_half, second_goal_time, team_exact_goals periods,
-- exact_total_halves, set_match_combo, team_total_oe periods, win_by_margin
-- periods, minute_win_or_draw, minute_total_grid, trailing-dash regressions.

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  SELECT u.source, u.smt, 'first_goal_half_ft'::text ck, (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='first_goal_half_ft') cn, NULL::numeric ln FROM unmapped u WHERE u.smt ~* '^Gol\s+Nel\s+Tempo$'
  UNION ALL SELECT u.source, u.smt, 'second_goal_time_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='second_goal_time_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Momento\s+In\s+Cui\s+Viene\s+Realizzato\s+Il\s+Secondo\s+Goal$'

  UNION ALL SELECT u.source, u.smt, 'team1_exact_goals_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_exact_goals_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Numero\s+Esatto\s+Di\s+Goal\s+\(\d+\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'team1_exact_goals_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_exact_goals_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Numero\s+Esatto\s+Di\s+Goal\s+\(\d+\)\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'team2_exact_goals_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_exact_goals_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Numero\s+Esatto\s+Di\s+Goal\s+\(\d+\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'team2_exact_goals_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_exact_goals_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Numero\s+Esatto\s+Di\s+Goal\s+\(\d+\)\s+-\s+2T$'

  UNION ALL SELECT u.source, u.smt, 'exact_total_halves_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='exact_total_halves_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Numero\s+Esatto\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'exact_total_halves_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='exact_total_halves_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Numero\s+Esatto\s+-\s+2T$'

  UNION ALL SELECT u.source, u.smt, 'exact_total_grid_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='exact_total_grid_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Esatto(\s+-\s*)?$'

  UNION ALL SELECT u.source, u.smt, 'set_match_combo_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='set_match_combo_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Set\s+/\s+Partita$'

  UNION ALL SELECT u.source, u.smt, 'team1_total_oe_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_total_oe_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Pari\s*/\s*Dispari\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_oe_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_total_oe_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Pari\s*/\s*Dispari\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_oe_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_total_oe_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Pari\s*/\s*Dispari\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_oe_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_total_oe_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Pari\s*/\s*Dispari\s+-\s+2T$'

  UNION ALL SELECT u.source, u.smt, 'win_by_margin_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='win_by_margin_1h'), (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Vittoria\s+Di\s+\((\d+)\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='win_by_margin_2h'), (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Vittoria\s+Di\s+\((\d+)\)\s+-\s+2T$'

  UNION ALL SELECT u.source, u.smt, 'minute_win_or_draw_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='minute_win_or_draw_ft'), (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Vittoria\s+o\s+Pareggio\s+Al\s+Minuto\s+\((\d+)\)$'

  -- Totale Al Minuto variants → minute_total_grid_ft (market only)
  UNION ALL SELECT u.source, u.smt, 'minute_total_grid_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='minute_total_grid_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Al\s+Minuto(\s+\([\d.]+\))?(\s+-\s*.*)?$'

  -- Segna In Entrambi i Tempi (trailing dash) → both_halves_score (NB canonical_key has no _ft suffix)
  UNION ALL SELECT u.source, u.smt, 'both_halves_score', NULL, NULL FROM unmapped u WHERE u.smt ~* '^Segna\s+In\s+Entrambi\s+i\s+Tempi(\s+-\s*)?$'

  -- Prossimo Calcio D'angolo (1) - (trailing dash) → next_corner_ft line=1
  UNION ALL SELECT u.source, u.smt, 'next_corner_ft', NULL, (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Prossimo\s+Calcio\s+D[''’]angolo\s+\((\d+)\)(\s+-\s*)?$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck,
       m.ln,
       COALESCE(m.cn, (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key=m.ck)),
       false, 'regex', 95, now()
FROM matches m
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key = EXCLUDED.canonical_key,
      canonical_line = EXCLUDED.canonical_line,
      canonical_name_it = EXCLUDED.canonical_name_it,
      extracted_by = EXCLUDED.extracted_by,
      confidence = EXCLUDED.confidence,
      updated_at = now()
  WHERE market_normalization.verified = false
    AND market_normalization.canonical_key IS NULL;
