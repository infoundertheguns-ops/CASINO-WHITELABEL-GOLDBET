# Half-Stake Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore per-leg precision for `half_won`/`half_lost` verdicts in bet payout aggregation, so Asian Handicap quarter and Goal Line .25/.75 markets pay the mathematically correct amount instead of being collapsed to full won/lost.

**Architecture:** Widen the legacy `Verdict` union, drop the lossy adapter collapse, extract two pure functions (`computeEffectiveOdds`, `aggregatePayout`) into a new module so logic is exhaustively unit-testable without supabase mocks, then thin out `resolveBet` so it's pure DB plumbing around the helpers.

**Tech Stack:** TypeScript, vitest, Next.js, Supabase JS client. Spec: `docs/superpowers/specs/2026-05-02-half-stake-payout-design.md`.

**Repo:** `/root/betssolution-admin/` on VPS `scraper-vps`. Branch: `feature/plan-d-settlement-d1` (HEAD `4932e7b` at plan write time).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/settlement.ts:78` | Modify | Widen legacy `Verdict` union to include `half_won \| half_lost` (keep existing `push` for back-compat) |
| `lib/settlement.ts:1769-1782` | Modify | `planDVerdictToLegacy` becomes pass-through (1-line return) |
| `lib/settlement.ts:1999-2070` | Modify | `resolveBet` delegates payout math to new helpers; always credits `payout` (drop the won-only and void-stake special cases) |
| `lib/settlement/half-stake-payout.ts` | Create | Pure helpers: `computeEffectiveOdds`, `aggregatePayout`, types |
| `tests/lib/settlement/half-stake-payout.test.ts` | Create | Unit tests for pure helpers, 8 spec scenarios + edge cases |

No new migrations. No DDL. No wallet ledger changes.

---

## Task 1: Widen legacy Verdict union

**Files:**
- Modify: `lib/settlement.ts:78`

- [ ] **Step 1: Read current Verdict definition**

```bash
ssh scraper-vps 'sed -n "75,82p" /root/betssolution-admin/lib/settlement.ts'
```

Expected output around line 78:
```ts
type Verdict = "won" | "lost" | "void" | "push";
```

- [ ] **Step 2: Widen the type to include half verdicts**

Edit `lib/settlement.ts` line 78. Change from:
```ts
type Verdict = "won" | "lost" | "void" | "push";
```
to:
```ts
type Verdict = "won" | "lost" | "void" | "push" | "half_won" | "half_lost";
```

(Keep `push` — used by markets like 1H/2H over .0 lines elsewhere in this file.)

- [ ] **Step 3: Run TypeScript compile to surface non-exhaustive switches**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx tsc --noEmit 2>&1 | head -40'
```

Expected: 0 errors OR errors only inside `lib/settlement.ts` from switches over `Verdict` that lack default branches. Note any locations.

- [ ] **Step 4: Fix any non-exhaustive switches**

For each location flagged in Step 3, add a `default:` branch that either re-throws (`throw new Error(\`unhandled verdict: \${v}\`)`) or returns a sensible neutral value (`return "void"`). Document the choice with a one-line comment.

- [ ] **Step 5: Re-run tsc to confirm clean**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx tsc --noEmit 2>&1 | tail -5'
```
Expected: no output (silent = success).

- [ ] **Step 6: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add lib/settlement.ts && git commit -m "refactor(settlement): widen legacy Verdict union for half_won/half_lost

Adds half_won and half_lost variants to the legacy Verdict type so the
Plan D adapter can stop collapsing them. Existing switches over Verdict
audited and updated where needed.

No runtime behavior change yet — adapter still collapses (next commit).

Refs spec docs/superpowers/specs/2026-05-02-half-stake-payout-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 2: Make planDVerdictToLegacy a pass-through

**Files:**
- Modify: `lib/settlement.ts:1763-1782`
- Test: `tests/lib/settlement/half-stake-payout.test.ts` (test added in Task 4; smoke this manually now)

- [ ] **Step 1: Read current adapter for context**

```bash
ssh scraper-vps 'sed -n "1763,1785p" /root/betssolution-admin/lib/settlement.ts'
```

- [ ] **Step 2: Replace switch body with pass-through return**

Edit `lib/settlement.ts:1769-1782`. Replace the function body so the result is:

```ts
/**
 * Map Plan D verdict to legacy Verdict.
 * Plan D Verdict (5 values) is now a subset of legacy Verdict (6 values incl. push).
 * Pass through unchanged — bet_selections.result column TEXT accepts all variants
 * (see migration 001_initial_schema.sql:290,329 comment).
 */
