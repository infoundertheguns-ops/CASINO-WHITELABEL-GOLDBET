-- ════════════════════════════════════════════════════════════
-- 103b_consensus_sports_counts_rpc.sql
--
-- Fix: /admin/consensus sport dropdown showing only "Baseball" because
-- the RPC it calls (get_consensus_sports_counts) was never created.
-- The JS fallback (SELECT sport FROM consensus_snapshots LIMIT 10000)
-- reads the first 10k rows by physical id ASC → oldest inserts →
-- not representative of current sport distribution.
--
-- This migration adds the missing RPC, filtered to the same 48h window
-- the view uses. Returns one row per sport with count, ordered DESC.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_consensus_sports_counts()
RETURNS TABLE(sport text, count bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT sport, count(*)::bigint AS count
  FROM consensus_snapshots
  WHERE event_starts_at > now() - interval '48 hours'
  GROUP BY sport
  ORDER BY count(*) DESC;
$$;

COMMENT ON FUNCTION get_consensus_sports_counts IS
  'Sport counts for /admin/consensus dropdown, scoped to 48h window (matches v_consensus_latest view). Replaces a JS fallback that was pulling unsorted first-10k rows.';
