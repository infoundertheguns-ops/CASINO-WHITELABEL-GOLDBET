-- 048_add_asian_handicap_and_1x2_btts_canonicals.sql
-- Adds canonicals needed to cover regex Bug B (22bet "1X2 Asian H (...)" and
-- Kambi "Handicap Asiatico (...)") and Bug D (22bet "1X2 + Ogni Squadra Segna").
-- Also adds period variants (ft/1h/2h) to handle per-tempo markets.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('asian_handicap_ft', 'asian_handicap', 'ft', 'Handicap Asiatico',              true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('asian_handicap_1h', 'asian_handicap', '1h', 'Handicap Asiatico 1° Tempo',     true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('asian_handicap_2h', 'asian_handicap', '2h', 'Handicap Asiatico 2° Tempo',     true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_btts_ft',      '1x2_btts',       'ft', '1X2 + Ogni Squadra Segna',         false,
   '[{"key":"home_yes","name_it":"1 + Goal"},{"key":"home_no","name_it":"1 + NoGoal"},{"key":"draw_yes","name_it":"X + Goal"},{"key":"draw_no","name_it":"X + NoGoal"},{"key":"away_yes","name_it":"2 + Goal"},{"key":"away_no","name_it":"2 + NoGoal"}]'::jsonb),
  ('1x2_btts_1h',      '1x2_btts',       '1h', '1X2 + Ogni Squadra Segna 1° Tempo',false,
   '[{"key":"home_yes","name_it":"1 + Goal"},{"key":"home_no","name_it":"1 + NoGoal"},{"key":"draw_yes","name_it":"X + Goal"},{"key":"draw_no","name_it":"X + NoGoal"},{"key":"away_yes","name_it":"2 + Goal"},{"key":"away_no","name_it":"2 + NoGoal"}]'::jsonb),
  ('1x2_btts_2h',      '1x2_btts',       '2h', '1X2 + Ogni Squadra Segna 2° Tempo',false,
   '[{"key":"home_yes","name_it":"1 + Goal"},{"key":"home_no","name_it":"1 + NoGoal"},{"key":"draw_yes","name_it":"X + Goal"},{"key":"draw_no","name_it":"X + NoGoal"},{"key":"away_yes","name_it":"2 + Goal"},{"key":"away_no","name_it":"2 + NoGoal"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
