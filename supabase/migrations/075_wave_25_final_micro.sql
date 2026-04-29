-- 075_wave_25_final_micro.sql
-- Wave 25: final micro-additions + fix seed regex gaps.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- team{1|2}_exact_goals FT (no period) — missing from Wave 18
  ('team1_exact_goals_ft', 'team1_exact_goals', 'ft', 'Numero Esatto Goal Squadra 1', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),
  ('team2_exact_goals_ft', 'team2_exact_goals', 'ft', 'Numero Esatto Goal Squadra 2', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),

  -- Cricket
  ('first_run_ft', 'first_run', 'ft', 'Primo Run', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('last_run_ft', 'last_run', 'ft', 'Ultimo Run', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('super_over_winner_ft', 'super_over_winner', 'ft', 'Vincitore Super Over', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- Goal Al Minuto (N) — minute-based BTTS-like with minute N
  ('goal_at_minute_ft', 'goal_at_minute', 'ft', 'Goal Al Minuto', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Coin toss combo
  ('coin_toss_and_match_ft', 'coin_toss_and_match', 'ft', 'Lancio Monetina + Partita', false,
   '[{"key":"grid","name_it":"Combo"}]'::jsonb),

  -- BTTS in all halves (similar to team_scores_every_half but market-scoped)
  ('btts_all_halves_ft', 'btts_all_halves', 'ft', 'GG In Tutti i Tempi', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Team half scorer (Squadra Segna il Suo Goal Nel Tempo (N))
  ('team_scores_in_half_ft', 'team_scores_in_half', 'ft', 'Squadra Segna Goal Nel Tempo', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Team wins every half
  ('team_wins_every_half_ft', 'team_wins_every_half', 'ft', 'Squadra Vince Tutti i Tempi', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Esito + Numero Di Goal (result + goals compound)
  ('result_and_goals_ft', 'result_and_goals', 'ft', 'Esito + Goal', false,
   '[{"key":"grid","name_it":"Combo"}]'::jsonb),

  -- Results per half
  ('halves_results_ft', 'halves_results', 'ft', 'Risultati Tempi', false,
   '[{"key":"grid","name_it":"Halves"}]'::jsonb),

  -- Scores after N sets
  ('scores_after_n_sets_ft', 'scores_after_n_sets', 'ft', 'Segna Dopo X Set', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Who wins more halves
  ('who_wins_more_halves_ft', 'who_wins_more_halves', 'ft', 'Chi Vincerà Più Tempi', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- Lowest scoring half
  ('lowest_scoring_half_ft', 'lowest_scoring_half', 'ft', 'Tempo Con Meno Punti', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Win by grid with line (Vince Di. (N))
  ('win_by_margin_dot_ft', 'win_by_margin_dot', 'ft', 'Vince Di Linea', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('win_by_margin_dot_1h', 'win_by_margin_dot', '1h', 'Vince Di Linea 1T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('win_by_margin_dot_2h', 'win_by_margin_dot', '2h', 'Vince Di Linea 2T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Win in comeback
  ('win_in_comeback_ft', 'win_in_comeback', 'ft', 'Vince In Rimonta', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuna"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
