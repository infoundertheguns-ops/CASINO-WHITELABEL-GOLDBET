-- 070_wave_20_period_extensions_and_new_families.sql
-- Wave 20: period 3h/4h extensions for existing compound families + basketball
-- aggregate halves (11T/12T in period.ts → 1h/2h mapping) + new families for
-- largest residue shapes.
--
-- Scope unlocks:
--   - team1/2_total_3way 3h/4h (basket quarter 3-way totals)
--   - total_3way 3h/4h
--   - total_team_asian 3h/4h
--   - total_team 3h/4h
--   - team1/2_result_total 4h (already have 3h from wave 17)
--   - Squadra N, Calci D'Angolo Multipli → team_multi_corners
--   - Entrambe Le Squadre Segnano N Punti Ciascuna → team_scores_n_points (has_line=N points)
--   - Differenza Punti Esatta → exact_point_diff periods
--   - Cifra Nel Risultato → last_digit_result periods
--   - Map N - Team Kills Handicap → map_team_kills_handicap
--   - Punteggio Più Alto Squadra Di Casa/Trasferta Totale → home/away_highest_score (tournament)
--   - Totale Ogni Squadra Segnerà Under/Over → both_teams_total_ou

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ team1/2_total_3way period extensions (basket quarter 3-way) ═══
  ('team1_total_3way_3h', 'team1_total_3way', '3h', 'Totale 1 3-Way 3° Tempo', true,
   '[{"key":"under","name_it":"Under"},{"key":"exact","name_it":"Esatto"},{"key":"over","name_it":"Over"}]'::jsonb),
  ('team2_total_3way_3h', 'team2_total_3way', '3h', 'Totale 2 3-Way 3° Tempo', true,
   '[{"key":"under","name_it":"Under"},{"key":"exact","name_it":"Esatto"},{"key":"over","name_it":"Over"}]'::jsonb),
  ('team1_total_3way_4h', 'team1_total_3way', '4h', 'Totale 1 3-Way 4° Tempo', true,
   '[{"key":"under","name_it":"Under"},{"key":"exact","name_it":"Esatto"},{"key":"over","name_it":"Over"}]'::jsonb),
  ('team2_total_3way_4h', 'team2_total_3way', '4h', 'Totale 2 3-Way 4° Tempo', true,
   '[{"key":"under","name_it":"Under"},{"key":"exact","name_it":"Esatto"},{"key":"over","name_it":"Over"}]'::jsonb),

  -- total_3way (generic 3-way total) 3h/4h
  ('total_3way_3h', 'total_3way', '3h', 'Totale 3-Way 3° Tempo', true,
   '[{"key":"under","name_it":"Under"},{"key":"exact","name_it":"Esatto"},{"key":"over","name_it":"Over"}]'::jsonb),
  ('total_3way_4h', 'total_3way', '4h', 'Totale 3-Way 4° Tempo', true,
   '[{"key":"under","name_it":"Under"},{"key":"exact","name_it":"Esatto"},{"key":"over","name_it":"Over"}]'::jsonb),

  -- total_team_asian 3h/4h (already have ft/1h/2h)
  ('total_team_asian_3h', 'total_team_asian', '3h', 'Totale Squadra Asiatico 3° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_team_asian_4h', 'total_team_asian', '4h', 'Totale Squadra Asiatico 4° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- total_team 3h/4h (generic, already have ft/1h/2h)
  ('total_team_3h', 'total_team', '3h', 'Totale Squadra 3° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_team_4h', 'total_team', '4h', 'Totale Squadra 4° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- team1/2_result_total 4h (already have 3h from wave 17)
  ('team1_result_total_4h', 'team1_result_total', '4h', '1, Risultato + Totale 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team2_result_total_4h', 'team2_result_total', '4h', '2, Risultato + Totale 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),

  -- team1/2_nolose_and_team_total 4h (already have 3h)
  ('team1_nolose_and_team_total_4h', 'team1_nolose_and_team_total', '4h', 'DC + Tot. Squadra 1 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team2_nolose_and_team_total_4h', 'team2_nolose_and_team_total', '4h', 'DC + Tot. Squadra 2 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),

  -- ═══ team_multi_corners (Squadra X, Calci D'Angolo Multipli) ═══
  ('team1_multi_corners_ft', 'team1_multi_corners', 'ft', 'Multi Corner Squadra 1', true,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team2_multi_corners_ft', 'team2_multi_corners', 'ft', 'Multi Corner Squadra 2', true,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('multi_corners_ft', 'multi_corners', 'ft', 'Multi Corner', true,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),

  -- ═══ Entrambe Le Squadre Segnano N Punti Ciascuna (N) ═══
  ('team_scores_n_points_ft', 'team_scores_n_points', 'ft', 'Entrambe Segnano N Punti', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team_scores_n_points_1h', 'team_scores_n_points', '1h', 'Entrambe Segnano N Punti 1T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team_scores_n_points_2h', 'team_scores_n_points', '2h', 'Entrambe Segnano N Punti 2T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team_scores_n_points_3h', 'team_scores_n_points', '3h', 'Entrambe Segnano N Punti 3T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team_scores_n_points_4h', 'team_scores_n_points', '4h', 'Entrambe Segnano N Punti 4T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Differenza Punti Esatta (N) ═══
  ('exact_point_diff_ft', 'exact_point_diff', 'ft', 'Differenza Punti Esatta', true,
   '[{"key":"grid","name_it":"Diff"}]'::jsonb),
  ('exact_point_diff_1h', 'exact_point_diff', '1h', 'Differenza Punti Esatta 1T', true,
   '[{"key":"grid","name_it":"Diff"}]'::jsonb),
  ('exact_point_diff_2h', 'exact_point_diff', '2h', 'Differenza Punti Esatta 2T', true,
   '[{"key":"grid","name_it":"Diff"}]'::jsonb),

  -- ═══ Cifra Nel Risultato (N) — last digit of match score ═══
  ('last_digit_result_ft', 'last_digit_result', 'ft', 'Cifra Nel Risultato', true,
   '[{"key":"grid","name_it":"Digit"}]'::jsonb),
  ('last_digit_result_1h', 'last_digit_result', '1h', 'Cifra Nel Risultato 1T', true,
   '[{"key":"grid","name_it":"Digit"}]'::jsonb),
  ('last_digit_result_2h', 'last_digit_result', '2h', 'Cifra Nel Risultato 2T', true,
   '[{"key":"grid","name_it":"Digit"}]'::jsonb),

  -- ═══ Map N - Team Kills Handicap (N) (esports) ═══
  ('map_team_kills_handicap_ft', 'map_team_kills_handicap', 'ft', 'Map Team Kills Handicap', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('map_total_kills_ft', 'map_total_kills', 'ft', 'Map Total Kills', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Tournament highest home/away score ═══
  ('tournament_highest_home_score_ft', 'tournament_highest_home_score', 'ft', 'Punteggio Più Alto Casa (tournament)', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Totale Ogni Squadra Segnerà Under/Over (N) ═══
  ('both_teams_total_ou_ft', 'both_teams_total_ou', 'ft', 'Ogni Squadra Segna U/O', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Squadra X Segna Goal Consecutivi (N) ═══
  ('team1_consecutive_goals_ft', 'team1_consecutive_goals', 'ft', 'Squadra 1 Goal Consecutivi', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_consecutive_goals_ft', 'team2_consecutive_goals', 'ft', 'Squadra 2 Goal Consecutivi', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Sfida A Punti (NOpzioni) (N) — race to points N-way ═══
  ('race_to_points_ft', 'race_to_points', 'ft', 'Sfida A Punti', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('race_to_points_1h', 'race_to_points', '1h', 'Sfida A Punti 1T', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('race_to_points_2h', 'race_to_points', '2h', 'Sfida A Punti 2T', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('race_to_points_3h', 'race_to_points', '3h', 'Sfida A Punti 3T', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('race_to_points_4h', 'race_to_points', '4h', 'Sfida A Punti 4T', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Total 3Opzioni grid (various forms beyond existing) ═══
  ('total_nashor_ft', 'total_nashor', 'ft', 'Totale Nashor', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_dragons_ft', 'total_dragons', 'ft', 'Totale Draghi', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_towers_ft', 'total_towers', 'ft', 'Totale Torri', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
