-- 056_add_dnb_2h_canonical.sql
-- Add missing Draw No Bet 2° Tempo canonical (gap identified by LLM POC 2026-04-21).
-- Existing DNB regex + normalizePeriod already handle "Draw No Bet - 2° tempo" but
-- the catalog lookup failed silently because only dnb_ft and dnb_1h existed.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes)
VALUES (
  'dnb_2h',
  'dnb',
  '2h',
  'Draw No Bet 2° Tempo',
  false,
  '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb
)
ON CONFLICT (canonical_key) DO NOTHING;
