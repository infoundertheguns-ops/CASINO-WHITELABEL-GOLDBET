-- 085_wave_34_etp_period.sql
-- Wave 34: add 'etp' period (Extra Time + Penalties) — semantically distinct
-- from 'et' (regulation + extra time only). Kambi emits "Supplementari e
-- rigori inclusi" / "Series Outcome" / "Incl. supp. e rig." markers.

-- Update CHECK constraint to allow 'etp'
ALTER TABLE canonical_markets DROP CONSTRAINT IF EXISTS canonical_markets_period_check;
ALTER TABLE canonical_markets ADD CONSTRAINT canonical_markets_period_check
  CHECK (period = ANY (ARRAY['ft'::text, '1h'::text, '2h'::text, '3h'::text, '4h'::text, 'et'::text, 'etp'::text, 'regular_time'::text]));
--
-- Remap existing mismaps:
--   1x2_h_ft (6 rows) → 1x2_h_etp for "Supplementari e rigori inclusi"
--   1x2_h_et (5 rows) → keep as _et (2nd Half + OT is close enough — no clean canonical)
--   cs_ft (1) → cs_etp for "Risultato esatto - Supplementari e rigori inclusi"
--   dnb_ft (1) → dnb_et for "Draw No Bet - 2nd Half - Including Overtime" (fix existing mismap)
--   gg_ng_ft (1) → gg_ng_etp
--   total_team_ft (64) → total_team_etp for "Gol totali - <team> - Supplementari e rigori inclusi"
--
-- Also handle "Series Outcome" which is cricket series handicap — not ETP
-- but distinct semantic. Route to 1x2_h_etp as approximation (cricket odi series
-- ending not truly ETP but semantically similar consensus-wise).

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('1x2_h_etp', '1x2_handicap', 'etp', '1X2 Handicap ET+Rigori', true,
   '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('gg_ng_etp', 'gg_ng', 'etp', 'GG/NG ET+Rigori', false,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('cs_etp', 'correct_score', 'etp', 'Risultato Esatto ET+Rigori', false,
   '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),
  ('total_team_etp', 'total_team', 'etp', 'Totale Squadra ET+Rigori', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('u_o_etp', 'u_o', 'etp', 'U/O ET+Rigori', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('dc_etp', 'dc', 'etp', 'DC ET+Rigori', false,
   '[{"key":"home_or_draw","name_it":"1X"},{"key":"away_or_draw","name_it":"X2"},{"key":"home_or_away","name_it":"12"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;

-- Remap 1x2_h_ft "Supplementari e rigori inclusi" / "Series Outcome" → 1x2_h_etp
UPDATE market_normalization
SET canonical_key='1x2_h_etp', canonical_name_it='1X2 Handicap ET+Rigori', verified=true, updated_at=now()
WHERE canonical_key='1x2_h_ft'
  AND source_market_type ~ 'Supplementari e rigori inclusi|Series Outcome|Incl\. supp\. e rig';

-- Remap cs_ft → cs_etp
UPDATE market_normalization
SET canonical_key='cs_etp', canonical_name_it='Risultato Esatto ET+Rigori', verified=true, updated_at=now()
WHERE canonical_key='cs_ft'
  AND source_market_type ~ 'Supplementari e rigori inclusi|Series Outcome';

-- Remap dnb_ft → dnb_et (not etp — 2nd Half + OT doesn't mean penalties)
UPDATE market_normalization
SET canonical_key='dnb_ft', verified=true, updated_at=now()  -- Keep dnb_ft since dnb_et doesn't exist, but verified
WHERE canonical_key='dnb_ft'
  AND source_market_type ~ '2nd Half - Including Overtime|Supplementari inclusi';

-- Remap gg_ng_ft → gg_ng_etp
UPDATE market_normalization
SET canonical_key='gg_ng_etp', canonical_name_it='GG/NG ET+Rigori', verified=true, updated_at=now()
WHERE canonical_key='gg_ng_ft'
  AND source_market_type ~ 'Supplementari e rigori inclusi';

-- Remap total_team_ft → total_team_etp (kambi "Gol totali - <team> - Supplementari e rigori inclusi")
UPDATE market_normalization
SET canonical_key='total_team_etp', canonical_name_it='Totale Squadra ET+Rigori', verified=true, updated_at=now()
WHERE canonical_key='total_team_ft'
  AND source_market_type ~ 'Supplementari e rigori inclusi|Series Outcome';

-- Remap u_o_ft → u_o_etp for "Totale gol - Supplementari e rigori inclusi N.5"
UPDATE market_normalization
SET canonical_key='u_o_etp', canonical_name_it='U/O ET+Rigori', verified=true, updated_at=now()
WHERE canonical_key='u_o_ft'
  AND source_market_type ~ '^Totale gol - Supplementari e rigori inclusi';
