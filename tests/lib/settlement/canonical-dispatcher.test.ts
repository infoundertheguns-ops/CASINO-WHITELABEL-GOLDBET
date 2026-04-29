import { describe, it, expect } from "vitest";
import {
  CANONICAL_TO_SETTLER,
  VOID_BY_DESIGN,
  canonicalizeOutcome,
  canonicalOutcomeToSettlerInput,
  deriveSetIdx,
  makeEmptyLookups,
  resolveCanonicalSettler,
  type CanonicalLookups,
} from "@/lib/settlement/canonical-dispatcher";

function lookupsWith(opts: {
  markets?: Array<{
    source: string;
    source_market_type: string;
    canonical_key: string;
    canonical_line?: number | null;
  }>;
  outcomes?: Array<{
    source: string;
    source_market_type: string;
    source_outcome_name: string;
    canonical_outcome_key: string;
  }>;
  dictionary?: Array<{
    canonical_key: string;
    source_outcome_pattern: string;
    canonical_outcome_key: string;
  }>;
}): CanonicalLookups {
  const l = makeEmptyLookups();
  for (const m of opts.markets ?? []) {
    l.market.set(`${m.source}|${m.source_market_type}`, {
      canonical_key: m.canonical_key,
      canonical_line: m.canonical_line ?? null,
    });
  }
  for (const o of opts.outcomes ?? []) {
    l.outcome.set(
      `${o.source}|${o.source_market_type}|${o.source_outcome_name.toLowerCase()}`,
      o.canonical_outcome_key,
    );
  }
  for (const d of opts.dictionary ?? []) {
    l.dictionary.set(
      `${d.canonical_key}|${d.source_outcome_pattern.toLowerCase()}`,
      d.canonical_outcome_key,
    );
  }
  return l;
}

describe("resolveCanonicalSettler", () => {
  it("22bet '1X2 - 1T' → 1X2_HT via 1x2_1h canonical", () => {
    const lookups = lookupsWith({
      markets: [
        { source: "22bet", source_market_type: "1X2 - 1T", canonical_key: "1x2_1h" },
      ],
    });
    const r = resolveCanonicalSettler("22bet", "1X2 - 1T", null, lookups);
    expect(r).toEqual({ key: "1X2_HT", line: undefined, canonicalKey: "1x2_1h" });
  });

  it("22bet 'U/O 2.5 - 1T' → O/U_HT with canonical_line 2.5", () => {
    const lookups = lookupsWith({
      markets: [
        {
          source: "22bet",
          source_market_type: "U/O 2.5 - 1T",
          canonical_key: "u_o_1h",
          canonical_line: 2.5,
        },
      ],
    });
    const r = resolveCanonicalSettler("22bet", "U/O 2.5 - 1T", null, lookups);
    expect(r).toEqual({ key: "O/U_HT", line: 2.5, canonicalKey: "u_o_1h" });
  });

  it("canonical_line missing → falls back to marketLine", () => {
    const lookups = lookupsWith({
      markets: [
        { source: "22bet", source_market_type: "U/O", canonical_key: "u_o_ft" },
      ],
    });
    const r = resolveCanonicalSettler("22bet", "U/O", 3.5, lookups);
    expect(r?.line).toBe(3.5);
  });

  it("22bet 'GG/NG - 1T' → GG/NG_HT", () => {
    const lookups = lookupsWith({
      markets: [
        { source: "22bet", source_market_type: "GG/NG - 1T", canonical_key: "gg_ng_1h" },
      ],
    });
    const r = resolveCanonicalSettler("22bet", "GG/NG - 1T", null, lookups);
    expect(r?.key).toBe("GG/NG_HT");
  });

  it("22bet 'DC - 1T' → DC_HT", () => {
    const lookups = lookupsWith({
      markets: [
        { source: "22bet", source_market_type: "DC - 1T", canonical_key: "dc_1h" },
      ],
    });
    const r = resolveCanonicalSettler("22bet", "DC - 1T", null, lookups);
    expect(r?.key).toBe("DC_HT");
  });

  it("unmapped market_type → null (fall through to void)", () => {
    const lookups = makeEmptyLookups();
    const r = resolveCanonicalSettler("22bet", "Some Exotic Prop", null, lookups);
    expect(r).toBeNull();
  });

  it("canonical_key without settler mapping → null", () => {
    const lookups = lookupsWith({
      markets: [
        {
          source: "22bet",
          source_market_type: "Player Props Thing",
          // anytime_scorer exists in canonical_markets but not in CANONICAL_TO_SETTLER
          canonical_key: "anytime_scorer",
        },
      ],
    });
    const r = resolveCanonicalSettler("22bet", "Player Props Thing", null, lookups);
    expect(r).toBeNull();
  });

  it("source discrimination: same market_type, different sources → independent", () => {
    const lookups = lookupsWith({
      markets: [
        { source: "kambi", source_market_type: "1X2", canonical_key: "1x2_ft" },
      ],
    });
    // 22bet with same market_type but no mapping → null
    expect(resolveCanonicalSettler("22bet", "1X2", null, lookups)).toBeNull();
    // kambi → maps
    expect(resolveCanonicalSettler("kambi", "1X2", null, lookups)?.key).toBe("1X2");
  });
});

