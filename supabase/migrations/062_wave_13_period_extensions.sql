-- 062_wave_13_period_extensions.sql
-- Wave 13: canonical extensions for basket/hockey quarter-period markets
-- surfaced by LLM subagent batches (2026-04-21) + Totale Home/Away period split.
--
-- Background:
--   - Kambi emits "Handicap - 1°/2°/3°/4° Quarto" and "Punti totali - N° Quarto X.5"
--     for basket matches. Engine previously dropped them to _ft silently because
--     normalizePeriod did not recognise "Quarto" nor "Periodo" (hockey).
--   - 22bet emits "1X2 H (N) - 3T/4T", "T/T Handicap (N) - 3T/4T", "Totale Asiatico N - 3T/4T"
--     for basket/hockey quarters — blocked because 3h/4h canonicals were missing
--     for several families.
--   - 22bet "Totale Away/Home N - 1T/2T" needs total_team period variants.
--
-- Applied: prod (xgnyqkmugnfzhdveeqom) + staging (bnabvfalytivjsrwqydo) 2026-04-21.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- ═══ 2way_handicap 3°/4° period (basket quarter, hockey 3rd period) ═══
  ('2way_handicap_3h', '2way_handicap', '3h', 'Handicap 2-Way 3° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('2way_handicap_4h', '2way_handicap', '4h', 'Handicap 2-Way 4° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ 1x2_handicap 3°/4° period (calcio-like 3-way handicap, hockey period) ═══
  ('1x2_h_3h', '1x2_handicap', '3h', '1X2 Handicap 3° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_h_4h', '1x2_handicap', '4h', '1X2 Handicap 4° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Asian total 3°/4° period (basket/hockey asian over/under) ═══
  ('asian_total_3h', 'asian_total', '3h', 'Totale Asiatico 3° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('asian_total_4h', 'asian_total', '4h', 'Totale Asiatico 4° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Asian handicap 3°/4° period (basket/hockey asian handicap) ═══
  ('asian_handicap_3h', 'asian_handicap', '3h', 'Handicap Asiatico 3° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('asian_handicap_4h', 'asian_handicap', '4h', 'Handicap Asiatico 4° Tempo', true,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),

  -- ═══ Total corners 3°/4° period (reserved, kambi/22bet may emit in future) ═══
  ('total_corners_3h', 'total_corners', '3h', 'Totale Calci d''Angolo 3° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_corners_4h', 'total_corners', '4h', 'Totale Calci d''Angolo 4° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- ═══ Total team (generic) 1°/2° period — Totale Home/Away N - 1T/2T ═══
  -- Note: catalog does NOT split team1/team2 for generic total_team (design choice:
  -- Home/Away distinction lost in this canonical family). Phase 3 may revisit.
  ('total_team_1h', 'total_team', '1h', 'Totale Squadra 1° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('total_team_2h', 'total_team', '2h', 'Totale Squadra 2° Tempo', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
