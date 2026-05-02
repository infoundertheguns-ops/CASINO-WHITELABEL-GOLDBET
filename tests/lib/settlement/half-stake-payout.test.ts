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
