-- 063_wave_14_ot_canonicals.sql
-- Wave 14: OT ("Supplementari inclusi" / "Including Overtime") canonicals.
--
-- Background:
--   Kambi emits a family of markets resolved on regulation + overtime instead of
--   regulation only: "Totale gol - Supplementari inclusi 5.5", "Risultato esatto
--   - Supplementari inclusi", "Entrambe le squadre segnano - Supplementari
--   inclusi", "1X2 con handicap - Supplementari inclusi (-1)", "U/O Incl. Supp.
--   164.5", etc.
--
-- These markets are semantically distinct from their `_ft` counterparts (a
-- draw in 90 min may not be a draw including OT), so they get their own
-- canonical keys with period='et'. normalizePeriod() has been extended to
-- recognise the OT fragments and return 'et'.
--
-- Volume unmapped prod 2026-04-21 pre-Wave-14: 789 types / 2362 volume.
-- Applied: prod (xgnyqkmugnfzhdveeqom) + staging (bnabvfalytivjsrwqydo) 2026-04-21.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ 1X2 with OT ═══
  ('1x2_et', '1x2', 'et', '1X2 Supplementari Inclusi', false,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ 1X2 Handicap with OT ═══
  ('1x2_h_et', '1x2_handicap', 'et', '1X2 Handicap Supplementari Inclusi', true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Under/Over with OT (Totale gol - Supplementari inclusi N.5, U/O Incl. Supp. N) ═══
  ('u_o_et', 'u_o', 'et', 'Under/Over Supplementari Inclusi', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Goal/No Goal (Both Teams Score) with OT ═══
  ('gg_ng_et', 'gg_ng', 'et', 'Goal/No Goal Supplementari Inclusi', false,
   '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),

  -- ═══ Correct Score with OT ═══
  ('cs_et', 'correct_score', 'et', 'Risultato Esatto Supplementari Inclusi', false,
   '[{"key":"variable","name_it":"varie"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
