-- supabase/migrations/182_events_v2_add_sofa_inverse_orientation.sql
-- Persist Sofascore's tournament.uniqueTournament.displayInverseHomeAwayTeams flag.
-- TRUE for tournaments where Sofa lists home/away inverted vs odds-api convention
-- (e.g. MLB, NFL — "home team bats last" convention).
-- Used by matcher to skip swap-detection heuristic and bind orientation directly.

ALTER TABLE events_v2
  ADD COLUMN IF NOT EXISTS sofa_inverse_orientation BOOLEAN;

COMMENT ON COLUMN events_v2.sofa_inverse_orientation IS
  'Sofascore tournament.uniqueTournament.displayInverseHomeAwayTeams. NULL=unknown, TRUE=Sofa lists inverted, FALSE=Sofa same orientation as odds-api.';

-- Rollback (manual):
--   ALTER TABLE events_v2 DROP COLUMN IF EXISTS sofa_inverse_orientation;
