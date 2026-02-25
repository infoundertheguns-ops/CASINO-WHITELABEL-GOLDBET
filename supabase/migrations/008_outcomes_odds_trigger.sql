-- Migration 008: Auto-track odds movement on outcomes
-- Trigger copies old odds → previous_odds and sets updated_at on every update

CREATE OR REPLACE FUNCTION fn_outcomes_track_odds()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.odds IS DISTINCT FROM OLD.odds THEN
    NEW.previous_odds := OLD.odds;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outcomes_track_odds
  BEFORE UPDATE ON outcomes
  FOR EACH ROW
  EXECUTE FUNCTION fn_outcomes_track_odds();
