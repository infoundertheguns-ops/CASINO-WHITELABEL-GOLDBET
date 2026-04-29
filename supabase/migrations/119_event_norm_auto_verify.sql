-- ═══════════════════════════════════════════════════
-- Migration 119: event_normalization auto-verify infrastructure
--
-- Adds:
--   * event_normalization.llm_verify boolean — captures the LLM's self-verify
--     flag (separate from `verified`, which is the final ground-truth label).
--     llm_verify=true means LLM declared "operator would confirm without
--     hesitation"; combined with confidence>=0.95 → engine auto-verifies.
--   * RPC retroactive_auto_verify_event_norm(p_threshold) — runs the same
--     UPDATE as the recurring cron, callable from UI button + scheduled job.
--   * Index on (verified, confidence, match_stage) for the cron's WHERE clause.
--
-- Backfill: existing rows get llm_verify=NULL (unknown). The retro UPDATE
-- ignores LLM stage entries by design — the verify flag is unknown for old
-- rows, so we conservatively leave them in pending review.
-- ═══════════════════════════════════════════════════

-- -----------------------------------------------------
-- 119.1 — llm_verify column
-- -----------------------------------------------------

ALTER TABLE event_normalization
  ADD COLUMN IF NOT EXISTS llm_verify boolean;

COMMENT ON COLUMN event_normalization.llm_verify IS
  'LLM self-verify flag: true = LLM declared "operator would confirm without hesitation". Paired with confidence>=0.95 as dual gate for auto-verify on stage=llm. NULL for non-LLM rows or pre-mig 119 LLM rows.';

-- -----------------------------------------------------
-- 119.2 — Performance index for retroactive cron WHERE clause
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_event_norm_unverified_high_conf
  ON event_normalization(match_stage, confidence)
  WHERE NOT verified AND flashscore_id IS NOT NULL AND confidence >= 0.95;

-- -----------------------------------------------------
-- 119.3 — retroactive_auto_verify_event_norm RPC
--
-- Runs the same idempotent UPDATE as the cron. Callable from:
--   * Admin UI button (/admin/event-normalization "Auto-verify retroattivo")
--   * scraper-vps cron */30 min (recurring drift catch-up)
--   * One-shot ops scripts
--
-- Returns affected count + per-stage breakdown so the UI can show preview/result.
--
-- Stages eligible for retro auto-verify:
--   regex, trigram, alias_dict, propagation, flashscore_native
--
-- Excluded from retro (engine handles inline going forward):
--   llm  — needs llm_verify=true dual gate; old rows have llm_verify=NULL
--   manual — already verified by definition (verified=true at insert)
--   unmapped — no flashscore_id
--
-- p_threshold defaults to 0.97 (matches AUTO_VERIFY_THRESHOLDS for stages with
-- numeric threshold). Caller can pass 0.0 to verify even propagation/native
-- (those have always-verify policy in the engine but may need a sweep too).
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION retroactive_auto_verify_event_norm(
  p_threshold numeric DEFAULT 0.97,
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE(
  total_affected bigint,
  by_stage jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_breakdown jsonb;
  v_total bigint;
BEGIN
  -- Compute per-stage breakdown of what WOULD be affected
  SELECT
    jsonb_object_agg(match_stage, n),
    sum(n)
  INTO v_breakdown, v_total
  FROM (
    SELECT match_stage, count(*)::bigint AS n
    FROM event_normalization
    WHERE NOT verified
      AND flashscore_id IS NOT NULL
      AND confidence >= p_threshold
      AND match_stage IN ('regex','trigram','alias_dict','propagation','flashscore_native')
    GROUP BY match_stage
  ) s;

  IF p_dry_run THEN
    RETURN QUERY SELECT coalesce(v_total, 0::bigint), coalesce(v_breakdown, '{}'::jsonb);
    RETURN;
  END IF;

  UPDATE event_normalization
  SET verified = true,
      verified_at = now(),
      verified_by = NULL
  WHERE NOT verified
    AND flashscore_id IS NOT NULL
    AND confidence >= p_threshold
    AND match_stage IN ('regex','trigram','alias_dict','propagation','flashscore_native');

  RETURN QUERY SELECT coalesce(v_total, 0::bigint), coalesce(v_breakdown, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION retroactive_auto_verify_event_norm IS
  'Idempotent retroactive auto-verify for event_normalization. Flips verified=true on stage IN (regex,trigram,alias_dict,propagation,flashscore_native) with confidence>=p_threshold (default 0.97). LLM stage excluded (needs llm_verify dual gate, applied inline by engine). p_dry_run=true returns counts without UPDATE — used by UI preview.';

GRANT EXECUTE ON FUNCTION retroactive_auto_verify_event_norm(numeric, boolean) TO anon, authenticated, service_role;

-- -----------------------------------------------------
-- 119.4 — event_norm_verified_breakdown RPC (KPI card support)
--
-- Returns auto vs manual verified counts per stage, used by the
-- event-normalization page KPI split.
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION event_norm_verified_breakdown()
RETURNS TABLE(
  match_stage text,
  total_mapped bigint,
  auto_verified bigint,
  human_verified bigint,
  unverified bigint,
  avg_confidence numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    en.match_stage,
    count(*)::bigint AS total_mapped,
    count(*) FILTER (WHERE en.verified AND en.verified_by IS NULL)::bigint AS auto_verified,
    count(*) FILTER (WHERE en.verified AND en.verified_by IS NOT NULL)::bigint AS human_verified,
    count(*) FILTER (WHERE NOT en.verified)::bigint AS unverified,
    round(avg(en.confidence)::numeric, 4) AS avg_confidence
  FROM event_normalization en
  WHERE en.flashscore_id IS NOT NULL
    AND en.match_stage <> 'unmapped'
  GROUP BY en.match_stage
  ORDER BY total_mapped DESC;
$$;

COMMENT ON FUNCTION event_norm_verified_breakdown IS
  'Per-stage breakdown for the Verificati KPI split: auto (verified_by NULL) vs human (verified_by IS NOT NULL). Powers the event-normalization page sub-text.';

GRANT EXECUTE ON FUNCTION event_norm_verified_breakdown() TO anon, authenticated, service_role;
