-- 069b_wave_19_seed.sql
-- Wave 19 seed: Kambi Opta player props + 22bet esports/tennis/tournament/corners
-- + scraper-bug market-level canonicalization.

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- ═══ Kambi Opta player props ═══
  SELECT u.source, u.smt, 'player_scores_goals_ft'::text ck, (regexp_match(u.smt, '^Segna\s+almeno\s+(\d+)\s+gol\s+\d+$'))[1]::numeric ln FROM unmapped u WHERE u.smt ~* '^Segna\s+almeno\s+(\d+)\s+gol\s+\d+$'
  UNION ALL SELECT u.source, u.smt, 'player_scores_goals_ft', (regexp_match(u.smt, '^Segna\s+(\d+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Segna\s+(\d+)$'
  UNION ALL SELECT u.source, u.smt, 'player_scores_header_ft', (regexp_match(u.smt, '^Segna\s+di\s+testa\s+(\d+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Segna\s+di\s+testa\s+(\d+)$'
  UNION ALL SELECT u.source, u.smt, 'player_scores_outside_ft', (regexp_match(u.smt, '^Segna\s+da\s+fuori\s+area\s+(\d+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Segna\s+da\s+fuori\s+area\s+(\d+)$'
  UNION ALL SELECT u.source, u.smt, 'player_assists_ft', (regexp_match(u.smt, '\s(\d+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Fornisce\s+un\s+assist(\s+\([^)]+\))?\s+\d+$'
  UNION ALL SELECT u.source, u.smt, 'player_scores_or_assists_ft', (regexp_match(u.smt, '\s(\d+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Segna\s+o\s+passa\s+un\s+assist(\s+\([^)]+\))?\s+\d+$'
  UNION ALL SELECT u.source, u.smt, 'player_booked_ft', (regexp_match(u.smt, '\s(\d+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Riceve\s+un\s+cartellino\s+\d+$'
  UNION ALL SELECT u.source, u.smt, 'player_red_card_ft', (regexp_match(u.smt, '\s(\d+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Prende\s+un\s+cartellino\s+rosso\s+\d+$'
  UNION ALL SELECT u.source, u.smt, 'player_shots_on_target_ft', (regexp_match(u.smt, '([\d.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Tiri\s+del\s+giocatore\s+nello\s+specchio\s+della\s+porta(\s+\([^)]+\))?\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'total_shots_on_target_ft', (regexp_match(u.smt, '([\d.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+tiri\s+in\s+porta(\s+\([^)]+\))?\s+[\d.]+$'
  UNION ALL SELECT u.source, u.smt, 'more_shots_on_target_ft', NULL::numeric FROM unmapped u WHERE u.smt ~* '^Pi[úù]\s+tiri\s+in\s+porta(\s+\([^)]+\))?$'
  UNION ALL SELECT u.source, u.smt, 'woodwork_hit_ft', NULL::numeric FROM unmapped u WHERE u.smt ~* '^Woodwork\s+to\s+be\s+Hit\s+in\s+the\s+Match(\s+\([^)]+\))?$'

  -- ═══ 22bet esports ═══
  UNION ALL SELECT u.source, u.smt, 'first_blood_ft', NULL FROM unmapped u WHERE u.smt ~* '^Primo\s+Sangue$'
  UNION ALL SELECT u.source, u.smt, 'first_blood_1h', NULL FROM unmapped u WHERE u.smt ~* '^Primo\s+Sangue\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'first_blood_2h', NULL FROM unmapped u WHERE u.smt ~* '^Primo\s+Sangue\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'first_blood_3h', NULL FROM unmapped u WHERE u.smt ~* '^Primo\s+Sangue\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'nashor_ft', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Chi\s+Batterà\s+Nashor\s+\(\d+\)$'
  UNION ALL SELECT u.source, u.smt, 'nashor_1h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Chi\s+Batterà\s+Nashor\s+\(\d+\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'nashor_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Chi\s+Batterà\s+Nashor\s+\(\d+\)\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'inhibitor_destroyed_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Inhibitor\s+Distrutti\.?\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'inhibitor_destroyed_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Inhibitor\s+Distrutti\.?\s+\([\d.]+\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'inhibitor_destroyed_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Inhibitor\s+Distrutti\.?\s+\([\d.]+\)\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'frag_race_ft', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Frag,\s+Sfida\s+Al\s+\(\d+\)$'
  UNION ALL SELECT u.source, u.smt, 'frag_race_1h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Frag,\s+Sfida\s+Al\s+\(\d+\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'frag_race_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Frag,\s+Sfida\s+Al\s+\(\d+\)\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'frag_total_oe_ft', NULL FROM unmapped u WHERE u.smt ~* '^Frag,\s+Totale\s+Pari/Dispari$'
  UNION ALL SELECT u.source, u.smt, 'frag_total_oe_1h', NULL FROM unmapped u WHERE u.smt ~* '^Frag,\s+Totale\s+Pari/Dispari\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'frag_total_oe_2h', NULL FROM unmapped u WHERE u.smt ~* '^Frag,\s+Totale\s+Pari/Dispari\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'round_total_oe_ft', NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Round\s+Pari\s*/\s*Dispari$'
  UNION ALL SELECT u.source, u.smt, 'round_total_oe_1h', NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Round\s+Pari\s*/\s*Dispari\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'round_total_oe_2h', NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Round\s+Pari\s*/\s*Dispari\s+-\s+2T$'

  -- ═══ 22bet tennis compound ═══
  UNION ALL SELECT u.source, u.smt, 'point_score_first_serve_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Giocatore\s+[12],\s+Punteggio\s+Del\s+1°\s+Servizio\s+\([\d.]+\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'point_score_first_serve_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Giocatore\s+[12],\s+Punteggio\s+Del\s+1°\s+Servizio\s+\([\d.]+\)\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'serve_hold_with_score_1h', NULL FROM unmapped u WHERE u.smt ~* '^Vince\s+Il\s+Suo\s+Primo\s+Turno\s+Di\s+Servizio\s+Col\s+Punteggio\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'serve_hold_with_score_2h', NULL FROM unmapped u WHERE u.smt ~* '^Vince\s+Il\s+Suo\s+Primo\s+Turno\s+Di\s+Servizio\s+Col\s+Punteggio\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'games_race_1h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+Al\s+\(\d+\)\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'games_race_2h', (regexp_match(u.smt, '\((\d+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Sfida\s+Al\s+\(\d+\)\s+-\s+2T$'

  -- ═══ 22bet tournament ═══
  UNION ALL SELECT u.source, u.smt, 'tournament_most_scoring_match_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Partita\s+Con\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s*Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_least_scoring_match_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Partita\s+Con\s+il\s+Minor\s+Numero\s+di\s+Marcature\s+Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_most_scoring_team_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+Che\s+Realizza\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s+Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_least_scoring_team_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Squadra\s+Che\s+Realizza\s+il\s+Minor\s+Numero\s+Di\s+Marcature\s+Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_highest_away_score_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+In\s+Trasferta\s+Totale\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_matches_overunder_ft', NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Partite\s+Con\s+Over/Under$'

  -- ═══ 22bet corner interval ═══
  UNION ALL SELECT u.source, u.smt, 'corner_interval_ft', NULL FROM unmapped u WHERE u.smt ~* '^Calcio\s+D[''’]angolo\s+Dal\s+Minuto\s+Al\s+Minuto(\s+\([\d.]+\))?(\s+-\s*)?$'
  UNION ALL SELECT u.source, u.smt, 'team1_corner_interval_ft', NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+1,\s+Calcio\s+D[''’]angolo\s+Dal\s+Minuto\s+Al\s+Minuto(\s+\([\d.]+\))?(\s+-\s*)?$'
  UNION ALL SELECT u.source, u.smt, 'team2_corner_interval_ft', NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+2,\s+Calcio\s+D[''’]angolo\s+Dal\s+Minuto\s+Al\s+Minuto(\s+\([\d.]+\))?(\s+-\s*)?$'

  -- ═══ Scraper-bug market-only ═══
  UNION ALL SELECT u.source, u.smt, 'first_goal_time_ft', NULL FROM unmapped u WHERE u.smt ~* '^Momento\s+In\s+Cui\s+Viene\s+Realizzato\s+Il\s+Primo\s+Goal$'
  UNION ALL SELECT u.source, u.smt, 'team_half_first_goal_ft', NULL FROM unmapped u WHERE u.smt ~* '^In\s+Quale\s+Tempo\s+Squadra\s+[12]\s+Segna\s+Il\s+Suo\s+Goal$'
  UNION ALL SELECT u.source, u.smt, 'super_handicap_ft', NULL FROM unmapped u WHERE u.smt ~* '^SuperHandicap$'
  UNION ALL SELECT u.source, u.smt, 'super_handicap_1h', NULL FROM unmapped u WHERE u.smt ~* '^SuperHandicap\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'super_handicap_2h', NULL FROM unmapped u WHERE u.smt ~* '^SuperHandicap\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'super_total_ft', NULL FROM unmapped u WHERE u.smt ~* '^SuperTotale$'
  UNION ALL SELECT u.source, u.smt, 'super_total_1h', NULL FROM unmapped u WHERE u.smt ~* '^SuperTotale\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'super_total_2h', NULL FROM unmapped u WHERE u.smt ~* '^SuperTotale\s+-\s+2T$'
  UNION ALL SELECT u.source, u.smt, 'exact_total_sets_ft', NULL FROM unmapped u WHERE u.smt ~* '^Numero\s+Esatto\s+Totale\s+di\s+Set$'
  UNION ALL SELECT u.source, u.smt, 'exact_total_ft', NULL FROM unmapped u WHERE u.smt ~* '^Numero\s+Esatto$'

  -- ═══ Prossimo Calcio D'angolo (no line) ═══
  UNION ALL SELECT u.source, u.smt, 'next_corner_ft', NULL FROM unmapped u WHERE u.smt ~* '^Prossimo\s+Calcio\s+D[''’]angolo(\s+-\s*)?$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck, m.ln,
       (SELECT canonical_name_it FROM canonical_markets cm WHERE cm.canonical_key=m.ck),
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