describe("canonicalOutcomeToSettlerInput", () => {
  it.each([
    ["home", "1"],
    ["draw", "X"],
    ["away", "2"],
    ["over", "Over"],
    ["under", "Under"],
    ["yes", "Sì"],
    ["no", "No"],
    ["1X", "1X"],
    ["12", "12"],
    ["X2", "X2"],
    ["odd", "Dispari"],
    ["even", "Pari"],
    ["1_1", "1/1"],
    ["X_2", "X/2"],
    ["2_2", "2/2"],
  ])("%s → %s", (canonical, expected) => {
    expect(canonicalOutcomeToSettlerInput(canonical, "FALLBACK")).toBe(expected);
  });

  it("unknown canonical → fallback raw", () => {
    expect(canonicalOutcomeToSettlerInput("some_weird_thing", "RAW")).toBe("RAW");
  });
});

describe("canonicalizeOutcome", () => {
  it("outcome_normalization hit takes precedence over dictionary", () => {
    const lookups = lookupsWith({
      outcomes: [
        {
          source: "22bet",
          source_market_type: "GG/NG",
          source_outcome_name: "Si",
          canonical_outcome_key: "yes",
        },
      ],
      dictionary: [
        // dictionary also has si→yes but outcome_normalization should hit first
        { canonical_key: "gg_ng_ft", source_outcome_pattern: "si", canonical_outcome_key: "yes" },
      ],
    });
    expect(
      canonicalizeOutcome("22bet", "GG/NG", "Si", "gg_ng_ft", lookups),
    ).toBe("Sì");
  });

  it("falls back to outcome_dictionary when outcome_normalization misses", () => {
    const lookups = lookupsWith({
      dictionary: [
        { canonical_key: "1x2_ft", source_outcome_pattern: "1", canonical_outcome_key: "home" },
      ],
    });
    expect(canonicalizeOutcome("22bet", "1X2", "1", "1x2_ft", lookups)).toBe("1");
  });

  it("case-insensitive outcome lookup", () => {
    const lookups = lookupsWith({
      dictionary: [
        { canonical_key: "u_o_ft", source_outcome_pattern: "over", canonical_outcome_key: "over" },
      ],
    });
    expect(canonicalizeOutcome("22bet", "U/O", "OVER", "u_o_ft", lookups)).toBe("Over");
  });

  it("no mapping → returns raw outcome (safe fallback)", () => {
    const lookups = makeEmptyLookups();
    expect(canonicalizeOutcome("22bet", "Some Market", "SomeOutcome", null, lookups)).toBe(
      "SomeOutcome",
    );
  });

  it("null canonical_key skips dictionary lookup", () => {
    const lookups = lookupsWith({
      dictionary: [
        { canonical_key: "1x2_ft", source_outcome_pattern: "1", canonical_outcome_key: "home" },
      ],
    });
    expect(canonicalizeOutcome("22bet", "Something", "1", null, lookups)).toBe("1");
  });
});

describe("deriveSetIdx", () => {
  it("1x2_3h → 3", () => expect(deriveSetIdx("1x2_3h")).toBe(3));
  it("u_o_4h → 4", () => expect(deriveSetIdx("u_o_4h")).toBe(4));
  it("dc_1h → undefined (dedicated _HT settler)", () =>
    expect(deriveSetIdx("dc_1h")).toBeUndefined());
  it("u_o_2h → undefined (dedicated _SH settler)", () =>
    expect(deriveSetIdx("u_o_2h")).toBeUndefined());
  it("gg_ng_ft → undefined", () => expect(deriveSetIdx("gg_ng_ft")).toBeUndefined());
  it("winner_ft → undefined", () => expect(deriveSetIdx("winner_ft")).toBeUndefined());
});

