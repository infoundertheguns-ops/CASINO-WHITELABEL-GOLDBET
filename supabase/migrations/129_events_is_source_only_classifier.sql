-- Migration 129: Sprint 3 Phase B — events.is_source_only boolean classifier.
--
-- Adds a structural flag to events that will *never* appear in Flashscore by
-- design (tennis tavolo russo, esports synthetic, "Alternative Matches"
-- placeholder leagues, prospective combat fights, pre-lineup placeholders).
-- This separates the L3 KPI denominator into:
--   - total_active_7d         (raw, including source_only)
--   - mappable_total          (= total - source_only)
--   - coverage_among_mappable_pct (the meaningful number)
--
-- See plan: docs/superpowers/plans/2026-04-27-sprint3-phase-b-is-source-only.md
--
-- Schema:
--   ALTER TABLE events ADD COLUMN is_source_only boolean NOT NULL DEFAULT false
--   CREATE INDEX idx_events_is_source_only ON events(is_source_only) WHERE true
--   (PG ≥11 instant — no rewrite.)
--
-- RPC:
--   classify_event_source_only(p_event_id uuid) RETURNS boolean
--   - Idempotent. If row already true → returns true without UPDATE.
--   - Otherwise applies rule pyramid (top-down, first true wins) and updates.
--   - Errors swallowed at caller level (engine integration is best-effort).
--
-- Rules are conservative — false negative (missing a source_only event) is
-- preferable to false positive (flagging a mappable real event, which would
-- exclude it from coverage and block future Flashscore matching attempts).
--
-- Rollback:
--   DROP FUNCTION classify_event_source_only(uuid);
--   DROP INDEX idx_events_is_source_only;
--   ALTER TABLE events DROP COLUMN is_source_only;

SET statement_timeout = '5min';
SET lock_timeout = '2min';

-- ═══════════════════════════════════════════════════════════════════
-- 1. Schema
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_source_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_events_is_source_only
  ON events(is_source_only)
  WHERE is_source_only = true;

COMMENT ON COLUMN events.is_source_only IS
  'Sprint 3 Phase B: true = evento strutturalmente non in Flashscore (tennis tavolo russo, esports synthetic, leghe Alternative Matches, fights prospective). Esclude dal denominatore "coverage tra mappabili". Set via classify_event_source_only RPC, conservativo (false negative > false positive).';

-- ═══════════════════════════════════════════════════════════════════
-- 2. Classifier RPC
-- ═══════════════════════════════════════════════════════════════════

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

  -- Idempotency: already flagged → no work.
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

  -- ─── Rule pyramid (top-down, first true wins) ───

  -- R1: Placeholder pre-lineup teams (Home / Home (Special bets) / "% +").
  IF v_target.home_team IN ('Home', 'Home (Special bets)')
     OR v_target.home_team LIKE '% +' THEN
    v_flag := true;
  END IF;

  -- R2: ANY sport, "Alternative Matches" pseudo-league suffix (22bet synthetic).
  IF NOT v_flag AND v_league_name ILIKE '%Alternative Matches%' THEN
    v_flag := true;
  END IF;

  -- R3: Tennis Tavolo russian/eastern circuits — never on Flashscore.
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

  -- R4: Esports — Flashscore copre solo top tier; il resto è source-only.
  -- Specifically named circuits + a default-true for any other Esports league.
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

  -- R5: Boxe minor circuits (Top Dog FC, generic "Fights", future bouts).
  IF NOT v_flag AND v_sport_name = 'Boxe' AND v_league_name IS NOT NULL THEN
    IF v_league_name = 'Fights'
       OR v_league_name ILIKE 'Top Dog FC%'
       OR v_league_name ILIKE 'Boxing. Future Bouts%'
    THEN
      v_flag := true;
    END IF;
  END IF;

  -- R6: MMA / Arti Marziali — prospective fights and Combatsport synthetic.
  IF NOT v_flag AND v_sport_name IN ('Arti Marziali', 'MMA') AND v_league_name IS NOT NULL THEN
    IF v_league_name = 'Prospective fights'
       OR v_league_name ILIKE 'Combatsport.%'
    THEN
      v_flag := true;
    END IF;
  END IF;

  -- R7: MMA Unknown league on betfair — Betfair Unknown bug + MMA non in FS by design.
  -- IMPORTANT: NOT extending this to Calcio/Tennis/Basket Unknown betfair (that's Phase C).
  IF NOT v_flag AND v_sport_name = 'MMA'
     AND v_league_name = 'Unknown'
     AND v_src_kind = 'betfair' THEN
    v_flag := true;
  END IF;

  -- R8: Cricket Unknown on betfair/22bet — minor cricket uncovered by Flashscore.
  IF NOT v_flag AND v_sport_name = 'Cricket'
     AND v_league_name = 'Unknown'
     AND v_src_kind IN ('betfair', '22bet') THEN
    v_flag := true;
  END IF;

  -- R9: Pallamano Women long-future — won't appear in FS until close to date.
  IF NOT v_flag AND v_sport_name = 'Pallamano'
     AND v_league_name IS NOT NULL
     AND v_league_name ILIKE '%. Women%'
     AND v_target.status = 'prematch'
     AND v_target.starts_at > now() + interval '60 days' THEN
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
  'Sprint 3 Phase B: classifies event as structurally not-in-Flashscore. Idempotent. Rules: placeholder teams, Alternative Matches, Setka/TT-Cup/Liga Pro etc, Esports named circuits, Boxe minor, MMA/Arti Marziali prospective + Combatsport, MMA betfair Unknown, Cricket betfair/22bet Unknown, Pallamano Women >60d. Conservative (Calcio/Tennis/Basket Unknown betfair stay unflagged — Phase C territory).';

GRANT EXECUTE ON FUNCTION classify_event_source_only(uuid) TO authenticated, service_role;
