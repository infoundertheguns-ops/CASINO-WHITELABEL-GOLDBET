-- 072_wave_22_final_sweep.sql
-- Wave 22: final sweep of remaining residue patterns.
-- Fixes Wave 20 SQL regex gaps (\d in Postgres), adds canonicals for last
-- cluster of medium-volume patterns.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- Extra points (basket OT)
  ('extra_points_ft', 'extra_points', 'ft', 'Punti Extra', false,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('extra_points_1h', 'extra_points', '1h', 'Punti Extra 1T', false,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('extra_points_2h', 'extra_points', '2h', 'Punti Extra 2T', false,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Result after 2 sets (tennis)
  ('result_after_2_sets_ft', 'result_after_2_sets', 'ft', 'Risultato Dopo 2 Set', false,
   '[{"key":"grid","name_it":"Grid"}]'::jsonb),

  -- Exact points in set (tennis)
  ('exact_points_set_1h', 'exact_points_set', '1h', 'Numero Esatto Punti 1° Set', true,
   '[{"key":"grid","name_it":"N"}]'::jsonb),
  ('exact_points_set_2h', 'exact_points_set', '2h', 'Numero Esatto Punti 2° Set', true,
   '[{"key":"grid","name_it":"N"}]'::jsonb),

  -- Team wins both halves
  ('team1_wins_both_halves_ft', 'team1_wins_both_halves', 'ft', 'Squadra 1 Vince Entrambi Tempi', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('team2_wins_both_halves_ft', 'team2_wins_both_halves', 'ft', 'Squadra 2 Vince Entrambi Tempi', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Team scores every half (Squadra Segna In Ogni Tempo - Sì/No)
  ('team_scores_every_half_ft', 'team_scores_every_half', 'ft', 'Squadra Segna Ogni Tempo', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Esports slayed variants
  ('total_dragons_slain_ft', 'total_dragons_slain', 'ft', 'Totale Draghi Battuti', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_dragons_slain_1h', 'total_dragons_slain', '1h', 'Totale Draghi Battuti 1° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_dragons_slain_2h', 'total_dragons_slain', '2h', 'Totale Draghi Battuti 2° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_nashor_slain_ft', 'total_nashor_slain', 'ft', 'Totale Nashor Battuti', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_nashor_slain_1h', 'total_nashor_slain', '1h', 'Totale Nashor Battuti 1° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_nashor_slain_2h', 'total_nashor_slain', '2h', 'Totale Nashor Battuti 2° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Winner determined time
  ('winner_determined_ft', 'winner_determined', 'ft', 'Quando Determinato Vincitore', false,
   '[{"key":"grid","name_it":"Quando"}]'::jsonb),

  -- Quadrupla Uccisione (esports quadra kill, Sì/No per team per map)
  ('quadra_kill_ft', 'quadra_kill', 'ft', 'Quadrupla Uccisione', false,
   '[{"key":"grid","name_it":"Per-map"}]'::jsonb),
  ('quadra_kill_1h', 'quadra_kill', '1h', 'Quadrupla Uccisione 1° Mappa', false,
   '[{"key":"grid","name_it":"Per-map"}]'::jsonb),
  ('quadra_kill_2h', 'quadra_kill', '2h', 'Quadrupla Uccisione 2° Mappa', false,
   '[{"key":"grid","name_it":"Per-map"}]'::jsonb),

  -- Either opponent wins by (Un Avversario Vince Di)
  ('either_wins_by_ft', 'either_wins_by', 'ft', 'Un Avversario Vince Di', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('either_wins_by_1h', 'either_wins_by', '1h', 'Un Avversario Vince Di 1T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('either_wins_by_2h', 'either_wins_by', '2h', 'Un Avversario Vince Di 2T', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Win by grid (Vince Di. alias)
  -- (already have win_by_margin_grid_ft from Wave 17)

  -- Tournament matches overunder periods
  ('tournament_matches_overunder_1h', 'tournament_matches_overunder', '1h', 'Tot Partite O/U 1T (tournament)', false,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('tournament_matches_overunder_2h', 'tournament_matches_overunder', '2h', 'Tot Partite O/U 2T (tournament)', false,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Team total OE 3h/4h
  ('team1_total_oe_3h', 'team1_total_oe', '3h', 'Totale 1 Pari/Dispari 3T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),
  ('team1_total_oe_4h', 'team1_total_oe', '4h', 'Totale 1 Pari/Dispari 4T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),
  ('team2_total_oe_3h', 'team2_total_oe', '3h', 'Totale 2 Pari/Dispari 3T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),
  ('team2_total_oe_4h', 'team2_total_oe', '4h', 'Totale 2 Pari/Dispari 4T', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb),

  -- Frag_total_oe 3h for esports map 3
  ('frag_total_oe_3h', 'frag_total_oe', '3h', 'Frag Pari/Dispari 3° Mappa', false,
   '[{"key":"even","name_it":"Pari"},{"key":"odd","name_it":"Dispari"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
