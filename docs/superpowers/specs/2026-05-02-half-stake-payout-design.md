# Half-Stake Payout — Design Spec

**Date**: 2026-05-02
**Branch target**: `feature/plan-d-settlement-d1`
**Scope**: Restore half-stake payout precision for Asian Handicap quarter and Goal Line .25/.75 markets after S6 cutover collapsed them to full won/lost.

## Problem

Plan D classifier (commit `96c2071` of 6b extension) emits `half_won` and `half_lost` verdicts for split-line markets:

- **Asian Handicap quarter** (`.25` / `.75` lines, e.g. "Inter -0.25"): bet is split across two adjacent half-step lines. If one half wins and the other voids, verdict = `half_won`; if one loses and the other voids, verdict = `half_lost`.
- **Goal Line** (`.25` / `.75`, e.g. "Over 2.25"): same split mechanism via Asian total.

At the S6 cutover (2026-05-01), to avoid touching legacy schema, we wired the Plan D engine into legacy `settleEvent` via the adapter `planDVerdictToLegacy` (`lib/settlement.ts:1769`). That adapter **collapses**:

```
half_won  → won
half_lost → lost
```

This is mathematically wrong for real-money payout:

- Stake 10€, odds 2.0, verdict `half_won`: correct payout is 15€ (half stake at full odds + half stake refunded). We pay 20€. Player wins 5€ extra.
- Stake 10€, odds 2.0, verdict `half_lost`: correct payout is 5€ (half stake refunded). We pay 0€. Player loses 5€ extra.

In test mode (no real bettors) this is harmless. For real-money onboarding it is a blocker.

## What is already in place

- `bet_selections.result` is `TEXT NULL` with no CHECK constraint. The migration `001_initial_schema.sql:290,329` comment already lists `won, lost, void, half_won, half_lost` as anticipated values. **No DDL change required.**
- Classifier emits `half_won`/`half_lost` correctly (commit `96c2071`, fixture `tests/fixtures/settlement/score-only-60.json` covers split scenarios).
- The bet pipeline (`resolveBet` at `lib/settlement.ts:2005`) already aggregates legs into combo/sistema payouts.

## What is missing

1. **Adapter `planDVerdictToLegacy`** (`lib/settlement.ts:1769`): drop the collapse, pass `half_won`/`half_lost` through unchanged.
2. **Payout aggregation in `resolveBet`** (`lib/settlement.ts:2005-2042`): currently filters `result === "won"` and multiplies `odds_at_placement`. Does not understand half verdicts — `half_won` legs are silently dropped from the multiplication, `half_lost` legs do not trigger early-loss. Both lead to wrong payouts (or, worse, mark a bet `won` when one leg was `half_lost`).
3. **Test coverage** for combo/single bets containing half verdicts.

## Proposed change

### 3.1 Adapter (`lib/settlement.ts:1769-1782`)

Replace the switch with pass-through:

```ts
function planDVerdictToLegacy(v: PlanDVerdict | null): Verdict | null {
  return v; // PlanDVerdict superset of Verdict; bet_selections.result accepts all 5
}
```

Update the `Verdict` type alias used by legacy code so TypeScript accepts the wider union:

```ts
export type Verdict = "won" | "lost" | "void" | "half_won" | "half_lost";
```

(Hunt for any narrow `result === "won"` exhaustiveness checks introduced by this widening — fix surgically.)

### 3.2 Payout aggregation (`lib/settlement.ts:2005-2042`)

Replace the won/lost binary with **effective odds per leg**:

| Leg `result`  | Effective odds              | Notes                               |
| ------------- | --------------------------- | ----------------------------------- |
| `won`         | `odds_at_placement`         | unchanged                           |
| `half_won`    | `(odds_at_placement + 1)/2` | industry-standard half-stake at win |
| `void`        | `1.0`                       | leg removed from product            |
| `half_lost`   | `0.5`                       | half stake refunded                 |
| `lost`        | (early termination)         | bet is lost                         |
| `null`        | (wait)                      | unsettled                           |

