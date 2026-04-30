-- Rollback for migration 160
DROP VIEW IF EXISTS v_player_outcomes;
DROP VIEW IF EXISTS v_player_markets;
DROP VIEW IF EXISTS v_player_events;
DELETE FROM _migrations WHERE name = '160_player_views';