function planDVerdictToLegacy(v: PlanDVerdict | null): Verdict | null {
  return v;
}
```

- [ ] **Step 3: Run tsc**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx tsc --noEmit 2>&1 | tail -5'
```
Expected: no errors. (PlanDVerdict is now a structural subset of Verdict.)

- [ ] **Step 4: Run existing settlement test suite to verify no regression**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx vitest run tests/lib/settlement/ 2>&1 | tail -20'
```
Expected: all tests pass (current suite does not exercise half verdicts; this is a baseline check).

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add lib/settlement.ts && git commit -m "refactor(settlement): planDVerdictToLegacy pass-through

Drops the test-mode collapse of half_won → won and half_lost → lost.
The widened legacy Verdict type now accepts the Plan D union directly.

Note: resolveBet payout aggregation still treats these as won/lost
incorrectly — fixed in next commits via aggregatePayout helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 3: Create pure module with computeEffectiveOdds + table tests

**Files:**
- Create: `lib/settlement/half-stake-payout.ts`
- Create: `tests/lib/settlement/half-stake-payout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/settlement/half-stake-payout.test.ts` with this content:

```ts
import { describe, expect, test } from "vitest";
import { computeEffectiveOdds, type LegResult } from "@/lib/settlement/half-stake-payout";

