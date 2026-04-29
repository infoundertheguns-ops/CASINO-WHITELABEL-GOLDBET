-- 066b_wave_16_seed.sql
-- Seed market_normalization with Wave 16 regex matches directly in SQL
-- (parallel to engine.ts logic) to get instant coverage bump without
-- waiting for app deploy + cron pickup.
--
-- Safe to re-run: ON CONFLICT DO NOTHING protects existing manual/verified rows.

-- ═══ Helper: catalog lookup via JOIN (all sources) ═══

-- Build a CTE with all fresh distinct (source, market_type) that are currently unmapped
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
-- ═══ Stage: pattern matches (fixed-string + parametric) ═══
matches AS (
  -- Fixed-string patterns
  SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL::numeric AS line, 95 AS conf FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='btts_both_halves_ft'       WHERE u.smt ~* '^Entrambe\s+Le\s+Squadre\s+Segnano\s+In\s+Entrambi\s+i\s+Tempi$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='team_goal_combo_ft'        WHERE u.smt ~* '^Squadre\s+Goal$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='highest_scoring_half_ft'   WHERE u.smt ~* '^Tempo\s+Con\s+il\s+Maggior\s+Numero\s+Di\s+Punti$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='way_of_winning_ft'         WHERE u.smt ~* '^Modalità\s+Di\s+Vittoria$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='coin_toss_winner_ft'       WHERE u.smt ~* '^Chi\s+Vincerà\s+il\s+Lancio\s+Della\s+Monetina$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='red_card_given_ft'         WHERE u.smt ~* '^Cartellino\s+rosso\s+assegnato$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='penalty_awarded_ft'        WHERE u.smt ~* '^Almeno\s+un\s+calcio\s+di\s+rigore\s+assegnato$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='more_cards_ft'             WHERE u.smt ~* '^Pi[úù]\s+cartellini$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='more_games_ft'             WHERE u.smt ~* '^Pi[úù]\s+giochi$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='draw_and_btts_ft'          WHERE u.smt ~* '^Pareggio\s+ed\s+entrambe\s+le\s+squadre\s+a\s+segno(\s+\(Gol/No\s+Gol\))?$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='qualification'             WHERE u.smt ~* '^Qualificazione$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='cs_map_ft'                 WHERE u.smt ~* '^Risultato\s+esatto[:]?\s+Mappa$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_ft'                    WHERE u.smt ~* '^Esito\s+Finale\s+1x2\s+-\s+Tempo\s+regolamentare$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_ft'                    WHERE u.smt ~* '^Esito\s+dell[''’]incontro$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_ft'                    WHERE u.smt ~* '^Match\s+Odds$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_ft'                    WHERE u.smt ~* '^Tempi\s+regolamentari\s+-\s+1X2$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='dc_ft'                     WHERE u.smt ~* '^Doppia\s+Chance\s+-\s+Tempo\s+regolamentare$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='maps_oe_ft'                WHERE u.smt ~* '^Totale\s+Mappe\s+Pari/Dispari$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='maps_oe_ft'                WHERE u.smt ~* '^Total\s+Maps\s+\(Odd/Even\)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='first_scorer_team_ft'      WHERE u.smt ~* '^Chi\s+Segnerà\s+il\s+Primo\s+Goal\s+Della\s+Partita\??(\s+-?\s*.*)?$'

  -- Vincente Incontro period 3T/4T (via existing regex but missing canonicals pre-mig-066)
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='winner_3h' WHERE u.smt ~* '^Vincente\s+Incontro\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='winner_4h' WHERE u.smt ~* '^Vincente\s+Incontro\s+-\s+4T$'
  -- Risultato Esatto 3T/4T
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='cs_3h' WHERE u.smt ~* '^Risultato\s+Esatto\s+-\s+3T$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='cs_4h' WHERE u.smt ~* '^Risultato\s+Esatto\s+-\s+4T$'

  -- ═══ Kambi basketball quarter 1X2 (standalone "1°/2°/3°/4° Quarto") ═══
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_1h' WHERE u.smt ~* '^(1°\s*Quarto|primo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_2h' WHERE u.smt ~* '^(2°\s*Quarto|secondo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_3h' WHERE u.smt ~* '^(3°\s*Quarto|terzo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_4h' WHERE u.smt ~* '^(4°\s*Quarto|quarto\s+quarto)$'
  -- Periodo hockey
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_1h' WHERE u.smt ~* '^(1°\s*Periodo|primo\s+periodo)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_2h' WHERE u.smt ~* '^(2°\s*Periodo|secondo\s+periodo)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_3h' WHERE u.smt ~* '^(3°\s*Periodo|terzo\s+periodo)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='1x2_4h' WHERE u.smt ~* '^(4°\s*Periodo|quarto\s+periodo)$'

  -- "Risultato al termine del N° Quarto" → winner_{1h-4h}
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='winner_1h' WHERE u.smt ~* '^Risultato\s+al\s+termine\s+del\s+(1°\s*Quarto|primo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='winner_2h' WHERE u.smt ~* '^Risultato\s+al\s+termine\s+del\s+(2°\s*Quarto|secondo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='winner_3h' WHERE u.smt ~* '^Risultato\s+al\s+termine\s+del\s+(3°\s*Quarto|terzo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='winner_4h' WHERE u.smt ~* '^Risultato\s+al\s+termine\s+del\s+(4°\s*Quarto|quarto\s+quarto)$'

  -- DNB per quarter
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='dnb_1h' WHERE u.smt ~* '^Draw\s+No\s+Bet\s+-\s+(1°\s*Quarto|primo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='dnb_2h' WHERE u.smt ~* '^Draw\s+No\s+Bet\s+-\s+(2°\s*Quarto|secondo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='dnb_3h' WHERE u.smt ~* '^Draw\s+No\s+Bet\s+-\s+(3°\s*Quarto|terzo\s+quarto)$'
  UNION ALL SELECT u.source, u.smt, cm.canonical_key, cm.canonical_name_it, NULL, 95 FROM unmapped u JOIN canonical_markets cm ON cm.canonical_key='dnb_4h' WHERE u.smt ~* '^Draw\s+No\s+Bet\s+-\s+(4°\s*Quarto|quarto\s+quarto)$'

  -- ═══ Parametric patterns (line extraction via regexp_match) ═══
  -- Totale Mappe (N.5)
  UNION ALL
  SELECT u.source, u.smt, 'total_maps_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_maps_ft'),
         (regexp_match(u.smt, '^Totale\s+Mappe\s+\(([\d.]+)\)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Totale\s+Mappe\s+\(([\d.]+)\)$'

  UNION ALL
  SELECT u.source, u.smt, 'total_maps_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_maps_ft'),
         (regexp_match(u.smt, '^Total\s+Maps\s+([\d.]+)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Total\s+Maps\s+([\d.]+)$'

  UNION ALL
  SELECT u.source, u.smt, 'total_maps_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_maps_ft'),
         (regexp_match(u.smt, '^Mappe\s+totali\s+([\d.]+)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Mappe\s+totali\s+([\d.]+)$'

  -- Totale Mappe Handicap (±N.5) / Handicap Mappa (±N.5) / Map Handicap (±N.5)
  UNION ALL
  SELECT u.source, u.smt, 'maps_handicap_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='maps_handicap_ft'),
         (regexp_match(u.smt, '^Totale\s+Mappe\s+Handicap\s+\(([+-]?[\d.]+)\)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Totale\s+Mappe\s+Handicap\s+\(([+-]?[\d.]+)\)$'

  UNION ALL
  SELECT u.source, u.smt, 'maps_handicap_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='maps_handicap_ft'),
         (regexp_match(u.smt, '^(?:Handicap\s+Mappa|Map\s+Handicap)\s+\(([+-]?[\d.]+)\)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^(Handicap\s+Mappa|Map\s+Handicap)\s+\(([+-]?[\d.]+)\)$'

  -- Map N / Mappa N → map_winner_ft line=N
  UNION ALL
  SELECT u.source, u.smt, 'map_winner_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='map_winner_ft'),
         (regexp_match(u.smt, '^(?:Map|Mappa)\s+(\d+)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^(Map|Mappa)\s+(\d+)$'

  -- Totale giochi N.5
  UNION ALL
  SELECT u.source, u.smt, 'total_games_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_games_ft'),
         (regexp_match(u.smt, '^Totale\s+giochi\s+([\d.]+)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Totale\s+giochi\s+([\d.]+)$'

  -- Totale giochi nel 1°/2°/3°/4°/5° set N.5
  UNION ALL SELECT u.source, u.smt, 'total_games_set1_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_games_set1_ft'), (regexp_match(u.smt, '^Totale\s+giochi\s+nel\s+1°\s+set\s+([\d.]+)$'))[1]::numeric, 95 FROM unmapped u WHERE u.smt ~* '^Totale\s+giochi\s+nel\s+1°\s+set\s+([\d.]+)$'
  UNION ALL SELECT u.source, u.smt, 'total_games_set2_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_games_set2_ft'), (regexp_match(u.smt, '^Totale\s+giochi\s+nel\s+2°\s+set\s+([\d.]+)$'))[1]::numeric, 95 FROM unmapped u WHERE u.smt ~* '^Totale\s+giochi\s+nel\s+2°\s+set\s+([\d.]+)$'
  UNION ALL SELECT u.source, u.smt, 'total_games_set3_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_games_set3_ft'), (regexp_match(u.smt, '^Totale\s+giochi\s+nel\s+3°\s+set\s+([\d.]+)$'))[1]::numeric, 95 FROM unmapped u WHERE u.smt ~* '^Totale\s+giochi\s+nel\s+3°\s+set\s+([\d.]+)$'
  UNION ALL SELECT u.source, u.smt, 'total_games_set4_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_games_set4_ft'), (regexp_match(u.smt, '^Totale\s+giochi\s+nel\s+4°\s+set\s+([\d.]+)$'))[1]::numeric, 95 FROM unmapped u WHERE u.smt ~* '^Totale\s+giochi\s+nel\s+4°\s+set\s+([\d.]+)$'
  UNION ALL SELECT u.source, u.smt, 'total_games_set5_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_games_set5_ft'), (regexp_match(u.smt, '^Totale\s+giochi\s+nel\s+5°\s+set\s+([\d.]+)$'))[1]::numeric, 95 FROM unmapped u WHERE u.smt ~* '^Totale\s+giochi\s+nel\s+5°\s+set\s+([\d.]+)$'

  -- Totale set N.5 (tennis, alias of total_sets)
  UNION ALL
  SELECT u.source, u.smt, 'total_sets_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_sets_ft'),
         (regexp_match(u.smt, '^Totale\s+set\s+([\d.]+)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Totale\s+set\s+([\d.]+)$'

  -- Totale cartellini N.5
  UNION ALL
  SELECT u.source, u.smt, 'total_cards_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='total_cards_ft'),
         (regexp_match(u.smt, '^Totale\s+cartellini\s+([\d.]+)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Totale\s+cartellini\s+([\d.]+)$'

  -- Team goals min "Entrambe le squadre realizzano almeno N gol - Tempi regolamentari"
  UNION ALL
  SELECT u.source, u.smt, 'team_goals_min_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='team_goals_min_ft'),
         (regexp_match(u.smt, '^Entrambe\s+le\s+squadre\s+realizzano\s+almeno\s+(\d+)\s+gol'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Entrambe\s+le\s+squadre\s+realizzano\s+almeno\s+(\d+)\s+gol(\s+-\s+Tempi\s+regolamentari)?$'

  -- Gol totali - Tempo Regolamentare N.5 → u_o_ft
  UNION ALL
  SELECT u.source, u.smt, 'u_o_ft', (SELECT canonical_name_it FROM canonical_markets WHERE canonical_key='u_o_ft'),
         (regexp_match(u.smt, '^Gol\s+totali\s+-\s+Tempo\s+Regolamentare\s+([\d.]+)$'))[1]::numeric, 95
  FROM unmapped u WHERE u.smt ~* '^Gol\s+totali\s+-\s+Tempo\s+Regolamentare\s+([\d.]+)$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT source, smt, canonical_key, line, canonical_name_it, false, 'regex', conf, now()
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
