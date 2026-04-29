import { describe, it, expect } from "vitest";
import { __test__settle as settle } from "@/lib/settlement";
import {
  makeEmptyLookups,
  type CanonicalLookups,
} from "@/lib/settlement/canonical-dispatcher";

// End-to-end validation of the Phase B canonical fallback: when no regex
// in MARKET_PATTERNS matches the raw market_type string, but a trusted
// (source, market_type) → canonical_key mapping exists in
// market_normalization, dispatch should fall through and settle correctly.

function buildLookups(opts: {
  source: string;
  markets: Array<{ mt: string; canonical_key: string; canonical_line?: number }>;
  outcomes?: Array<{ mt: string; on: string; canonical_outcome_key: string }>;
  dictionary?: Array<{ canonical_key: string; pattern: string; canonical_outcome_key: string }>;
}): CanonicalLookups {
  const l = makeEmptyLookups();
  for (const m of opts.markets) {
    l.market.set(`${opts.source}|${m.mt}`, {
      canonical_key: m.canonical_key,
      canonical_line: m.canonical_line ?? null,
    });
  }
  for (const o of opts.outcomes ?? []) {
    l.outcome.set(
      `${opts.source}|${o.mt}|${o.on.toLowerCase()}`,
      o.canonical_outcome_key,
    );
  }
  for (const d of opts.dictionary ?? []) {
    l.dictionary.set(
      `${d.canonical_key}|${d.pattern.toLowerCase()}`,
      d.canonical_outcome_key,
    );
  }
  return l;
}

