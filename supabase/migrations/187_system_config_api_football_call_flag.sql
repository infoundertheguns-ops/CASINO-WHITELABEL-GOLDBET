-- 187: system_config feature flag API_FOOTBALL_CALL_ENABLED for api-football ingester (M1.14)
-- When true, scheduler executes pollers + discovery; when false, scheduler is dormant.
-- Default false during M1 mappings phase. Distinct from API_FOOTBALL_WRITE_ENABLED
-- (mig 186) which gates persistence: callEnabled=true + writeEnabled=false is the
-- "dry-run" mode (API calls fire, DB never touched).

INSERT INTO system_config (key, value, description)
VALUES ('API_FOOTBALL_CALL_ENABLED', 'false'::jsonb, 'When true, api-football-ingester executes pollers + discovery; when false, scheduler is dormant. Default false during M1 mappings phase.')
ON CONFLICT (key) DO NOTHING;

-- Rollback: DELETE FROM system_config WHERE key = 'API_FOOTBALL_CALL_ENABLED';
