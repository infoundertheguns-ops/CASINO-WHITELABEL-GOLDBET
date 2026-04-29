-- ═══════════════════════════════════════════════════
-- Migration 088: Manual Override Schema (Phase 3)
--
-- Adds operator-controlled override fields to outcomes so that a consensus
-- outlier (wrong Kambi odds, bug, or value-bet to hide) can be:
--   - suspended manually without touching the scraper-sourced is_suspended
--   - overridden with a corrected odds value
-- Both changes must SURVIVE the scraper upsert cycle — the scraper code
-- (mig 088b, TypeScript change) will exclude manual_* from its upsert payload.
--
-- Also introduces two support tables:
--   - outcome_manual_actions  (audit trail: who did what, when, why, from what consensus)
--   - normalization_issues    (feedback queue from consensus dismiss to norm team)
--
-- See docs/superpowers/specs/2026-04-22-consensus-event-normalization-manual-override-design.md
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- 088.1 — Extend outcomes with manual override columns
-- -----------------------------------------------------

ALTER TABLE outcomes
  ADD COLUMN IF NOT EXISTS manual_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_odds numeric(8,2),
  ADD COLUMN IF NOT EXISTS manual_reason text,
  ADD COLUMN IF NOT EXISTS manual_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_set_at timestamptz;

-- odds must be > 1 when set (same invariant as base odds column)
ALTER TABLE outcomes
  DROP CONSTRAINT IF EXISTS outcomes_manual_odds_check;
ALTER TABLE outcomes
  ADD CONSTRAINT outcomes_manual_odds_check
  CHECK (manual_odds IS NULL OR manual_odds > 1::numeric);

-- Cannot have expires_at in the past relative to set_at (set_at is optional
-- to allow bulk inserts without timestamp; when both present, order enforced).
ALTER TABLE outcomes
  DROP CONSTRAINT IF EXISTS outcomes_manual_expiry_order_check;
ALTER TABLE outcomes
  ADD CONSTRAINT outcomes_manual_expiry_order_check
  CHECK (
    manual_expires_at IS NULL
    OR manual_set_at IS NULL
    OR manual_expires_at >= manual_set_at
  );

-- Efficient filter for the expiry cleanup cron.
CREATE INDEX IF NOT EXISTS idx_outcomes_manual_expires
  ON outcomes (manual_expires_at)
  WHERE manual_expires_at IS NOT NULL;

-- Partial index to speed up operator dashboards ("show me all active overrides").
CREATE INDEX IF NOT EXISTS idx_outcomes_manual_active
  ON outcomes (manual_set_at DESC)
  WHERE manual_suspended = true OR manual_odds IS NOT NULL;

COMMENT ON COLUMN outcomes.manual_suspended IS
  'Operator-controlled suspension. Independent of scraper-driven is_suspended. Player frontend: isBettable = is_active AND NOT is_suspended AND NOT manual_suspended.';
COMMENT ON COLUMN outcomes.manual_odds IS
  'Operator-overridden odds. Player frontend: displayOdds = COALESCE(manual_odds, odds). Does not replace odds — it masks them.';
COMMENT ON COLUMN outcomes.manual_expires_at IS
  'Auto-clear timestamp. NULL = permanent until manual restore. Cleanup cron empties manual_* when now() > expires_at.';

-- -----------------------------------------------------
-- 088.2 — outcome_manual_actions (audit trail)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS outcome_manual_actions (
  id bigserial PRIMARY KEY,
  outcome_id uuid NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  action_type text NOT NULL
    CHECK (action_type IN (
      'suspend',
      'override',
      'restore',
      'auto_suspend',
      'auto_restore',
      'expire'
    )),
  old_value jsonb,
  new_value jsonb,
  reason text,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto_consensus', 'cron_expiry')),
  consensus_id bigint REFERENCES consensus_snapshots(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_actions_outcome
  ON outcome_manual_actions (outcome_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_actions_recent
  ON outcome_manual_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_actions_consensus
  ON outcome_manual_actions (consensus_id)
  WHERE consensus_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manual_actions_auto
  ON outcome_manual_actions (source, created_at DESC)
  WHERE source = 'auto_consensus';

COMMENT ON TABLE outcome_manual_actions IS
  'Append-only audit of every manual override action. old_value/new_value carry jsonb snapshots of the manual_* fields pre/post. source distinguishes operator actions from auto-consensus-triggered suspensions and cron expiry clears.';

-- -----------------------------------------------------
-- 088.3 — normalization_issues (feedback queue)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS normalization_issues (
  id bigserial PRIMARY KEY,
  issue_type text NOT NULL
    CHECK (issue_type IN (
      'market_normalization',
      'event_normalization',
      'outcome_normalization',
      'scraper_bug',
      'other'
    )),
  source text
    CHECK (source IS NULL OR source IN ('kambi', '22bet')),
  source_ref text,  -- e.g. market_type, team name, arbitrary scraper identifier
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  market_id uuid REFERENCES markets(id) ON DELETE SET NULL,
  outcome_id uuid REFERENCES outcomes(id) ON DELETE SET NULL,
  consensus_id bigint REFERENCES consensus_snapshots(id) ON DELETE SET NULL,
  notes text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved', 'wontfix', 'duplicate')),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_norm_issues_open
  ON normalization_issues (status, created_at DESC)
  WHERE status IN ('open', 'investigating');
CREATE INDEX IF NOT EXISTS idx_norm_issues_type_status
  ON normalization_issues (issue_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_norm_issues_consensus
  ON normalization_issues (consensus_id)
  WHERE consensus_id IS NOT NULL;

COMMENT ON TABLE normalization_issues IS
  'Feedback queue populated by consensus dismiss actions and ad-hoc reporting. The normalization team (market / event / outcome) uses this to track systemic scraper or mapping issues surfaced during consensus review.';

-- -----------------------------------------------------
-- 088.4 — RLS policies
-- -----------------------------------------------------

-- Audit table: service role only. Operators go through API + RPC that inserts
-- using their auth.uid() via created_by.
ALTER TABLE outcome_manual_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_service_role_all ON outcome_manual_actions;
CREATE POLICY audit_service_role_all ON outcome_manual_actions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Normalization issues: service role full access; no public read.
ALTER TABLE normalization_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS norm_issues_service_role_all ON normalization_issues;
CREATE POLICY norm_issues_service_role_all ON normalization_issues
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- outcomes RLS: existing public SELECT policy (is_active OR is_suspended)
-- is unchanged. manual_* columns are visible alongside odds — the player
-- frontend reads them and applies displayOdds / isBettable logic client-side.
-- No RLS change required here.

-- -----------------------------------------------------
-- 088.5 — Publications (realtime propagation)
-- -----------------------------------------------------

-- outcomes is already in supabase_realtime + staging_pub. The new columns
-- will flow through existing publications automatically for UPDATE events.
-- Player frontend SSE route (use-event.ts) must be verified to pass
-- manual_suspended / manual_odds fields on realtime messages — handled in B8.

-- No action needed here; documenting for traceability.

-- Note: no backfill UPDATE needed. ALTER ADD COLUMN with DEFAULT false on
-- PG 11+ is metadata-only for non-volatile defaults; existing rows get the
-- default transparently. A full-table UPDATE on 14M outcome rows would be
-- multi-minute and is not necessary.
