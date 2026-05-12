-- Migration 184 — recreate compute_event_liability against v2 schema.
--
-- Context: legacy version (mig 006) referenced outcomes/markets which were
-- dropped 2026-05-12 in big-bang DROP CASCADE (Sprint 4). RPC currently
-- raises "relation does not exist" at runtime — admin liability dashboard
-- + acceptance engine pre-checks are broken until this migration applies.
--
-- Schema diffs from legacy:
--   - outcomes.name        → outcomes_v2.outcome_key
--   - outcomes.max_liability → DROPPED (single-source post Plan D doesn't
--                              need per-outcome custom caps; all outcomes
--                              share config.acceptance.max_liability_per_outcome
--                              default 50000, resolved client-side)
--   - markets.name         → markets_v2.market_name
--   - markets.is_active    → DROPPED (no equivalent column on markets_v2;
--                              suspended state is now on outcomes_v2.is_suspended)
--   - outcomes.is_active   → preserved on outcomes_v2.is_active ✓
--
-- compute_outcome_liability (mig 006) is unchanged — it joins bet_selections +
-- bets which were recreated v2-shaped in mig 183 with same table names.
--
-- max_liability is returned as hardcoded 50000 matching config default. If
-- per-outcome caps return as a feature, ALTER outcomes_v2 ADD max_liability
-- and revert this RPC to read it.

BEGIN;

DROP FUNCTION IF EXISTS public.compute_event_liability(UUID);

CREATE OR REPLACE FUNCTION public.compute_event_liability(p_event_id UUID)
RETURNS TABLE(
    outcome_id   UUID,
    outcome_name TEXT,
    market_id    UUID,
    market_name  TEXT,
    liability    DECIMAL,
    max_liability DECIMAL,
    pct_used     DECIMAL
)
LANGUAGE SQL STABLE
AS $$
    SELECT
        o.id                                                    AS outcome_id,
        o.outcome_key                                           AS outcome_name,
        m.id                                                    AS market_id,
        m.market_name                                           AS market_name,
        compute_outcome_liability(o.id)                         AS liability,
        50000::DECIMAL                                          AS max_liability,
        ROUND(compute_outcome_liability(o.id) / 50000.0 * 100, 1) AS pct_used
    FROM public.outcomes_v2 o
    JOIN public.markets_v2 m ON m.id = o.market_id
    WHERE m.event_id = p_event_id
      AND o.is_active = TRUE
    ORDER BY compute_outcome_liability(o.id) DESC;
$$;

COMMENT ON FUNCTION public.compute_event_liability(UUID) IS
  'Per-outcome liability rollup for an event. Recreated 2026-05-12 against v2 schema '
  'post big-bang DROP CASCADE. max_liability returned as hardcoded 50000 (config default) '
  'since per-outcome custom caps were a 3-source-era feature dropped with outcomes legacy.';

COMMIT;
