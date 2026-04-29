-- 059_wave_11_team_both_halves.sql
-- Team-specific "scores in both halves" (outcomes Sì/No).
-- 22bet emits "Squadra 1 Segna Un Goal In Entrambi I Tempi" / "Squadra 2 ..."
-- ~1.2K markets on prod. Distinct from existing `both_halves_score` which is
-- match-level (any team scores in both halves).

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('team1_both_halves_score_ft', 'team1_both_halves_score', 'ft', 'Squadra 1 Segna In Entrambi i Tempi', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_both_halves_score_ft', 'team2_both_halves_score', 'ft', 'Squadra 2 Segna In Entrambi i Tempi', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
