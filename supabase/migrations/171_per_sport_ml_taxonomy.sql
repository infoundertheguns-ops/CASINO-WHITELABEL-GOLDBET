-- Migration 171: per-sport ML + 3-Way Result label taxonomy.
--
-- Convention (user 2026-05-03):
--   T/T  = 2-way "Team vs Team" (no draw possible)
--   1X2  = 3-way "match result" (draw possible)
-- Tennis gets a special suffix "(Escl. Ritiro)" indicating retirement voids.
--
-- Sports breakdown (by ML conceptual nature):
--   3-way (1X2):  football, calcio, rugby
--   2-way (T/T):  tennis, basketball, baseball, ice-hockey, hockey-ghiaccio,
--                 volleyball, darts, cricket, mma, boxing, american-football,
--                 snooker, esports, handball, pallamano
--
-- Sports with separate 3-Way Result market (mapped to "1X2" label):
--   handball, basketball, baseball — distinct from ML (which is 2-way / DNB-like)
--   ice-hockey/hockey-ghiaccio already mapped to "1X2 TR" by previous migrations.

-- =================================================================
-- Part 1: per-sport ML overrides (T/T for 2-way, 1X2 for 3-way)
-- =================================================================

-- 3-way sports: ML → 1X2
INSERT INTO oddsapi_translations (kind, sport_slug, source_key, parent_market, translated, notes)
VALUES
  ('market', 'rugby',    'ML', '', '1X2', 'mig 171: simplified from "Tempo regolamentare (1X2)"')
ON CONFLICT (kind, source_key, sport_slug, parent_market) DO UPDATE
SET translated = EXCLUDED.translated, notes = EXCLUDED.notes, updated_at = now();

-- 2-way sports: ML → T/T (or T/T Match (Escl. Ritiro) for tennis)
INSERT INTO oddsapi_translations (kind, sport_slug, source_key, parent_market, translated, notes)
VALUES
  ('market', 'tennis',            'ML', '', 'T/T Match (Escl. Ritiro)', 'mig 171'),
  ('market', 'basketball',        'ML', '', 'T/T', 'mig 171'),
  ('market', 'baseball',          'ML', '', 'T/T', 'mig 171: was "Vincente Incontro"'),
  ('market', 'ice-hockey',        'ML', '', 'T/T', 'mig 171: was "Vincente Incontro"'),
  ('market', 'hockey-ghiaccio',   'ML', '', 'T/T', 'mig 171: was "Vincente Incontro"'),
  ('market', 'volleyball',        'ML', '', 'T/T', 'mig 171'),
  ('market', 'darts',             'ML', '', 'T/T', 'mig 171'),
  ('market', 'cricket',           'ML', '', 'T/T', 'mig 171'),
  ('market', 'mma',               'ML', '', 'T/T', 'mig 171'),
  ('market', 'boxing',            'ML', '', 'T/T', 'mig 171'),
  ('market', 'american-football', 'ML', '', 'T/T', 'mig 171'),
  ('market', 'snooker',           'ML', '', 'T/T', 'mig 171'),
  ('market', 'esports',           'ML', '', 'T/T', 'mig 171'),
  ('market', 'handball',          'ML', '', 'T/T', 'mig 171: was "Tempo Regolamentare"'),
  ('market', 'pallamano',         'ML', '', 'T/T', 'mig 171: was "Tempo Regolamentare"')
ON CONFLICT (kind, source_key, sport_slug, parent_market) DO UPDATE
SET translated = EXCLUDED.translated, notes = EXCLUDED.notes, updated_at = now();

-- =================================================================
-- Part 2: 3-Way Result mappings → "1X2" for sports with both ML+3WR
-- =================================================================

INSERT INTO oddsapi_translations (kind, sport_slug, source_key, parent_market, translated, notes)
VALUES
  ('market', 'handball',   '3-Way Result', '', '1X2', 'mig 171: handball regular-season 3-way distinct from ML/T/T'),
  ('market', 'pallamano',  '3-Way Result', '', '1X2', 'mig 171'),
  ('market', 'basketball', '3-Way Result', '', '1X2 Tempo Regolamentare', 'mig 171: basket 3-Way Result = result at end of regulation, 1X2 valid'),
  ('market', 'baseball',   '3-Way Result', '', '1X2', 'mig 171: baseball 3-Way Result = result inc draw at 9 innings'),
  ('market', 'baseball',   '3-Way',        '', '1X2', 'mig 171: baseball alt naming for 3-Way Result')
ON CONFLICT (kind, source_key, sport_slug, parent_market) DO UPDATE
SET translated = EXCLUDED.translated, notes = EXCLUDED.notes, updated_at = now();

-- =================================================================
-- Verification
-- =================================================================

DO $$
DECLARE n_ml int; n_3wr int;
BEGIN
  SELECT COUNT(*) INTO n_ml FROM oddsapi_translations
    WHERE kind='market' AND source_key='ML' AND sport_slug <> '';
  SELECT COUNT(*) INTO n_3wr FROM oddsapi_translations
    WHERE kind='market' AND source_key IN ('3-Way Result','3-Way') AND sport_slug <> '';
  RAISE NOTICE 'Per-sport ML overrides: % rows (expected >=16)', n_ml;
  RAISE NOTICE 'Per-sport 3-Way Result/3-Way overrides: % rows (expected >=7 incl pre-existing)', n_3wr;
END $$;

INSERT INTO _migrations (name, applied_at, notes)
VALUES ('171_per_sport_ml_taxonomy', now(), 'T/T vs 1X2 taxonomy per-sport, plus 3-Way Result mappings for handball/basket/baseball')
ON CONFLICT (name) DO NOTHING;
