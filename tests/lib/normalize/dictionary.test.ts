import { describe, it, expect } from "vitest";
import { lookupDictionary } from "@/lib/normalize/dictionary";
import type { CanonicalMarket } from "@/lib/normalize/types";

const CANONICALS: CanonicalMarket[] = [
  { canonical_key: "1x2_ft",   base_key: "1x2",   period: "ft", canonical_name_it: "1X2",             has_line: false, outcomes: [] },
  { canonical_key: "dnb_ft",   base_key: "dnb",   period: "ft", canonical_name_it: "Draw No Bet",     has_line: false, outcomes: [] },
  { canonical_key: "gg_ng_ft", base_key: "gg_ng", period: "ft", canonical_name_it: "Goal/No Goal",    has_line: false, outcomes: [] },
];

describe("lookupDictionary — 22bet", () => {
  it("returns canonical_key when twobet_market_groups exact-matches name_it", () => {
    const twobetGroups = [{ twobet_g: 1, name_it: "1x2" }];
    const result = lookupDictionary({
      source: "22bet",
      source_market_type: "1X2",
      canonicals: CANONICALS,
      twobetGroups,
    });
    expect(result).toEqual({
      canonical_key: "1x2_ft",
      canonical_line: null,
      canonical_name_it: "1X2",
      confidence: 90,
      extracted_by: "dictionary",
    });
  });

  it("returns null when no dictionary match", () => {
    const result = lookupDictionary({
      source: "22bet",
      source_market_type: "Mercato Esotico",
      canonicals: CANONICALS,
      twobetGroups: [],
    });
    expect(result).toBeNull();
  });
});

describe("lookupDictionary — kambi", () => {
  it("maps italianized Kambi string 'Draw No Bet' to dnb_ft", () => {
    const result = lookupDictionary({
      source: "kambi",
      source_market_type: "Draw No Bet",
      canonicals: CANONICALS,
      twobetGroups: [],
    });
    expect(result).toEqual({
      canonical_key: "dnb_ft",
      canonical_line: null,
      canonical_name_it: "Draw No Bet",
      confidence: 90,
      extracted_by: "dictionary",
    });
  });

  it("returns null for unknown Kambi string", () => {
    const result = lookupDictionary({
      source: "kambi",
      source_market_type: "Unknown Market",
      canonicals: CANONICALS,
      twobetGroups: [],
    });
    expect(result).toBeNull();
  });
});
