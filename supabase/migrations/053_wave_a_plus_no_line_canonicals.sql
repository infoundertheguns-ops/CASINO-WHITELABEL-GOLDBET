-- 053_wave_a_plus_no_line_canonicals.sql
-- Wave A+: 12 nuovi canonical senza line/period variant.
-- Scoperti durante live validation 2026-04-21 dai pattern 22bet top-unmapped.
-- Outcomes definiti in base ai sample outcome query sul DB prod.

-- Semantica nome "Squadra X Segna Nei Tempi": è un 3-way compare
-- di gol del team X tra 1° e 2° tempo (1T<2T, 1T>2T, 1T=2T).
-- NON è "segna in entrambi i tempi" — traduzione 22bet fuorviante.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- Squadra X Segna Nei Tempi → confronto gol 1T vs 2T per team
  ('team1_halves_goal_compare_ft', 'team1_halves_goal_compare', 'ft', 'Squadra 1 - Gol 1T vs 2T', false,
   '[{"key":"1h_more","name_it":"1° Tempo > 2° Tempo"},{"key":"1h_less","name_it":"1° Tempo < 2° Tempo"},{"key":"equal","name_it":"1° Tempo = 2° Tempo"}]'::jsonb),
  ('team2_halves_goal_compare_ft', 'team2_halves_goal_compare', 'ft', 'Squadra 2 - Gol 1T vs 2T', false,
   '[{"key":"1h_more","name_it":"1° Tempo > 2° Tempo"},{"key":"1h_less","name_it":"1° Tempo < 2° Tempo"},{"key":"equal","name_it":"1° Tempo = 2° Tempo"}]'::jsonb),

  -- Doppia Chance + Entrambe Le Squadre Segnano → DC+BTTS combo (6 outcomes: 3 DC × Sì/No)
  ('dc_btts_ft', 'dc_btts', 'ft', 'Doppia Chance + Entrambe Le Squadre Segnano', false,
   '[{"key":"1X_yes","name_it":"1X E GG"},{"key":"1X_no","name_it":"1X E NG"},{"key":"12_yes","name_it":"12 E GG"},{"key":"12_no","name_it":"12 E NG"},{"key":"X2_yes","name_it":"X2 E GG"},{"key":"X2_no","name_it":"X2 E NG"}]'::jsonb),
  ('dc_btts_1h', 'dc_btts', '1h', 'DC + BTTS 1° Tempo', false,
   '[{"key":"1X_yes","name_it":"1X E GG"},{"key":"1X_no","name_it":"1X E NG"},{"key":"12_yes","name_it":"12 E GG"},{"key":"12_no","name_it":"12 E NG"},{"key":"X2_yes","name_it":"X2 E GG"},{"key":"X2_no","name_it":"X2 E NG"}]'::jsonb),
  ('dc_btts_2h', 'dc_btts', '2h', 'DC + BTTS 2° Tempo', false,
   '[{"key":"1X_yes","name_it":"1X E GG"},{"key":"1X_no","name_it":"1X E NG"},{"key":"12_yes","name_it":"12 E GG"},{"key":"12_no","name_it":"12 E NG"},{"key":"X2_yes","name_it":"X2 E GG"},{"key":"X2_no","name_it":"X2 E NG"}]'::jsonb),

  -- Pareggio In Almeno Un Tempo → Sì/No
  ('draw_any_half_ft', 'draw_any_half', 'ft', 'Pareggio In Almeno Un Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Individuale Totale X Pari/Dispari → team-specific odd/even
  ('team1_total_oe_ft', 'team1_total_oe', 'ft', 'Squadra 1 Totale Pari/Dispari', false,
   '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),
  ('team2_total_oe_ft', 'team2_total_oe', 'ft', 'Squadra 2 Totale Pari/Dispari', false,
   '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),

  -- Squadra X Vince Uno Dei Due Tempi → Sì/No per team
  ('team1_wins_any_half_ft', 'team1_wins_any_half', 'ft', 'Squadra 1 Vince Almeno Un Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_wins_any_half_ft', 'team2_wins_any_half', 'ft', 'Squadra 2 Vince Almeno Un Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Ultimo Goal - 1T/2T → ultimo marcatore per tempo (Sq1/Sq2/Nessuno)
  ('last_goal_1h', 'last_goal', '1h', 'Ultimo Goal 1° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb),
  ('last_goal_2h', 'last_goal', '2h', 'Ultimo Goal 2° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
