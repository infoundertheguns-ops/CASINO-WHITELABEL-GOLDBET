-- 077a_wave_27_canonicals.sql
-- New canonicals needed by mig 077 seed.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('win_in_round_ft', 'win_in_round', 'ft', 'Vittoria Nel Round', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('win_in_round_1h', 'win_in_round', '1h', 'Vittoria Nel Round 1° Mappa', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('win_in_round_2h', 'win_in_round', '2h', 'Vittoria Nel Round 2° Mappa', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('team_wins_n_quarters_ft', 'team_wins_n_quarters', 'ft', 'Quanti Quarti Vincerà Squadra', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('who_destroys_tower_ft', 'who_destroys_tower', 'ft', 'Chi Distruggerà Torre', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('who_destroys_tower_1h', 'who_destroys_tower', '1h', 'Chi Distruggerà Torre 1° Mappa', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('who_destroys_tower_2h', 'who_destroys_tower', '2h', 'Chi Distruggerà Torre 2° Mappa', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
