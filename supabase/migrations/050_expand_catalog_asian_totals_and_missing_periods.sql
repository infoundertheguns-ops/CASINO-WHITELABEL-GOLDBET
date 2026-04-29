-- 050_expand_catalog_asian_totals_and_missing_periods.sql
-- Expands the canonical catalog to absorb the largest unmapped groups from
-- the current 22bet tail (~20K+ markets by volume).
--
-- Adds:
--   - cs_2h     — correct score 2° tempo (missing — only cs_ft / cs_1h existed)
--   - oe_2h     — odd/even 2° tempo     (missing — only oe_ft / oe_1h existed)
--   - asian_total_{ft,1h,2h}         — 22bet "Totale Asiatico N (- 1T/2T)"
--   - total_team_asian_{ft,1h,2h}    — 22bet "Squadra 1/2 Totale Asiatico (N) ..."
--   - winner_ft                       — 22bet "Vincente Incontro" (2-way moneyline, tennis/basket)

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('cs_2h',   'correct_score', '2h', 'Risultato Esatto 2° Tempo', false,
   '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),
  ('oe_2h',   'odd_even',      '2h', 'Pari/Dispari 2° Tempo',     false,
   '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),

  ('asian_total_ft', 'asian_total', 'ft', 'Totale Asiatico',               true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('asian_total_1h', 'asian_total', '1h', 'Totale Asiatico 1° Tempo',      true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('asian_total_2h', 'asian_total', '2h', 'Totale Asiatico 2° Tempo',      true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  ('total_team_asian_ft', 'total_team_asian', 'ft', 'Totale Asiatico Squadra',          true,
   '[{"key":"home_over","name_it":"Casa Over"},{"key":"home_under","name_it":"Casa Under"},{"key":"away_over","name_it":"Ospite Over"},{"key":"away_under","name_it":"Ospite Under"}]'::jsonb),
  ('total_team_asian_1h', 'total_team_asian', '1h', 'Totale Asiatico Squadra 1° Tempo', true,
   '[{"key":"home_over","name_it":"Casa Over"},{"key":"home_under","name_it":"Casa Under"},{"key":"away_over","name_it":"Ospite Over"},{"key":"away_under","name_it":"Ospite Under"}]'::jsonb),
  ('total_team_asian_2h', 'total_team_asian', '2h', 'Totale Asiatico Squadra 2° Tempo', true,
   '[{"key":"home_over","name_it":"Casa Over"},{"key":"home_under","name_it":"Casa Under"},{"key":"away_over","name_it":"Ospite Over"},{"key":"away_under","name_it":"Ospite Under"}]'::jsonb),

  ('winner_ft', 'winner', 'ft', 'Vincente Incontro', false,
   '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;
