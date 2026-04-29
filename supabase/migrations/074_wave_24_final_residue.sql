-- 074_wave_24_final_residue.sql
-- Wave 24: canonicals for remaining top residue post Wave 23.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('halves_total_ou_ft', 'halves_total_ou', 'ft', 'Tutti i Tempi Totale O/U', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('last_team_to_score_ft', 'last_team_to_score', 'ft', 'Ultima Squadra A Segnare', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuna"}]'::jsonb),
  ('last_event_ft', 'last_event', 'ft', 'Ultimo Avvenimento', false,
   '[{"key":"grid","name_it":"Event"}]'::jsonb),
  ('team1_wins_any_map_ft', 'team1_wins_any_map', 'ft', 'Squadra 1 Vince Almeno 1 Mappa', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_wins_any_map_ft', 'team2_wins_any_map', 'ft', 'Squadra 2 Vince Almeno 1 Mappa', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('corners_four_sides_ft', 'corners_four_sides', 'ft', 'Corner Da Tutti 4 Lati', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('player_first_and_last_scorer_ft', 'player_first_and_last_scorer', 'ft', 'Giocatore Primo E Ultimo Goal', false,
   '[{"key":"grid","name_it":"Player"}]'::jsonb),
  ('player_first_or_last_scorer_ft', 'player_first_or_last_scorer', 'ft', 'Giocatore Primo O Ultimo Goal', false,
   '[{"key":"grid","name_it":"Player"}]'::jsonb),
  ('team_no_loss_any_half_ft', 'team_no_loss_any_half', 'ft', 'Squadra Non Perde Alcun Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('frag_moment_1h', 'frag_moment', '1h', 'Momento Del Frag 1° Mappa', true,
   '[{"key":"grid","name_it":"Min range"}]'::jsonb),
  ('frag_moment_2h', 'frag_moment', '2h', 'Momento Del Frag 2° Mappa', true,
   '[{"key":"grid","name_it":"Min range"}]'::jsonb),
  ('marcature_nei_tempi_ft', 'marcature_nei_tempi', 'ft', 'Marcature Nei Tempi', false,
   '[{"key":"grid","name_it":"Halves score"}]'::jsonb),
  ('team1_first_player_to_score_ft', 'team1_first_player_to_score', 'ft', 'Squadra 1 Primo Marcatore', false,
   '[{"key":"grid","name_it":"Player"}]'::jsonb),
  ('team2_first_player_to_score_ft', 'team2_first_player_to_score', 'ft', 'Squadra 2 Primo Marcatore', false,
   '[{"key":"grid","name_it":"Player"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