describe("VOID_BY_DESIGN", () => {
  it("contains player-specific canonicals", () => {
    expect(VOID_BY_DESIGN.has("anytime_scorer")).toBe(true);
    expect(VOID_BY_DESIGN.has("first_scorer")).toBe(true);
    expect(VOID_BY_DESIGN.has("player_booked_ft")).toBe(true);
  });

  it("does NOT contain settleable core canonicals", () => {
    expect(VOID_BY_DESIGN.has("1x2_ft")).toBe(false);
    expect(VOID_BY_DESIGN.has("u_o_ft")).toBe(false);
    expect(VOID_BY_DESIGN.has("dc_btts_ft")).toBe(false);
  });

  it("resolveCanonicalSettler returns null for VOID_BY_DESIGN canonicals", () => {
    const l = makeEmptyLookups();
    l.market.set("22bet|Anytime Scorer Market", {
      canonical_key: "anytime_scorer",
      canonical_line: null,
    });
    expect(resolveCanonicalSettler("22bet", "Anytime Scorer Market", null, l)).toBeNull();
  });
});

describe("setIdx from canonical suffix — Phase C period 3h/4h", () => {
  it("1x2_3h → 1X2_QUARTER setIdx=3", () => {
    const l = makeEmptyLookups();
    l.market.set("22bet|1X2 - 3Q", { canonical_key: "1x2_3h", canonical_line: null });
    const r = resolveCanonicalSettler("22bet", "1X2 - 3Q", null, l);
    expect(r).toEqual({
      key: "1X2_QUARTER",
      line: undefined,
      setIdx: 3,
      canonicalKey: "1x2_3h",
    });
  });

  it("u_o_4h → O/U_QUARTER setIdx=4 with canonical_line", () => {
    const l = makeEmptyLookups();
    l.market.set("22bet|U/O 50 - 4Q", {
      canonical_key: "u_o_4h",
      canonical_line: 50,
    });
    const r = resolveCanonicalSettler("22bet", "U/O 50 - 4Q", null, l);
    expect(r?.key).toBe("O/U_QUARTER");
    expect(r?.setIdx).toBe(4);
    expect(r?.line).toBe(50);
  });

  it("dc_1h does NOT derive setIdx (routed to DC_HT)", () => {
    const l = makeEmptyLookups();
    l.market.set("22bet|DC - 1T", { canonical_key: "dc_1h", canonical_line: null });
    const r = resolveCanonicalSettler("22bet", "DC - 1T", null, l);
    expect(r?.key).toBe("DC_HT");
    expect(r?.setIdx).toBeUndefined();
  });
});

describe("canonicalOutcomeToSettlerInput — Family C combos", () => {
  it.each([
    // 1x2_btts
    ["home_yes", "1 - Sì"],
    ["home_no", "1 - No"],
    ["draw_yes", "X - Sì"],
    ["draw_no", "X - No"],
    ["away_yes", "2 - Sì"],
    ["away_no", "2 - No"],
    // dc_btts
    ["1X_yes", "1X - Sì"],
    ["1X_no", "1X - No"],
    ["12_yes", "12 - Sì"],
    ["12_no", "12 - No"],
    ["X2_yes", "X2 - Sì"],
    ["X2_no", "X2 - No"],
    // dc_and_total
    ["1X_over", "1X - Over"],
    ["1X_under", "1X - Under"],
    ["12_over", "12 - Over"],
    ["12_under", "12 - Under"],
    ["X2_over", "X2 - Over"],
    ["X2_under", "X2 - Under"],
    // btts_and_total (GG first in COMBO_GG_OU settler)
    ["over_yes", "Sì - Over"],
    ["over_no", "No - Over"],
    ["under_yes", "Sì - Under"],
    ["under_no", "No - Under"],
  ])("combo outcome %s → %s", (canonical, expected) => {
    expect(canonicalOutcomeToSettlerInput(canonical, "FALLBACK")).toBe(expected);
  });
});