describe("computeEffectiveOdds", () => {
  test.each<[LegResult, number, number]>([
    ["won",       2.0, 2.0],
    ["won",       1.5, 1.5],
    ["void",      2.0, 1.0],
    ["void",      5.0, 1.0],
    ["half_won",  2.0, 1.5],
    ["half_won",  3.0, 2.0],
    ["half_won",  1.5, 1.25],
    ["half_lost", 2.0, 0.5],
    ["half_lost", 5.0, 0.5],
  ])("%s leg with odds %d → effective %d", (result, odds, expected) => {
    expect(computeEffectiveOdds(result, odds)).toBeCloseTo(expected, 4);
  });

  test("lost leg throws (caller must short-circuit before calling)", () => {
    expect(() => computeEffectiveOdds("lost", 2.0)).toThrow(/lost/);
  });

  test("null result throws (caller must wait for settlement)", () => {
    expect(() => computeEffectiveOdds(null as unknown as LegResult, 2.0)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx vitest run tests/lib/settlement/half-stake-payout.test.ts 2>&1 | tail -10'
```
Expected: FAIL with "Cannot find module '@/lib/settlement/half-stake-payout'".

- [ ] **Step 3: Create minimal module to pass**

Create `lib/settlement/half-stake-payout.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx vitest run tests/lib/settlement/half-stake-payout.test.ts 2>&1 | tail -10'
```
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add lib/settlement/half-stake-payout.ts tests/lib/settlement/half-stake-payout.test.ts && git commit -m "feat(settlement): pure computeEffectiveOdds helper

New module lib/settlement/half-stake-payout.ts hosts pure payout math
extracted out of settlement.ts. computeEffectiveOdds maps a per-leg
verdict to its effective odds multiplier (half_won → (odds+1)/2,
half_lost → 0.5, void → 1.0). 11 unit tests (9 table + 2 throw).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 4: Add aggregatePayout pure function + 8 scenarios

**Files:**
- Modify: `lib/settlement/half-stake-payout.ts` (add function)
- Modify: `tests/lib/settlement/half-stake-payout.test.ts` (add scenarios)

- [ ] **Step 1: Write failing tests for aggregatePayout**

Append to `tests/lib/settlement/half-stake-payout.test.ts`:

```ts
import { aggregatePayout, type Leg } from "@/lib/settlement/half-stake-payout";

describe("aggregatePayout", () => {
  // Helper to make legs concise
  const leg = (result: LegResult | null, odds: number): Leg => ({ result, odds_at_placement: odds });

  test("any leg lost → bet lost, payout 0 (early termination)", () => {
    const r = aggregatePayout([leg("won", 2.0), leg("lost", 3.0)], 10);
    expect(r).toEqual({ status: "lost", payout: 0 });
  });

  test("any leg unsettled (null) and no leg lost → returns null (wait)", () => {
    const r = aggregatePayout([leg("won", 2.0), leg(null, 3.0)], 10);
    expect(r).toBeNull();
  });

  test("all void → bet void, payout = stake (refund)", () => {
    const r = aggregatePayout([leg("void", 2.0), leg("void", 3.0)], 10);
    expect(r).toEqual({ status: "void", payout: 10 });
  });

  // SPEC SCENARIOS (8 total):

  test("single leg half_won odds 2.0, stake 10 → payout 15", () => {
    const r = aggregatePayout([leg("half_won", 2.0)], 10);
    expect(r).toEqual({ status: "won", payout: 15 });
  });

  test("single leg half_lost, stake 10 → payout 5, status lost", () => {
    const r = aggregatePayout([leg("half_lost", 2.0)], 10);
    expect(r).toEqual({ status: "lost", payout: 5 });
  });

  test("combo: 2 legs both won (2.0, 2.0), stake 10 → payout 40 (regression)", () => {
    const r = aggregatePayout([leg("won", 2.0), leg("won", 2.0)], 10);
    expect(r).toEqual({ status: "won", payout: 40 });
  });

  test("combo: won 2.0 + half_won 2.0, stake 10 → payout 30", () => {
    const r = aggregatePayout([leg("won", 2.0), leg("half_won", 2.0)], 10);
    expect(r).toEqual({ status: "won", payout: 30 });
  });

  test("combo: won 2.0 + half_lost, stake 10 → payout 10, status void (net zero)", () => {
    const r = aggregatePayout([leg("won", 2.0), leg("half_lost", 3.0)], 10);
    expect(r).toEqual({ status: "void", payout: 10 });
  });

  test("combo: won 2.0 + void, stake 10 → payout 20 (regression: void leg removed)", () => {
    const r = aggregatePayout([leg("won", 2.0), leg("void", 3.0)], 10);
    expect(r).toEqual({ status: "won", payout: 20 });
  });

  test("combo: won 2.0 + lost, stake 10 → payout 0, status lost (regression)", () => {
    const r = aggregatePayout([leg("won", 2.0), leg("lost", 3.0)], 10);
    expect(r).toEqual({ status: "lost", payout: 0 });
  });

  test("combo: all half_lost, stake 10 → payout 2.5, status lost (edge case)", () => {
    const r = aggregatePayout([leg("half_lost", 2.0), leg("half_lost", 2.0)], 10);
    expect(r).toEqual({ status: "lost", payout: 2.5 });
  });

  test("payout rounded to 2 decimals", () => {
    const r = aggregatePayout([leg("half_won", 1.7)], 10);
    // (1.7+1)/2 = 1.35 → 10 × 1.35 = 13.5
    expect(r?.payout).toBe(13.5);
  });

  test("odds_at_placement accepts string (coerced) — DB returns NUMERIC as string", () => {
    const r = aggregatePayout(
      [{ result: "won", odds_at_placement: "2.5" as unknown as number }],
      10
    );
    expect(r).toEqual({ status: "won", payout: 25 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx vitest run tests/lib/settlement/half-stake-payout.test.ts 2>&1 | tail -15'
```
Expected: FAIL with "aggregatePayout is not exported".

- [ ] **Step 3: Implement aggregatePayout**

Append to `lib/settlement/half-stake-payout.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx vitest run tests/lib/settlement/half-stake-payout.test.ts 2>&1 | tail -15'
```
Expected: all tests pass (~24 total: 11 from Task 3 + 13 from Task 4).

- [ ] **Step 5: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add lib/settlement/half-stake-payout.ts tests/lib/settlement/half-stake-payout.test.ts && git commit -m "feat(settlement): aggregatePayout pure function + 13 scenario tests

Aggregates per-leg verdicts into final bet payout + status. Status rule
is purely numeric (payout vs stake), so won-leg + half_lost-leg netting
to break-even resolves to void (matches reviewer recommendation in spec).

Wallet credit always equals payout in all non-zero branches; caller
responsibility to write the wallet ledger entry.

13 tests: all 8 spec scenarios + early-lost + unsettled wait + all-void
+ all-half_lost edge + numeric coercion + rounding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 5: Refactor resolveBet to use aggregatePayout + always-credit-payout

**Files:**
- Modify: `lib/settlement.ts:1999-2070`

- [ ] **Step 1: Read current resolveBet**

```bash
ssh scraper-vps 'sed -n "1999,2075p" /root/betssolution-admin/lib/settlement.ts'
```

- [ ] **Step 2: Add import for aggregatePayout near other imports (line ~17)**

Edit `lib/settlement.ts`. After existing settlement-related imports (around line 17), add:
```ts
import { aggregatePayout } from "@/lib/settlement/half-stake-payout";
```

- [ ] **Step 3: Replace the body of resolveBet**

Find the `export async function resolveBet(...)` declaration around line 1999. Replace from the line `// Fetch all legs for this bet` through the line before `// If this is a child of a sistema bet` with:

```ts
  // Fetch all legs for this bet
  const { data: allLegs } = await supabase
    .from("bet_selections")
    .select("result, odds_at_placement")
    .eq("bet_id", betId);

  if (!allLegs) return null;

  // Fetch the bet itself (need stake/user before we can aggregate)
  const { data: bet } = await supabase
    .from("bets")
    .select("id, user_id, stake, potential_win, status, parent_bet_id")
    .eq("id", betId)
    .single();

  if (!bet || bet.status !== "open") return null;

  // Pure aggregation: returns null if waiting on more legs.
  const aggregated = aggregatePayout(
    allLegs.map((l) => ({ result: l.result as any, odds_at_placement: l.odds_at_placement })),
    Number(bet.stake)
  );
  if (aggregated === null) return null;

  const { status: betStatus, payout } = aggregated;

  // Persist bet outcome
  await supabase
    .from("bets")
    .update({
      status: betStatus,
      actual_win: payout,
      settled_at: new Date().toISOString(),
    })
    .eq("id", betId);

  // Wallet credit: always credit the numeric payout (zero is a no-op).
  // The bet status enum just labels the net outcome — the wallet sees money.
  if (payout > 0) {
    const ledgerType = betStatus === "won" ? "win" : betStatus === "void" ? "refund" : "partial_refund";
    await creditWallet(supabase, bet.user_id, betId, payout, ledgerType);
  }

  // Telegram alert only for net wins (status === "won")
  if (betStatus === "won") {
    const { data: winner } = await supabase.from("users").select("username").eq("id", bet.user_id).single();
    sendTelegramMessage(
      `🏆 <b>SCOMMESSA VINTA</b>\n👤 @${winner?.username || bet.user_id}\n💰 +€${payout.toFixed(2)} (stake: €${bet.stake})`
    ).catch(() => {});
  }
```

- [ ] **Step 4: Verify creditWallet signature accepts the new ledger types**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && grep -n "creditWallet\|partial_refund" lib/wallet*.ts lib/settlement.ts 2>/dev/null | head -10'
```

If `creditWallet` has a strict union for the type parameter that doesn't include `"partial_refund"`, either:
- (a) widen its signature in the wallet module, OR
- (b) reuse `"refund"` for the partial-refund case (simpler — wallet ledger doesn't need the distinction).

Pick (b) by default unless the wallet ledger has a downstream consumer (admin UI, reporting) that filters on type. Edit accordingly:

```ts
const ledgerType = betStatus === "won" ? "win" : "refund";
```

- [ ] **Step 5: Run full test suite**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx vitest run 2>&1 | tail -20'
```
Expected: all green. Note any failures — most likely candidates are settlement-touching tests that mocked the old shape.

- [ ] **Step 6: Run tsc**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx tsc --noEmit 2>&1 | tail -10'
```
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add lib/settlement.ts && git commit -m "refactor(settlement): resolveBet delegates payout to aggregatePayout

Replaces in-line won-only-multiplication with a call to the pure
aggregatePayout helper. Wallet credit collapses to a single rule:
always credit payout when payout > 0, ledger type derived from
final bet status.

Behavior change for half-stake bets:
  - half_won leg now contributes (odds+1)/2 to combo product
  - half_lost leg now contributes 0.5 (was: silent drop, ineffective payout)
  - won + half_lost netting to stake → status void (was: status won, full payout)

All 13 aggregatePayout unit tests cover these cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 6: Audit downstream readers of bet_selections.result

**Files:** read-only audit, may modify if non-display consumer found.

- [ ] **Step 1: Grep all readers**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && grep -rn "bet_selections.*result\|sel\.result\|\.result\s*===\s*[\"'\''](won\|lost\|void)" --include="*.ts" --include="*.tsx" app/ lib/ 2>/dev/null | grep -v "lib/settlement" | head -30'
```

Expected output: list of files. For each hit, classify as:
- **Display only** (rendering in JSX, formatting strings, sending to Telegram) → no change needed
- **State machine consumer** (switch on result to drive logic) → must handle `half_won`/`half_lost`

- [ ] **Step 2: For each non-display consumer, evaluate**

For each state-machine consumer found, decide:
- **Treat half_won as won** (display-style aggregation, e.g., counter of "winning bets") → add `|| "half_won"` to existing checks
- **Treat half_lost as lost** (similar) → add `|| "half_lost"` to existing checks
- **Bespoke handling needed** (e.g., admin UI shows per-leg result label) → add UI string for the new variants

Document each modification with a one-line comment.

- [ ] **Step 3: Re-run full test suite**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx vitest run 2>&1 | tail -10'
```
Expected: all green.

- [ ] **Step 4: Run tsc**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && npx tsc --noEmit 2>&1 | tail -5'
```
Expected: 0 errors.

- [ ] **Step 5: Commit (skip if no changes)**

If any non-display readers were modified:
```bash
ssh scraper-vps 'cd /root/betssolution-admin && git add -A && git commit -m "fix(consumers): handle widened bet_selections.result union

Audited all readers of bet_selections.result outside lib/settlement.ts.
Modified <N> downstream consumers to recognize half_won/half_lost.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

If audit revealed only display-only readers: skip commit, note finding in execution summary.

---

## Task 7: Manual smoke test (optional but recommended)

**Files:** none (DB query only).

- [ ] **Step 1: Insert a synthetic test bet via SQL**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && cat > /tmp/half-stake-smoke.sql << "EOF"
-- Find a test user (any user with wallet)
WITH test_user AS (SELECT id FROM users LIMIT 1)
-- Insert a bet with stake 10
INSERT INTO bets (id, user_id, stake, total_odds, potential_win, status, type)
SELECT gen_random_uuid(), test_user.id, 10, 1.5, 15, 'open', 'single'
FROM test_user
RETURNING id, user_id;
EOF
echo "(would run, but skip if you do not want to dirty prod DB)"'
```

This is a destructive action against the prod DB. **Only run if user explicitly approves** during execution.

Alternative non-destructive smoke: write a quick `tsx` script that imports `aggregatePayout` and runs it against synthesized inputs, prints the table.

- [ ] **Step 2: Build admin to verify no compile-time regression**

```bash
ssh scraper-vps 'source ~/.nvm/nvm.sh && cd /root/betssolution-admin && npm run build 2>&1 | tail -20'
```
Expected: build succeeds.

---

## Task 8: Final verification + summary

- [ ] **Step 1: Confirm all acceptance criteria from spec**

Verify:
- [ ] `npx vitest run` — all green
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm run build` — succeeds
- [ ] grep audit completed (Task 6)
- [ ] No push to origin yet (spec rule: "no push until human review")

- [ ] **Step 2: Show git log of new commits**

```bash
ssh scraper-vps 'cd /root/betssolution-admin && git log --oneline 4932e7b..HEAD'
```
Expected: 5-6 new commits (Task 1, 2, 3, 4, 5, optionally 6).

- [ ] **Step 3: Hand off to user for review**

Report to user:
- Number of new commits
- Branch HEAD SHA
- Test count delta
- Any non-display consumers modified in Task 6
- Whether smoke test (Task 7) was run, and result

Ask: "Ready to push to origin? Or any concerns to address first?"

---

## Out of scope (do not do)

- Push to origin (user opt-in only)
- Add CHECK constraint on `bet_selections.result` (separate optional follow-up)
- Modify classifier — already correct
- Modify wallet ledger schema
- Touch the player-facing repo
- Recompute historical bets settled in test mode
