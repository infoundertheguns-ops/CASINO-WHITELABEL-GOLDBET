-- 051_add_winner_periods_and_exact_goals.sql
-- Wave 4 — targeted additions for remaining high-volume 22bet patterns:
--   - winner_1h / winner_2h   — "Vincente Incontro - 1T/2T" period variants
--   - exact_goals_{ft,1h,2h}  — "Numero Esatto (N)" and period variants
-- Note: Kambi/22bet "Segna Entrambi i Tempi" forms reuse the existing
-- both_halves_score_ft canonical (no new catalog row needed).

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('winner_1h', 'winner', '1h', 'Vincente 1° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('winner_2h', 'winner', '2h', 'Vincente 2° Tempo', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  ('exact_goals_ft', 'exact_goals', 'ft', 'Numero Esatto Goal',            true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('exact_goals_1h', 'exact_goals', '1h', 'Numero Esatto Goal 1° Tempo',   true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('exact_goals_2h', 'exact_goals', '2h', 'Numero Esatto Goal 2° Tempo',   true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
