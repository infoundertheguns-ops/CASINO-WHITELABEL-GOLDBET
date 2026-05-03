import { describe, it, expect } from "vitest";
import { categorizeMarketsV2 } from "@/lib/market-categorizer-v2";

const mkMarket = (id: string, marketType: string, line: number | null = null) => ({
  id, market_type: marketType, line, outcomes: [],
});

describe("categorizeMarketsV2", () => {
  it("dispatches 1X2 to Principali tab", () => {
    const markets = [mkMarket("m1", "1X2")];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    expect(result.markets.find(m => m.market_type === "1X2")).toBeTruthy();
  });

  it("groups U/O multi-line variants into Gol/U/O tab @picker", () => {
    const markets = [
      mkMarket("m1", "U/O", 1.5),
      mkMarket("m2", "U/O", 2.5),
      mkMarket("m3", "U/O", 3.5),
    ];
    const result = categorizeMarketsV2(markets, "calcio", "Gol/U/O");
    const uoGroup = result.groupedMarkets.get("U/O@picker");
    expect(uoGroup?.length).toBe(3);
  });

  it("U/O@2.5 in Principali keeps only line 2.5", () => {
    const markets = [
      mkMarket("m1", "U/O", 1.5),
      mkMarket("m2", "U/O", 2.5),
      mkMarket("m3", "U/O", 3.5),
    ];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    const uo = result.markets.find(m => m.market_type === "U/O");
    expect(uo?.line).toBe(2.5);
  });

  it("U/O@2.5 falls back to closest if 2.5 missing", () => {
    const markets = [mkMarket("m1", "U/O", 2.0), mkMarket("m2", "U/O", 3.0)];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    const uo = result.markets.find(m => m.market_type === "U/O");
    expect([2.0, 3.0]).toContain(uo?.line);
  });

  it("supports sub-pill filtering for Tempi", () => {
    const markets = [
      mkMarket("m1", "1X2 - 1T"),
      mkMarket("m2", "1X2 - 2T"),
      mkMarket("m3", "HT/FT"),
    ];
    const r1 = categorizeMarketsV2(markets, "calcio", "Tempi", "1° Tempo");
    expect(r1.markets.length).toBe(1);
    expect(r1.markets[0].market_type).toBe("1X2 - 1T");

    const r2 = categorizeMarketsV2(markets, "calcio", "Tempi", "Combo HT/FT");
    expect(r2.markets.length).toBe(1);
    expect(r2.markets[0].market_type).toBe("HT/FT");
  });

  it("returns empty for tab with no matching markets", () => {
    const markets = [mkMarket("m1", "1X2")];
    const result = categorizeMarketsV2(markets, "calcio", "Player", "Anytime");
    expect(result.markets.length).toBe(0);
  });

  it("preserves unknown markets in 'extras' bucket", () => {
    const markets = [mkMarket("m1", "Some Weird Market")];
    const result = categorizeMarketsV2(markets, "calcio", "Principali");
    expect(result.extras).toContain(markets[0]);
  });
});
