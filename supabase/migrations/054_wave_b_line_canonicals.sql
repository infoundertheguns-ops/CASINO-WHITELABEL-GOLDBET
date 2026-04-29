-- 054_wave_b_line_canonicals.sql
-- Wave B: 24 nuovi canonical con line=N (totali 3-way, combo, next goal, margin, race, draw+UO).
-- Tutti has_line=true eccetto dove esplicitato. Outcomes confermati via sample queries su prod.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ Totale 3Opzioni (N) — 3-way total: Over / Esatto / Under sulla line N ═══
  ('total_3way_ft', 'total_3way', 'ft', 'Totale 3-Way (Over/Esatto/Under)', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_3way_1h', 'total_3way', '1h', 'Totale 3-Way 1° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_3way_2h', 'total_3way', '2h', 'Totale 3-Way 2° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Totale X Individuale 3Opzioni (N) — team-specific 3-way total ═══
  ('team1_total_3way_ft', 'team1_total_3way', 'ft', 'Squadra 1 Totale 3-Way', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('team1_total_3way_1h', 'team1_total_3way', '1h', 'Squadra 1 Totale 3-Way 1° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('team1_total_3way_2h', 'team1_total_3way', '2h', 'Squadra 1 Totale 3-Way 2° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('team2_total_3way_ft', 'team2_total_3way', 'ft', 'Squadra 2 Totale 3-Way', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('team2_total_3way_1h', 'team2_total_3way', '1h', 'Squadra 2 Totale 3-Way 1° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('team2_total_3way_2h', 'team2_total_3way', '2h', 'Squadra 2 Totale 3-Way 2° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"exact","name_it":"Esatto"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ N, Risultato + Totale (X.Y) — team win/dnb combined with U/O line ═══
  -- 8 outcomes: win_over/win_under/dnb_over/dnb_under × Sì/No
  ('team1_result_total_ft', 'team1_result_total', 'ft', 'Squadra 1 Risultato + Totale', true,
   '[{"key":"win_over_yes","name_it":"Vince e Over - Sì"},{"key":"win_over_no","name_it":"Vince e Over - No"},{"key":"win_under_yes","name_it":"Vince e Under - Sì"},{"key":"win_under_no","name_it":"Vince e Under - No"},{"key":"dnb_over_yes","name_it":"Non Perde e Over - Sì"},{"key":"dnb_over_no","name_it":"Non Perde e Over - No"},{"key":"dnb_under_yes","name_it":"Non Perde e Under - Sì"},{"key":"dnb_under_no","name_it":"Non Perde e Under - No"}]'::jsonb),
  ('team1_result_total_1h', 'team1_result_total', '1h', 'Squadra 1 Risultato + Totale 1° Tempo', true,
   '[{"key":"win_over_yes","name_it":"Vince e Over - Sì"},{"key":"win_over_no","name_it":"Vince e Over - No"},{"key":"win_under_yes","name_it":"Vince e Under - Sì"},{"key":"win_under_no","name_it":"Vince e Under - No"},{"key":"dnb_over_yes","name_it":"Non Perde e Over - Sì"},{"key":"dnb_over_no","name_it":"Non Perde e Over - No"},{"key":"dnb_under_yes","name_it":"Non Perde e Under - Sì"},{"key":"dnb_under_no","name_it":"Non Perde e Under - No"}]'::jsonb),
  ('team1_result_total_2h', 'team1_result_total', '2h', 'Squadra 1 Risultato + Totale 2° Tempo', true,
   '[{"key":"win_over_yes","name_it":"Vince e Over - Sì"},{"key":"win_over_no","name_it":"Vince e Over - No"},{"key":"win_under_yes","name_it":"Vince e Under - Sì"},{"key":"win_under_no","name_it":"Vince e Under - No"},{"key":"dnb_over_yes","name_it":"Non Perde e Over - Sì"},{"key":"dnb_over_no","name_it":"Non Perde e Over - No"},{"key":"dnb_under_yes","name_it":"Non Perde e Under - Sì"},{"key":"dnb_under_no","name_it":"Non Perde e Under - No"}]'::jsonb),
  ('team2_result_total_ft', 'team2_result_total', 'ft', 'Squadra 2 Risultato + Totale', true,
   '[{"key":"win_over_yes","name_it":"Vince e Over - Sì"},{"key":"win_over_no","name_it":"Vince e Over - No"},{"key":"win_under_yes","name_it":"Vince e Under - Sì"},{"key":"win_under_no","name_it":"Vince e Under - No"},{"key":"dnb_over_yes","name_it":"Non Perde e Over - Sì"},{"key":"dnb_over_no","name_it":"Non Perde e Over - No"},{"key":"dnb_under_yes","name_it":"Non Perde e Under - Sì"},{"key":"dnb_under_no","name_it":"Non Perde e Under - No"}]'::jsonb),
  ('team2_result_total_1h', 'team2_result_total', '1h', 'Squadra 2 Risultato + Totale 1° Tempo', true,
   '[{"key":"win_over_yes","name_it":"Vince e Over - Sì"},{"key":"win_over_no","name_it":"Vince e Over - No"},{"key":"win_under_yes","name_it":"Vince e Under - Sì"},{"key":"win_under_no","name_it":"Vince e Under - No"},{"key":"dnb_over_yes","name_it":"Non Perde e Over - Sì"},{"key":"dnb_over_no","name_it":"Non Perde e Over - No"},{"key":"dnb_under_yes","name_it":"Non Perde e Under - Sì"},{"key":"dnb_under_no","name_it":"Non Perde e Under - No"}]'::jsonb),
  ('team2_result_total_2h', 'team2_result_total', '2h', 'Squadra 2 Risultato + Totale 2° Tempo', true,
   '[{"key":"win_over_yes","name_it":"Vince e Over - Sì"},{"key":"win_over_no","name_it":"Vince e Over - No"},{"key":"win_under_yes","name_it":"Vince e Under - Sì"},{"key":"win_under_no","name_it":"Vince e Under - No"},{"key":"dnb_over_yes","name_it":"Non Perde e Over - Sì"},{"key":"dnb_over_no","name_it":"Non Perde e Over - No"},{"key":"dnb_under_yes","name_it":"Non Perde e Under - Sì"},{"key":"dnb_under_no","name_it":"Non Perde e Under - No"}]'::jsonb),

  -- ═══ Goal Successivo (N) — next goal N: home / away / none ═══
  ('next_goal_ft', 'next_goal', 'ft', 'Prossimo Gol (N)', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb),
  ('next_goal_1h', 'next_goal', '1h', 'Prossimo Gol 1° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb),
  ('next_goal_2h', 'next_goal', '2h', 'Prossimo Gol 2° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb),

  -- ═══ Vittoria Di (N) — team wins by exactly N goals (Sì/No per team) ═══
  ('win_by_margin_ft', 'win_by_margin', 'ft', 'Vittoria Con Margine N', true,
   '[{"key":"team1_yes","name_it":"Squadra 1 Sì"},{"key":"team1_no","name_it":"Squadra 1 No"},{"key":"team2_yes","name_it":"Squadra 2 Sì"},{"key":"team2_no","name_it":"Squadra 2 No"}]'::jsonb),

  -- ═══ Una Qualsiasi Squadra Vince Di (N) — any team wins by N (Sì/No) ═══
  ('any_team_win_by_margin_ft', 'any_team_win_by_margin', 'ft', 'Qualsiasi Squadra Vince Con Margine N', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Sfida Al (N) — race to N goals: home / away / none ═══
  ('race_to_goals_ft', 'race_to_goals', 'ft', 'Sfida Ai N Goal', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb),

  -- ═══ Pareggio + Totale (X.Y) — draw combined with U/O line (Sì/No × over/under) ═══
  ('draw_and_u_o_ft', 'draw_and_u_o', 'ft', 'Pareggio + Totale', true,
   '[{"key":"over_yes","name_it":"Pareggio e Over - Sì"},{"key":"over_no","name_it":"Pareggio e Over - No"},{"key":"under_yes","name_it":"Pareggio e Under - Sì"},{"key":"under_no","name_it":"Pareggio e Under - No"}]'::jsonb),
  ('draw_and_u_o_1h', 'draw_and_u_o', '1h', 'Pareggio + Totale 1° Tempo', true,
   '[{"key":"over_yes","name_it":"Pareggio e Over - Sì"},{"key":"over_no","name_it":"Pareggio e Over - No"},{"key":"under_yes","name_it":"Pareggio e Under - Sì"},{"key":"under_no","name_it":"Pareggio e Under - No"}]'::jsonb),
  ('draw_and_u_o_2h', 'draw_and_u_o', '2h', 'Pareggio + Totale 2° Tempo', true,
   '[{"key":"over_yes","name_it":"Pareggio e Over - Sì"},{"key":"over_no","name_it":"Pareggio e Over - No"},{"key":"under_yes","name_it":"Pareggio e Under - Sì"},{"key":"under_no","name_it":"Pareggio e Under - No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