describe("Phase B canonical fallback — end-to-end", () => {
  // Event: Juve 2-1 Inter, HT 1-1
  const ev = {
    score_home: 2,
    score_away: 1,
    live_data: { halfScoreHome: [1, 1], halfScoreAway: [1, 0] },
  };

  describe("22bet 1X2 - 1T → 1X2_HT (HT 1-1 draw)", () => {
    const lookups = buildLookups({
      source: "22bet",
      markets: [{ mt: "1X2 - 1T", canonical_key: "1x2_1h" }],
      dictionary: [
        { canonical_key: "1x2_1h", pattern: "1", canonical_outcome_key: "home" },
        { canonical_key: "1x2_1h", pattern: "x", canonical_outcome_key: "draw" },
        { canonical_key: "1x2_1h", pattern: "2", canonical_outcome_key: "away" },
      ],
    });

    it("outcome 'X' → won (HT draw 1-1)", () => {
      expect(settle(ev, "1X2 - 1T", "X", undefined, "calcio", { source: "22bet", lookups })).toBe(
        "won",
      );
    });

    it("outcome '1' → lost (HT is draw, not home win)", () => {
      expect(settle(ev, "1X2 - 1T", "1", undefined, "calcio", { source: "22bet", lookups })).toBe(
        "lost",
      );
    });
  });

  describe("22bet U/O 2.5 - 1T → O/U_HT (HT total = 2)", () => {
    const lookups = buildLookups({
      source: "22bet",
      markets: [
        { mt: "U/O 2.5 - 1T", canonical_key: "u_o_1h", canonical_line: 2.5 },
      ],
      dictionary: [
        { canonical_key: "u_o_1h", pattern: "over", canonical_outcome_key: "over" },
        { canonical_key: "u_o_1h", pattern: "under", canonical_outcome_key: "under" },
      ],
    });

    it("Under → won (HT total 2 < 2.5)", () => {
      expect(
        settle(ev, "U/O 2.5 - 1T", "Under", undefined, "calcio", { source: "22bet", lookups }),
      ).toBe("won");
    });

    it("Over → lost (HT total 2 < 2.5)", () => {
      expect(
        settle(ev, "U/O 2.5 - 1T", "Over", undefined, "calcio", { source: "22bet", lookups }),
      ).toBe("lost");
    });
  });

  describe("22bet GG/NG - 1T → GG/NG_HT (HT both teams scored)", () => {
    const lookups = buildLookups({
      source: "22bet",
      markets: [{ mt: "GG/NG - 1T", canonical_key: "gg_ng_1h" }],
      outcomes: [
        {
          mt: "GG/NG - 1T",
          on: "Si",
          canonical_outcome_key: "yes",
        },
        {
          mt: "GG/NG - 1T",
          on: "No",
          canonical_outcome_key: "no",
        },
      ],
    });

    it("outcome 'Si' → won (HT 1-1, both scored)", () => {
      expect(
        settle(ev, "GG/NG - 1T", "Si", undefined, "calcio", { source: "22bet", lookups }),
      ).toBe("won");
    });

    it("outcome 'No' → lost", () => {
      expect(
        settle(ev, "GG/NG - 1T", "No", undefined, "calcio", { source: "22bet", lookups }),
      ).toBe("lost");
    });
  });

  describe("22bet DC - 1T → DC_HT (HT draw 1-1)", () => {
    const lookups = buildLookups({
      source: "22bet",
      markets: [{ mt: "DC - 1T", canonical_key: "dc_1h" }],
      dictionary: [
        { canonical_key: "dc_1h", pattern: "1x", canonical_outcome_key: "1X" },
        { canonical_key: "dc_1h", pattern: "12", canonical_outcome_key: "12" },
        { canonical_key: "dc_1h", pattern: "x2", canonical_outcome_key: "X2" },
      ],
    });

    it("outcome '1X' → won (HT home 1 >= away 1)", () => {
      expect(settle(ev, "DC - 1T", "1X", undefined, "calcio", { source: "22bet", lookups })).toBe(
        "won",
      );
    });

    it("outcome 'X2' → won (HT draw qualifies X2)", () => {
      expect(settle(ev, "DC - 1T", "X2", undefined, "calcio", { source: "22bet", lookups })).toBe(
        "won",
      );
    });

    it("outcome '12' → lost (HT is draw, so 12 loses)", () => {
      expect(settle(ev, "DC - 1T", "12", undefined, "calcio", { source: "22bet", lookups })).toBe(
        "lost",
      );
    });
  });

  describe("regex fast-path still has priority over canonical", () => {
    // Kambi native "1X2" has a regex match at MARKET_PATTERNS; canonical
    // lookups should not interfere even when provided.
    const lookups = buildLookups({
      source: "kambi",
      markets: [{ mt: "1X2", canonical_key: "1x2_ft" }],
    });
    it("Kambi native '1X2' outcome '1' → won (FT home 2 > away 1) via regex", () => {
      expect(settle(ev, "1X2", "1", undefined, "calcio", { source: "kambi", lookups })).toBe(
        "won",
      );
    });
  });

  describe("no canonical mapping + no regex → null (settlement layer will void)", () => {
    const lookups = makeEmptyLookups();
    it("unknown market → null", () => {
      expect(
        settle(ev, "Some Totally Unknown Market - 22bet edition", "X", undefined, "calcio", {
          source: "22bet",
          lookups,
        }),
      ).toBeNull();
    });
  });

  describe("canonical_line precedence over marketLine param", () => {
    // Pick a 22bet-native market name that doesn't collide with any regex
    // in MARKET_PATTERNS so canonical fallback is guaranteed to fire.
    const lookups = buildLookups({
      source: "22bet",
      markets: [
        { mt: "Totale Gol Intero Match", canonical_key: "u_o_ft", canonical_line: 3.5 },
      ],
      dictionary: [
        { canonical_key: "u_o_ft", pattern: "over", canonical_outcome_key: "over" },
      ],
    });
    it("uses canonical_line 3.5, not test-provided 2.5 (FT total 3)", () => {
      expect(
        settle(ev, "Totale Gol Intero Match", "Over", 2.5, "calcio", {
          source: "22bet",
          lookups,
        }),
      ).toBe("lost"); // total 3 < canonical_line 3.5 → Over loses
    });
  });

  describe("Phase C — period 3h/4h via setIdx derivation", () => {
    // Basketball event: Q1 18-20, Q2 22-25 (HT 40-45), Q3 24-18, Q4 20-22 (FT 84-85)
    const bkEv = {
      score_home: 84,
      score_away: 85,
      live_data: {
        halfScoreHome: [18, 22, 24, 20],
        halfScoreAway: [20, 25, 18, 22],
      },
    };

    it("22bet '1X2 - 3Q' canonical 1x2_3h → Q3 home 24 > away 18 won", () => {
      const lookups = buildLookups({
        source: "22bet",
        markets: [{ mt: "1X2 Terzo Quarto", canonical_key: "1x2_3h" }],
        dictionary: [
          { canonical_key: "1x2_3h", pattern: "1", canonical_outcome_key: "home" },
          { canonical_key: "1x2_3h", pattern: "2", canonical_outcome_key: "away" },
        ],
      });
      expect(
        settle(bkEv, "1X2 Terzo Quarto", "1", undefined, "basket", {
          source: "22bet",
          lookups,
        }),
      ).toBe("won");
    });

    it("22bet 'U/O 45 - 4Q' canonical u_o_4h → Q4 total 42 < 45 Under won", () => {
      const lookups = buildLookups({
        source: "22bet",
        markets: [
          { mt: "Totale Quarto Quarto", canonical_key: "u_o_4h", canonical_line: 45 },
        ],
        dictionary: [
          { canonical_key: "u_o_4h", pattern: "under", canonical_outcome_key: "under" },
        ],
      });
      expect(
        settle(bkEv, "Totale Quarto Quarto", "Under", undefined, "basket", {
          source: "22bet",
          lookups,
        }),
      ).toBe("won");
    });
  });

  describe("Phase C — Family C combos", () => {
    // Juve 2-1 Inter HT 1-1 — 1X2=1, GG=Yes, O/U 2.5=Over
    const combosEv = {
      score_home: 2,
      score_away: 1,
      live_data: { halfScoreHome: [1, 1], halfScoreAway: [1, 0] },
    };

    describe("1x2_btts_ft (COMBO_1X2_GG)", () => {
      const lookups = buildLookups({
        source: "22bet",
        markets: [
          { mt: "1X2 + Entrambe Segnano", canonical_key: "1x2_btts_ft" },
        ],
        dictionary: [
          {
            canonical_key: "1x2_btts_ft",
            pattern: "1 + goal",
            canonical_outcome_key: "home_yes",
          },
          {
            canonical_key: "1x2_btts_ft",
            pattern: "x + goal",
            canonical_outcome_key: "draw_yes",
          },
          {
            canonical_key: "1x2_btts_ft",
            pattern: "1 + nogoal",
            canonical_outcome_key: "home_no",
          },
        ],
      });

      it("outcome '1 + Goal' → won (home wins + both scored)", () => {
        expect(
          settle(combosEv, "1X2 + Entrambe Segnano", "1 + Goal", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("won");
      });

      it("outcome 'X + Goal' → lost (draw component fails)", () => {
        expect(
          settle(combosEv, "1X2 + Entrambe Segnano", "X + Goal", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("lost");
      });

      it("outcome '1 + NoGoal' → lost (GG fails because away scored)", () => {
        expect(
          settle(combosEv, "1X2 + Entrambe Segnano", "1 + NoGoal", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("lost");
      });
    });

    describe("dc_btts_ft (COMBO_DC_GG)", () => {
      const lookups = buildLookups({
        source: "22bet",
        markets: [{ mt: "DC + GG", canonical_key: "dc_btts_ft" }],
        dictionary: [
          { canonical_key: "dc_btts_ft", pattern: "1x e gg", canonical_outcome_key: "1X_yes" },
          { canonical_key: "dc_btts_ft", pattern: "12 e ng", canonical_outcome_key: "12_no" },
        ],
      });

      it("outcome '1X E GG' → won (home wins + both scored)", () => {
        expect(
          settle(combosEv, "DC + GG", "1X E GG", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("won");
      });

      it("outcome '12 E NG' → lost (NG fails)", () => {
        expect(
          settle(combosEv, "DC + GG", "12 E NG", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("lost");
      });
    });

    describe("dc_and_total_ft (COMBO_DC_OU) with line", () => {
      const lookups = buildLookups({
        source: "22bet",
        markets: [
          { mt: "DC + Totale", canonical_key: "dc_and_total_ft", canonical_line: 2.5 },
        ],
        dictionary: [
          {
            canonical_key: "dc_and_total_ft",
            pattern: "1x + over",
            canonical_outcome_key: "1X_over",
          },
          {
            canonical_key: "dc_and_total_ft",
            pattern: "x2 + under",
            canonical_outcome_key: "X2_under",
          },
        ],
      });

      it("outcome '1X + Over' → won (home+draw OK, total 3 > 2.5)", () => {
        expect(
          settle(combosEv, "DC + Totale", "1X + Over", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("won");
      });

      it("outcome 'X2 + Under' → lost (DC fails and total also fails)", () => {
        expect(
          settle(combosEv, "DC + Totale", "X2 + Under", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("lost");
      });
    });

    describe("btts_and_total_ft (COMBO_GG_OU) with line", () => {
      const lookups = buildLookups({
        source: "22bet",
        markets: [
          { mt: "GG + Totale", canonical_key: "btts_and_total_ft", canonical_line: 2.5 },
        ],
        dictionary: [
          {
            canonical_key: "btts_and_total_ft",
            pattern: "btts + over - sì",
            canonical_outcome_key: "over_yes",
          },
          {
            canonical_key: "btts_and_total_ft",
            pattern: "btts + under - no",
            canonical_outcome_key: "under_no",
          },
        ],
      });

      it("outcome 'BTTS + Over - Sì' → won (both scored, total 3 > 2.5)", () => {
        expect(
          settle(combosEv, "GG + Totale", "BTTS + Over - Sì", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("won");
      });

      it("outcome 'BTTS + Under - No' → lost (no_no means 'No' on btts, but both scored)", () => {
        // under_no → "No - Under" → GG=No but both DID score → NG fails → lost
        expect(
          settle(combosEv, "GG + Totale", "BTTS + Under - No", undefined, "calcio", {
            source: "22bet",
            lookups,
          }),
        ).toBe("lost");
      });
    });
  });

  describe("Phase C — VOID_BY_DESIGN short-circuits", () => {
    const lookups = buildLookups({
      source: "22bet",
      markets: [{ mt: "Marcatore Qualsiasi", canonical_key: "anytime_scorer" }],
    });
    it("anytime_scorer canonical → null (settlement voids)", () => {
      expect(
        settle(ev, "Marcatore Qualsiasi", "Player X", undefined, "calcio", {
          source: "22bet",
          lookups,
        }),
      ).toBeNull();
    });
  });

  describe("outcome_normalization overrides dictionary (source-specific wins)", () => {
    // 22bet uses "GG/NG - BT" (made-up marker) to force canonical fallback;
    // bare "GG/NG" would be caught by the regex at line 398.
    const lookups = buildLookups({
      source: "22bet",
      markets: [{ mt: "Goal Entrambe Squadre Finale", canonical_key: "gg_ng_ft" }],
      // Simulate operator-curated outcome_normalization entry
      outcomes: [
        { mt: "Goal Entrambe Squadre Finale", on: "Yes", canonical_outcome_key: "yes" },
      ],
      // Dictionary also has yes→yes mapping but outcome_normalization hits first
      dictionary: [
        { canonical_key: "gg_ng_ft", pattern: "yes", canonical_outcome_key: "yes" },
      ],
    });
    it("outcome 'Yes' → won (FT 2-1 both scored)", () => {
      expect(
        settle(ev, "Goal Entrambe Squadre Finale", "Yes", undefined, "calcio", {
          source: "22bet",
          lookups,
        }),
      ).toBe("won");
    });
  });
});
