import { describe, it, expect } from "vitest";
import { propagate } from "@/lib/normalize/propagation";
import type { NormalizationRow } from "@/lib/normalize/types";

const KAMBI_VERIFIED: NormalizationRow = {
  source: "kambi",
  source_market_type: "Triple Chance",
  canonical_key: "triple_chance_ft",
  canonical_line: null,
  canonical_name_it: "Triple Chance",
  verified: true,
  extracted_by: "manual",
  confidence: 100,
  notes: null,
};

describe("propagate — literal-string strategy", () => {
  it("propagates from verified kambi row to unmapped 22bet row with same string", () => {
    const result = propagate({
      source: "22bet",
      source_market_type: "Triple Chance",
      verifiedRows: [KAMBI_VERIFIED],
    });
    expect(result).toEqual({
      canonical_key: "triple_chance_ft",
      canonical_line: null,
      canonical_name_it: "Triple Chance",
      confidence: 85,
      extracted_by: "propagation",
    });
  });

  it("returns null when no verified row matches literally", () => {
    const result = propagate({
      source: "22bet",
      source_market_type: "Another Market",
      verifiedRows: [KAMBI_VERIFIED],
    });
    expect(result).toBeNull();
  });

  it("does not propagate from unverified rows", () => {
    const unverified: NormalizationRow = { ...KAMBI_VERIFIED, verified: false };
    const result = propagate({
      source: "22bet",
      source_market_type: "Triple Chance",
      verifiedRows: [unverified],
    });
    expect(result).toBeNull();
  });

  it("skips self-source (would only match literally on itself)", () => {
    const result = propagate({
      source: "kambi",
      source_market_type: "Triple Chance",
      verifiedRows: [KAMBI_VERIFIED],
    });
    expect(result).toBeNull();
  });
});
