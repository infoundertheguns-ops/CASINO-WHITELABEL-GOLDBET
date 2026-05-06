-- Migration 177 — events_v2 live columns (period, minute, live_data)
--
-- Context:
--   Plan D S6 cutover moved live event ingestion to events_v2, but the
--   table never had columns for FS-scraper-supplied period / minute /
--   live_data (halfScores, stats.clock). The FS push-to-vincitu matcher
--   (mig 178 follow-up) needs these columns to write live UX state.
--
-- Behaviour:
--   Pure additive ALTER, three nullable columns. Zero impact on existing
--   readers/writers. Mig 176's LATERAL JOIN against legacy events still
--   functions identically; only adds new write target for mig 178 cutover.
--
-- Rollback:
--   ALTER TABLE events_v2
--     DROP COLUMN IF EXISTS period,
--     DROP COLUMN IF EXISTS minute,
--     DROP COLUMN IF EXISTS live_data;

BEGIN;

ALTER TABLE events_v2
  ADD COLUMN IF NOT EXISTS period    text,
  ADD COLUMN IF NOT EXISTS minute    int,
  ADD COLUMN IF NOT EXISTS live_data jsonb;

COMMENT ON COLUMN events_v2.period    IS 'Live period label (e.g. "2T", "Set 3"). Populated by FS-scraper push matcher.';
COMMENT ON COLUMN events_v2.minute    IS 'Live minute (football). NULL for non-football sports.';
COMMENT ON COLUMN events_v2.live_data IS 'Live merged state (halfScoreHome/Away, stats.clock, ...). Populated by FS-scraper push matcher.';

INSERT INTO _migrations (name, applied_at)
VALUES ('177_events_v2_live_columns', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;
