-- 077_wave_27_literal_N_fix.sql
-- Scraper-side quirk: 22bet emits "Entrambe Le Squadre Segnano N Punti Ciascuna (M)"
-- with literal "N" placeholder (not substituted with actual threshold).
-- The M in parens IS the points threshold. Map accordingly.
--
-- Also catches other literal-N patterns that escaped prior seeds:
--   - Squadra N Totale Nel Minuto (N)
--   - Entrambe Le Squadre Segnano N Punti Ciascuna (...)

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- Entrambe Le Squadre Segnano N Punti Ciascuna (M) [- period]
  SELECT u.source, u.smt, 'team_scores_n_points_ft'::text ck, (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric ln FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano N Punti Ciascuna \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano N Punti Ciascuna \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano N Punti Ciascuna \([0-9.]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_3h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano N Punti Ciascuna \([0-9.]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_4h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano N Punti Ciascuna \([0-9.]+\) - 4T$'

  -- Squadra N Totale Nel Minuto (N) — also literal N in name. Map to team_scores_n_points? No, this is "Team N Total At Minute N" — different. New canonical.
  -- Skip for now — need new canonical.

  -- Numero Esatto Di Goal (N) - NT (existing exact_goals, need period variants)
  UNION ALL SELECT u.source, u.smt, 'exact_goals_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Numero Esatto Di Goal \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'exact_goals_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Numero Esatto Di Goal \([0-9]+\) - (2T|12T)$'

  -- Vittoria Nel Round (N) - NT → Map to new canonical win_in_round_ft
  -- (new canonical added below)
  UNION ALL SELECT u.source, u.smt, 'win_in_round_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vittoria Nel Round \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'win_in_round_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vittoria Nel Round \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'win_in_round_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vittoria Nel Round \([0-9]+\) - (2T|12T)$'

  -- Tiri totali (Opta) N.N → total_shots_on_target (existing)
  UNION ALL SELECT u.source, u.smt, 'total_shots_on_target_ft', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Tiri totali \(Scommesse refertate usando Opta\) [0-9.]+$'

  -- Punti totali - N° Quarto N.N → u_o_{1h-4h} (existing Punti totali rule) — N° Quarto pattern
  UNION ALL SELECT u.source, u.smt, 'u_o_1h', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Punti totali - 1° Quarto [0-9.]+$'
  UNION ALL SELECT u.source, u.smt, 'u_o_2h', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Punti totali - 2° Quarto [0-9.]+$'
  UNION ALL SELECT u.source, u.smt, 'u_o_3h', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Punti totali - 3° Quarto [0-9.]+$'
  UNION ALL SELECT u.source, u.smt, 'u_o_4h', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Punti totali - 4° Quarto [0-9.]+$'

  -- Quanti Quarti Vincerà La Squadra N (N)
  UNION ALL SELECT u.source, u.smt, 'team_wins_n_quarters_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Quanti Quarti Vincerà La Squadra [12] \([0-9]+\)$'

  -- Mappa N - Round Handicap (N) → map_round_handicap_ft (existing)
  UNION ALL SELECT u.source, u.smt, 'map_round_handicap_ft', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)\s*$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Mappa [0-9]+ - Round Handicap \([+-]?[0-9.]+\)$'

  -- Chi Distruggerà La Torre (N) - NT → new canonical esports
  UNION ALL SELECT u.source, u.smt, 'who_destroys_tower_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Chi Distruggerà La Torre \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'who_destroys_tower_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Chi Distruggerà La Torre \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'who_destroys_tower_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Chi Distruggerà La Torre \([0-9]+\) - (2T|12T)$'

  -- Totale Torri Distrutte (N) - NT → total_towers_destroyed_ft (alias of total_towers)
  UNION ALL SELECT u.source, u.smt, 'total_towers_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Torri Distrutte \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'total_towers_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Torri Distrutte \([0-9.]+\) - (1T|2T|3T|4T|11T|12T)$'

  -- Durata Della Mappa (N) - NT → map_total_minutes_ft (alias)
  UNION ALL SELECT u.source, u.smt, 'map_total_minutes_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Durata Della Mappa \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'map_total_minutes_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Durata Della Mappa \([0-9.]+\) - (1T|2T|3T|11T|12T)$'

  -- Vittorie Totali (N) → team_wins_n_sets_ft (alias of total_sets)
  UNION ALL SELECT u.source, u.smt, 'total_sets_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vittorie Totali \([0-9.]+\)$'

  -- Vince Di. (N) - NT
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_dot_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vince Di\. \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_dot_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vince Di\. \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_dot_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vince Di\. \([0-9.]+\) - (2T|12T)$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck, m.ln,
       (SELECT canonical_name_it FROM canonical_markets cm WHERE cm.canonical_key=m.ck),
       false, 'regex', 85, now()
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
