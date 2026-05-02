-- Migration 164: duplicate Italian-anchored translation overrides for English sport_slugs
--
-- Bug discovered 2026-05-02: events_v2.sport_slug stores English values
-- (football, basketball, tennis...) per ingester convention, but
-- oddsapi_translations sport_slug overrides were seeded with Italian
-- values (calcio, basket, ...). Lookup misses → fallback to default
-- translation (e.g. ML → 'Vincente Incontro' instead of '1X2' for football).
-- Add English-language duplicates.
--
-- Mapping below uses the actual English sport_slug values found in events_v2
-- (e.g. 'ice-hockey' with hyphen, 'american-football' with hyphen).

INSERT INTO oddsapi_translations (kind, source_key, sport_slug, parent_market, translated)
SELECT
  kind,
  source_key,
  CASE sport_slug
    WHEN 'calcio' THEN 'football'
    WHEN 'basket' THEN 'basketball'
    WHEN 'tennis' THEN 'tennis'
    WHEN 'pallamano' THEN 'handball'
    WHEN 'pallavolo' THEN 'volleyball'
    WHEN 'volley' THEN 'volleyball'
    WHEN 'rugby' THEN 'rugby'
    WHEN 'rugby-league' THEN 'rugby'
    WHEN 'hockey-ghiaccio' THEN 'ice-hockey'
    WHEN 'tennis-tavolo' THEN 'tabletennis'
    WHEN 'football-americano' THEN 'american-football'
    WHEN 'arti-marziali' THEN 'mma'
    WHEN 'freccette' THEN 'darts'
    WHEN 'motociclismo' THEN 'motogp'
    WHEN 'pugilato' THEN 'boxing'
    WHEN 'boxe' THEN 'boxing'
    WHEN 'pallanuoto' THEN 'waterpolo'
    ELSE sport_slug
  END AS sport_slug_en,
  parent_market,
  translated
FROM oddsapi_translations
WHERE sport_slug IN (
  'calcio','basket','tennis','pallamano','pallavolo','volley','rugby','rugby-league',
  'hockey-ghiaccio','tennis-tavolo','football-americano','arti-marziali','freccette',
  'motociclismo','pugilato','boxe','pallanuoto'
)
ON CONFLICT DO NOTHING;

-- Verification
DO $$
DECLARE n_football int;
DECLARE n_total int;
BEGIN
  SELECT count(*) INTO n_football FROM oddsapi_translations WHERE sport_slug = 'football';
  SELECT count(*) INTO n_total FROM oddsapi_translations;
  IF n_football < 1 THEN
    RAISE EXCEPTION 'Expected at least 1 football translation, found %', n_football;
  END IF;
  RAISE NOTICE 'oddsapi_translations: % rows total, % for sport_slug=football', n_total, n_football;
END $$;
