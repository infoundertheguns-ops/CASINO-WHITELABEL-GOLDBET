-- Migration 168: hockey 1X2 TR should come from "3-Way Result" not "ML"
--
-- ML in odds-api hockey = 2-way moneyline (Home/Away only, no draw).
-- "3-Way Result" = 3-way (Home/Draw/Away) — what the kiosk 1X2 TR column needs.
-- Mig 167 mapped ML -> 1X2 TR which produces no X (draw) column.
--
-- Switch: 3-Way Result -> 1X2 TR (preferred source).
-- Revert ML override to NULL (use default translation = Supplementari Inclusi or Vincente Incontro).
-- Same for hockey-ghiaccio Italian sport_slug.

-- Add 3-Way Result -> 1X2 TR for hockey
INSERT INTO oddsapi_translations (kind, source_key, sport_slug, parent_market, translated)
VALUES
  ('market', '3-Way Result', 'ice-hockey', '', '1X2 TR'),
  ('market', '3-Way Result', 'hockey-ghiaccio', '', '1X2 TR'),
  ('market', '3-Way',        'ice-hockey', '', '1X2 TR'),
  ('market', '3-Way',        'hockey-ghiaccio', '', '1X2 TR')
ON CONFLICT (kind, source_key, sport_slug, parent_market)
DO UPDATE SET translated = EXCLUDED.translated;

-- Revert ML hockey override back to safe default (so it doesn't pollute 1X2 TR column)
UPDATE oddsapi_translations
SET translated = 'Vincente Incontro'
WHERE kind = 'market' AND source_key = 'ML'
  AND sport_slug IN ('ice-hockey', 'hockey-ghiaccio');

DO $$
DECLARE n_3way int;
DECLARE n_ml int;
BEGIN
  SELECT count(*) INTO n_3way FROM oddsapi_translations
    WHERE kind = 'market' AND source_key IN ('3-Way Result','3-Way')
    AND sport_slug IN ('ice-hockey','hockey-ghiaccio') AND translated = '1X2 TR';
  SELECT count(*) INTO n_ml FROM oddsapi_translations
    WHERE kind = 'market' AND source_key = 'ML'
    AND sport_slug IN ('ice-hockey','hockey-ghiaccio') AND translated = 'Vincente Incontro';
  IF n_3way < 2 THEN RAISE EXCEPTION '3-Way Result hockey not mapped (got %)', n_3way; END IF;
  IF n_ml < 2 THEN RAISE EXCEPTION 'ML hockey revert failed (got %)', n_ml; END IF;
  RAISE NOTICE '3-Way->1X2 TR: % rows; ML->Vincente Incontro: % rows', n_3way, n_ml;
END $$;
