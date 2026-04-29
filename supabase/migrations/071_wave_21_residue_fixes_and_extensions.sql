-- 071_wave_21_residue_fixes_and_extensions.sql
-- Wave 21: fix regex gaps in Wave 20 + extend remaining families that still
-- dominate residue after 11T/12T unlock.
--
-- Targets:
--   - Differenza Punti Esatta... (with multiple trailing dots, scraper quirk)
--   - Team-name-embedded totals (Totale Home/Away/<Team Name> N.N)
--   - Tournament highest away score periods
--   - Cricket run totals (Squadra N Totale Run Nell'Over)
--   - Handicap Al Minuto (N)
--   - Entrambe Le Squadre a Segno Al Minuto (N)
--   - Testa a testa Handicap (N) — alias of 2way_handicap
--   - Quante Squadre Segneranno (varianti)
--   - Frag, Totale (N) - periodic variants (esports)
--   - Map N - Round Handicap / Total Rounds / Mappa N - Minuti totali (esports)
--   - Ultima Cifra Nel Risultato (cricket)

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- Team-name-embedded totals (generic "Totale <anything> N.N - periodic") → total_team_ft
  -- These already exist. Just need regex.

  -- Tournament highest AWAY periods (highest HOME wave 20)
  ('tournament_highest_away_score_1h', 'tournament_highest_away_score', '1h', 'Punteggio Più Alto Trasferta 1T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_highest_away_score_2h', 'tournament_highest_away_score', '2h', 'Punteggio Più Alto Trasferta 2T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_highest_home_score_1h', 'tournament_highest_home_score', '1h', 'Punteggio Più Alto Casa 1T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_highest_home_score_2h', 'tournament_highest_home_score', '2h', 'Punteggio Più Alto Casa 2T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_most_scoring_match_1h', 'tournament_most_scoring_match', '1h', 'Partita Più Marcature 1T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_most_scoring_match_2h', 'tournament_most_scoring_match', '2h', 'Partita Più Marcature 2T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_most_scoring_team_1h', 'tournament_most_scoring_team', '1h', 'Squadra Più Marcature 1T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_most_scoring_team_2h', 'tournament_most_scoring_team', '2h', 'Squadra Più Marcature 2T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_least_scoring_match_1h', 'tournament_least_scoring_match', '1h', 'Partita Meno Marcature 1T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_least_scoring_match_2h', 'tournament_least_scoring_match', '2h', 'Partita Meno Marcature 2T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_least_scoring_team_1h', 'tournament_least_scoring_team', '1h', 'Squadra Meno Marcature 1T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_least_scoring_team_2h', 'tournament_least_scoring_team', '2h', 'Squadra Meno Marcature 2T', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Cricket
  ('team_total_run_over_ft', 'team_total_run_over', 'ft', 'Totale Run Nell Over', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('last_digit_after_overs_ft', 'last_digit_after_overs', 'ft', 'Ultima Cifra Dopo N Over', false,
   '[{"key":"grid","name_it":"Digit"}]'::jsonb),

  -- Minute-based handicap and btts
  ('minute_handicap_ft', 'minute_handicap', 'ft', 'Handicap Al Minuto', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('minute_btts_ft', 'minute_btts', 'ft', 'GG Al Minuto', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- h2h handicap (Testa a testa Handicap) — alias map to 2way_handicap_ft, so no new canonical needed
  -- (handled via regex)

  -- Frag totale (esports O/U) — per period
  ('frag_total_ft', 'frag_total', 'ft', 'Totale Frag', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('frag_total_1h', 'frag_total', '1h', 'Totale Frag 1° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('frag_total_2h', 'frag_total', '2h', 'Totale Frag 2° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('team1_frag_total_ft', 'team1_frag_total', 'ft', 'Totale Frag Squadra 1', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('team2_frag_total_ft', 'team2_frag_total', 'ft', 'Totale Frag Squadra 2', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Esports per-map
  ('map_round_handicap_ft', 'map_round_handicap', 'ft', 'Map Round Handicap', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('map_total_rounds_ft', 'map_total_rounds', 'ft', 'Map Total Rounds', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('map_total_minutes_ft', 'map_total_minutes', 'ft', 'Mappa Minuti Totali', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- How many teams will score N goals
  ('teams_scoring_n_goals_ft', 'teams_scoring_n_goals', 'ft', 'Quante Squadre Segneranno N Goal', false,
   '[{"key":"grid","name_it":"Count"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
