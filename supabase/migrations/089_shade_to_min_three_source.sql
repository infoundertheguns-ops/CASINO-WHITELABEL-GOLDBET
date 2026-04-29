-- ============================================================
-- 089_shade_to_min_three_source.sql
--
-- Enables Betfair as a third source and introduces read-time
-- shade-to-min odds computation. Replaces the auto_suspend cron
-- (cron disabled separately via crontab edit in rollout task).
--
-- Safe to apply BEFORE frontend changes -- view is additive.
-- Target Postgres: 17.6 (verified prod 2026-04-22).
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1) Widen source CHECK constraints to allow 'betfair'
-- ----------------------------------------------------------------

ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_normalization_source_check;
ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_source_check
  CHECK (source = ANY (ARRAY['kambi'::text, '22bet'::text, 'betfair'::text]));

ALTER TABLE outcome_normalization
  DROP CONSTRAINT IF EXISTS outcome_normalization_source_check;
ALTER TABLE outcome_normalization
  ADD CONSTRAINT outcome_normalization_source_check
  CHECK (source = ANY (ARRAY['kambi'::text, '22bet'::text, 'betfair'::text]));

-- ----------------------------------------------------------------
-- 1b) Widen events.source generated expression to include 'betfair:%'
--     PG 17+ supports in-place ALTER COLUMN SET EXPRESSION AS.
--     Prod confirmed on 17.6 (2026-04-22).
-- ----------------------------------------------------------------

DO $$
DECLARE
  v_pg_version int;
BEGIN
  v_pg_version := current_setting('server_version_num')::int;

  IF v_pg_version >= 170000 THEN
    EXECUTE $SQL$
      ALTER TABLE events ALTER COLUMN source SET EXPRESSION AS (
        CASE
          WHEN external_id LIKE 'kambi:%'   THEN 'kambi'
          WHEN external_id LIKE 'leon:%'    THEN 'leon'
          WHEN external_id LIKE '22bet:%'   THEN '22bet'
          WHEN external_id LIKE 'betfair:%' THEN 'betfair'
          ELSE 'goldbet'
        END
      )
    $SQL$;
    RAISE NOTICE 'events.source generated expression updated in-place (PG17+)';
  ELSE
    -- Fallback for PG<17: drop+recreate (slow -- triggers table rewrite).
    -- Must also drop dependent views (v_consensus_latest from mig 086) CASCADE and
    -- recreate them afterwards; prod is on 17.6 so this branch is not expected to run.
    EXECUTE 'DROP VIEW IF EXISTS v_consensus_latest CASCADE';
    EXECUTE 'ALTER TABLE events DROP COLUMN source';
    EXECUTE $SQL$
      ALTER TABLE events ADD COLUMN source TEXT GENERATED ALWAYS AS (
        CASE
          WHEN external_id LIKE 'kambi:%'   THEN 'kambi'
          WHEN external_id LIKE 'leon:%'    THEN 'leon'
          WHEN external_id LIKE '22bet:%'   THEN '22bet'
          WHEN external_id LIKE 'betfair:%' THEN 'betfair'
          ELSE 'goldbet'
        END
      ) STORED
    $SQL$;
    RAISE NOTICE 'events.source generated expression recreated via DROP+ADD (PG<17). v_consensus_latest must be recreated by re-running mig 086 DDL.';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 2) Extend consensus_snapshots (backward compatible, columns nullable)
-- ----------------------------------------------------------------

ALTER TABLE consensus_snapshots
  ADD COLUMN IF NOT EXISTS betfair_event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS betfair_odds numeric;

