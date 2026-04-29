-- 057_corner_market_canonicals.sql
-- Wave 7: corner market family (Kambi high-volume, ~10K+ markets).
-- Outcomes verificati via sample query: Over/Under, 1/X/2, home/away/none.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- Total corners (Over/Under line)
  ('total_corners_ft', 'total_corners', 'ft', 'Totale Calci d''Angolo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_corners_1h', 'total_corners', '1h', 'Totale Calci d''Angolo 1° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_corners_2h', 'total_corners', '2h', 'Totale Calci d''Angolo 2° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Corner winner (più calci d'angolo: 1/X/2, avg X=7.77 = rare tie)
  ('corner_winner_ft', 'corner_winner', 'ft', 'Più Calci d''Angolo', false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('corner_winner_1h', 'corner_winner', '1h', 'Più Calci d''Angolo 1° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('corner_winner_2h', 'corner_winner', '2h', 'Più Calci d''Angolo 2° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),

  -- Corner 1X2 Handicap
  ('corner_1x2_handicap_ft', 'corner_1x2_handicap', 'ft', 'Calci d''Angolo 1X2 Handicap', true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),

  -- Next corner: line = N-th upcoming corner; outcomes home/away/none (team scores Nth corner)
  ('next_corner_ft', 'next_corner', 'ft', 'Corner Successivo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
