-- 068_wave_18_additional_families.sql
-- Wave 18: continuation of 95% coverage push.
-- Covers: first goal half, second goal time grid, team exact goals per half,
-- numero esatto halves, set/partita combo, team total oe periods,
-- win by margin periods, minute win-or-draw, minute total grid, exact total grid.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- First goal half (3-way: none / 1° tempo / 2° tempo) — clean outcomes
  ('first_goal_half_ft', 'first_goal_half', 'ft', 'Primo Goal In Quale Tempo', false,
   '[{"key":"none","name_it":"Nessuno"},{"key":"first","name_it":"1° Tempo"},{"key":"second","name_it":"2° Tempo"}]'::jsonb),

  -- Second goal time (grid, market only — outcomes scraper-bugged)
  ('second_goal_time_ft', 'second_goal_time', 'ft', 'Tempo Del Secondo Goal', false,
   '[{"key":"grid","name_it":"Fascia Min"}]'::jsonb),

  -- Team exact goals per half (market only, outcomes mixed/bugged)
  ('team1_exact_goals_1h', 'team1_exact_goals', '1h', 'Numero Esatto Goal Squadra 1 1°T', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),
  ('team1_exact_goals_2h', 'team1_exact_goals', '2h', 'Numero Esatto Goal Squadra 1 2°T', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),
  ('team2_exact_goals_1h', 'team2_exact_goals', '1h', 'Numero Esatto Goal Squadra 2 1°T', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),
  ('team2_exact_goals_2h', 'team2_exact_goals', '2h', 'Numero Esatto Goal Squadra 2 2°T', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),

  -- Exact total halves (Numero Esatto - 1T/2T) — market only, outcomes bugged
  ('exact_total_halves_1h', 'exact_total_halves', '1h', 'Numero Esatto Totale 1°T', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),
  ('exact_total_halves_2h', 'exact_total_halves', '2h', 'Numero Esatto Totale 2°T', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),

  -- Exact total grid (Totale Esatto, generic)
  ('exact_total_grid_ft', 'exact_total_grid', 'ft', 'Totale Esatto', false,
   '[{"key":"grid","name_it":"N"}]'::jsonb),

  -- Set / Partita combo (tennis)
  ('set_match_combo_ft', 'set_match_combo', 'ft', 'Set / Partita', false,
   '[{"key":"grid","name_it":"Set × Match"}]'::jsonb),

  -- Team total OE per half (extend existing team1/2_total_oe_ft)
  ('team1_total_oe_1h', 'team1_total_oe', '1h', 'Totale 1 Pari/Dispari 1°T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),
  ('team1_total_oe_2h', 'team1_total_oe', '2h', 'Totale 1 Pari/Dispari 2°T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),
  ('team2_total_oe_1h', 'team2_total_oe', '1h', 'Totale 2 Pari/Dispari 1°T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),
  ('team2_total_oe_2h', 'team2_total_oe', '2h', 'Totale 2 Pari/Dispari 2°T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),

  -- Win by margin per half — extend existing win_by_margin_ft
  ('win_by_margin_1h', 'win_by_margin', '1h', 'Vittoria Di 1°T', true,
   '[{"key":"grid","name_it":"N"}]'::jsonb),
  ('win_by_margin_2h', 'win_by_margin', '2h', 'Vittoria Di 2°T', true,
   '[{"key":"grid","name_it":"N"}]'::jsonb),

  -- Minute win or draw (Vittoria o Pareggio Al Minuto N) — outcomes 1X / X / X2 at minute
  ('minute_win_or_draw_ft', 'minute_win_or_draw', 'ft', 'Vittoria o Pareggio Al Minuto', true,
   '[{"key":"home_or_draw","name_it":"1X"},{"key":"draw","name_it":"X"},{"key":"away_or_draw","name_it":"X2"}]'::jsonb),

  -- Minute total grid (market only — outcomes scraper-bugged)
  ('minute_total_grid_ft', 'minute_total_grid', 'ft', 'Totale Al Minuto', false,
   '[{"key":"grid","name_it":"O/U @ Min"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
