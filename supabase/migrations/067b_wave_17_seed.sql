-- 067b_wave_17_seed.sql
-- Seed market_normalization with Wave 17 matches (compound + minute + multi-goal).

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (
      SELECT 1 FROM market_normalization mn
      WHERE mn.source = e.source AND mn.source_market_type = m.market_type
        AND mn.canonical_key IS NOT NULL
    )
),
matches AS (
  -- PT-F + Totale (N)
  SELECT u.source, u.smt, 'htft_and_total_ft'::text canonical_key,
         (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='htft_and_total_ft') AS canonical_name_it,
         (regexp_match(u.smt, '^PT-F\s+\+\s+Totale\s+\(([\d.]+)\)$'))[1]::numeric AS line
  FROM unmapped u WHERE u.smt ~* '^PT-F\s+\+\s+Totale\s+\(([\d.]+)\)$'

  -- Handicap 1/2 + Totale (N) → handicap_and_total_ft
  UNION ALL
  SELECT u.source, u.smt, 'handicap_and_total_ft',
         (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='handicap_and_total_ft'),
         (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~* '^Handicap\s+[12]\s+\+\s+Totale\s+\(([\d.]+)\)$'

  -- Handicap 1/2 + Totale (no line, trailing dash, period {1h,2h,ft})
  UNION ALL
  SELECT u.source, u.smt, 'handicap_and_total_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='handicap_and_total_1h'), NULL
  FROM unmapped u WHERE u.smt ~* '^Handicap\s+[12]\s+\+\s+Totale\s+-\s+1T$'
  UNION ALL
  SELECT u.source, u.smt, 'handicap_and_total_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='handicap_and_total_2h'), NULL
  FROM unmapped u WHERE u.smt ~* '^Handicap\s+[12]\s+\+\s+Totale\s+-\s+2T$'
  UNION ALL
  SELECT u.source, u.smt, 'handicap_and_total_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='handicap_and_total_ft'), NULL
  FROM unmapped u WHERE u.smt ~* '^Handicap\s+[12]\s+\+\s+Totale(\s+-\s+)?$'

  -- Doppia Chance + Totale (N)
  UNION ALL
  SELECT u.source, u.smt, 'dc_and_total_ft',
         (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='dc_and_total_ft'),
         (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~* '^Doppia\s+Chance\s+\+\s+Totale\s+\(([\d.]+)\)$'

  -- Entrambe A Segno / Entrambe Le Squadre a Segno + Totale (N)
  UNION ALL
  SELECT u.source, u.smt, 'btts_and_total_ft',
         (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='btts_and_total_ft'),
         (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~* '^Entrambe\s+A\s+Segno\s+S[iì]/No\s+\+\s+Totale\s+\(([\d.]+)\)$'
                   OR u.smt ~* '^Entrambe\s+Le\s+Squadre\s+a\s+Segno\s+\+\s+Totale\s+\(([\d.]+)\)$'

  -- Multi Goal / Multi Goal - 1T/2T
  UNION ALL SELECT u.source, u.smt, 'multi_goal_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='multi_goal_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Multi\s+Goal$'
  UNION ALL SELECT u.source, u.smt, 'multi_goal_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='multi_goal_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Multi\s+Goal\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'multi_goal_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='multi_goal_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Multi\s+Goal\s+-\s+2T$'

  -- Squadra 1/2, Multi Goal (+ period)
  UNION ALL SELECT u.source, u.smt, 'team1_multi_goal_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_multi_goal_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+1,\s+Multi\s+Goal$'
  UNION ALL SELECT u.source, u.smt, 'team2_multi_goal_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_multi_goal_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+2,\s+Multi\s+Goal$'
  UNION ALL SELECT u.source, u.smt, 'team1_multi_goal_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_multi_goal_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+1,\s+Multi\s+Goal\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'team2_multi_goal_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_multi_goal_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+2,\s+Multi\s+Goal\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'team1_multi_goal_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_multi_goal_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+1,\s+Multi\s+Goal\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'team2_multi_goal_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_multi_goal_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+2,\s+Multi\s+Goal\s+-\s+2T$'

  -- Risultato Al Minuto (N)
  UNION ALL
  SELECT u.source, u.smt, 'minute_result_ft',
         (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='minute_result_ft'),
         (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~* '^Risultato\s+Al\s+Minuto\s+\((\d+)\)(\s+-\s*.*)?$'

  -- Tempo Del Primo Goal
  UNION ALL SELECT u.source, u.smt, 'time_of_first_goal_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='time_of_first_goal_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Tempo\s+Del\s+Primo\s+Goal$'

  -- Totale Goal Nei Tempi (N.5)
  UNION ALL
  SELECT u.source, u.smt, 'halves_both_ou_ft',
         (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='halves_both_ou_ft'),
         (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric
  FROM unmapped u WHERE u.smt ~* '^Totale\s+Goal\s+Nei\s+Tempi\s+\(([\d.]+)\)$'

  -- Tennis first serve hold
  UNION ALL SELECT u.source, u.smt, 'first_serve_hold_1h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='first_serve_hold_1h'), NULL FROM unmapped u WHERE u.smt ~* '^Vince\s+Il\s+Suo\s+Primo\s+Turno\s+Di\s+Servizio\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'first_serve_hold_2h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='first_serve_hold_2h'), NULL FROM unmapped u WHERE u.smt ~* '^Vince\s+Il\s+Suo\s+Primo\s+Turno\s+Di\s+Servizio\s+-\s+2T$'

  -- Goal Intervallo variants → goal_interval_ft (market canonicalize only)
  UNION ALL SELECT u.source, u.smt, 'goal_interval_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='goal_interval_ft'), NULL
  FROM unmapped u WHERE u.smt ~* '^Goal\s+Intervallo(\s+-\s+(S[iì]|No))?(\s+\([\d.]+\))?$'
  UNION ALL SELECT u.source, u.smt, 'goal_interval_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='goal_interval_ft'), NULL
  FROM unmapped u WHERE u.smt ~* '^Goal\s+Nell''intervallo\s+Di\s+Tempo(\s+-\s+S[iì]/No)?(\s+\([\d.]+\))?$'

  -- Vittoria Di (no line)
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_grid_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='win_by_margin_grid_ft'), NULL FROM unmapped u WHERE u.smt ~* '^Vittoria\s+Di$'

  -- V1 + Totale 1 (N) - 3T / 4T → team1/2_win_and_team_total_3h/4h
  UNION ALL SELECT u.source, u.smt, 'team1_win_and_team_total_3h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_win_and_team_total_3h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^V1\s+\+\s+Totale\s+1\s+\(([\d.]+)\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_and_team_total_3h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_win_and_team_total_3h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^V2\s+\+\s+Totale\s+2\s+\(([\d.]+)\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team1_win_and_team_total_4h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_win_and_team_total_4h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^V1\s+\+\s+Totale\s+1\s+\(([\d.]+)\)\s+-\s+4T$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_and_team_total_4h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_win_and_team_total_4h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^V2\s+\+\s+Totale\s+2\s+\(([\d.]+)\)\s+-\s+4T$'

  -- 1/2, Risultato + Totale (N) - 3T / 4T
  UNION ALL SELECT u.source, u.smt, 'team1_result_total_3h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_result_total_3h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1,\s+Risultato\s+\+\s+Totale\s+\(([\d.]+)\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team2_result_total_3h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_result_total_3h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^2,\s+Risultato\s+\+\s+Totale\s+\(([\d.]+)\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team1_result_total_4h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_result_total_4h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1,\s+Risultato\s+\+\s+Totale\s+\(([\d.]+)\)\s+-\s+4T$'
  UNION ALL SELECT u.source, u.smt, 'team2_result_total_4h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_result_total_4h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^2,\s+Risultato\s+\+\s+Totale\s+\(([\d.]+)\)\s+-\s+4T$'

  -- Doppia Chance + Totale Squadra 1/2 (N) - 3T → team1/2_nolose_and_team_total_3h
  UNION ALL SELECT u.source, u.smt, 'team1_nolose_and_team_total_3h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team1_nolose_and_team_total_3h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Doppia\s+Chance\s+\+\s+Totale\s+Squadra\s+1\s+\(([\d.]+)\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team2_nolose_and_team_total_3h', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team2_nolose_and_team_total_3h'), (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Doppia\s+Chance\s+\+\s+Totale\s+Squadra\s+2\s+\(([\d.]+)\)\s+-\s+3T$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT source, smt, canonical_key, line, canonical_name_it, false, 'regex', 95, now()
FROM matches
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key = EXCLUDED.canonical_key,
      canonical_line = EXCLUDED.canonical_line,
      canonical_name_it = EXCLUDED.canonical_name_it,
      extracted_by = EXCLUDED.extracted_by,
      confidence = EXCLUDED.confidence,
      updated_at = now()
  WHERE market_normalization.verified = false
    AND market_normalization.canonical_key IS NULL;