-- ----------------------------------------------------------------
-- 3) Pure compute function (IMMUTABLE for planner optimization)
--
-- INVARIANT: this function must remain pure in its inputs. Any future change that
-- reads from current_timestamp, session vars, or other tables MUST change the
-- volatility marker to STABLE or VOLATILE.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_compute_displayed_odds(
  p_kambi_odds numeric, p_kambi_active boolean, p_kambi_suspended boolean,
  p_twobet_odds numeric, p_twobet_active boolean, p_twobet_suspended boolean,
  p_betfair_odds numeric, p_betfair_active boolean, p_betfair_suspended boolean,
  p_manual_odds numeric,
  p_canonical_verified boolean
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_available numeric[];
  v_min numeric; v_max numeric;
  v_spread numeric;
  v_primary numeric;
BEGIN
  IF p_manual_odds IS NOT NULL THEN RETURN p_manual_odds; END IF;

  v_available := ARRAY[]::numeric[];
  IF p_kambi_odds IS NOT NULL AND COALESCE(p_kambi_active, false) AND NOT COALESCE(p_kambi_suspended, false) THEN
    v_available := array_append(v_available, p_kambi_odds);
  END IF;
  IF p_twobet_odds IS NOT NULL AND COALESCE(p_twobet_active, false) AND NOT COALESCE(p_twobet_suspended, false) THEN
    v_available := array_append(v_available, p_twobet_odds);
  END IF;
  IF p_betfair_odds IS NOT NULL AND COALESCE(p_betfair_active, false) AND NOT COALESCE(p_betfair_suspended, false) THEN
    v_available := array_append(v_available, p_betfair_odds);
  END IF;

  IF array_length(v_available, 1) IS NULL THEN RETURN NULL; END IF;

  v_primary := COALESCE(
    CASE WHEN COALESCE(p_kambi_active,false)   AND NOT COALESCE(p_kambi_suspended,false)   THEN p_kambi_odds   END,
    CASE WHEN COALESCE(p_twobet_active,false)  AND NOT COALESCE(p_twobet_suspended,false)  THEN p_twobet_odds  END,
    CASE WHEN COALESCE(p_betfair_active,false) AND NOT COALESCE(p_betfair_suspended,false) THEN p_betfair_odds END
  );

  IF NOT COALESCE(p_canonical_verified, false) THEN RETURN v_primary; END IF;

  IF array_length(v_available, 1) = 1 THEN
    IF v_available[1] > 3.0 THEN
      RETURN ROUND(v_available[1] * 0.90, 2);
    ELSE
      RETURN v_available[1];
    END IF;
  END IF;

  SELECT MIN(x), MAX(x) INTO v_min, v_max FROM unnest(v_available) x;
  v_spread := (v_max / v_min) - 1;
  IF v_spread > 0.25 THEN RETURN v_min; END IF;
  RETURN v_primary;
END $$;

COMMENT ON FUNCTION fn_compute_displayed_odds IS
  'Pure read-time shade-to-min computation. Spec: docs/superpowers/specs/2026-04-22-shade-to-min-betfair-design.md section 5.';

-- ----------------------------------------------------------------
-- 4) v_outcomes_canonical -- resolution helper joining normalization tables
--
-- Joins outcomes -> markets -> events, plus LEFT JOINs to market_normalization
-- (source + source_market_type) and outcome_normalization (source + source_market_type
--  + source_outcome_name). Real column names verified against prod schema 2026-04-22.
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW v_outcomes_canonical AS
SELECT
  e.flashscore_id,
  e.sport_id,
  e.source,
  mn.canonical_key          AS market_canonical_key,
  mn.verified               AS market_canon_verified,
  onz.canonical_outcome_key,
  onz.verified              AS outcome_canon_verified,
  o.id                      AS outcome_id,
  o.odds,
  o.is_active,
  o.is_suspended,
  o.manual_odds,
  o.manual_suspended,
  m.id                      AS market_id,
  m.market_type             AS source_market_type,
  o.name                    AS source_outcome_name
