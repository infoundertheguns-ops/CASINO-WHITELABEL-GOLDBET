-- 186: system_config feature flags for api-football integration
-- API_FOOTBALL_WRITE_ENABLED: gate for ingester writes to events_v2 (M1 default false)
-- API_FOOTBALL_TIMER_OWNER: M2 gate to switch timer/period/score ownership from FS to api-football
-- Both default false; flipped via DB UPDATE during rollout milestones.

INSERT INTO system_config (key, value, description)
VALUES
  ('API_FOOTBALL_WRITE_ENABLED', 'false'::jsonb, 'When true, api-football-ingester writes to events_v2 + live_data sub-keys. Default false during M1 (mappings-only phase).'),
  ('API_FOOTBALL_TIMER_OWNER', 'false'::jsonb, 'When true, api-football owns events_v2 minute/period/score_*/period_scores for football; FS scraper skips writing those fields. Default false; flipped during M2 ownership switch.')
ON CONFLICT (key) DO NOTHING;

-- Rollback: DELETE FROM system_config WHERE key IN ('API_FOOTBALL_WRITE_ENABLED', 'API_FOOTBALL_TIMER_OWNER');
