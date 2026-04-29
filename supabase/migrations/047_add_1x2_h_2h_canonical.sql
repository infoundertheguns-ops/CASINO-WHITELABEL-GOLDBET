-- 047_add_1x2_h_2h_canonical.sql
-- Adds missing canonical '1x2_h_2h' (1X2 Handicap 2° Tempo).
-- Migration 042 seeded 1x2_h_ft + 1x2_h_1h but not 1x2_h_2h; the regex engine
-- started producing (base_key=1x2_handicap, period=2h) parses after 047_regex fix,
-- which had nothing to map to without this row.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('1x2_h_2h', '1x2_handicap', '2h', '1X2 Handicap 2° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
