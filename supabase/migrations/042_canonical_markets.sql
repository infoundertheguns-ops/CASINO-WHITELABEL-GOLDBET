-- 042_canonical_markets.sql
-- Catalog of canonical market identities. Seed covers football basics; expand via /admin/canonical-markets CRUD.

CREATE TABLE IF NOT EXISTS canonical_markets (
  canonical_key     TEXT PRIMARY KEY,
  base_key          TEXT NOT NULL,
  period            TEXT NOT NULL CHECK (period IN ('ft','1h','2h','et','regular_time')),
  canonical_name_it TEXT NOT NULL,
  has_line          BOOLEAN NOT NULL DEFAULT false,
  outcomes          JSONB NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_markets_base ON canonical_markets(base_key);

-- Seed: core football canonicals
INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('1x2_ft',     '1x2',          'ft', '1X2',                          false, '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_1h',     '1x2',          '1h', '1X2 1° Tempo',                 false, '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_2h',     '1x2',          '2h', '1X2 2° Tempo',                 false, '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('u_o_ft',     'u_o',          'ft', 'Under/Over',                   true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('u_o_1h',     'u_o',          '1h', 'Under/Over 1° Tempo',          true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('u_o_2h',     'u_o',          '2h', 'Under/Over 2° Tempo',          true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('gg_ng_ft',   'gg_ng',        'ft', 'Goal/No Goal',                 false, '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),
  ('gg_ng_1h',   'gg_ng',        '1h', 'Goal/No Goal 1° Tempo',        false, '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),
  ('gg_ng_2h',   'gg_ng',        '2h', 'Goal/No Goal 2° Tempo',        false, '[{"key":"yes","name_it":"Goal"},{"key":"no","name_it":"No Goal"}]'::jsonb),
  ('dc_ft',      'dc',           'ft', 'Doppia Chance',                false, '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('dc_1h',      'dc',           '1h', 'Doppia Chance 1° Tempo',       false, '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('dc_2h',      'dc',           '2h', 'Doppia Chance 2° Tempo',       false, '[{"key":"1X","name_it":"1X"},{"key":"12","name_it":"12"},{"key":"X2","name_it":"X2"}]'::jsonb),
  ('1x2_h_ft',   '1x2_handicap', 'ft', '1X2 Handicap',                 true,  '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('1x2_h_1h',   '1x2_handicap', '1h', '1X2 Handicap 1° Tempo',        true,  '[{"key":"home","name_it":"1"},{"key":"draw","name_it":"X"},{"key":"away","name_it":"2"}]'::jsonb),
  ('dnb_ft',     'dnb',          'ft', 'Draw No Bet',                  false, '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('dnb_1h',     'dnb',          '1h', 'Draw No Bet 1° Tempo',         false, '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('cs_ft',      'correct_score','ft', 'Risultato Esatto',             false, '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),
  ('cs_1h',      'correct_score','1h', 'Risultato Esatto 1° Tempo',    false, '[{"key":"grid","name_it":"Griglia N-M"}]'::jsonb),
  ('htft',       'htft',         'ft', 'Esito 1T/Finale',              false, '[{"key":"1_1","name_it":"1/1"},{"key":"1_X","name_it":"1/X"},{"key":"1_2","name_it":"1/2"},{"key":"X_1","name_it":"X/1"},{"key":"X_X","name_it":"X/X"},{"key":"X_2","name_it":"X/2"},{"key":"2_1","name_it":"2/1"},{"key":"2_X","name_it":"2/X"},{"key":"2_2","name_it":"2/2"}]'::jsonb),
  ('oe_ft',      'odd_even',     'ft', 'Pari/Dispari',                 false, '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),
  ('oe_1h',      'odd_even',     '1h', 'Pari/Dispari 1° Tempo',        false, '[{"key":"odd","name_it":"Dispari"},{"key":"even","name_it":"Pari"}]'::jsonb),
  ('team_score_ft','team_scores','ft', 'Squadra Segna',                false, '[{"key":"home","name_it":"Casa Segna"},{"key":"away","name_it":"Ospite Segna"}]'::jsonb),
  ('total_team_ft','total_team', 'ft', 'Totale Squadra',               true,  '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('clean_sheet_ft','clean_sheet','ft','Clean Sheet',                   false, '[{"key":"home","name_it":"Casa Clean Sheet"},{"key":"away","name_it":"Ospite Clean Sheet"}]'::jsonb),
  ('win_to_nil_ft','win_to_nil','ft', 'Vince e Non Subisce Goal',      false, '[{"key":"home","name_it":"1 Non Subisce"},{"key":"away","name_it":"2 Non Subisce"}]'::jsonb),
  ('both_halves_score','both_halves_score','ft','Segna Entrambi i Tempi',false,'[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),
  ('anytime_scorer','anytime_scorer','ft','Marcatore Qualsiasi Momento',false,'[{"key":"yes","name_it":"Sì"}]'::jsonb),
  ('first_scorer','first_scorer','ft','Primo Marcatore',                false, '[{"key":"player","name_it":"Giocatore"},{"key":"no_goal","name_it":"No Goal"}]'::jsonb),
  ('last_scorer','last_scorer',  'ft', 'Ultimo Marcatore',              false, '[{"key":"player","name_it":"Giocatore"},{"key":"no_goal","name_it":"No Goal"}]'::jsonb),
  ('h2h_ft',     'h2h',          'ft', 'Testa a Testa',                 false, '[{"key":"home","name_it":"1"},{"key":"away","name_it":"2"}]'::jsonb),
  ('qualification','qualification','ft','Qualificazione',               false, '[{"key":"home","name_it":"1 Si Qualifica"},{"key":"away","name_it":"2 Si Qualifica"}]'::jsonb);
