-- 061_wave_12bc_combo_families.sql
-- Wave 12b+12c: combo families (team nolose + team total, BTTS combos).
-- 22bet-specific markets, ~7K markets on prod.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ 12b: team nolose + team total (1X / 2X / DC + team N total) ═══
  ('team1_nolose_and_team_total_ft', 'team1_nolose_and_team_total', 'ft', 'Squadra 1 Non Perde + Totale Squadra 1', true,
   '[{"key":"over_yes","name_it":"1X + Over - Sì"},{"key":"over_no","name_it":"1X + Over - No"},{"key":"under_yes","name_it":"1X + Under - Sì"},{"key":"under_no","name_it":"1X + Under - No"}]'::jsonb),
  ('team1_nolose_and_team_total_1h', 'team1_nolose_and_team_total', '1h', 'Squadra 1 Non Perde + Totale Squadra 1 - 1° Tempo', true,
   '[{"key":"over_yes","name_it":"1X + Over - Sì"},{"key":"over_no","name_it":"1X + Over - No"},{"key":"under_yes","name_it":"1X + Under - Sì"},{"key":"under_no","name_it":"1X + Under - No"}]'::jsonb),
  ('team1_nolose_and_team_total_2h', 'team1_nolose_and_team_total', '2h', 'Squadra 1 Non Perde + Totale Squadra 1 - 2° Tempo', true,
   '[{"key":"over_yes","name_it":"1X + Over - Sì"},{"key":"over_no","name_it":"1X + Over - No"},{"key":"under_yes","name_it":"1X + Under - Sì"},{"key":"under_no","name_it":"1X + Under - No"}]'::jsonb),
  ('team2_nolose_and_team_total_ft', 'team2_nolose_and_team_total', 'ft', 'Squadra 2 Non Perde + Totale Squadra 2', true,
   '[{"key":"over_yes","name_it":"2X + Over - Sì"},{"key":"over_no","name_it":"2X + Over - No"},{"key":"under_yes","name_it":"2X + Under - Sì"},{"key":"under_no","name_it":"2X + Under - No"}]'::jsonb),
  ('team2_nolose_and_team_total_1h', 'team2_nolose_and_team_total', '1h', 'Squadra 2 Non Perde + Totale Squadra 2 - 1° Tempo', true,
   '[{"key":"over_yes","name_it":"2X + Over - Sì"},{"key":"over_no","name_it":"2X + Over - No"},{"key":"under_yes","name_it":"2X + Under - Sì"},{"key":"under_no","name_it":"2X + Under - No"}]'::jsonb),
  ('team2_nolose_and_team_total_2h', 'team2_nolose_and_team_total', '2h', 'Squadra 2 Non Perde + Totale Squadra 2 - 2° Tempo', true,
   '[{"key":"over_yes","name_it":"2X + Over - Sì"},{"key":"over_no","name_it":"2X + Over - No"},{"key":"under_yes","name_it":"2X + Under - Sì"},{"key":"under_no","name_it":"2X + Under - No"}]'::jsonb),

  -- ═══ 12c: BTTS combos ═══
  -- no_btts_and_dc: "Entrambe Le Squadre Segnano + Doppia Chance" (outcomes say "Almeno Una Non Segna E DC")
  -- Only 4 outcomes observed (1X and 2X DC legs × Sì/No), 12 DC leg absent.
  ('no_btts_and_dc_ft', 'no_btts_and_dc', 'ft', 'No BTTS + Doppia Chance', false,
   '[{"key":"1x_yes","name_it":"Almeno Una Non Segna + 1X - Sì"},{"key":"1x_no","name_it":"Almeno Una Non Segna + 1X - No"},{"key":"2x_yes","name_it":"Almeno Una Non Segna + 2X - Sì"},{"key":"2x_no","name_it":"Almeno Una Non Segna + 2X - No"}]'::jsonb),
  ('no_btts_and_dc_1h', 'no_btts_and_dc', '1h', 'No BTTS + Doppia Chance 1° Tempo', false,
   '[{"key":"1x_yes","name_it":"Almeno Una Non Segna + 1X - Sì"},{"key":"1x_no","name_it":"Almeno Una Non Segna + 1X - No"},{"key":"2x_yes","name_it":"Almeno Una Non Segna + 2X - Sì"},{"key":"2x_no","name_it":"Almeno Una Non Segna + 2X - No"}]'::jsonb),
  ('no_btts_and_dc_2h', 'no_btts_and_dc', '2h', 'No BTTS + Doppia Chance 2° Tempo', false,
   '[{"key":"1x_yes","name_it":"Almeno Una Non Segna + 1X - Sì"},{"key":"1x_no","name_it":"Almeno Una Non Segna + 1X - No"},{"key":"2x_yes","name_it":"Almeno Una Non Segna + 2X - Sì"},{"key":"2x_no","name_it":"Almeno Una Non Segna + 2X - No"}]'::jsonb),

  -- btts_and_total: "Totale E Entrambe A Segno (N)" (BTTS=Yes + U/O line)
  ('btts_and_total_ft', 'btts_and_total', 'ft', 'Totale + Entrambe A Segno', true,
   '[{"key":"over_yes","name_it":"BTTS + Over - Sì"},{"key":"over_no","name_it":"BTTS + Over - No"},{"key":"under_yes","name_it":"BTTS + Under - Sì"},{"key":"under_no","name_it":"BTTS + Under - No"}]'::jsonb),
  ('btts_and_total_1h', 'btts_and_total', '1h', 'Totale + Entrambe A Segno 1° Tempo', true,
   '[{"key":"over_yes","name_it":"BTTS + Over - Sì"},{"key":"over_no","name_it":"BTTS + Over - No"},{"key":"under_yes","name_it":"BTTS + Under - Sì"},{"key":"under_no","name_it":"BTTS + Under - No"}]'::jsonb),
  ('btts_and_total_2h', 'btts_and_total', '2h', 'Totale + Entrambe A Segno 2° Tempo', true,
   '[{"key":"over_yes","name_it":"BTTS + Over - Sì"},{"key":"over_no","name_it":"BTTS + Over - No"},{"key":"under_yes","name_it":"BTTS + Under - Sì"},{"key":"under_no","name_it":"BTTS + Under - No"}]'::jsonb),

  -- no_btts_and_total: "Almeno Una Delle Due Squadre Non Segna + Totale (N)" (BTTS=No + U/O)
  ('no_btts_and_total_ft', 'no_btts_and_total', 'ft', 'No BTTS + Totale', true,
   '[{"key":"over_yes","name_it":"No BTTS + Over - Sì"},{"key":"over_no","name_it":"No BTTS + Over - No"},{"key":"under_yes","name_it":"No BTTS + Under - Sì"},{"key":"under_no","name_it":"No BTTS + Under - No"}]'::jsonb),
  ('no_btts_and_total_1h', 'no_btts_and_total', '1h', 'No BTTS + Totale 1° Tempo', true,
   '[{"key":"over_yes","name_it":"No BTTS + Over - Sì"},{"key":"over_no","name_it":"No BTTS + Over - No"},{"key":"under_yes","name_it":"No BTTS + Under - Sì"},{"key":"under_no","name_it":"No BTTS + Under - No"}]'::jsonb),
  ('no_btts_and_total_2h', 'no_btts_and_total', '2h', 'No BTTS + Totale 2° Tempo', true,
   '[{"key":"over_yes","name_it":"No BTTS + Over - Sì"},{"key":"over_no","name_it":"No BTTS + Over - No"},{"key":"under_yes","name_it":"No BTTS + Under - Sì"},{"key":"under_no","name_it":"No BTTS + Under - No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
