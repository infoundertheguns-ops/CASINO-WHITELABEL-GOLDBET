-- 074b_wave_24_seed.sql
SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- Entrambe Le Squadre Segnano N Punti Ciascuna (N) -- use [0-9] for robust
  SELECT u.source, u.smt, 'team_scores_n_points_ft'::text ck, (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric ln FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_3h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_4h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 4T$'

  -- Tutti i Tempi - Totale Over/Under (N.5)
  UNION ALL SELECT u.source, u.smt, 'halves_total_ou_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Tutti i Tempi - Totale (Over|Under) \([0-9.]+\)$'

  -- Last team to score
  UNION ALL SELECT u.source, u.smt, 'last_team_to_score_ft', NULL FROM unmapped u WHERE u.smt ~ '^Quale Squadra Realizzerà Punti Per Ultima\?$'
  -- Last event
  UNION ALL SELECT u.source, u.smt, 'last_event_ft', NULL FROM unmapped u WHERE u.smt ~ '^Ultimo Avvenimento( - )?$'
  -- Team wins any map (esports)
  UNION ALL SELECT u.source, u.smt, 'team1_wins_any_map_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 1 Vince Almeno Una Mappa$'
  UNION ALL SELECT u.source, u.smt, 'team2_wins_any_map_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 2 Vince Almeno Una Mappa$'
  -- Corners four sides
  UNION ALL SELECT u.source, u.smt, 'corners_four_sides_ft', NULL FROM unmapped u WHERE u.smt ~ '^Calci D''angolo Calciati Da Tutti e Quattro i Lati Del Campo( - )?$'
  -- Player first/last scorer combos
  UNION ALL SELECT u.source, u.smt, 'player_first_and_last_scorer_ft', NULL FROM unmapped u WHERE u.smt ~ '^Giocatore Segna il Primo E L''ultimo Goal( - )?$'
  UNION ALL SELECT u.source, u.smt, 'player_first_or_last_scorer_ft', NULL FROM unmapped u WHERE u.smt ~ '^Giocatore Segna il Primo O L''ultimo Goal( - )?$'
  -- Team no loss any half
  UNION ALL SELECT u.source, u.smt, 'team_no_loss_any_half_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra Non Perde Alcun Tempo$'
  -- Frag moment per map
  UNION ALL SELECT u.source, u.smt, 'frag_moment_1h', NULL FROM unmapped u WHERE u.smt ~ '^Momento Del Frag - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'frag_moment_2h', NULL FROM unmapped u WHERE u.smt ~ '^Momento Del Frag - (2T|12T)$'
  -- Marcature Nei Tempi
  UNION ALL SELECT u.source, u.smt, 'marcature_nei_tempi_ft', NULL FROM unmapped u WHERE u.smt ~ '^Marcature Nei Tempi$'
  -- Team primo giocatore
  UNION ALL SELECT u.source, u.smt, 'team1_first_player_to_score_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 1, Primo Giocatore A Segnare( - )?$'
  UNION ALL SELECT u.source, u.smt, 'team2_first_player_to_score_ft', NULL FROM unmapped u WHERE u.smt ~ '^Squadra 2, Primo Giocatore A Segnare( - )?$'
  -- Rigore Assegnato (alias of penalty_awarded_ft)
  UNION ALL SELECT u.source, u.smt, 'penalty_awarded_ft', NULL FROM unmapped u WHERE u.smt ~ '^Rigore Assegnato$'
  -- Individuale Totale X Numero Esatto Di Goal (N) (no period) → team{1|2}_exact_goals_ft (need canonicals)
  -- Skipped: no ft canonical, only 1h/2h. Add below:
  -- Handicap Al Minuto (no parens) — skip (ambiguous line)
  -- Cifra Nel Risultato (no parens) → last_digit_result_ft, line=null
  UNION ALL SELECT u.source, u.smt, 'last_digit_result_ft', NULL FROM unmapped u WHERE u.smt ~ '^Cifra Nel Risultato$'
  -- Differenza Punti Esatta. (no parens, just trailing dot)
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_ft', NULL FROM unmapped u WHERE u.smt ~ '^Differenza Punti Esatta\.$'
  -- SuperHandicap (-N) - 1T/2T (line included, existing super_handicap — add with line)
  UNION ALL SELECT u.source, u.smt, 'super_handicap_1h', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^SuperHandicap \([+-]?[0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'super_handicap_2h', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^SuperHandicap \([+-]?[0-9.]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'super_handicap_ft', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^SuperHandicap \([+-]?[0-9.]+\)$'

  -- Kambi Tempo Regolamentare (standalone, 1X2 alias)
  UNION ALL SELECT u.source, u.smt, '1x2_ft', NULL FROM unmapped u WHERE u.smt ~ '^Tempo Regolamentare$'

  -- 22bet "Quadrupla Uccisione" without period (market-only)
  UNION ALL SELECT u.source, u.smt, 'quadra_kill_ft', NULL FROM unmapped u WHERE u.smt ~ '^Quadrupla Uccisione$'
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
