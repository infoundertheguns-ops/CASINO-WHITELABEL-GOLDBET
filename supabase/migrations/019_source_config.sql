-- Migration 019: Add active_live_source config key
-- Allows admin to switch live data source between leon and goldbet

INSERT INTO system_config (key, value, description)
VALUES ('active_live_source', '"leon"', 'Active live data source (leon or goldbet)')
ON CONFLICT (key) DO NOTHING;
