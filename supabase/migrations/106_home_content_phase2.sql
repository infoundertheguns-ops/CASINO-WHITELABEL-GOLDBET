-- 106_home_content_phase2.sql
-- E5 Phase 2 — Home CMS enhancements: i18n, scheduling, versioning, link-health.
--
-- Additions to home_content:
--   - title_en             : optional English translation (title stays authoritative for backward compat and becomes title_it alias).
--   - published_from/until : optional scheduling window. When set, cron toggles is_active.
--   - link_status          : result of periodic URL health check ('ok' | 'broken' | 'unknown' | NULL).
--   - link_checked_at      : last time the link was probed.
--
-- New table home_content_history: audit+rollback log. One row per UPDATE/DELETE event
-- storing the *previous* snapshot plus actor + action.

BEGIN;

-- ─── Column additions (idempotent) ─────────────────────────

ALTER TABLE home_content
  ADD COLUMN IF NOT EXISTS title_en        TEXT,
  ADD COLUMN IF NOT EXISTS published_from  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS link_status     TEXT CHECK (link_status IN ('ok', 'broken', 'unknown')),
  ADD COLUMN IF NOT EXISTS link_checked_at TIMESTAMPTZ;

-- Index to speed scheduler cron (finds rows with any time-bound).
CREATE INDEX IF NOT EXISTS idx_home_content_published_window
  ON home_content(published_from, published_until)
  WHERE published_from IS NOT NULL OR published_until IS NOT NULL;

-- ─── History table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS home_content_history (
  history_id    BIGSERIAL PRIMARY KEY,
  home_content_id UUID NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('update', 'delete')),
  snapshot      JSONB NOT NULL,         -- full previous row
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by    TEXT                     -- optional actor identifier (email / 'system')
);

CREATE INDEX IF NOT EXISTS idx_home_content_history_item
  ON home_content_history(home_content_id, changed_at DESC);

-- ─── Trigger: copy row on UPDATE and DELETE ────────────────
-- Uses current_setting('app.actor', true) which route.ts will set via supabase.rpc('set_config',...).
-- If unset, changed_by is NULL.

CREATE OR REPLACE FUNCTION home_content_snapshot_trigger() RETURNS trigger AS $$
DECLARE
  actor TEXT := current_setting('app.actor', true);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO home_content_history (home_content_id, action, snapshot, changed_by)
    VALUES (OLD.id, 'update', to_jsonb(OLD), actor);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO home_content_history (home_content_id, action, snapshot, changed_by)
    VALUES (OLD.id, 'delete', to_jsonb(OLD), actor);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_home_content_history ON home_content;
CREATE TRIGGER trg_home_content_history
  BEFORE UPDATE OR DELETE ON home_content
  FOR EACH ROW EXECUTE FUNCTION home_content_snapshot_trigger();

-- ─── RLS on history (service-role only for writes; select open) ─

ALTER TABLE home_content_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "home_content_history_select" ON home_content_history;
CREATE POLICY "home_content_history_select" ON home_content_history FOR SELECT USING (true);

COMMIT;
