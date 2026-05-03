-- Migration 167: override hockey ML translation from "Supplementari Inclusi" to "1X2 TR"
--
-- Mig 164 seeded ice-hockey ML -> "Supplementari Inclusi" by duplicating the
-- Italian-anchored hockey-ghiaccio override. But the kiosk HOCKEY_COLUMNS expects
-- groupName "1X2 TR" (per lib/market-config.ts). Mig 166 tried to insert "1X2 TR"
-- but ON CONFLICT DO NOTHING skipped because (kind, source_key, sport_slug,
-- parent_market) already had a row.
--
-- Use UPDATE for both ice-hockey and hockey-ghiaccio rows (the latter for any
-- legacy consumer filtering by Italian slug).

UPDATE oddsapi_translations
SET translated = '1X2 TR'
WHERE kind = 'market'
  AND source_key = 'ML'
  AND sport_slug IN ('ice-hockey', 'hockey-ghiaccio');

DO $$
DECLARE n_updated int;
BEGIN
  SELECT count(*) INTO n_updated FROM oddsapi_translations
    WHERE kind = 'market' AND source_key = 'ML'
    AND sport_slug IN ('ice-hockey', 'hockey-ghiaccio')
    AND translated = '1X2 TR';
  IF n_updated < 1 THEN
    RAISE EXCEPTION 'No hockey ML rows updated to 1X2 TR';
  END IF;
  RAISE NOTICE 'Updated % hockey ML rows to 1X2 TR', n_updated;
END $$;
