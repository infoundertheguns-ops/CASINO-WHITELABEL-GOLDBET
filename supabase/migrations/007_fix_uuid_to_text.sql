-- Migration 007: Fix UUID references to TEXT for admin identifiers
-- These columns were UUID REFERENCES admin_users(id) but admin auth
-- isn't set up yet, so change to TEXT for flexibility

-- 1. bets.accepted_by
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_accepted_by_fkey;
ALTER TABLE bets ALTER COLUMN accepted_by TYPE TEXT USING accepted_by::TEXT;

-- 2. risk_actions.performed_by
ALTER TABLE risk_actions DROP CONSTRAINT IF EXISTS risk_actions_performed_by_fkey;
ALTER TABLE risk_actions ALTER COLUMN performed_by TYPE TEXT USING performed_by::TEXT;

-- 3. risk_flags.assigned_to
ALTER TABLE risk_flags DROP CONSTRAINT IF EXISTS risk_flags_assigned_to_fkey;
ALTER TABLE risk_flags ALTER COLUMN assigned_to TYPE TEXT USING assigned_to::TEXT;

-- 4. risk_flags.resolved_by (from migration 005)
ALTER TABLE risk_flags DROP CONSTRAINT IF EXISTS risk_flags_resolved_by_fkey;
ALTER TABLE risk_flags ALTER COLUMN resolved_by TYPE TEXT USING resolved_by::TEXT;

-- 5. risk_events.resolved_by (from migration 001)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='risk_events' AND column_name='resolved_by') THEN
    ALTER TABLE risk_events DROP CONSTRAINT IF EXISTS risk_events_resolved_by_fkey;
    ALTER TABLE risk_events ALTER COLUMN resolved_by TYPE TEXT USING resolved_by::TEXT;
  END IF;
END $$;
