-- supabase/migrations/154_derive_legacy_filter.sql
-- Plan D Phase 1.5 — filter-at-exposure helper + dry-run sibling RPC.
--
-- IMPORTANT: classifier is REGEX-based, not dict lookup. The literal-key dict
-- in `market_categories_seed` (mig 152) cannot enumerate real-world prod labels
-- which include unbounded lines ("U/O 2.75"), abbreviations ("DC", "DNB"), and
-- embedded line suffixes ("Totale 1° squadra 1.5"). Patterns mirror the TS
-- classifier in lib/settlement/market-classification.ts.
--
-- Filter source: events.flashscore_id (legacy table, populated by FS matcher
-- post-derive). NOT events_v2.flashscore_id (100% NULL on prod). See spec §12 R10.
--
-- Does NOT modify the live derive_legacy_from_v2(); the cutover (mig 154b) is
-- gated by 24h staging observation of the dry-run output.

BEGIN;

-- ========== Part A: classify_market_pattern (regex-based) ==========
-- Matches order: special → player → stats → score → unknown ('special' fail-safe).

DROP FUNCTION IF EXISTS classify_market_pattern(TEXT);
CREATE FUNCTION classify_market_pattern(p_market_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  -- Compact regex per category — single alternation per category.
  -- NOTE: leading word-boundary `\y` only; NO trailing boundary because the captured
  -- keyword is typically followed by additional tokens ("Marcatore Squadra Casa",
  -- "Cartellini 4.5") or suffix letters ("Corners", "Marcatori").
  -- Order matters: special → player → stats → score → unknown (fail-safe).
  --
  -- Score covers Italian translated forms AND raw English/odds-api forms that
  -- _oddsapi_translate_market() does not translate (e.g. "Alternative Asian
  -- Handicap", "Both Teams To Score HT", "ML 1st Set", "Tempo Regolamentare").
  SELECT CASE
    WHEN p_market_type ~* '^(Metodo Goal|Goal Method|Primi 10 Minuti|First 10|Special)' THEN 'special'
    WHEN p_market_type ~* '\y(Marcator|Giocator|Marca o Assist|Anytime|Player|Scorer|Multi Scorers|Team Goalscorer|Goalscorer)' THEN 'player'
    WHEN p_market_type ~* '\y(Corner|Angoli|Cartellin|Card |Cards|Tackles|Salvataggi|Goalkeeper Saves|Falli|Fouls|Tiri Totali|Tiri in Porta|Tiri Squadra|Team Shots|Match Shots|Shots on Target|Bookings|Doubles|Batter Walks|Hits)' THEN 'stats'
    WHEN p_market_type ~* '^(1X2|U/O|GG/NG|DC|DNB|HT/FT|ML|P/D|3-Way|2-Way|Doppia|Pareggio|Vincente|Pari/Dispari|Numero Goal|Esatto|Risultato|Linea Goal|Goal/No Goal|Goal Line|Totale|Total|Handicap|Asian Handicap|European Handicap|Spread|Multigol|Multiscores|Alternative|Both Teams|Exact|First Team|Last Team|Number of|To Score|Tempo Regolamentare|Supplementari|Half Time|Full Time|1st Half|2nd Half|First Half|Second Half|Draw No Bet|Match Result|Final Score|Score after|Set Betting|Game Betting|Frame|Race To|Highest Scoring|Lowest Scoring|Penalty|To Win|Win and|Win Either|Winning Margin|Clean Sheet|5 Innings|7 Innings|9 Innings)' THEN 'score'
    ELSE 'special'  -- fail-safe
  END;
$$;

COMMENT ON FUNCTION classify_market_pattern(TEXT) IS
  'Plan D v2 — regex-based classifier mirror of lib/settlement/market-classification.ts classify(). Order: special > player > stats > score > unknown. Patterns handle line suffixes / abbreviations / variants.';

GRANT EXECUTE ON FUNCTION classify_market_pattern(TEXT) TO anon, authenticated, service_role;

-- ========== Part B: is_market_exposable predicate ==========

DROP FUNCTION IF EXISTS is_market_exposable(TEXT, BOOLEAN);
CREATE FUNCTION is_market_exposable(
  p_market_type TEXT,
  p_event_has_flashscore_id BOOLEAN
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE classify_market_pattern(p_market_type)
    WHEN 'score' THEN true
    WHEN 'stats' THEN p_event_has_flashscore_id
    WHEN 'player' THEN p_event_has_flashscore_id
    ELSE false  -- special or unknown → fail-safe filter
  END;
$$;

COMMENT ON FUNCTION is_market_exposable(TEXT, BOOLEAN) IS
  'Plan D v2 filter-at-exposure predicate. Score always exposable; stats/player only on FS-mapped events; special and unknown always filtered.';

GRANT EXECUTE ON FUNCTION is_market_exposable(TEXT, BOOLEAN) TO anon, authenticated, service_role;

-- ========== Part C: dry-run sibling RPC ==========
-- Returns the diff: markets that the live derive_legacy_from_v2() currently produces
-- but the new filter would remove.
-- Scoped to derive's same time window (events.starts_at > now()-2d AND < now()+14d)
-- to keep the regex scan within statement_timeout. Historical events are already
-- settled and not affected by exposure filters.

DROP FUNCTION IF EXISTS derive_legacy_from_v2_filter_diff();
CREATE FUNCTION derive_legacy_from_v2_filter_diff()
RETURNS TABLE(
  market_id UUID, event_id UUID, market_type TEXT, category TEXT,
  event_has_flashscore_id BOOLEAN, would_remove BOOLEAN,
  reason TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id AS market_id,
    e.id AS event_id,
    m.market_type,
    classify_market_pattern(m.market_type) AS category,
    (e.flashscore_id IS NOT NULL) AS event_has_flashscore_id,
    NOT is_market_exposable(m.market_type, e.flashscore_id IS NOT NULL) AS would_remove,
    CASE
      WHEN classify_market_pattern(m.market_type) = 'special'
        THEN 'special-always-filtered'
      WHEN classify_market_pattern(m.market_type) IN ('stats','player') AND e.flashscore_id IS NULL
        THEN 'no-flashscore-id'
      WHEN is_market_exposable(m.market_type, e.flashscore_id IS NOT NULL)
        THEN 'kept'
      ELSE 'unknown-fail-safe'
    END AS reason
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active = true
    AND e.external_id LIKE 'odds-api:%'
    AND e.starts_at > NOW() - INTERVAL '2 days'
    AND e.starts_at < NOW() + INTERVAL '14 days';
$$;

GRANT EXECUTE ON FUNCTION derive_legacy_from_v2_filter_diff() TO anon, authenticated, service_role;

-- ========== Part D: replace settlement_coverage_filter_kpi stub with real body ==========

DROP FUNCTION IF EXISTS settlement_coverage_filter_kpi(int);
CREATE FUNCTION settlement_coverage_filter_kpi(window_days int DEFAULT 7)
RETURNS TABLE(
  markets_filtered BIGINT, total_markets BIGINT, pct NUMERIC, reason TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    count(*) FILTER (WHERE would_remove) AS markets_filtered,
    count(*) AS total_markets,
    round(100.0 * count(*) FILTER (WHERE would_remove) / NULLIF(count(*), 0), 2) AS pct,
    reason
  FROM derive_legacy_from_v2_filter_diff()
  GROUP BY reason
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION settlement_coverage_filter_kpi(int) TO anon, authenticated, service_role;

COMMIT;
