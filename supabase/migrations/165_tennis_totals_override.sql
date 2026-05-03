-- Migration 165: tennis-specific translation for Totals -> Totale set
--
-- The kiosk tennis listing tile expects market_type matching regex /^Totale set/i.
-- Without sport override, `Totals` translates to default `U/O` which doesn't match.
-- Add tennis sport_slug=tennis override.
--
-- Same logic applies to tabletennis (TABLETENNIS_COLUMNS expects "Totale set" too).

INSERT INTO oddsapi_translations (kind, source_key, sport_slug, parent_market, translated)
VALUES
  ('market', 'Totals', 'tennis', '', 'Totale set'),
  ('market', 'Totals', 'tabletennis', '', 'Totale set'),
  ('market', 'Totals', 'table-tennis', '', 'Totale set')
ON CONFLICT DO NOTHING;

-- Verification
DO $$
DECLARE r record;
BEGIN
  SELECT count(*) AS n INTO r FROM oddsapi_translations
    WHERE source_key = 'Totals' AND sport_slug IN ('tennis','tabletennis','table-tennis');
  IF r.n < 1 THEN
    RAISE EXCEPTION 'tennis Totals override not present after insert';
  END IF;
  RAISE NOTICE 'tennis Totals override OK (% rows)', r.n;
END $$;
