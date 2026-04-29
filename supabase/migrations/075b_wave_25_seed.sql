-- 075b_wave_25_seed.sql
-- Critical fix: re-seed Entrambe Le Squadre Segnano with fully [0-9] regex
-- (Wave 20/22 \d-based seed missed these residue variants with "- 1T" literal).

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- CRITICAL fix: Entrambe Le Squadre Segnano N Punti Ciascuna - 1T/2T (literal, not 11T/12T)
  SELECT u.source, u.smt, 'team_scores_n_points_1h'::text ck, (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric ln FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 1T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 2T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_3h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_4h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 4T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 11T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 12T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\)$'

  -- Individuale Totale X Numero Esatto Di Goal (N) [no period] → team{1|2}_exact_goals_ft
  UNION ALL SELECT u.source, u.smt, 'team1_exact_goals_ft', NULL FROM unmapped u WHERE u.smt ~ '^Individuale Totale 1 Numero Esatto Di Goal \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team2_exact_goals_ft', NULL FROM unmapped u WHERE u.smt ~ '^Individuale Totale 2 Numero Esatto Di Goal \([0-9]+\)$'

  -- Cricket Primo/Ultimo Run
  UNION ALL SELECT u.source, u.smt, 'first_run_ft', NULL FROM unmapped u WHERE u.smt ~ '^Primo Run$'
  UNION ALL SELECT u.source, u.smt, 'last_run_ft', NULL FROM unmapped u WHERE u.smt ~ '^Ultimo Run$'
  UNION ALL SELECT u.source, u.smt, 'super_over_winner_ft', NULL FROM unmapped u WHERE u.smt ~ '^Vincitore Del Super Over$'

  -- Goal Al Minuto (N) → goal_at_minute_ft line=N
  UNION ALL SELECT u.source, u.smt, 'goal_at_minute_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Goal Al Minuto \([0-9]+\)$'

  -- Vince Il Lancio Della Monetina/La Partita
  UNION ALL SELECT u.source, u.smt, 'coin_toss_and_match_ft', NULL FROM unmapped u WHERE u.smt ~ '^Vince Il Lancio Della Monetina/La Partita$'

  -- Entrambe Le Squadre Segnano In Tutti i Tempi
  UNION ALL SELECT u.source, u.smt, 'btts_all_halves_ft', NULL FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano In Tutti i Tempi$'

  -- Squadra Segna il Suo Goal Nel Tempo (N) / variants
  UNION ALL SELECT u.source, u.smt, 'team_scores_in_half_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra Segna il Suo Goal Nel Tempo$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_in_half_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra Segna il Suo Goal Nel Tempo \([0-9]+\)$'

  -- Squadra Vince Tutti i Tempi
  UNION ALL SELECT u.source, u.smt, 'team_wins_every_half_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra Vince Tutti i Tempi$'

  -- Esito + Numero Di Goal
  UNION ALL SELECT u.source, u.smt, 'result_and_goals_ft', NULL FROM unmapped u WHERE u.smt ~ '^Esito \+ Numero Di Goal$'

  -- Risultati, Tempi
  UNION ALL SELECT u.source, u.smt, 'halves_results_ft', NULL FROM unmapped u WHERE u.smt ~ '^Risultati, Tempi$'

  -- Segna Dopo X Set
  UNION ALL SELECT u.source, u.smt, 'scores_after_n_sets_ft', (regexp_match(u.smt, 'Dopo\s+([0-9]+)\s+Set'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Segna Dopo [0-9]+ Set$'

  -- Chi Vincerà Più Tempi
  UNION ALL SELECT u.source, u.smt, 'who_wins_more_halves_ft', NULL FROM unmapped u WHERE u.smt ~ '^Chi Vincerà Più Tempi$'

  -- Tempo Con il Minor Numero Di Punti Totali (N.5)
  UNION ALL SELECT u.source, u.smt, 'lowest_scoring_half_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Tempo Con il Minor Numero Di Punti Totali \([0-9.]+\)$'

  -- Vince Di. (N) — with line variant of win_by_margin_dot
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_dot_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vince Di\. \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_dot_1h', NULL FROM unmapped u WHERE u.smt ~ '^Vince Di\. - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_dot_2h', NULL FROM unmapped u WHERE u.smt ~ '^Vince Di\. - (2T|12T)$'

  -- Vince In Rimonta
  UNION ALL SELECT u.source, u.smt, 'win_in_comeback_ft', NULL FROM unmapped u WHERE u.smt ~ '^Vince In Rimonta$'

  -- Ultima Cifra... Dopo 20 Over Del Primo Innings (no parens variants)
  UNION ALL SELECT u.source, u.smt, 'last_digit_after_overs_ft', NULL FROM unmapped u WHERE u.smt ~ '^Ultima Cifra Nel Risultato Della Partita Dopo [0-9]+ Over Del Primo Innings(, Intervallo)?$'

  -- Goal Nell'intervallo Di Tempo - Sì/No - 1T/2T (existing goal_interval canonical, no period variant)
  UNION ALL SELECT u.source, u.smt, 'goal_interval_ft', NULL FROM unmapped u WHERE u.smt ~ '^Goal Nell''intervallo Di Tempo - Sì/No( \([0-9.]+\))? - (1T|2T|11T|12T)$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck, m.ln,
       (SELECT canonical_name_it FROM canonical_markets cm WHERE cm.canonical_key=m.ck),
       false, 'regex', 80, now()
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
