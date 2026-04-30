-- Migration 159 — oddsapi_translations table (Plan D / Elimina-derive Fase 1)
-- Stores EXACT translation rules for market_name and outcome_key (EN -> IT).
-- Prefix/LIKE patterns + sport-aware ML defaults remain in _oddsapi_translate_market/_outcome
-- functions as fallback. Views (mig 160) prefer table, fall back to function.

-- sport_slug='' / parent_market='' represent "applies to any" (Postgres PK can't use COALESCE)
CREATE TABLE IF NOT EXISTS oddsapi_translations (
  kind TEXT NOT NULL CHECK (kind IN ('market','outcome')),
  sport_slug TEXT NOT NULL DEFAULT '',  -- '' = applies to any sport
  source_key TEXT NOT NULL,             -- raw EN key (lowercased for outcomes)
  parent_market TEXT NOT NULL DEFAULT '', -- for outcomes: market context, '' = any
  translated TEXT NOT NULL,             -- IT translation
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, source_key, sport_slug, parent_market)
);

CREATE INDEX IF NOT EXISTS idx_oddsapi_translations_lookup
  ON oddsapi_translations(kind, source_key);

CREATE OR REPLACE FUNCTION oddsapi_translations_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oddsapi_translations_updated_at ON oddsapi_translations;
CREATE TRIGGER trg_oddsapi_translations_updated_at
  BEFORE UPDATE ON oddsapi_translations
  FOR EACH ROW EXECUTE FUNCTION oddsapi_translations_set_updated_at();

COMMENT ON TABLE oddsapi_translations IS
  'Plan D Fase 1 — exact-match translation dictionary. Prefix/sport-aware fallback in _oddsapi_translate_market/_outcome functions.';

-- ============================================================
-- Initial population — extracted from _oddsapi_translate_market function body
-- (verified against pg_proc body 2026-04-30)
-- ============================================================

-- Sport-aware ML rules
INSERT INTO oddsapi_translations (kind, sport_slug, source_key, translated) VALUES
  ('market', 'calcio',           'ML', '1X2'),
  ('market', 'pallamano',        'ML', 'Tempo Regolamentare'),
  ('market', 'hockey-ghiaccio',  'ML', 'Supplementari Inclusi'),
  ('market', 'rugby',            'ML', 'Tempo regolamentare (1X2)'),
  ('market', '',               'ML', 'Vincente Incontro')
ON CONFLICT DO NOTHING;

-- 3-Way Result + Half/Quarter ML
INSERT INTO oddsapi_translations (kind, sport_slug, source_key, translated) VALUES
  ('market', '', '3-Way Result',       'Tempo Regolamentare'),
  ('market', '', 'Game Lines 3-Way',   'Tempo Regolamentare'),
  ('market', '', 'ML HT',               '1X2 - 1T'),
  ('market', '', 'ML 2H',               '1X2 - 2T'),
  ('market', '', 'ML Q1',               '1X2 - 1Q'),
  ('market', '', 'ML Q2',               '1X2 - 2Q'),
  ('market', '', 'ML Q3',               '1X2 - 3Q'),
  ('market', '', 'ML Q4',               '1X2 - 4Q'),
  ('market', '', 'Half Time Result',    '1X2 - 1T')
ON CONFLICT DO NOTHING;

-- Totals (over/under)
INSERT INTO oddsapi_translations (kind, sport_slug, source_key, translated) VALUES
  ('market', '', 'Totals',                  'U/O'),
  ('market', '', 'Totals HT',               'U/O - 1T'),
  ('market', '', 'Totals 1H',               'U/O - 1T'),
  ('market', '', 'Totals 2H',               'U/O - 2T'),
  ('market', '', 'Totals 1Q',               'U/O - 1Q'),
  ('market', '', 'Totals 2Q',               'U/O - 2Q'),
  ('market', '', 'Totals 3Q',               'U/O - 3Q'),
  ('market', '', 'Totals 4Q',               'U/O - 4Q'),
  ('market', '', 'Totals (Games)',          'Totale giochi'),
  ('market', '', 'Goals Over/Under',        'U/O'),
  ('market', '', 'Alternative Goal Line',   'U/O')
ON CONFLICT DO NOTHING;

-- Spread / Handicap
INSERT INTO oddsapi_translations (kind, sport_slug, source_key, translated) VALUES
  ('market', '', 'Spread',              'Handicap'),
  ('market', '', 'Spread HT',           'Handicap - 1T'),
  ('market', '', 'Spread 2H',           'Handicap - 2T'),
  ('market', '', 'Spread Q1',           'Handicap - 1Q'),
  ('market', '', 'Spread (Games)',      'Handicap'),
  ('market', '', 'European Handicap',   'Handicap'),
  ('market', '', '1st Half Handicap',   'Handicap - 1T'),
  ('market', '', 'Corners Spread',      'Handicap angoli')
ON CONFLICT DO NOTHING;

-- Other calcio (exact)
INSERT INTO oddsapi_translations (kind, sport_slug, source_key, translated) VALUES
  ('market', '', 'Double Chance',           'DC'),
  ('market', '', 'Both Teams To Score',     'GG/NG'),
  ('market', '', 'Both Teams To Score 2H',  'GG/NG - 2T'),
  ('market', '', 'Draw No Bet',             'DNB'),
  ('market', '', 'Correct Score',           'Risultato Esatto'),
  ('market', '', 'Half Time / Full Time',   '1T/Finale'),
  ('market', '', 'Odd/Even',                'P/D'),
  ('market', '', 'Anytime Goalscorer',      'Marcatore'),
  ('market', '', 'Corners',                 'Angoli'),
  ('market', '', 'Corners 2-Way',           'Angoli 2-Way')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Outcome rules (extracted from _oddsapi_translate_outcome)
-- Function uses lower(p_key) so source_key stored lowercase. View MUST lower(outcome_key).
-- All sport-agnostic, parent_market = NULL (any market context).
-- ============================================================
INSERT INTO oddsapi_translations (kind, source_key, translated) VALUES
  ('outcome', 'yes',           'Si'),
  ('outcome', 'no',            'No'),
  ('outcome', 'odd',           'Dispari'),
  ('outcome', 'even',          'Pari'),
  ('outcome', 'over',          'Over'),
  ('outcome', 'under',         'Under'),
  ('outcome', 'home_or_draw',  '1X'),
  ('outcome', 'away_or_draw',  'X2'),
  ('outcome', 'home_or_away',  '12'),
  ('outcome', 'home',          '1'),
  ('outcome', 'draw',          'X'),
  ('outcome', 'away',          '2')
ON CONFLICT DO NOTHING;

-- Track migration
INSERT INTO _migrations (name, applied_at)
VALUES ('159_oddsapi_translations', now())
ON CONFLICT (name) DO NOTHING;
