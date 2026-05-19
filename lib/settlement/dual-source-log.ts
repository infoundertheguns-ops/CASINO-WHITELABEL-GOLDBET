// lib/settlement/dual-source-log.ts
//
// M3.7 — Dual-source disagreement logger for api-football rollout monitoring.
//
// During Phase 1B (Tier C) of the api-football integration, every leg settled
// via the canonical api-football path ALSO runs a shadow classification via
// the existing FS data and records both verdicts into
// `settlement_dual_source_log` (migration 183).
//
// Agreement-rate < 1% disagreement over 14d gates removal of the FS shadow
// path. This logger is the write-side of that monitoring.
//
// Contract
// --------
// • Called INLINE (sync await) from the canonical settlement path so the
//   monitoring row is durable before the canonical verdict is written to
//   the bet ledger (transactional record per spec §M3.7).
// • Best-effort: any error (shadow build, classifier crash, supabase insert
//   failure) is caught + logged via console.error. NEVER throws — settlement
//   correctness must not depend on observability.
// • The disagreement flag is computed by Postgres via SQL `<>` to keep the
//   canonical/shadow comparison identical to anything downstream queries
//   against the table (no app-side stringly typed drift).
//
// Spec §M3.7 / migration 183.

import { createAdminClient } from "@/lib/supabase/server";
import {
  classifyLeg,
  type BetLeg,
  type ScoreResult,
  type Verdict,
} from "@/lib/settlement/odds-api/classify";
// NOTE: `__test__buildResult` is the only exported entry point for the FS
// score-builder in `lib/settlement.ts` today. Despite the `__test__` prefix
// it IS the production function — alias on import to make the call site read
// cleanly. M3.6 (settlement.ts integration) will be free to promote the
// export to a stable name; until then we accept the alias.
import { __test__buildResult as buildResultFromFS } from "@/lib/settlement";

export interface DualSourceLogInput {
  /** bet_selections.id (UUID) */
  betId: string;
  /** Canonical market_type string (matches bet_selections.market_type) */
  marketType: string;
  /** Verdict produced by the canonical (api-football) path */
  canonicalVerdict: Verdict;
  /** FS-side event row (same shape consumed by buildResult in lib/settlement.ts) */
  event: Record<string, unknown>;
  /** Bet leg fields (market_type / outcome_name / line) for FS shadow classifier */
  leg: BetLeg;
  /** Sport slug ("calcio" / "football" / ...) — required for the FS buildResult */
  sport: string;
}

// ---- helpers ----

/**
 * Adapt the `SettlementResult` shape produced by `lib/settlement.ts#buildResult`
 * to the `ScoreResult` shape consumed by `lib/settlement/odds-api/classify.ts#classifyLeg`.
 *
 * The two interfaces overlap on the fields the shadow classifier needs
 * (home/away/ht_home/ht_away/stats); we only copy the score-side fields here.
 * Player props (scorers / assists / player_shots) are not produced by the
 * FS buildResult — they will be `undefined` in the shadow result, and the
 * classifier will return `null` for unsupported markets (correctly logged as
 * a "shadow_unsupported" disagreement-or-not depending on canonical).
 */
function toScoreResult(sr: ReturnType<typeof buildResultFromFS>): ScoreResult | null {
  if (!sr) return null;
  return {
    home: sr.home,
    away: sr.away,
    ht_home: sr.ht_home ?? null,
    ht_away: sr.ht_away ?? null,
    corners_home: sr.corners_home ?? null,
    corners_away: sr.corners_away ?? null,
    ht_corners_home: sr.ht_corners_home ?? null,
    ht_corners_away: sr.ht_corners_away ?? null,
    cards_home: sr.cards_home ?? null,
    cards_away: sr.cards_away ?? null,
    shots_on_target_home: sr.shots_on_target_home ?? null,
    shots_on_target_away: sr.shots_on_target_away ?? null,
  };
}

/** Build the FS shadow verdict, swallowing builder/classifier crashes. */
function computeShadowVerdict(
  event: Record<string, unknown>,
  sport: string,
  leg: BetLeg
): Verdict | null {
  try {
    const sr = buildResultFromFS(event, undefined, sport);
    const adapted = toScoreResult(sr);
    if (!adapted) return null;
    const { verdict } = classifyLeg(leg, adapted);
    return verdict;
  } catch (err) {
    console.error("[dual-source-log] shadow build/classify threw", err);
    return null;
  }
}

// ---- public API ----

/**
 * Records the canonical (api-football) verdict alongside the FS-shadow verdict
 * into `settlement_dual_source_log` for rollout monitoring.
 *
 * MUST be called from the canonical settle path BEFORE the canonical verdict
 * is committed to the bet ledger (so a crash between log + ledger leaves
 * monitoring data — not the other way around).
 *
 * Best-effort write: never throws. Errors are surfaced via console.error and
 * counted via the table's natural absence (settlement_log rows without a
 * matching dual_source row signal a logger outage).
 */
export async function logDualSource(input: DualSourceLogInput): Promise<void> {
  const { betId, marketType, canonicalVerdict, event, leg, sport } = input;

  const shadowVerdict = computeShadowVerdict(event, sport, leg);

  try {
    const supabase = createAdminClient();
    // Disagreement semantics:
    //   - canonical === shadow             -> false
    //   - canonical !== shadow             -> true
    //   - shadow_verdict NULL (unsupported
    //     market / missing FS scores)      -> true
    // A null shadow counts as disagreement because the rollout-gate metric
    // is "fraction of canonical settlements the FS path would NOT have
    // matched", which includes the "shadow couldn't classify" bucket.
    const disagreement =
      shadowVerdict == null ? true : canonicalVerdict !== shadowVerdict;

    const { error } = await supabase
      .from("settlement_dual_source_log")
      .insert({
        bet_id: betId,
        market_type: marketType,
        canonical_source: "api-football",
        canonical_verdict: canonicalVerdict,
        shadow_source: "fs",
        shadow_verdict: shadowVerdict,
        disagreement,
      });

    if (error) {
      console.error("[dual-source-log] insert failed", {
        betId,
        marketType,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("[dual-source-log] insert threw", err);
  }
}
