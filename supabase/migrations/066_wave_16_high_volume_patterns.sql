-- 066_wave_16_high_volume_patterns.sql
-- Wave 16: new canonicals for 22bet + Kambi high-volume unmapped families
-- surfaced during 95% push audit (2026-04-21 night).
--
-- 22bet targets:
--   - Vincente Incontro - 3T/4T (basket/hockey period winner) → winner_3h/4h
--   - Risultato Esatto - 3T/4T (basket/hockey period correct score) → cs_3h/4h
--   - Entrambe Le Squadre Segnano In Entrambi i Tempi → btts_both_halves_ft
--   - Squadre Goal (4-way team goal combo) → team_goal_combo_ft
--   - Tempo Con il Maggior Numero Di Punti → highest_scoring_half_ft
--   - Modalità Di Vittoria (MMA/boxing decision mode) → way_of_winning_ft
--   - Chi Vincerà il Lancio Della Monetina → coin_toss_winner_ft
--   - Totale Mappe (N.5) → total_maps_ft (esports)
--   - Totale Mappe Handicap (±N.5) → maps_handicap_ft
--   - Totale Mappe Pari/Dispari → maps_oe_ft
--   - Chi Segnerà il Primo Goal Della Partita → first_scorer_team_ft
--
-- Kambi targets:
--   - Draw No Bet - 3°/4° Quarto → dnb_3h/4h (basketball quarter DNB)
--   - Map Handicap / Handicap Mappa (±N.5) → maps_handicap_ft (esports)
--   - Total Maps (Odd/Even) → maps_oe_ft
--   - Total Maps N.5 / Mappe totali N.5 → total_maps_ft aliases
--   - Map 1 / Mappa 1 (per-map winner) → map_winner_ft
--   - Totale giochi N.5 → total_games_ft (tennis)
--   - Totale giochi nel N° set M.5 → total_games_setN_ft (N=1..5)
--   - Totale cartellini N.5 → total_cards_ft
--   - Cartellino rosso assegnato → red_card_given_ft
--   - Almeno un calcio di rigore assegnato → penalty_awarded_ft
--   - Piú cartellini → more_cards_ft
--   - Piú giochi → more_games_ft
--   - Pareggio ed entrambe le squadre a segno → draw_and_btts_ft
--   - Entrambe le squadre realizzano almeno N gol → team_goals_min_ft
--   - Risultato esatto: Mappa → cs_map_ft
--
-- Skipped (scraper-side bugs — upstream fix required):
--   - Momento In Cui Viene Realizzato Il Primo/Secondo Goal (odds-as-line bug)
--   - In Quale Tempo Squadra X Segna Il Suo Goal (same bug)
--   - Primi 5 Minuti - (multi-market under same market_type, cannot split)
--   - SuperHandicap (odds-as-line on every outcome line)
--   - 1°/2°/3°/4° Set (outcomes are player names — Phase 3 Part 2a territory)
--
-- Apply: prod + staging.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ Winner 3°/4° period (basket/hockey) ═══
  ('winner_3h', 'winner', '3h', 'Vincente 3° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('winner_4h', 'winner', '4h', 'Vincente 4° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Correct score 3°/4° period ═══
  ('cs_3h', 'correct_score', '3h', 'Risultato Esatto 3° Tempo', false,
   '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),
  ('cs_4h', 'correct_score', '4h', 'Risultato Esatto 4° Tempo', false,
   '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),

  -- ═══ DNB 3°/4° period (basketball quarters DNB) ═══
  ('dnb_3h', 'dnb', '3h', 'Draw No Bet 3° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('dnb_4h', 'dnb', '4h', 'Draw No Bet 4° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ BTTS both halves (Sì/No) ═══
  ('btts_both_halves_ft', 'btts_both_halves', 'ft', 'GG Entrambi i Tempi', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Team goal combo (4-way) ═══
  ('team_goal_combo_ft', 'team_goal_combo', 'ft', 'Squadre Che Segnano', false,
   '[{"key":"none","name_it":"Nessuna"},{"key":"home_only","name_it":"Solo Squadra 1"},{"key":"away_only","name_it":"Solo Squadra 2"},{"key":"both","name_it":"Entrambe"}]'::jsonb),

  -- ═══ Highest scoring half ═══
  ('highest_scoring_half_ft', 'highest_scoring_half', 'ft', 'Tempo Con Più Punti', false,
   '[{"key":"first","name_it":"Primo Tempo"},{"key":"second","name_it":"Secondo Tempo"},{"key":"equal","name_it":"Uguale"}]'::jsonb),

  -- ═══ Way of winning (MMA/boxing) ═══
  ('way_of_winning_ft', 'way_of_winning', 'ft', 'Modalità Di Vittoria', false,
   '[{"key":"grid","name_it":"Metodo"}]'::jsonb),

  -- ═══ Coin toss winner ═══
  ('coin_toss_winner_ft', 'coin_toss_winner', 'ft', 'Vincente Lancio Monetina', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Total maps (esports O/U) ═══
  ('total_maps_ft', 'total_maps', 'ft', 'Totale Mappe', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Maps handicap (esports handicap on maps) ═══
  ('maps_handicap_ft', 'maps_handicap', 'ft', 'Handicap Mappe', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Maps odd/even (esports) ═══
  ('maps_oe_ft', 'maps_oe', 'ft', 'Mappe Pari/Dispari', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),

  -- ═══ Single map winner (Map N / Mappa N) — has_line=true, line=map number ═══
  ('map_winner_ft', 'map_winner', 'ft', 'Vincente Mappa', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Correct score per map (esports) ═══
  ('cs_map_ft', 'correct_score_map', 'ft', 'Risultato Esatto Mappa', false,
   '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),

  -- ═══ First scorer team (generic, team-name outcomes → Phase 3 Part 2a) ═══
  ('first_scorer_team_ft', 'first_scorer_team', 'ft', 'Primo Goal Squadra', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb),

  -- ═══ Total games (tennis full match) ═══
  ('total_games_ft', 'total_games', 'ft', 'Totale Giochi', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Total games per-set (tennis per-set games count) ═══
  ('total_games_set1_ft', 'total_games_set1', 'ft', 'Totale Giochi 1° Set', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_games_set2_ft', 'total_games_set2', 'ft', 'Totale Giochi 2° Set', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_games_set3_ft', 'total_games_set3', 'ft', 'Totale Giochi 3° Set', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_games_set4_ft', 'total_games_set4', 'ft', 'Totale Giochi 4° Set', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_games_set5_ft', 'total_games_set5', 'ft', 'Totale Giochi 5° Set', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Total cards (football total cards) ═══
  ('total_cards_ft', 'total_cards', 'ft', 'Totale Cartellini', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Red card given (Sì/No) ═══
  ('red_card_given_ft', 'red_card_given', 'ft', 'Cartellino Rosso', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Penalty awarded (Sì/No) ═══
  ('penalty_awarded_ft', 'penalty_awarded', 'ft', 'Rigore Assegnato', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ More cards / More games (2-way team comparison) ═══
  ('more_cards_ft', 'more_cards', 'ft', 'Più Cartellini', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"equal","name_it":"Uguale"}]'::jsonb),
  ('more_games_ft', 'more_games', 'ft', 'Più Giochi', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Draw + BTTS combo (Sì/No) ═══
  ('draw_and_btts_ft', 'draw_and_btts', 'ft', 'Pareggio + GG', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Team goals minimum threshold (both teams score N+ goals, Sì/No with line=N) ═══
  ('team_goals_min_ft', 'team_goals_min', 'ft', 'Entrambe Segnano N+ Gol', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
