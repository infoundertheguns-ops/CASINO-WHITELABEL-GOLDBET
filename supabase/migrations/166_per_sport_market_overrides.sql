-- Migration 166: per-sport market_type translation overrides for kiosk listing tiles
--
-- Each kiosk sport has its own column groupNames hardcoded in lib/market-config.ts.
-- The frontend EventRow matches markets via regex on market_type. So translations
-- must produce specific strings per sport (e.g. tennis Totals -> "Totale set", basket
-- Totals -> "U/O Incl. Supp.", hockey Spread -> "Handicap TR").
--
-- This migration adds 12 sport-specific overrides discovered by mapping kiosk column
-- groupNames to v_player_markets.market_type expected values.

INSERT INTO oddsapi_translations (kind, source_key, sport_slug, parent_market, translated)
VALUES
  -- BASKETBALL: Totals = U/O Incl. Supp., Spread = T/T Handicap
  ('market', 'Totals',   'basketball', '', 'U/O Incl. Supp.'),
  ('market', 'Spread',   'basketball', '', 'T/T Handicap'),

  -- BASEBALL: Totals = Run totali, Spread = Handicap (default)
  ('market', 'Totals',   'baseball',   '', 'Run totali'),
  ('market', 'Spread',   'baseball',   '', 'Handicap'),

  -- ICE-HOCKEY: ML = 1X2 TR (over default Supplementari Inclusi), DC = DC TR,
  --             Spread = Handicap TR, Totals = Gol Tot. TR
  ('market', 'ML',              'ice-hockey', '', '1X2 TR'),
  ('market', 'Double Chance',   'ice-hockey', '', 'DC TR'),
  ('market', 'Spread',          'ice-hockey', '', 'Handicap TR'),
  ('market', 'Totals',          'ice-hockey', '', 'Gol Tot. TR'),

  -- HANDBALL: Totals = U/O, Spread = Handicap (default works but make explicit)
  ('market', 'Totals',   'handball',   '', 'U/O'),
  ('market', 'Spread',   'handball',   '', 'Handicap'),

  -- RUGBY: Totals = U/O Incl. Supp., Spread = T/T Handicap
  ('market', 'Totals',   'rugby',      '', 'U/O Incl. Supp.'),
  ('market', 'Spread',   'rugby',      '', 'T/T Handicap')
ON CONFLICT DO NOTHING;

-- Verification
DO $$
DECLARE n_added int;
BEGIN
  SELECT count(*) INTO n_added FROM oddsapi_translations
    WHERE sport_slug IN ('basketball','baseball','ice-hockey','handball','rugby')
    AND source_key IN ('Totals','Spread','ML','Double Chance');
  IF n_added < 8 THEN
    RAISE EXCEPTION 'Expected at least 8 per-sport overrides, found %', n_added;
  END IF;
  RAISE NOTICE 'per-sport translations: % rows for basket/baseball/hockey/handball/rugby', n_added;
END $$;
