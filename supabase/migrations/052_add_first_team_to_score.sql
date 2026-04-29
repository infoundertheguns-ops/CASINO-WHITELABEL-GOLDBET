-- 052_add_first_team_to_score.sql
-- Add canonical "First Team to Score" for Kambi "Segna Goal" market.
-- Outcomes: 1 (home scores first), X (nessuno segna), 2 (away scores first).
-- Identified during live validation 2026-04-21: ~1146 markets on prod, all football,
-- avg odds X≈11.37 confirms semantics (X = no goal in match, not a draw).

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes)
VALUES (
  'first_team_to_score_ft',
  'first_team_to_score',
  'ft',
  'Prima Squadra a Segnare',
  false,
  '[
    {"key":"home","name_it":"1"},
    {"key":"away","name_it":"2"},
    {"key":"none","name_it":"Nessuna"}
  ]'::jsonb
)
ON CONFLICT (canonical_key) DO NOTHING;