FROM outcomes o
  JOIN markets m ON m.id = o.market_id
  JOIN events  e ON e.id = m.event_id
  LEFT JOIN market_normalization mn
    ON mn.source = e.source
   AND mn.source_market_type = m.market_type
  LEFT JOIN outcome_normalization onz
    ON onz.source = e.source
   AND onz.source_market_type = m.market_type
   AND onz.source_outcome_name = o.name
WHERE e.flashscore_id IS NOT NULL;

COMMENT ON VIEW v_outcomes_canonical IS
  'Per-source outcome rows with canonicalization resolved via market_normalization and outcome_normalization. Intermediate for v_outcomes_displayed.';

-- ----------------------------------------------------------------
-- 5) v_outcomes_displayed -- pivot per canonical group + compute
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW v_outcomes_displayed AS
WITH pivoted AS (
  SELECT
    flashscore_id,
    sport_id,
    market_canonical_key,
    canonical_outcome_key,

    MAX(odds)             FILTER (WHERE source='kambi')   AS kambi_odds,
    BOOL_OR(is_active)    FILTER (WHERE source='kambi')   AS kambi_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='kambi')   AS kambi_suspended,

    MAX(odds)             FILTER (WHERE source='22bet')   AS twobet_odds,
    BOOL_OR(is_active)    FILTER (WHERE source='22bet')   AS twobet_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='22bet')   AS twobet_suspended,

    MAX(odds)             FILTER (WHERE source='betfair') AS betfair_odds,
    BOOL_OR(is_active)    FILTER (WHERE source='betfair') AS betfair_active,
    BOOL_OR(is_suspended) FILTER (WHERE source='betfair') AS betfair_suspended,

    MAX(manual_odds)             AS manual_odds,
    BOOL_OR(manual_suspended)    AS manual_suspended,

    (BOOL_AND(COALESCE(market_canon_verified, false))
     AND BOOL_AND(COALESCE(outcome_canon_verified, false))
    ) AS canonical_verified,

    (ARRAY_AGG(outcome_id ORDER BY
       CASE source WHEN 'kambi' THEN 1 WHEN '22bet' THEN 2 WHEN 'betfair' THEN 3 ELSE 9 END
    ))[1] AS primary_outcome_id
  FROM v_outcomes_canonical
  WHERE market_canonical_key IS NOT NULL
    AND canonical_outcome_key IS NOT NULL
  GROUP BY flashscore_id, sport_id, market_canonical_key, canonical_outcome_key
)
SELECT
  p.*,
  fn_compute_displayed_odds(
    p.kambi_odds, p.kambi_active, p.kambi_suspended,
    p.twobet_odds, p.twobet_active, p.twobet_suspended,
    p.betfair_odds, p.betfair_active, p.betfair_suspended,
    p.manual_odds,
    p.canonical_verified
  ) AS displayed_odds
FROM pivoted p;

COMMENT ON VIEW v_outcomes_displayed IS
  'One row per canonical (flashscore_id, market_canonical_key, canonical_outcome_key) triple with per-source odds pivoted and displayed_odds computed. Player frontend reads this when system_config.shade_enabled=true.';

-- ----------------------------------------------------------------
-- 6) Feature flag in system_config (runtime toggle -- NOT a Next.js env var)
-- ----------------------------------------------------------------

INSERT INTO system_config (key, value, description)
VALUES (
  'shade_enabled',
  'false'::jsonb,
  'Enable shade-to-min on player frontend. When false, reads outcomes.odds (primary source). When true, reads v_outcomes_displayed.displayed_odds.'
)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------
-- 7) Supporting indexes (idempotent)
-- ----------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_market_normalization_lookup
  ON market_normalization(source, source_market_type);
CREATE INDEX IF NOT EXISTS idx_outcome_normalization_lookup
  ON outcome_normalization(source, source_market_type, source_outcome_name);
CREATE INDEX IF NOT EXISTS idx_events_flashscore_source
  ON events(flashscore_id, source) WHERE flashscore_id IS NOT NULL;

COMMIT;
