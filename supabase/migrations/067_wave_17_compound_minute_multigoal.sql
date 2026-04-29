-- 067_wave_17_compound_minute_multigoal.sql
-- Wave 17: compound markets (HTFT+Total, Handicap+Total, DC+Total),
-- minute-based (Risultato Al Minuto), Multi Goal family, tennis serve hold,
-- time-of-first-goal, halves both-OU, 3°/4° period team-result-total extensions.
--
-- Total expected row coverage: ~10-14K (1.8-2.5pp).
-- Residue context: post-Wave-16 DB has 178K rows unmapped, 22bet dominated by
-- compound/minute/multi_goal families. Many markets have scraper-bug outcomes
-- (odds-as-line) but market_type is still canonicalizable.
--
-- Apply: prod + staging 2026-04-21.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ HTFT + Total (PT-F + Totale N.5) ═══
  ('htft_and_total_ft', 'htft_and_total', 'ft', 'HTFT + Totale', true,
   '[{"key":"grid","name_it":"Griglia HTFT × U/O"}]'::jsonb),

  -- ═══ Handicap + Total compound (2-line — capture total only; handicap info lost) ═══
  ('handicap_and_total_ft', 'handicap_and_total', 'ft', 'Handicap + Totale', true,
   '[{"key":"grid","name_it":"Griglia H × U/O"}]'::jsonb),
  ('handicap_and_total_1h', 'handicap_and_total', '1h', 'Handicap + Totale 1° Tempo', true,
   '[{"key":"grid","name_it":"Griglia H × U/O"}]'::jsonb),
  ('handicap_and_total_2h', 'handicap_and_total', '2h', 'Handicap + Totale 2° Tempo', true,
   '[{"key":"grid","name_it":"Griglia H × U/O"}]'::jsonb),

  -- ═══ DC + Total ═══
  ('dc_and_total_ft', 'dc_and_total', 'ft', 'Doppia Chance + Totale', true,
   '[{"key":"grid","name_it":"Griglia DC × U/O"}]'::jsonb),

  -- ═══ 3°/4° period extensions for existing compound families ═══
  ('team1_win_and_team_total_3h', 'team1_win_and_team_total', '3h', 'V1 + Tot. Squadra 1 3° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team2_win_and_team_total_3h', 'team2_win_and_team_total', '3h', 'V2 + Tot. Squadra 2 3° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team1_win_and_team_total_4h', 'team1_win_and_team_total', '4h', 'V1 + Tot. Squadra 1 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team2_win_and_team_total_4h', 'team2_win_and_team_total', '4h', 'V2 + Tot. Squadra 2 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team1_result_total_3h', 'team1_result_total', '3h', '1, Risultato + Totale 3° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team2_result_total_3h', 'team2_result_total', '3h', '2, Risultato + Totale 3° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team1_result_total_4h', 'team1_result_total', '4h', '1, Risultato + Totale 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team2_result_total_4h', 'team2_result_total', '4h', '2, Risultato + Totale 4° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team1_nolose_and_team_total_3h', 'team1_nolose_and_team_total', '3h', 'DC + Tot. Squadra 1 3° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),
  ('team2_nolose_and_team_total_3h', 'team2_nolose_and_team_total', '3h', 'DC + Tot. Squadra 2 3° Tempo', true,
   '[{"key":"grid","name_it":"Griglia"}]'::jsonb),

  -- ═══ Multi Goal family (market only — outcomes scraper-bugged) ═══
  ('multi_goal_ft', 'multi_goal', 'ft', 'Multi Goal', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('multi_goal_1h', 'multi_goal', '1h', 'Multi Goal 1° Tempo', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('multi_goal_2h', 'multi_goal', '2h', 'Multi Goal 2° Tempo', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team1_multi_goal_ft', 'team1_multi_goal', 'ft', 'Multi Goal Squadra 1', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team2_multi_goal_ft', 'team2_multi_goal', 'ft', 'Multi Goal Squadra 2', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team1_multi_goal_1h', 'team1_multi_goal', '1h', 'Multi Goal Squadra 1 1T', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team2_multi_goal_1h', 'team2_multi_goal', '1h', 'Multi Goal Squadra 2 1T', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team1_multi_goal_2h', 'team1_multi_goal', '2h', 'Multi Goal Squadra 1 2T', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),
  ('team2_multi_goal_2h', 'team2_multi_goal', '2h', 'Multi Goal Squadra 2 2T', false,
   '[{"key":"grid","name_it":"Range"}]'::jsonb),

  -- ═══ Minute-based result (Risultato Al Minuto N, outcomes 1/X/2) ═══
  ('minute_result_ft', 'minute_result', 'ft', 'Risultato Al Minuto', true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Time of first goal (grid, 11 outcomes: per minute bucket) ═══
  ('time_of_first_goal_ft', 'time_of_first_goal', 'ft', 'Tempo Del Primo Goal', false,
   '[{"key":"grid","name_it":"Fascia Min"}]'::jsonb),

  -- ═══ Both halves U/O compound (Totale Goal Nei Tempi N.5 — Sì/No per Over/Under entrambi i tempi) ═══
  ('halves_both_ou_ft', 'halves_both_ou', 'ft', 'Totale Goal Entrambi Tempi', true,
   '[{"key":"grid","name_it":"Sì/No × O/U"}]'::jsonb),

  -- ═══ Tennis first serve hold (Sì/No per player) ═══
  ('first_serve_hold_1h', 'first_serve_hold', '1h', 'Primo Turno Servizio 1° Set', false,
   '[{"key":"grid","name_it":"Per-player"}]'::jsonb),
  ('first_serve_hold_2h', 'first_serve_hold', '2h', 'Primo Turno Servizio 2° Set', false,
   '[{"key":"grid","name_it":"Per-player"}]'::jsonb),

  -- ═══ Goal interval (market canonicalize only — outcomes scraper-bugged) ═══
  ('goal_interval_ft', 'goal_interval', 'ft', 'Goal Intervallo', false,
   '[{"key":"grid","name_it":"Per-interval"}]'::jsonb),

  -- ═══ Win by margin grid (Vittoria Di — market_type no line, outcomes scraper-bugged) ═══
  ('win_by_margin_grid_ft', 'win_by_margin_grid', 'ft', 'Vittoria Di (Griglia)', false,
   '[{"key":"grid","name_it":"Per-margin"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
