-- 071b_wave_21_seed.sql
-- Wave 21 seed: apply new regex rules + fix gaps from Wave 20 + bulk-backfill
-- existing rules (Wave 14 U/O Incl. Supp, Wave 10 T/T Handicap, team_result_total, etc.)

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- U/O Incl. Supp. N.N → u_o_et (Wave 14 rule)
  SELECT u.source, u.smt, 'u_o_et'::text ck, (regexp_match(u.smt, '([\d.]+)$'))[1]::numeric ln FROM unmapped u WHERE u.smt ~* '^U/O\s+Incl\.\s*Supp\.\s+[\d.]+$'

  -- N, Risultato + Totale (N) → team{1|2}_result_total_ft
  UNION ALL SELECT u.source, u.smt, 'team1_result_total_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1,\s+Risultato\s+\+\s+Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team2_result_total_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^2,\s+Risultato\s+\+\s+Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team1_result_total_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1,\s+Risultato\s+\+\s+Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_result_total_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^2,\s+Risultato\s+\+\s+Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team1_result_total_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^1,\s+Risultato\s+\+\s+Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_result_total_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^2,\s+Risultato\s+\+\s+Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'

  -- Totale N Individuale 3Opzioni (N) (no period)
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_ft', (regexp_match(u.smt, '\((\d+)\)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+1\s+Individuale\s+3Opzioni\s+\(\d+\)$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_ft', (regexp_match(u.smt, '\((\d+)\)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+2\s+Individuale\s+3Opzioni\s+\(\d+\)$'

  -- Totale 3Opzioni (N) (no period)
  UNION ALL SELECT u.source, u.smt, 'total_3way_ft', (regexp_match(u.smt, '\((\d+)\)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+3Opzioni\s+\(\d+\)$'

  -- Totale N Individuale 3Opzioni (N) - 11T/12T (basket halves aggregate)
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_1h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+1\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_1h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+2\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+1\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+12T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+2\s+Individuale\s+3Opzioni\s+\(\d+\)\s+-\s+12T$'

  -- Differenza Punti Esatta (permissive trailing dots)
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.*\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.*\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.*\s+\([\d.]+\)\s+-\s+(2T|12T)$'

  -- Entrambe Le Squadre Segnano N Punti Ciascuna (N) 11T/12T
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\([\d.]+\)\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\([\d.]+\)\s+-\s+12T$'

  -- Tournament periods
  UNION ALL SELECT u.source, u.smt, 'tournament_most_scoring_match_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Partita\s+Con\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s*Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_most_scoring_match_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Partita\s+Con\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s*Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_least_scoring_match_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Partita\s+Con\s+il\s+Minor\s+Numero\s+di\s+Marcature\s+Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_least_scoring_match_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Partita\s+Con\s+il\s+Minor\s+Numero\s+di\s+Marcature\s+Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_most_scoring_team_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+Che\s+Realizza\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s+Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_most_scoring_team_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+Che\s+Realizza\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s+Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_highest_home_score_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+Di\s+Casa\s+Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_highest_home_score_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+Di\s+Casa\s+Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_highest_away_score_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+In\s+Trasferta\s+Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_highest_away_score_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+In\s+Trasferta\s+Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'

  -- Totale Home/Away (Points) N.N - NT
  UNION ALL SELECT u.source, u.smt, 'total_team_ft', (regexp_match(u.smt, 'Points\)\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+(Home|Away)\s+\(Points\)\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'total_team_1h', (regexp_match(u.smt, 'Points\)\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+(Home|Away)\s+\(Points\)\s+[\d.]+\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_2h', (regexp_match(u.smt, 'Points\)\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+(Home|Away)\s+\(Points\)\s+[\d.]+\s+-\s+(2T|12T)$'

  -- Cricket
  UNION ALL SELECT u.source, u.smt, 'team_total_run_over_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+[12]\s+Totale\s+Run\s+Nell[''’]Over\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'last_digit_after_overs_ft', NULL FROM unmapped u WHERE u.smt ~* '^Ultima\s+Cifra\s+Nel\s+Risultato\s+Della\s+Partita\s+Dopo\s+\d+\s+Over\s+Del\s+Primo\s+Innings\s+\([\d.]+\)$'

  -- Minute-based handicap / BTTS at minute
  UNION ALL SELECT u.source, u.smt, 'minute_handicap_ft', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Handicap\s+Al\s+Minuto\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'minute_btts_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+a\s+Segno\s+Al\s+Minuto\s+\([\d.]+\)$'

  -- Testa a testa Handicap → 2way_handicap_ft
  UNION ALL SELECT u.source, u.smt, '2way_handicap_ft', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Testa\s+a\s+testa\s+Handicap\s+\([+-]?[\d.]+\)$'

  -- Frag, Totale (N) - NT
  UNION ALL SELECT u.source, u.smt, 'frag_total_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Frag,\s+Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'frag_total_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Frag,\s+Totale\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'frag_total_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Frag,\s+Totale\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team1_frag_total_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+1,\s+Totale\s+Frag\s+\([\d.]+\)(\s+-\s+\d+T)?$'
  UNION ALL SELECT u.source, u.smt, 'team2_frag_total_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+2,\s+Totale\s+Frag\s+\([\d.]+\)(\s+-\s+\d+T)?$'

  -- Esports per-map
  UNION ALL SELECT u.source, u.smt, 'map_round_handicap_ft', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Map\s+\d+\s+-\s+Round\s+Handicap\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'map_total_rounds_ft', (regexp_match(u.smt, 'Rounds\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Map\s+\d+\s+-\s+Total\s+Rounds\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'map_total_minutes_ft', (regexp_match(u.smt, 'totali\s+([\d.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Mappa\s+\d+\s+-\s+Minuti\s+totali\s+[\d.]+$'

  -- Quante Squadre Segneranno Un Determinato Numero Di Goal (- period)
  UNION ALL SELECT u.source, u.smt, 'teams_scoring_n_goals_ft', NULL FROM unmapped u WHERE u.smt ~* '^Quante\s+Squadre\s+Segneranno\s+Un\s+Determinato\s+Numero\s+Di\s+Goal$'
  UNION ALL SELECT u.source, u.smt, 'teams_scoring_n_goals_ft', NULL FROM unmapped u WHERE u.smt ~* '^Quante\s+Squadre\s+Segneranno\s+Un\s+Determinato\s+Numero\s+Di\s+Goal\s+-\s+(1T|11T|2T|12T)$'

  -- Sfida Al (N) - NT (race to goals existing rule, needs 11T/12T variant)
  UNION ALL SELECT u.source, u.smt, 'race_to_goals_ft', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+Al\s+\(\d+\)\s+-\s+(11T|12T)$'

  -- Handicap Asiatico (N) - 11T/12T
  UNION ALL SELECT u.source, u.smt, 'asian_handicap_1h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Handicap\s+Asiatico\s+\([+-]?[\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_handicap_2h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Handicap\s+Asiatico\s+\([+-]?[\d.]+\)\s+-\s+(2T|12T)$'

  -- Handicap - N° Quarto (N) — Wave 13 rule, ensure all seeded
  UNION ALL SELECT u.source, u.smt, '2way_handicap_1h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Handicap\s+-\s+1°\s*Quarto\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_2h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Handicap\s+-\s+2°\s*Quarto\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_3h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Handicap\s+-\s+3°\s*Quarto\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_4h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Handicap\s+-\s+4°\s*Quarto\s+\([+-]?[\d.]+\)$'

  -- NXN H (N) - NT → 1x2_h_{period}
  UNION ALL SELECT u.source, u.smt, '1x2_h_ft', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^\dX\d\s+H\s+\([+-]?[\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, '1x2_h_1h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^\dX\d\s+H\s+\([+-]?[\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, '1x2_h_2h', (regexp_match(u.smt, '\(([+-]?[\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^\dX\d\s+H\s+\([+-]?[\d.]+\)\s+-\s+(2T|12T)$'
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