describe("CANONICAL_TO_SETTLER catalog sanity", () => {
  it("all listed settler keys are non-empty strings", () => {
    for (const [ck, sk] of Object.entries(CANONICAL_TO_SETTLER)) {
      expect(typeof sk).toBe("string");
      expect(sk.length, `canonical ${ck} must map to non-empty settler`).toBeGreaterThan(0);
    }
  });

  it("covers all ft/1h/2h canonicals for the core 8 families (1x2, u_o, gg_ng, dc, dnb, cs, oe)", () => {
    // 1x2 ft+1h+2h
    expect(CANONICAL_TO_SETTLER["1x2_ft"]).toBeDefined();
    expect(CANONICAL_TO_SETTLER["1x2_1h"]).toBeDefined();
    expect(CANONICAL_TO_SETTLER["1x2_2h"]).toBeDefined();
    // u_o
    expect(CANONICAL_TO_SETTLER.u_o_ft).toBeDefined();
    expect(CANONICAL_TO_SETTLER.u_o_1h).toBeDefined();
    expect(CANONICAL_TO_SETTLER.u_o_2h).toBeDefined();
    // gg_ng
    expect(CANONICAL_TO_SETTLER.gg_ng_ft).toBeDefined();
    expect(CANONICAL_TO_SETTLER.gg_ng_1h).toBeDefined();
    expect(CANONICAL_TO_SETTLER.gg_ng_2h).toBeDefined();
    // dc
    expect(CANONICAL_TO_SETTLER.dc_ft).toBeDefined();
    expect(CANONICAL_TO_SETTLER.dc_1h).toBeDefined();
    expect(CANONICAL_TO_SETTLER.dc_2h).toBeDefined();
    // handicap (1h only because 2h rare)
    expect(CANONICAL_TO_SETTLER["1x2_h_ft"]).toBeDefined();
    // cs
    expect(CANONICAL_TO_SETTLER.cs_ft).toBeDefined();
    // htft
    expect(CANONICAL_TO_SETTLER.htft).toBeDefined();
  });

  it("Phase C: period 3h/4h variants mapped", () => {
    expect(CANONICAL_TO_SETTLER["1x2_3h"]).toBe("1X2_QUARTER");
    expect(CANONICAL_TO_SETTLER["1x2_4h"]).toBe("1X2_QUARTER");
    expect(CANONICAL_TO_SETTLER.u_o_3h).toBe("O/U_QUARTER");
    expect(CANONICAL_TO_SETTLER.dc_3h).toBe("DC_PERIOD");
    expect(CANONICAL_TO_SETTLER.dnb_3h).toBe("DNB_QUARTER");
    expect(CANONICAL_TO_SETTLER.oe_3h).toBe("ODD_EVEN_QUARTER");
  });

  it("Phase C: winner + h2h + 2way_handicap + asian_handicap families mapped", () => {
    expect(CANONICAL_TO_SETTLER.winner_ft).toBe("MATCH_WINNER");
    expect(CANONICAL_TO_SETTLER.h2h_ft).toBe("MATCH_WINNER");
    expect(CANONICAL_TO_SETTLER["2way_handicap_ft"]).toBe("HANDICAP");
    expect(CANONICAL_TO_SETTLER["2way_handicap_1h"]).toBe("HANDICAP_HT");
  });

  it("Phase C: corner canonicals mapped", () => {
    expect(CANONICAL_TO_SETTLER.total_corners_ft).toBe("O/U_CORNERS");
    expect(CANONICAL_TO_SETTLER.total_corners_1h).toBe("O/U_CORNERS_HT");
    expect(CANONICAL_TO_SETTLER.total_corners_2h).toBe("O/U_CORNERS_SH");
    expect(CANONICAL_TO_SETTLER.corner_winner_ft).toBe("1X2_CORNERS");
    expect(CANONICAL_TO_SETTLER.corner_winner_1h).toBe("1X2_CORNERS_HT");
    expect(CANONICAL_TO_SETTLER.corner_winner_2h).toBe("1X2_CORNERS_SH");
    expect(CANONICAL_TO_SETTLER.corner_1x2_handicap_ft).toBe("HANDICAP_CORNERS");
  });

  it("Phase C: Family C combos mapped to COMBO_* settlers", () => {
    expect(CANONICAL_TO_SETTLER["1x2_btts_ft"]).toBe("COMBO_1X2_GG");
    expect(CANONICAL_TO_SETTLER["1x2_btts_1h"]).toBe("COMBO_1X2_GG_HT");
    expect(CANONICAL_TO_SETTLER.dc_btts_ft).toBe("COMBO_DC_GG");
    expect(CANONICAL_TO_SETTLER.dc_and_total_ft).toBe("COMBO_DC_OU");
    expect(CANONICAL_TO_SETTLER.btts_and_total_ft).toBe("COMBO_GG_OU");
  });
});
