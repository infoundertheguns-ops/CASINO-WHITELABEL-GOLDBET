-- 108_market_normalization_public_select.sql
-- Enable public SELECT on market_normalization + canonical_markets so the
-- player API (anon key) can enrich markets with canonical_key for the
-- listing column dispatch. Without this, RLS returns empty and every
-- market falls back to regex-only matching (Phase 5 silent regression).
--
-- Parity with existing RLS pattern on sports/leagues/events: public read,
-- no public writes (service role bypasses; admin writes via service).

-- market_normalization
DROP POLICY IF EXISTS "Public read access to market_normalization" ON market_normalization;
CREATE POLICY "Public read access to market_normalization"
  ON market_normalization
  FOR SELECT
  USING (true);

-- canonical_markets
DROP POLICY IF EXISTS "Public read access to canonical_markets" ON canonical_markets;
CREATE POLICY "Public read access to canonical_markets"
  ON canonical_markets
  FOR SELECT
  USING (true);