Algorithm:

```
hasLost      = any leg.result === "lost"
allSettled   = every leg.result != null
allVoid      = allSettled && every leg.result === "void"

if hasLost:           bet = "lost",  payout = 0
elif !allSettled:     return null
elif allVoid:         bet = "void",  payout = stake (refund)
else:
  effOddsProduct = product over legs of effective_odds(leg)
  payout         = stake × effOddsProduct
  bet            = payout > stake ? "won" : payout == stake ? "void" : "lost"
                   (allow "won" even if payout == stake when at least one leg is "won";
                    edge case: all half_lost → payout = stake × 0.5^n ≤ stake → still bet status "lost")
```

The bet `status` enum on the parent `bets` row stays `won|lost|void` — we do not introduce `half_won` at bet level, only at leg level. The wallet just sees a numeric payout.

### 3.3 Tests

Add `tests/lib/settlement/resolveBet-half-stake.test.ts` covering:

- Single leg, `half_won` odds 2.0, stake 10 → payout 15
- Single leg, `half_lost`, stake 10 → payout 5
- Combo 2 legs, both `won` (2.0, 2.0), stake 10 → payout 40 (regression)
- Combo 2 legs, `won` 2.0 + `half_won` 2.0, stake 10 → payout 30 (10 × 2.0 × 1.5)
- Combo 2 legs, `won` 2.0 + `half_lost`, stake 10 → payout 10 (10 × 2.0 × 0.5)
- Combo 2 legs, `won` 2.0 + `void`, stake 10 → payout 20 (regression: void leg removed)
- Combo 2 legs, `won` 2.0 + `lost`, stake 10 → payout 0, status `lost` (regression)
- Sistema parent aggregation with at least one half verdict in a child combo

Mock `supabase` and `creditWallet`; assert payout numeric and status string.

## Out of scope

- **No new column** on `bet_selections`. The TEXT result column already accepts the 5 verdicts.
- **No migration**. (Optional follow-up: add CHECK constraint enforcing the 5 valid values + `null`. Not in this spec.)
- **No change to classifier**. 6b extension already correct.
- **No change to wallet ledger**. Payout is a single numeric value either way.
- **No retroactive recomputation** of bets settled in test mode under the collapse logic. Test-mode bets do not affect real money.
- **Sistema payout shading / partial bonus rules**: out of scope, existing `resolveParentBet` logic preserved.

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Widening `Verdict` union surfaces non-exhaustive switches elsewhere | TypeScript will fail compile on any `switch(verdict)` without default — fix surgically. |
| 2 | Rounding error on `(odds + 1)/2` for odd quote inputs | Use `parseFloat((value).toFixed(2))` consistently with existing code. |
| 3 | A consumer of `bet_selections.result` outside `lib/settlement.ts` assumes only won/lost/void | Grep call sites: `app/api/admin/sportsbook/route.ts:25,46` reads result for display only — display layer just needs to render the new strings. Verify. |
| 4 | Telegram alert says "SCOMMESSA VINTA" for any payout > 0; half-win should still alert | Keep current logic — alert fires when `betStatus === "won"`. With `half_won` legs, bet status can still be `won` if effOddsProduct > 1. Acceptable. |

## Acceptance criteria

- [ ] All existing settlement tests still pass (`npm test`).
- [ ] New `resolveBet-half-stake.test.ts` covers 8 scenarios above, all pass.
- [ ] Manual smoke: insert a synthetic bet with one `half_won` leg, run `resolveBet`, verify `bets.actual_win` matches expected formula and wallet credit is the right amount.
- [ ] `tsc` 0 errors.
- [ ] Git commit on `feature/plan-d-settlement-d1`, no push to origin until human review.

## Estimate

30-45 minutes implementation + tests, single session.
