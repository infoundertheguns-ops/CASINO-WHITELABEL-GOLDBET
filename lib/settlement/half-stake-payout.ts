/**
 * Pure helpers for half-stake bet payout aggregation.
 *
 * Plan D classifier emits half_won / half_lost verdicts for split-line
 * markets (Asian Handicap quarter, Goal Line .25/.75). These helpers convert
 * per-leg verdicts into effective odds, then aggregate them into a final
 * bet payout and status. No database access; no side effects.
 *
 * Spec: docs/superpowers/specs/2026-05-02-half-stake-payout-design.md
 */

export type LegResult = "won" | "lost" | "void" | "half_won" | "half_lost";
export type BetStatus = "won" | "lost" | "void";

/**
 * Effective odds table:
 *   won       → odds (full payout)
 *   half_won  → (odds + 1) / 2 (industry standard half-stake at win)
 *   void      → 1.0 (leg removed from product)
 *   half_lost → 0.5 (half stake refunded)
 *   lost      → caller must short-circuit; throws.
 */
export function computeEffectiveOdds(result: LegResult, odds: number): number {
  switch (result) {
    case "won":       return odds;
    case "half_won":  return (odds + 1) / 2;
    case "void":      return 1.0;
    case "half_lost": return 0.5;
    case "lost":
      throw new Error("computeEffectiveOdds called on a lost leg — caller must short-circuit");
    default:
      throw new Error(`computeEffectiveOdds: unhandled leg result ${result}`);
  }
}

export interface Leg {
  result: LegResult | null;
  odds_at_placement: number | string; // Supabase NUMERIC may arrive as string
}

export interface AggregateResult {
  status: BetStatus;
  payout: number;
}

/**
 * Aggregate per-leg results into a final bet payout.
 *
 * Returns null if any leg is unsettled and none is lost (caller waits).
 * Returns AggregateResult when terminal:
 *   - any leg lost           → status "lost", payout 0
 *   - all legs void          → status "void", payout = stake (refund)
 *   - otherwise              → payout = stake × Π effectiveOdds(leg)
 *                              status purely from payout vs stake:
 *                                payout > stake → "won"
 *                                payout < stake → "lost"  (player still credited payout)
 *                                payout == stake → "void"
 *
 * Wallet credit equals payout in all branches (caller responsibility).
 */
export function aggregatePayout(legs: Leg[], stake: number): AggregateResult | null {
  const hasLost = legs.some((l) => l.result === "lost");
  if (hasLost) return { status: "lost", payout: 0 };

  const anyUnsettled = legs.some((l) => l.result == null);
  if (anyUnsettled) return null;

  const allVoid = legs.every((l) => l.result === "void");
  if (allVoid) return { status: "void", payout: stake };

  const effProduct = legs.reduce((acc, l) => {
    const odds = parseFloat(String(l.odds_at_placement));
    return acc * computeEffectiveOdds(l.result as LegResult, odds);
  }, 1);

  const payout = parseFloat((stake * effProduct).toFixed(2));

  let status: BetStatus;
  if (payout > stake)      status = "won";
  else if (payout < stake) status = "lost";
  else                     status = "void";

  return { status, payout };
}
