-- 064_wave_15_last_goal_ft_own_goal.sql
-- Wave 15: fill catalog gaps for 22bet "Ultimo Goal" (consolidated by
-- scraper fix) + kambi "Autogol" own-goal market.
--
-- Before: catalog had `last_goal_1h` + `last_goal_2h` but NO `last_goal_ft`,
-- so plain "Ultimo Goal" (3-way: Squadra 1 Segna L'Ultimo Goal / Squadra 2
-- Segna L'Ultimo Goal / Nessuno Segna L'Ultimo Goal) fell through.
--
-- Autogol: kambi emits simple Sì/No own-goal market, no equivalent canonical.
--
-- Volume unmapped pre-Wave-15: last_goal_ft ~982 / own_goal ~311.
-- Applied: prod + staging 2026-04-21.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ Ultimo Goal tempo pieno (3-way: home/away/none scores last) ═══
  ('last_goal_ft', 'last_goal', 'ft', 'Ultimo Goal', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"},{"key":"none","name_it":"Nessuno"}]'::jsonb),

  -- ═══ Autogol (own goal scored in match — Sì/No) ═══
  ('own_goal_ft', 'own_goal', 'ft', 'Autogol', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
