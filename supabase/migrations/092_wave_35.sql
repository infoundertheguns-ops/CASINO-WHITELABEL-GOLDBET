-- 092_wave_35.sql
-- Wave 35 (2026-04-23): set winners + set handicap + consecutive goals +
-- extra-time Sì/No per period + period-scoped singletons (rigore/espulsione/autogoal).
--
-- Scope trimmed from original handoff: upstream 22bet scraper-bug-poisoned markets
-- (Handicap Al Minuto, Primo Goal, Punteggio Durante La Partita, Falli, trailing-dash
-- family) remain unmapped — tracked separately as scraper fixes.

-- ═══ Canonicals ═══

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- Tennis set winner (outcomes are player names; Phase 3 Part 2a will resolve via events.home_team/away_team)
  ('set_n_winner_ft', 'set_n_winner', 'ft', 'Vincente Set N', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- Any-team consecutive goals (2 or 3 goals in a row by the same team, Sì/No)
  ('any_team_consecutive_goals_ft', 'any_team_consecutive_goals', 'ft', 'Goal Di Seguito Di Una Squadra', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Extra time yes/no, ft + per half (calcio "Ci Saranno i Supplementari")
  ('extra_time_yn_ft', 'extra_time_yn', 'ft', 'Ci Saranno i Supplementari', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('extra_time_yn_1h', 'extra_time_yn', '1h', 'Ci Saranno i Supplementari 1° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('extra_time_yn_2h', 'extra_time_yn', '2h', 'Ci Saranno i Supplementari 2° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('extra_time_yn_3h', 'extra_time_yn', '3h', 'Ci Saranno i Supplementari 3° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Rigore assegnato per period (Sì/No)
  ('penalty_awarded_1h', 'penalty_awarded', '1h', 'Rigore Assegnato 1° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('penalty_awarded_2h', 'penalty_awarded', '2h', 'Rigore Assegnato 2° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Espulsione per period (Sì/No)
  ('red_card_given_2h', 'red_card_given', '2h', 'Cartellino Rosso 2° Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;

-- ═══ Dictionary seed — manual-verified singletons ═══
-- Note: own_goal_ft + penalty_awarded_ft + red_card_given_ft already exist.

INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence, canonical_line, notes)
VALUES
  ('22bet', 'Autogoal',              'own_goal_ft',        'Autogol',                      true, 'manual', 100, NULL, 'Wave 35 dict seed'),
  ('22bet', 'Rigore Assegnato - 1T', 'penalty_awarded_1h', 'Rigore Assegnato 1° Tempo',    true, 'manual', 100, NULL, 'Wave 35 dict seed'),
  ('22bet', 'Rigore Assegnato - 2T', 'penalty_awarded_2h', 'Rigore Assegnato 2° Tempo',    true, 'manual', 100, NULL, 'Wave 35 dict seed'),
  ('22bet', 'Espulsione - 2T',       'red_card_given_2h',  'Cartellino Rosso 2° Tempo',    true, 'manual', 100, NULL, 'Wave 35 dict seed')
ON CONFLICT (source, source_market_type) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  canonical_name_it = EXCLUDED.canonical_name_it,
  verified = true,
  extracted_by = EXCLUDED.extracted_by,
  confidence = EXCLUDED.confidence,
  canonical_line = EXCLUDED.canonical_line,
  notes = EXCLUDED.notes,
  updated_at = now();
