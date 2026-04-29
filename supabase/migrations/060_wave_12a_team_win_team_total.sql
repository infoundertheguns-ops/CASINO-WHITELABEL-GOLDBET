-- 060_wave_12a_team_win_team_total.sql
-- Wave 12a: team wins + team total (over/under) combo.
-- 22bet emits "V1 + Totale 1 (N)" (team 1 wins AND team 1 U/O line) and
-- "V2 + Totale 2 (N)" (team 2 variant). 4 outcomes per market:
-- {over_yes, over_no, under_yes, under_no}.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('team1_win_and_team_total_ft', 'team1_win_and_team_total', 'ft', 'Squadra 1 Vince + Totale Squadra 1', true,
   '[{"key":"over_yes","name_it":"V1 + Over - Sì"},{"key":"over_no","name_it":"V1 + Over - No"},{"key":"under_yes","name_it":"V1 + Under - Sì"},{"key":"under_no","name_it":"V1 + Under - No"}]'::jsonb),
  ('team1_win_and_team_total_1h', 'team1_win_and_team_total', '1h', 'Squadra 1 Vince + Totale Squadra 1 - 1° Tempo', true,
   '[{"key":"over_yes","name_it":"V1 + Over - Sì"},{"key":"over_no","name_it":"V1 + Over - No"},{"key":"under_yes","name_it":"V1 + Under - Sì"},{"key":"under_no","name_it":"V1 + Under - No"}]'::jsonb),
  ('team1_win_and_team_total_2h', 'team1_win_and_team_total', '2h', 'Squadra 1 Vince + Totale Squadra 1 - 2° Tempo', true,
   '[{"key":"over_yes","name_it":"V1 + Over - Sì"},{"key":"over_no","name_it":"V1 + Over - No"},{"key":"under_yes","name_it":"V1 + Under - Sì"},{"key":"under_no","name_it":"V1 + Under - No"}]'::jsonb),
  ('team2_win_and_team_total_ft', 'team2_win_and_team_total', 'ft', 'Squadra 2 Vince + Totale Squadra 2', true,
   '[{"key":"over_yes","name_it":"V2 + Over - Sì"},{"key":"over_no","name_it":"V2 + Over - No"},{"key":"under_yes","name_it":"V2 + Under - Sì"},{"key":"under_no","name_it":"V2 + Under - No"}]'::jsonb),
  ('team2_win_and_team_total_1h', 'team2_win_and_team_total', '1h', 'Squadra 2 Vince + Totale Squadra 2 - 1° Tempo', true,
   '[{"key":"over_yes","name_it":"V2 + Over - Sì"},{"key":"over_no","name_it":"V2 + Over - No"},{"key":"under_yes","name_it":"V2 + Under - Sì"},{"key":"under_no","name_it":"V2 + Under - No"}]'::jsonb),
  ('team2_win_and_team_total_2h', 'team2_win_and_team_total', '2h', 'Squadra 2 Vince + Totale Squadra 2 - 2° Tempo', true,
   '[{"key":"over_yes","name_it":"V2 + Over - Sì"},{"key":"over_no","name_it":"V2 + Over - No"},{"key":"under_yes","name_it":"V2 + Under - Sì"},{"key":"under_no","name_it":"V2 + Under - No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
