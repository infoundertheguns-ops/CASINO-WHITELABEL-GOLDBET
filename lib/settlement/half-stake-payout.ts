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
