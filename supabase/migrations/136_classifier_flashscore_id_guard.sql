-- Migration 136: classify_event_source_only — flashscore_id global guard.
--
-- Bug: mig 135 R10 (Betfair Unknown no-cluster) checked canonical_id IS NULL
-- but NOT flashscore_id IS NULL. Result: 2137 events with flashscore_id
-- valid (mapped via regex/LLM directly to Flashscore) but no canonical_id
-- got flagged is_source_only=true — semantically contradictory and produces
-- coverage_among_mappable_pct > 100% in KPI L3 (105.1% observed).
--
-- Fix:
--   - Add early-return guard: if flashscore_id IS NOT NULL → not source_only.
--     This is universally true: flashscore_id presence is the definition of
--     "mapped". Applies to all rules R1..R10 retroactively.
--   - One-shot retroactive UPDATE to unflag events that were misflagged.
--
-- Idempotent: CREATE OR REPLACE.

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

  -- Mig 136 guard: events with flashscore_id are by definition NOT source-only.
  -- If a row was misflagged earlier, unflag it here so the engine self-heals.
  IF v_target.flashscore_id IS NOT NULL THEN
    IF v_target.is_source_only = true THEN
      UPDATE events SET is_source_only = false WHERE id = p_event_id;
    END IF;
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

  -- R1-R9 verbatim from mig 129
  IF v_target.home_team IN ('Home', 'Home (Special bets)')
     OR v_target.home_team LIKE '% +' THEN v_flag := true; END IF;

  IF NOT v_flag AND v_league_name ILIKE '%Alternative Matches%' THEN v_flag := true; END IF;

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
    THEN v_flag := true; END IF;
  END IF;

  IF NOT v_flag AND v_sport_name = 'Esports' AND v_league_name IS NOT NULL THEN
    IF v_league_name ILIKE 'Esports Battle%' OR v_league_name ILIKE 'eSports Battle%'
       OR v_league_name ILIKE 'Cyber Live Arena%' OR v_league_name ILIKE 'Cyber Football%'
       OR v_league_name ILIKE 'Cyber League%' OR v_league_name ILIKE 'FIFA.%'
       OR v_league_name ILIKE 'FIFA %' THEN v_flag := true; END IF;
  END IF;

  IF NOT v_flag AND v_sport_name = 'Boxe' AND v_league_name IS NOT NULL THEN
    IF v_league_name = 'Fights' OR v_league_name ILIKE 'Top Dog FC%'
       OR v_league_name ILIKE 'Boxing. Future Bouts%' THEN v_flag := true; END IF;
  END IF;

  IF NOT v_flag AND v_sport_name IN ('Arti Marziali', 'MMA') AND v_league_name IS NOT NULL THEN
    IF v_league_name = 'Prospective fights' OR v_league_name ILIKE 'Combatsport.%' THEN v_flag := true; END IF;
  END IF;

  IF NOT v_flag AND v_sport_name = 'MMA'
     AND v_league_name = 'Unknown' AND v_src_kind = 'betfair' THEN v_flag := true; END IF;

  IF NOT v_flag AND v_sport_name = 'Cricket'
     AND v_league_name = 'Unknown' AND v_src_kind IN ('betfair', '22bet') THEN v_flag := true; END IF;

  IF NOT v_flag AND v_sport_name = 'Pallamano'
     AND v_league_name IS NOT NULL AND v_league_name ILIKE '%. Women%'
     AND v_target.status = 'prematch'
     AND v_target.starts_at > now() + interval '60 days' THEN v_flag := true; END IF;

  -- R10 (mig 135): Betfair Unknown WITHOUT cross-source cluster.
  -- (flashscore_id check already done globally at top of function.)
  IF NOT v_flag
     AND v_src_kind = 'betfair'
     AND v_target.canonical_id IS NULL
     AND v_league_name IS NOT NULL
     AND (v_league_name = 'Unknown' OR v_league_name LIKE 'Unknown (%)') THEN
    v_flag := true;
  END IF;

  IF v_flag THEN
    UPDATE events SET is_source_only = true WHERE id = p_event_id;
  END IF;

  RETURN v_flag;
END;
$fn$;

COMMENT ON FUNCTION classify_event_source_only(uuid) IS
  'Sprint 3 Phase B+C+fix136: classifier with global flashscore_id guard. Rules R1-R10 (placeholder/Alternative/Setka/Esports/Boxe/MMA/Cricket/Pallamano/Betfair-Unknown-no-cluster). Mig 136 added the guard to prevent misflagging FS-mapped rows.';

GRANT EXECUTE ON FUNCTION classify_event_source_only(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- Retroactive unflag: clean up the existing 2137 misflagged events.
-- Direct UPDATE (faster than per-event RPC loop for this pure case).
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE v_unflagged int;
BEGIN
  WITH upd AS (
    UPDATE events
    SET is_source_only = false
    WHERE flashscore_id IS NOT NULL AND is_source_only = true
    RETURNING id
  )
  SELECT count(*) INTO v_unflagged FROM upd;
  RAISE NOTICE 'Mig 136 retroactive unflag: % events corrected (had flashscore_id but were is_source_only=true).', v_unflagged;
END $$;
