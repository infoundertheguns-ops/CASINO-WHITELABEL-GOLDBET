-- 070b_wave_20_seed.sql
-- Wave 20 seed: bulk-apply regex patterns (existing + new) to all currently
-- unmapped markets. Pushes through 11T/12T basketball-halves unlock + all
-- new families from mig 070.

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- ═══ 11T/12T basket halves — use existing regex families ═══
  -- Totale N Individuale 3Opzioni (N) - 11T/12T → team{1|2}_total_3way_{1h|2h}
  SELECT u.source, u.smt, 'team1_total_3way_1h'::text ck, (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric ln FROM unmapped u WHERE u.smt ~* '^Totale\s+1\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_1h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+2\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+1\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+12T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+2\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+12T$'
  -- 3T/4T variants (new canonicals mig 070)
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_3h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+1\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_3h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+2\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_4h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+1\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+4T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_4h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+2\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+4T$'

  -- Totale 3Opzioni (N) - NT
  UNION ALL SELECT u.source, u.smt, 'total_3way_1h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+3Opzioni\s+\(\d+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_3way_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+3Opzioni\s+\(\d+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'total_3way_3h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+3Opzioni\s+\(\d+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'total_3way_4h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+3Opzioni\s+\(\d+\)\s+-\s+4T$'

  -- T/T Handicap (N) - NT
  UNION ALL SELECT u.source, u.smt, '2way_handicap_ft', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^T/T\s+Handicap\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_1h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^T/T\s+Handicap\s+\([+-]?[\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_2h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^T/T\s+Handicap\s+\([+-]?[\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_3h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^T/T\s+Handicap\s+\([+-]?[\d.]+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_4h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^T/T\s+Handicap\s+\([+-]?[\d.]+\)\s+-\s+4T$'

  -- U/O N.N - NT
  UNION ALL SELECT u.source, u.smt, 'u_o_ft', (regexp_match(u.smt, '^U/O\s+([\d.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^U/O\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'u_o_1h', (regexp_match(u.smt, '^U/O\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^U/O\s+[\d.]+\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'u_o_2h', (regexp_match(u.smt, '^U/O\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^U/O\s+[\d.]+\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'u_o_3h', (regexp_match(u.smt, '^U/O\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^U/O\s+[\d.]+\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'u_o_4h', (regexp_match(u.smt, '^U/O\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^U/O\s+[\d.]+\s+-\s+4T$'

  -- Totale Asiatico N.N - NT
  UNION ALL SELECT u.source, u.smt, 'asian_total_ft', (regexp_match(u.smt, '([\d.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Asiatico\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_1h', (regexp_match(u.smt, 'Asiatico\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Asiatico\s+[\d.]+\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_2h', (regexp_match(u.smt, 'Asiatico\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Asiatico\s+[\d.]+\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_3h', (regexp_match(u.smt, 'Asiatico\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Asiatico\s+[\d.]+\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_4h', (regexp_match(u.smt, 'Asiatico\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Asiatico\s+[\d.]+\s+-\s+4T$'

  -- Squadra N Totale Asiatico (N) - NT
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+[12]\s+Totale\s+Asiatico\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+[12]\s+Totale\s+Asiatico\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+[12]\s+Totale\s+Asiatico\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_3h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+[12]\s+Totale\s+Asiatico\s+\([\d.]+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_4h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+[12]\s+Totale\s+Asiatico\s+\([\d.]+\)\s+-\s+4T$'

  -- Totale Squadra N.N - NT (no parens)
  UNION ALL SELECT u.source, u.smt, 'total_team_1h', (regexp_match(u.smt, 'Squadra\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Squadra\s+[\d.]+\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_2h', (regexp_match(u.smt, 'Squadra\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Squadra\s+[\d.]+\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_3h', (regexp_match(u.smt, 'Squadra\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Squadra\s+[\d.]+\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'total_team_4h', (regexp_match(u.smt, 'Squadra\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Squadra\s+[\d.]+\s+-\s+4T$'

  -- Individuale Totale N Pari/Dispari - NT
  UNION ALL SELECT u.source, u.smt, 'team1_total_oe_1h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Pari\s*/\s*Dispari\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_oe_2h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Pari\s*/\s*Dispari\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_oe_1h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Pari\s*/\s*Dispari\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_oe_2h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Pari\s*/\s*Dispari\s+-\s+(2T|12T)$'

  -- 1X2 - 11T/12T / DC - 11T/12T / Pari/Dispari / GG/NG
  UNION ALL SELECT u.source, u.smt, '1x2_1h', NULL FROM unmapped u WHERE u.smt ~* '^1X2\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, '1x2_2h', NULL FROM unmapped u WHERE u.smt ~* '^1X2\s+-\s+12T$'
  UNION ALL SELECT u.source, u.smt, 'dc_1h', NULL FROM unmapped u WHERE u.smt ~* '^DC\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'dc_2h', NULL FROM unmapped u WHERE u.smt ~* '^DC\s+-\s+12T$'
  UNION ALL SELECT u.source, u.smt, 'oe_1h', NULL FROM unmapped u WHERE u.smt ~* '^Pari\s*/\s*Dispari\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'oe_2h', NULL FROM unmapped u WHERE u.smt ~* '^Pari\s*/\s*Dispari\s+-\s+12T$'
  UNION ALL SELECT u.source, u.smt, 'gg_ng_1h', NULL FROM unmapped u WHERE u.smt ~* '^GG/NG\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'gg_ng_2h', NULL FROM unmapped u WHERE u.smt ~* '^GG/NG\s+-\s+12T$'

  -- 1X2 H / 1X2 Asian H with 11T/12T
  UNION ALL SELECT u.source, u.smt, '1x2_h_1h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1X2\s+H\s+\([+-]?[\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, '1x2_h_2h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1X2\s+H\s+\([+-]?[\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_handicap_1h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1X2\s+Asian\s+H\s+\([+-]?[\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_handicap_2h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1X2\s+Asian\s+H\s+\([+-]?[\d.]+\)\s+-\s+(2T|12T)$'

  -- ═══ Wave 20 new families ═══
  -- Squadra 1/2, Calci D'Angolo Multipli (N) -
  UNION ALL SELECT u.source, u.smt, 'team1_multi_corners_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+1,\s+Calci\s+D[''’]Angolo\s+Multipli\s+\([\d.]+\)(\s+-\s*)?$'
  UNION ALL SELECT u.source, u.smt, 'team2_multi_corners_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+2,\s+Calci\s+D[''’]Angolo\s+Multipli\s+\([\d.]+\)(\s+-\s*)?$'
  UNION ALL SELECT u.source, u.smt, 'multi_corners_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Calci\s+D[''’]Angolo\s+Multipli\s+\([\d.]+\)(\s+-\s*)?$'

  -- Entrambe Le Squadre Segnano N Punti Ciascuna (N) - NT
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_3h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\([\d.]+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_4h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\([\d.]+\)\s+-\s+4T$'

  -- Differenza Punti Esatta (N)
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.?\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.?\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.?\s+\([\d.]+\)\s+-\s+(2T|12T)$'

  -- Cifra Nel Risultato (N)
  UNION ALL SELECT u.source, u.smt, 'last_digit_result_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Cifra\s+Nel\s+Risultato\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'last_digit_result_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Cifra\s+Nel\s+Risultato\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'last_digit_result_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Cifra\s+Nel\s+Risultato\s+\([\d.]+\)\s+-\s+(2T|12T)$'

  -- Map N - Team Kills Handicap (N)
  UNION ALL SELECT u.source, u.smt, 'map_team_kills_handicap_ft', (regexp_match(u.smt, 'Handicap\s+\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Map\s+\d+\s+-\s+Team\s+Kills\s+Handicap\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'map_total_kills_ft', (regexp_match(u.smt, 'Kills\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Map\s+\d+\s+-\s+Total\s+Kills\s+[\d.]+$'

  -- Punteggio Più Alto Casa (tournament)
  UNION ALL SELECT u.source, u.smt, 'tournament_highest_home_score_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+Di\s+Casa\s+Totale\s+\([\d.]+\)(\s+-\s+\d+T)?$'

  -- Totale Ogni Squadra Segnerà Under/Over (N)
  UNION ALL SELECT u.source, u.smt, 'both_teams_total_ou_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Ogni\s+Squadra\s+Segnerà\s+Under/Over\s+\([\d.]+\)$'

  -- Squadra N Segna Goal Consecutivi (N)
  UNION ALL SELECT u.source, u.smt, 'team1_consecutive_goals_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+1\s+Segna\s+Goal\s+Consecutivi\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team2_consecutive_goals_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+2\s+Segna\s+Goal\s+Consecutivi\s+\([\d.]+\)$'

  -- Sfida A Punti (NOpzioni) (N) - NT
  UNION ALL SELECT u.source, u.smt, 'race_to_points_ft', (regexp_match(u.smt, '\)\s*\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+A\s+Punti\s+\(\d+Opzioni\)\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'race_to_points_1h', (regexp_match(u.smt, '\)\s*\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+A\s+Punti\s+\(\d+Opzioni\)\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'race_to_points_2h', (regexp_match(u.smt, '\)\s*\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+A\s+Punti\s+\(\d+Opzioni\)\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'race_to_points_3h', (regexp_match(u.smt, '\)\s*\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+A\s+Punti\s+\(\d+Opzioni\)\s+\([\d.]+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'race_to_points_4h', (regexp_match(u.smt, '\)\s*\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+A\s+Punti\s+\(\d+Opzioni\)\s+\([\d.]+\)\s+-\s+4T$'

  -- Esports totals
  UNION ALL SELECT u.source, u.smt, 'total_nashor_ft', (regexp_match(u.smt, '([\d.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Nashor\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'total_dragons_ft', (regexp_match(u.smt, '([\d.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Draghi\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'total_towers_ft', (regexp_match(u.smt, '([\d.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Torri\s+[\d.]+$'

  -- Wave 10 T/T Handicap bulk-backfill for never-seeded types (existing rule)
  -- Already handled above but explicit for Wave 20.
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck, m.ln,
       (SELECT canonical_name_it FROM canonical_markets cm WHERE cm.canonical_key=m.ck),
       false, 'regex', 95, now()
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
