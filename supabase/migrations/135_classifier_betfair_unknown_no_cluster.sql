-- Migration 135: Sprint 3 Phase C — extend classify_event_source_only with R10
-- (Betfair Unknown without cross-source cluster).
--
-- Mig 129 R7 deliberately deferred: "NOT extending this to Calcio/Tennis/Basket
-- Unknown betfair (that's Phase C)". The original plan was a static map of
-- competitionId → league, but probe (scripts/db/probe-betfair-classifier-potential.mjs)
-- showed: of 2810 single-source Betfair Unknown active 7d, only 231 (8%) had a
-- team-similar non-betfair sibling. The remaining 2579 are structurally
-- Betfair-only (futures / exotic markets) — they belong in is_source_only by
-- the same logic as Setka Cup or Esports Battle.
--
-- R10 logic:
--   - external_id LIKE 'betfair:%'
--   - league_name IN ('Unknown' or matches 'Unknown (...)')
--   - canonical_id IS NULL (no sibling in kambi/22bet — would be mappable
--     otherwise via mig 134 propagation)
--   → is_source_only = true
--
-- The canonical_id check is critical: engine.ts stage 6 runs
-- assign_event_cross_source_canonical_id BEFORE stage 7 classify_source_only,
-- so by the time we evaluate R10 the canonical_id is fresh — events that
-- DO have a kambi/22bet sibling will have been clustered already and skip R10.
--
-- Side-effect: one-shot retroactive UPDATE flags the existing 2686 events.
-- Expected KPI L3 impact:
--   - source_only_flagged: 1045 → ~3730
--   - mappable_total: 6961 → ~4276
--   - coverage_among_mappable_pct: 63.0% → ~95%+
--
-- Idempotent: CREATE OR REPLACE.
-- Rollback: re-apply mig 129.

SET statement_timeout = '5min';
SET lock_timeout = '2min';

CREATE OR REPLACE FUNCTION classify_event_source_only(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_target events%ROWTYPE;
  v_sport_name text;
  v_league_name text;
  v_src_kind text;
  v_flag boolean := false;
BEGIN
  SELECT * INTO v_target FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_target.is_source_only = true THEN
    RETURN true;
  END IF;

  SELECT s.name INTO v_sport_name FROM sports s WHERE s.id = v_target.sport_id;
  SELECT l.name INTO v_league_name FROM leagues l WHERE l.id = v_target.league_id;

  v_src_kind := CASE
    WHEN v_target.external_id LIKE 'kambi:%'   THEN 'kambi'
    WHEN v_target.external_id LIKE '22bet:%'   THEN '22bet'
    WHEN v_target.external_id LIKE 'betfair:%' THEN 'betfair'
    ELSE 'unknown'
  END;

  -- R1: Placeholder teams.
  IF v_target.home_team IN ('Home', 'Home (Special bets)')
     OR v_target.home_team LIKE '% +' THEN
    v_flag := true;
  END IF;

  -- R2: Alternative Matches.
  IF NOT v_flag AND v_league_name ILIKE '%Alternative Matches%' THEN
    v_flag := true;
  END IF;

  -- R3: Tennis Tavolo russian/eastern circuits.
  IF NOT v_flag AND v_sport_name = 'Tennis Tavolo' AND v_league_name IS NOT NULL THEN
    IF v_league_name = 'Setka Cup'
       OR v_league_name LIKE 'Setka Cup.%'
       OR v_league_name LIKE 'TT-Cup.%'
       OR v_league_name = 'TT-Cup'
       OR v_league_name = 'Liga Pro'
       OR v_league_name = 'Pro League'
       OR v_league_name LIKE 'Pro League.%'
       OR v_league_name LIKE 'Masters. Russia%'
       OR v_league_name LIKE 'Masters. Poland%'
       OR v_league_name LIKE 'Masters. Czech%'
       OR v_league_name = 'Czech Liga Pro'
    THEN
      v_flag := true;
    END IF;
  END IF;

  -- R4: Esports.
  IF NOT v_flag AND v_sport_name = 'Esports' AND v_league_name IS NOT NULL THEN
    IF v_league_name ILIKE 'Esports Battle%'
       OR v_league_name ILIKE 'eSports Battle%'
       OR v_league_name ILIKE 'Cyber Live Arena%'
       OR v_league_name ILIKE 'Cyber Football%'
       OR v_league_name ILIKE 'Cyber League%'
       OR v_league_name ILIKE 'FIFA.%'
       OR v_league_name ILIKE 'FIFA %'
    THEN
      v_flag := true;
    END IF;
  END IF;

  -- R5: Boxe minor.
  IF NOT v_flag AND v_sport_name = 'Boxe' AND v_league_name IS NOT NULL THEN
    IF v_league_name = 'Fights'
       OR v_league_name ILIKE 'Top Dog FC%'
       OR v_league_name ILIKE 'Boxing. Future Bouts%'
    THEN
      v_flag := true;
    END IF;
  END IF;

  -- R6: MMA prospective.
  IF NOT v_flag AND v_sport_name IN ('Arti Marziali', 'MMA') AND v_league_name IS NOT NULL THEN
    IF v_league_name = 'Prospective fights'
       OR v_league_name ILIKE 'Combatsport.%'
    THEN
      v_flag := true;
    END IF;
  END IF;

  -- R7: MMA Unknown betfair.
  IF NOT v_flag AND v_sport_name = 'MMA'
     AND v_league_name = 'Unknown'
     AND v_src_kind = 'betfair' THEN
    v_flag := true;
  END IF;

  -- R8: Cricket Unknown betfair/22bet.
  IF NOT v_flag AND v_sport_name = 'Cricket'
     AND v_league_name = 'Unknown'
     AND v_src_kind IN ('betfair', '22bet') THEN
    v_flag := true;
  END IF;

  -- R9: Pallamano Women long-future.
  IF NOT v_flag AND v_sport_name = 'Pallamano'
     AND v_league_name IS NOT NULL
     AND v_league_name ILIKE '%. Women%'
     AND v_target.status = 'prematch'
     AND v_target.starts_at > now() + interval '60 days' THEN
    v_flag := true;
  END IF;

  -- ─── R10 (Sprint 3 Phase C, mig 135): Betfair Unknown WITHOUT cross-source cluster ───
  -- Probe: 2579 of 2810 single-source Betfair Unknown have no team-similar sibling.
  -- These are futures / exotic markets that only Betfair carries — by definition
  -- not in Flashscore. The canonical_id IS NULL guard ensures we don't flag
  -- events that ARE clustered (those would be recoverable via mig 134 propagation).
  IF NOT v_flag
     AND v_src_kind = 'betfair'
     AND v_target.canonical_id IS NULL
     AND v_league_name IS NOT NULL
     AND (v_league_name = 'Unknown' OR v_league_name LIKE 'Unknown (%)') THEN
    v_flag := true;
  END IF;

  -- ─── Persist ───
  IF v_flag THEN
    UPDATE events SET is_source_only = true WHERE id = p_event_id;
  END IF;

  RETURN v_flag;
END;
$fn$;

COMMENT ON FUNCTION classify_event_source_only(uuid) IS
  'Sprint 3 Phase B+C: classifies event as structurally not-in-Flashscore. Idempotent. Rules: placeholder teams, Alternative Matches, Setka/TT-Cup/Liga Pro etc, Esports named circuits, Boxe minor, MMA/Arti Marziali prospective + Combatsport, MMA betfair Unknown, Cricket betfair/22bet Unknown, Pallamano Women >60d, Betfair Unknown without cross-source cluster (R10, Phase C).';

GRANT EXECUTE ON FUNCTION classify_event_source_only(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- Retroactive backfill: apply R10 to existing population.
-- Uses the new RPC iteratively to keep behaviour consistent with engine runs.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_event_id uuid;
  v_flagged int := 0;
BEGIN
  FOR v_event_id IN
    SELECT e.id
    FROM events e
    JOIN leagues l ON l.id = e.league_id
    WHERE e.external_id LIKE 'betfair:%'
      AND e.status IN ('prematch', 'live')
      AND e.starts_at > now() - interval '7 days'
      AND e.canonical_id IS NULL
      AND e.is_source_only = false
      AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  LOOP
    IF classify_event_source_only(v_event_id) THEN
      v_flagged := v_flagged + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Mig 135 retroactive: % events newly flagged is_source_only=true via R10.', v_flagged;
END $$;
