-- ═══════════════════════════════════════════════════
-- Migration 088d: Resolve outcome_id from a consensus snapshot
--
-- Thin helper RPC used by the admin consensus page to bridge between
-- consensus-keyed UI actions (operator sees consensus rows) and
-- outcome-keyed RPCs (suspend/override/restore target outcomes.id).
--
-- Returns the Kambi-side outcome uuid for a given consensus snapshot, or
-- NULL if the snapshot's (market_type, outcome_name) no longer resolves
-- to a live outcome (e.g., the market was deactivated).
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION resolve_outcome_from_consensus(p_consensus_id bigint)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id
  FROM consensus_snapshots c
  JOIN markets m ON m.event_id = c.kambi_event_id AND m.market_type = c.market_type
  JOIN outcomes o ON o.market_id = m.id AND o.name = c.outcome_name
  WHERE c.id = p_consensus_id
  ORDER BY o.is_active DESC, o.updated_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION resolve_outcome_from_consensus IS
  'Maps a consensus_snapshots.id to the Kambi-side outcomes.id. Preference given to is_active rows. Returns NULL if nothing resolves.';

REVOKE ALL ON FUNCTION resolve_outcome_from_consensus(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_outcome_from_consensus(bigint) TO service_role;
