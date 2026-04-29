-- 043_market_normalization_ext.sql
-- Extend market_normalization with line/provenance columns, tighten source whitelist, add FK to canonical_markets.

ALTER TABLE market_normalization
  ADD COLUMN IF NOT EXISTS canonical_line NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS extracted_by   TEXT,
  ADD COLUMN IF NOT EXISTS confidence     SMALLINT;

ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_normalization_source_check;

ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_source_check
    CHECK (source IN ('kambi','22bet'));

ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_norm_canonical_fk;

ALTER TABLE market_normalization
  ADD CONSTRAINT market_norm_canonical_fk
    FOREIGN KEY (canonical_key)
    REFERENCES canonical_markets(canonical_key)
    ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_extracted_by_check
    CHECK (extracted_by IS NULL OR extracted_by IN ('manual','regex','dictionary','propagation','fuzzy','llm'));

ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_confidence_check
    CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100));

CREATE INDEX IF NOT EXISTS idx_market_norm_unverified
  ON market_normalization(source, extracted_by)
  WHERE verified = false AND canonical_key IS NOT NULL;

-- Helper RPC 1: list distinct (source, market_type) pairs NOT yet mapped. Ordered by market_count DESC.
CREATE OR REPLACE FUNCTION list_unmapped_market_types(p_limit INT DEFAULT 500)
RETURNS TABLE (source TEXT, market_type TEXT, event_count BIGINT, market_count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT e.source::text, m.market_type::text, COUNT(DISTINCT e.id), COUNT(*)
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND e.source IN ('kambi','22bet')
    AND NOT EXISTS (
      SELECT 1 FROM market_normalization mn
      WHERE mn.source = e.source
        AND mn.source_market_type = m.market_type
        AND mn.canonical_key IS NOT NULL
    )
  GROUP BY e.source, m.market_type
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
$$;

-- Helper RPC 2: cheap count of remaining unmapped rows.
CREATE OR REPLACE FUNCTION count_unmapped_market_types()
RETURNS INT
LANGUAGE sql STABLE AS $$
  SELECT COUNT(DISTINCT (e.source, m.market_type))::int
  FROM markets m
  JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND e.source IN ('kambi','22bet')
    AND NOT EXISTS (
      SELECT 1 FROM market_normalization mn
      WHERE mn.source = e.source
        AND mn.source_market_type = m.market_type
        AND mn.canonical_key IS NOT NULL
    );
$$;

ALTER FUNCTION list_unmapped_market_types(INT) SET statement_timeout = '300s';
ALTER FUNCTION count_unmapped_market_types()   SET statement_timeout = '300s';
