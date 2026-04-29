-- ═══════════════════════════════════════════════════
-- Migration 121: team_aliases LLM suggest-mode + admin curation
--
-- Adds:
--   * team_aliases.proposed_for_event_id uuid — audit pointer to the event
--     that triggered the LLM suggestion. NULL for operator-created aliases.
--   * team_aliases.llm_reason text — verbatim LLM rationale (audit + UI).
--   * Index for unverified queue (pending alias proposals, drives the UI).
--   * Unique partial index (sport, alias) WHERE verified=true to prevent
--     duplicate verified aliases for the same sport. Multiple unverified
--     proposals are allowed so operators can compare.
--   * RPC team_aliases_pending_count() — KPI for the admin tab badge.
-- ═══════════════════════════════════════════════════

ALTER TABLE team_aliases
  ADD COLUMN IF NOT EXISTS proposed_for_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS llm_reason text;

COMMENT ON COLUMN team_aliases.proposed_for_event_id IS
  'Sprint 2.x: event that triggered the LLM alias proposal. NULL = operator-created or seed.';
COMMENT ON COLUMN team_aliases.llm_reason IS
  'Sprint 2.x: verbatim LLM rationale for the alias proposal. Surfaces in admin UI for audit.';

-- Pending alias queue (drives the admin tab list)
CREATE INDEX IF NOT EXISTS idx_team_aliases_pending
  ON team_aliases(created_at DESC)
  WHERE NOT verified;

-- Prevent duplicate verified aliases for the same sport.
-- Unverified rows can collide (operator triages and picks one).
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_aliases_sport_alias_verified
  ON team_aliases(sport, lower(alias))
  WHERE verified = true;

CREATE OR REPLACE FUNCTION team_aliases_pending_count()
RETURNS int
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::int FROM team_aliases WHERE NOT verified;
$$;

COMMENT ON FUNCTION team_aliases_pending_count IS
  'Sprint 2.x: count of pending alias proposals awaiting operator review. Powers the admin tab badge.';

GRANT EXECUTE ON FUNCTION team_aliases_pending_count() TO anon, authenticated, service_role;
