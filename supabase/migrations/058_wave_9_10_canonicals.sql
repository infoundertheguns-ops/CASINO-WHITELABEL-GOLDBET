-- 058_wave_9_10_canonicals.sql
-- Wave 9/10: 14 new canonicals for patterns emerged from LLM batches 2-3.
-- T/T Handicap (esports 2-way), team/half win-to-nil, tennis set family.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ T/T Handicap: 2-way handicap (esports/tennis, no draw) ═══
  ('2way_handicap_ft', '2way_handicap', 'ft', 'Handicap 2-Way', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('2way_handicap_1h', '2way_handicap', '1h', 'Handicap 2-Way 1° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('2way_handicap_2h', '2way_handicap', '2h', 'Handicap 2-Way 2° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Vince a Zero per tempo (win_to_nil half variants) ═══
  ('win_to_nil_1h', 'win_to_nil', '1h', 'Vince e Non Subisce Goal 1° Tempo', false,
   '[{"key":"home","name_it":"1 Non Subisce"},{"key":"away","name_it":"2 Non Subisce"}]'::jsonb),
  ('win_to_nil_2h', 'win_to_nil', '2h', 'Vince e Non Subisce Goal 2° Tempo', false,
   '[{"key":"home","name_it":"1 Non Subisce"},{"key":"away","name_it":"2 Non Subisce"}]'::jsonb),

  -- ═══ Team-specific Vince a Zero (Squadra 1 / Squadra 2) ═══
  ('team1_win_to_nil_ft', 'team1_win_to_nil', 'ft', 'Squadra 1 Vince e Non Subisce', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team1_win_to_nil_1h', 'team1_win_to_nil', '1h', 'Squadra 1 Vince e Non Subisce 1° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team1_win_to_nil_2h', 'team1_win_to_nil', '2h', 'Squadra 1 Vince e Non Subisce 2° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_win_to_nil_ft', 'team2_win_to_nil', 'ft', 'Squadra 2 Vince e Non Subisce', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_win_to_nil_1h', 'team2_win_to_nil', '1h', 'Squadra 2 Vince e Non Subisce 1° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_win_to_nil_2h', 'team2_win_to_nil', '2h', 'Squadra 2 Vince e Non Subisce 2° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- ═══ Tennis/volley set family ═══
  ('set_handicap_ft', 'set_handicap', 'ft', 'Handicap Set', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('total_sets_ft', 'total_sets', 'ft', 'Totale Set', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('set_result_ft', 'set_result', 'ft', 'Risultato Set', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
