-- 076_wave_26_robust_reseed.sql
-- Wave 26: exhaustive bulk re-seed with [0-9] regex throughout.
-- Catches all unmapped types that existing rules SHOULD handle but weren't
-- seeded due to (a) new types arriving since last seed, (b) Postgres \d
-- unreliability in some versions.

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- Totale 1/2 Individuale 3Opzioni (N) [- period]
  SELECT u.source, u.smt, 'team1_total_3way_ft'::text ck, (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric ln FROM unmapped u WHERE u.smt ~ '^Totale 1 Individuale 3Opzioni \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 2 Individuale 3Opzioni \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 1 Individuale 3Opzioni \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 2 Individuale 3Opzioni \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 1 Individuale 3Opzioni \([0-9]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 2 Individuale 3Opzioni \([0-9]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_3h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 1 Individuale 3Opzioni \([0-9]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_3h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 2 Individuale 3Opzioni \([0-9]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team1_total_3way_4h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 1 Individuale 3Opzioni \([0-9]+\) - 4T$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_3way_4h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 2 Individuale 3Opzioni \([0-9]+\) - 4T$'
  UNION ALL SELECT u.source, u.smt, 'total_3way_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 3Opzioni \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'total_3way_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 3Opzioni \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_3way_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale 3Opzioni \([0-9]+\) - (2T|12T)$'

  -- Frag, Sfida Al (N) [- period]
  UNION ALL SELECT u.source, u.smt, 'frag_race_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Frag, Sfida Al \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'frag_race_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Frag, Sfida Al \([0-9]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'frag_race_2h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Frag, Sfida Al \([0-9]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'frag_race_1h', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Frag, Sfida Al \([0-9]+\) - 3T$'

  -- V1/V2 + Totale 1/2 (N) [- period]
  UNION ALL SELECT u.source, u.smt, 'team1_win_and_team_total_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V1 \+ Totale 1 \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_and_team_total_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V2 \+ Totale 2 \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team1_win_and_team_total_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V1 \+ Totale 1 \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_and_team_total_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V2 \+ Totale 2 \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team1_win_and_team_total_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V1 \+ Totale 1 \([0-9.]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_and_team_total_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V2 \+ Totale 2 \([0-9.]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team1_win_and_team_total_3h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V1 \+ Totale 1 \([0-9.]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_and_team_total_3h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V2 \+ Totale 2 \([0-9.]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team1_win_and_team_total_4h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V1 \+ Totale 1 \([0-9.]+\) - 4T$'
  UNION ALL SELECT u.source, u.smt, 'team2_win_and_team_total_4h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^V2 \+ Totale 2 \([0-9.]+\) - 4T$'

  -- Numero Esatto Di Goal (N) → exact_goals_ft with line=N
  UNION ALL SELECT u.source, u.smt, 'exact_goals_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Numero Esatto Di Goal \([0-9]+\)$'

  -- Entrambe Le Squadre Segnano N Punti Ciascuna (N) [- period] — final bulk [0-9]
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_3h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 3T$'
  UNION ALL SELECT u.source, u.smt, 'team_scores_n_points_4h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Entrambe Le Squadre Segnano [0-9]+ Punti Ciascuna \([0-9.]+\) - 4T$'

  -- 1X2 H / 1X2 Asian H / T/T Handicap residue
  UNION ALL SELECT u.source, u.smt, '1x2_h_ft', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^1X2 H \([+-]?[0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, '1x2_h_1h', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^1X2 H \([+-]?[0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, '1x2_h_2h', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^1X2 H \([+-]?[0-9.]+\) - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_handicap_ft', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^1X2 Asian H \([+-]?[0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, '2way_handicap_ft', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^T/T Handicap \([+-]?[0-9.]+\)$'

  -- Sfida Al (N) race to goals without period
  UNION ALL SELECT u.source, u.smt, 'race_to_goals_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Sfida Al \([0-9]+\)$'
  UNION ALL SELECT u.source, u.smt, 'race_to_goals_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Sfida Al \([0-9]+\) - (3T|4T|11T|12T)$'

  -- U/O N.N [- period]
  UNION ALL SELECT u.source, u.smt, 'u_o_ft', (regexp_match(u.smt, '^U/O ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^U/O [0-9.]+$'
  UNION ALL SELECT u.source, u.smt, 'u_o_1h', (regexp_match(u.smt, '^U/O ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^U/O [0-9.]+ - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'u_o_2h', (regexp_match(u.smt, '^U/O ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^U/O [0-9.]+ - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'u_o_3h', (regexp_match(u.smt, '^U/O ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^U/O [0-9.]+ - 3T$'
  UNION ALL SELECT u.source, u.smt, 'u_o_4h', (regexp_match(u.smt, '^U/O ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^U/O [0-9.]+ - 4T$'

  -- Totale Asiatico N.N [- period]
  UNION ALL SELECT u.source, u.smt, 'asian_total_ft', (regexp_match(u.smt, 'Asiatico ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Asiatico [0-9.]+$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_1h', (regexp_match(u.smt, 'Asiatico ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Asiatico [0-9.]+ - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_2h', (regexp_match(u.smt, 'Asiatico ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Asiatico [0-9.]+ - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_3h', (regexp_match(u.smt, 'Asiatico ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Asiatico [0-9.]+ - 3T$'
  UNION ALL SELECT u.source, u.smt, 'asian_total_4h', (regexp_match(u.smt, 'Asiatico ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Asiatico [0-9.]+ - 4T$'

  -- Squadra 1/2 Totale Asiatico (N) [- period]
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra [12] Totale Asiatico \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra [12] Totale Asiatico \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'total_team_asian_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra [12] Totale Asiatico \([0-9.]+\) - (2T|12T)$'

  -- Individuale Totale N Pari /Dispari [- period]
  UNION ALL SELECT u.source, u.smt, 'team1_total_oe_ft', NULL FROM unmapped u WHERE u.smt ~ '^Individuale Totale 1 Pari\s*/\s*Dispari$'
  UNION ALL SELECT u.source, u.smt, 'team2_total_oe_ft', NULL FROM unmapped u WHERE u.smt ~ '^Individuale Totale 2 Pari\s*/\s*Dispari$'

  -- 1X2 / DC / GG/NG / Pari /Dispari with 11T/12T (already from Wave 20 but re-seed)
  UNION ALL SELECT u.source, u.smt, '1x2_1h', NULL FROM unmapped u WHERE u.smt ~ '^1X2 - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, '1x2_2h', NULL FROM unmapped u WHERE u.smt ~ '^1X2 - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'dc_1h', NULL FROM unmapped u WHERE u.smt ~ '^DC - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'dc_2h', NULL FROM unmapped u WHERE u.smt ~ '^DC - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'gg_ng_1h', NULL FROM unmapped u WHERE u.smt ~ '^GG/NG - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'gg_ng_2h', NULL FROM unmapped u WHERE u.smt ~ '^GG/NG - (2T|12T)$'
  UNION ALL SELECT u.source, u.smt, 'oe_1h', NULL FROM unmapped u WHERE u.smt ~ '^Pari\s*/\s*Dispari - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'oe_2h', NULL FROM unmapped u WHERE u.smt ~ '^Pari\s*/\s*Dispari - (2T|12T)$'

  -- Goal Intervallo / Goal Nell'intervallo Di Tempo with any trailing garbage
  UNION ALL SELECT u.source, u.smt, 'goal_interval_ft', NULL FROM unmapped u WHERE u.smt ~ '^Goal Intervallo'
  UNION ALL SELECT u.source, u.smt, 'goal_interval_ft', NULL FROM unmapped u WHERE u.smt ~ '^Goal Nell''intervallo Di Tempo'
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
