-- 105_events_unified_view.sql
-- Unified sportsbook: Kambi-first + 22bet gap-filler view.
-- Used by player API endpoints (sportsbook, sport-counts, antepost, search, use-results)
-- to read from a single virtual table that already dedupes cross-source duplicates.
--
-- Rule: always include Kambi events; include 22bet events ONLY when no Kambi
-- counterpart exists for the same flashscore_id (within the same active
-- status window — so an 'ended' Kambi event doesn't block a 'live' 22bet).
--
-- Events without flashscore_id: both sources kept (can't dedup).

BEGIN;

-- Partial index on kambi events with fsid to speed up the NOT EXISTS below.
-- Existing idx_events_flashscore_id (migration 011) is source-agnostic;
-- this one is kambi-specific for the block-lookup.
CREATE INDEX IF NOT EXISTS idx_events_kambi_fsid
  ON events (flashscore_id)
  WHERE source = 'kambi' AND flashscore_id IS NOT NULL;

-- ═══ The unified view ═══
-- Kambi ALWAYS wins when flashscore_id matches (any status). This includes
-- results pages (ended events): if a match is on Kambi, we always show Kambi's
-- record, never 22bet's duplicate. Trade-off: rare case where Kambi ends
-- earlier than 22bet could briefly hide an active 22bet event — accepted.
CREATE OR REPLACE VIEW v_events_unified AS
SELECT e.*
FROM events e
WHERE e.source IN ('kambi', '22bet')
  AND (
    e.source = 'kambi'
    OR e.flashscore_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM events k
      WHERE k.source = 'kambi'
        AND k.flashscore_id IS NOT NULL
        AND k.flashscore_id = e.flashscore_id
    )
  );

COMMENT ON VIEW v_events_unified IS
  'Kambi-primary + 22bet-fallback event catalog. Player API reads from this view instead of events table to auto-dedup cross-source duplicates via flashscore_id pivot. See docs/superpowers/specs/2026-04-24-unified-sportsbook.md';

-- Grant to anon/authenticated so PostgREST can serve it
GRANT SELECT ON v_events_unified TO anon, authenticated, service_role;

COMMIT;
