-- 072b_wave_22_seed.sql
-- Wave 22 seed: apply Wave 22 regex + fix Wave 20/21 gaps where Postgres \d
-- behavior or anchor issues caused misses.
-- NOTE: use [0-9] instead of \d where possible for robust cross-version POSIX.

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- ═══ Wave 22 new rules ═══
  SELECT u.source, u.smt, 'extra_points_ft'::text ck, NULL::numeric ln FROM unmapped u WHERE u.smt ~* '^Punti\s+Extra$'
  UNION ALL SELECT u.source, u.smt, 'extra_points_1h', NULL FROM unmapped u WHERE u.smt ~* '^Punti\s+Extra\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'extra_points_2h', NULL FROM unmapped u WHERE u.smt ~* '^Punti\s+Extra\s+-\s+(2T|12T)$'

  UNION ALL SELECT u.source, u.smt, 'result_after_2_sets_ft', NULL FROM unmapped u WHERE u.smt ~* '^Risultato\s+Dopo\s+I\s+Primi\s+Due\s+Set$'

  UNION ALL SELECT u.source, u.smt, 'exact_points_set_1h', NULL FROM unmapped u WHERE u.smt ~* '^Numero\s+Esatto\s+Di\s+Punti\s+Nel\s+Set\s+-\s+1T$'
  UNION ALL SELECT u.source, u.smt, 'exact_points_set_2h', NULL FROM unmapped u WHERE u.smt ~* '^Numero\s+Esatto\s+Di\s+Punti\s+Nel\s+Set\s+-\s+2T$'

  UNION ALL SELECT u.source, u.smt, 'team1_wins_both_halves_ft', NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+1\s+Vince\s+Entrambi\s+I\s+Tempi$'
  UNION ALL SELECT u.source, u.smt, 'team2_wins_both_halves_ft', NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+2\s+Vince\s+Entrambi\s+I\s+Tempi$'

  UNION ALL SELECT u.source, u.smt, 'team_scores_every_half_ft', NULL FROM unmapped u WHERE u.smt ~* '^Squadra\s+Segna\s+In\s+Ogni\s+Tempo\s+-\s+S[iì]/No$'

  UNION ALL SELECT u.source, u.smt, 'total_dragons_slain_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Draghi\s+Battuti\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'total_dragons_slain_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Draghi\s+Battuti\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_dragons_slain_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Draghi\s+Battuti\s+\([\d.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'total_nashor_slain_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Nashor\s+Battuti\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'total_nashor_slain_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Nashor\s+Battuti\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_nashor_slain_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Totale\s+Nashor\s+Battuti\s+\([\d.]+\)\s+-\s+(2T|12T)$'

  UNION ALL SELECT u.source, u.smt, 'winner_determined_ft', NULL FROM unmapped u WHERE u.smt ~* '^Quando\s+Sarà\s+Determinato\s+il\s+Vincitore$'

  UNION ALL SELECT u.source, u.smt, 'quadra_kill_ft', NULL FROM unmapped u WHERE u.smt ~* '^Quadrupla\s+Uccisione$'
  UNION ALL SELECT u.source, u.smt, 'quadra_kill_1h', NULL FROM unmapped u WHERE u.smt ~* '^Quadrupla\s+Uccisione\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'quadra_kill_2h', NULL FROM unmapped u WHERE u.smt ~* '^Quadrupla\s+Uccisione\s+-\s+(2T|12T)$'

  UNION ALL SELECT u.source, u.smt, 'either_wins_by_ft', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Un\s+Avversario\s+Vince\s+Di\s+\([\d.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'either_wins_by_1h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Un\s+Avversario\s+Vince\s+Di\s+\([\d.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'either_wins_by_2h', (regexp_match(u.smt, '\(([\d.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Un\s+Avversario\s+Vince\s+Di\s+\([\d.]+\)\s+-\s+(2T|12T)$'

  -- Un Avversario Vince Di - 1T/2T (no parens)
  UNION ALL SELECT u.source, u.smt, 'either_wins_by_1h', NULL FROM unmapped u WHERE u.smt ~* '^Un\s+Avversario\s+Vince\s+Di\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'either_wins_by_2h', NULL FROM unmapped u WHERE u.smt ~* '^Un\s+Avversario\s+Vince\s+Di\s+-\s+(2T|12T)$'

  UNION ALL SELECT u.source, u.smt, 'win_by_margin_grid_ft', NULL FROM unmapped u WHERE u.smt ~* '^Vince\s+Di\.$'

  UNION ALL SELECT u.source, u.smt, 'tournament_matches_overunder_1h', NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Partite\s+Con\s+Over/Under\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'tournament_matches_overunder_2h', NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Partite\s+Con\s+Over/Under\s+-\s+(2T|12T)$'

  -- ═══ Fix Wave 20/21 Postgres \d issues — use [0-9] ═══
  -- Entrambe Le Squadre Segnano N Punti Ciascuna (N) - NT
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+[0-9]+\s+Punti\s+Ciascuna\s+\([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+[0-9]+\s+Punti\s+Ciascuna\s+\([0-9.]+\)\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+[0-9]+\s+Punti\s+Ciascuna\s+\([0-9.]+\)\s+-\s+(2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_3h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+[0-9]+\s+Punti\s+Ciascuna\s+\([0-9.]+\)\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_4h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+[0-9]+\s+Punti\s+Ciascuna\s+\([0-9.]+\)\s+-\s+4T$'

  -- Individuale Totale N Pari /Dispari - 3T/4T (new canonicals wave 22)
  UNION ALL SELECT u.source, u.smt, 'team1_total_oe_3h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Pari\s*/\s*Dispari\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_oe_4h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+1\s+Pari\s*/\s*Dispari\s+-\s+4T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_oe_3h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Pari\s*/\s*Dispari\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_oe_4h', NULL FROM unmapped u WHERE u.smt ~* '^Individuale\s+Totale\s+2\s+Pari\s*/\s*Dispari\s+-\s+4T$'

  -- Frag, Totale Pari/Dispari - 3T (3rd map esports)
  UNION ALL SELECT u.source, u.smt, 'frag_total_oe_3h', NULL FROM unmapped u WHERE u.smt ~* '^Frag,\s+Totale\s+Pari/Dispari\s+-\s+3T$'

  -- Prossimo Calcio D'angolo (1) - 2T (period variant, already existing rule)
  UNION ALL SELECT u.source, u.smt, 'next_corner_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~* '^Prossimo\s+Calcio\s+D[''’]angolo\s+\([0-9]+\)\s+-\s+(1T|2T|11T|12T)$'

  -- Quale Squadra Segnerà Punti Per Prima? - 1T/2T/3T/4T (first_team_to_score period variants — need canonicals?)
  -- Actually first_team_to_score canonical is ft only. Map all to first_team_to_score_ft since semantics carry.
  UNION ALL SELECT u.source, u.smt, 'first_team_to_score_ft', NULL FROM unmapped u WHERE u.smt ~* '^Quale\s+Squadra\s+Segnerà\s+Punti\s+Per\s+Prima\?\s+-\s+(1T|2T|3T|4T|11T|12T)$'

  -- SuperHandicap 11T/12T → super_handicap_1h/2h
  UNION ALL SELECT u.source, u.smt, 'super_handicap_1h', NULL FROM unmapped u WHERE u.smt ~* '^SuperHandicap\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'super_handicap_2h', NULL FROM unmapped u WHERE u.smt ~* '^SuperHandicap\s+-\s+12T$'
  UNION ALL SELECT u.source, u.smt, 'super_total_1h', NULL FROM unmapped u WHERE u.smt ~* '^SuperTotale\s+-\s+11T$'
  UNION ALL SELECT u.source, u.smt, 'super_total_2h', NULL FROM unmapped u WHERE u.smt ~* '^SuperTotale\s+-\s+12T$'

  -- Differenza Punti Esatta. - NT (no parens, just trailing dot + period)
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_1h', NULL FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.\s+-\s+(1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'exact_point_diff_2h', NULL FROM unmapped u WHERE u.smt ~* '^Differenza\s+Punti\s+Esatta\.\s+-\s+(2T|12T)$'

  -- Pari/Dispari - 3T/4T (already have oe_3h, oe_4h)
  UNION ALL SELECT u.source, u.smt, 'oe_3h', NULL FROM unmapped u WHERE u.smt ~* '^Pari\s*/\s*Dispari\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, 'oe_4h', NULL FROM unmapped u WHERE u.smt ~* '^Pari\s*/\s*Dispari\s+-\s+4T$'

  -- Pareggio - 3T (draw at period 3 — maps to... dc_3h? No, this is draw-only outcome. Use dnb_3h? Actually it's a 3-way with Sì/No? Skip for now — small volume)

  -- Totale Mappe Pari/Dispari - NT
  UNION ALL SELECT u.source, u.smt, 'maps_oe_ft', NULL FROM unmapped u WHERE u.smt ~* '^Totale\s+Mappe\s+Pari/Dispari(\s+-\s+[0-9]+T)?$'
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
