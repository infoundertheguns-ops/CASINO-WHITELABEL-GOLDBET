-- 049_add_period_3h_4h.sql
-- Extends canonical_markets.period CHECK constraint with '3h' and '4h' for sports
-- with more than two periods (basketball, hockey, volleyball). 22bet emits
-- "1X2 - 3T", "DC - 3T", "U/O N - 4T" etc. for these, previously mis-mapped to ft.
--
-- Adds common per-period canonicals (1x2/dc/u_o/oe/gg_ng for periods 3 and 4).

ALTER TABLE canonical_markets
  DROP CONSTRAINT IF EXISTS canonical_markets_period_check;

ALTER TABLE canonical_markets
  ADD  CONSTRAINT canonical_markets_period_check
       CHECK (period IN ('ft','1h','2h','3h','4h','et','regular_time'));

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('1x2_3h',   '1x2',      '3h', '1X2 3° Tempo',         false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_4h',   '1x2',      '4h', '1X2 4° Tempo',         false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('dc_3h',    'dc',       '3h', 'Doppia Chance 3° Tempo', false,
   '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('dc_4h',    'dc',       '4h', 'Doppia Chance 4° Tempo', false,
   '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('u_o_3h',   'u_o',      '3h', 'Under/Over 3° Tempo',  true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('u_o_4h',   'u_o',      '4h', 'Under/Over 4° Tempo',  true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('oe_3h',    'odd_even', '3h', 'Pari/Dispari 3° Tempo', false,
   '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),
  ('oe_4h',    'odd_even', '4h', 'Pari/Dispari 4° Tempo', false,
   '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),
  ('gg_ng_3h', 'gg_ng',    '3h', 'Goal/No Goal 3° Tempo', false,
   '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),
  ('gg_ng_4h', 'gg_ng',    '4h', 'Goal/No Goal 4° Tempo', false,
   '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
