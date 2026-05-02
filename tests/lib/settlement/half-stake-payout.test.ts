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

  // SPEC SCENARIOS:

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
