import { describe, it, expect } from "vitest";
import { __test__settle as settle } from "@/lib/settlement";

// Shared event with full HT/SH corners + cards populated
const ev = {
  score_home: 1,
  score_away: 0,
  live_data: {
    halfScoreHome: [1, 0],
    halfScoreAway: [0, 0],
    stats: [
      { name: "Partita: Calci d'angolo", home: 7, away: 5 },
      { name: "1 Tempo: Calci d'angolo", home: 4, away: 2 },
      { name: "2 Tempo: Calci d'angolo", home: 3, away: 3 },
      { name: "Partita: Cartellini gialli", home: 3, away: 4 },
      { name: "1 Tempo: Cartellini gialli", home: 2, away: 3 },
      { name: "Partita: Cartellini rossi", home: 0, away: 1 },
      { name: "1 Tempo: Cartellini rossi", home: 0, away: 1 },
    ],
  },
};

describe("Family B: handicap corners HT/SH", () => {
  // HT corners 4-2 → home wins corners
  // Line applies to home (existing convention, see HANDICAP_CORNERS @ lib/settlement.ts)
  it("Handicap Corner 1°T (-1) outcome 1 → won (adjHome 4-1=3 > 2)", () => {
    expect(settle(ev, "Handicap Corner 1°T (-1)", "1", undefined, "calcio")).toBe("won");
  });

  it("Handicap Corner 1°T (-3) outcome 1 → lost (adjHome 4-3=1 < 2)", () => {
    expect(settle(ev, "Handicap Corner 1°T (-3)", "1", undefined, "calcio")).toBe("lost");
  });

  it("Handicap Corner 1°T (-2) outcome 1 → push (adjHome 4-2=2 == 2)", () => {
    expect(settle(ev, "Handicap Corner 1°T (-2)", "1", undefined, "calcio")).toBe("push");
  });

  // SH corners 3-3 → tie
  it("Handicap Corner 2°T (-0.5) outcome 2 → won (adjHome 3-0.5=2.5 < 3, away covers)", () => {
    expect(settle(ev, "Handicap Corner 2°T (-0.5)", "2", undefined, "calcio")).toBe("won");
  });

  it("Handicap Corner 2°T (+0.5) outcome 1 → won (adjHome 3+0.5=3.5 > 3)", () => {
    expect(settle(ev, "Handicap Corner 2°T (+0.5)", "1", undefined, "calcio")).toBe("won");
  });

  // Kambi-verbose variant
  it("Calci d'angolo - Handicap 1° Tempo (-1) outcome Casa → won", () => {
    expect(settle(ev, "Calci d'angolo - Handicap 1° Tempo (-1)", "Casa", undefined, "calcio")).toBe("won");
  });

  it("Calci d'angolo - Handicap 2° Tempo (+0.5) outcome Ospite → lost", () => {
    expect(settle(ev, "Calci d'angolo - Handicap 2° Tempo (+0.5)", "Ospite", undefined, "calcio")).toBe("lost");
  });

  it("returns null when HT corner stats missing", () => {
    const noStats = {
      score_home: 1,
      score_away: 0,
      live_data: { halfScoreHome: [1], halfScoreAway: [0] },
    };
    expect(settle(noStats, "Handicap Corner 1°T (-1)", "1", undefined, "calcio")).toBeNull();
  });
});

describe("Family B: DC corners HT/SH", () => {
  // HT corners 4-2 → home wins corners; SH corners 3-3 → draw
  it("DC Corner 1°T 1X → won (home wins corners)", () => {
    expect(settle(ev, "DC Corner 1°T", "1X", undefined, "calcio")).toBe("won");
  });

  it("DC Corner 1°T 12 → won", () => {
    expect(settle(ev, "DC Corner 1°T", "12", undefined, "calcio")).toBe("won");
  });

  it("DC Corner 1°T X2 → lost (home wins corners)", () => {
    expect(settle(ev, "DC Corner 1°T", "X2", undefined, "calcio")).toBe("lost");
  });

  it("DC Corner 2°T 1X → won (draw)", () => {
    expect(settle(ev, "DC Corner 2°T", "1X", undefined, "calcio")).toBe("won");
  });

  it("DC Corner 2°T X2 → won (draw)", () => {
    expect(settle(ev, "DC Corner 2°T", "X2", undefined, "calcio")).toBe("won");
  });

  it("DC Corner 2°T 12 → lost (draw, neither side wins)", () => {
    expect(settle(ev, "DC Corner 2°T", "12", undefined, "calcio")).toBe("lost");
  });

  it("returns null when SH corner stats missing", () => {
    const noStats = {
      score_home: 1,
      score_away: 0,
      live_data: { halfScoreHome: [1], halfScoreAway: [0] },
    };
    expect(settle(noStats, "DC Corner 2°T", "1X", undefined, "calcio")).toBeNull();
  });
});

describe("Family B: HT cards markets", () => {
  // HT cards: home=2 yellow+0 red=2, away=3 yellow+1 red=4, total=6
  it("O/U Cartellini 1°T 5.5 Over → won (total 6 > 5.5)", () => {
    expect(settle(ev, "O/U Cartellini 1°T 5.5", "Over", undefined, "calcio")).toBe("won");
  });

  it("O/U Cartellini 1°T 5.5 Under → lost", () => {
    expect(settle(ev, "O/U Cartellini 1°T 5.5", "Under", undefined, "calcio")).toBe("lost");
  });

  it("O/U Cartellini 1°T 6 Over → push (total exactly 6)", () => {
    expect(settle(ev, "O/U Cartellini 1°T 6", "Over", undefined, "calcio")).toBe("push");
  });

  // Handicap HT cards: line applies to home (h=2, a=4)
  it("Handicap Cartellini 1°T (+2.5) outcome 1 → won (adjHome 2+2.5=4.5 > 4)", () => {
    expect(settle(ev, "Handicap Cartellini 1°T (+2.5)", "1", undefined, "calcio")).toBe("won");
  });

  it("Handicap Cartellini 1°T (-1) outcome 2 → won (adjHome 2-1=1 < 4)", () => {
    expect(settle(ev, "Handicap Cartellini 1°T (-1)", "2", undefined, "calcio")).toBe("won");
  });

  it("Handicap Cartellini 1°T (+2) outcome 1 → push (adjHome 2+2=4 == 4)", () => {
    expect(settle(ev, "Handicap Cartellini 1°T (+2)", "1", undefined, "calcio")).toBe("push");
  });

  it("returns null when HT card stats missing", () => {
    const noStats = {
      score_home: 1,
      score_away: 0,
      live_data: { halfScoreHome: [1], halfScoreAway: [0] },
    };
    expect(settle(noStats, "O/U Cartellini 1°T 5.5", "Over", undefined, "calcio")).toBeNull();
    expect(settle(noStats, "Handicap Cartellini 1°T (-1)", "2", undefined, "calcio")).toBeNull();
  });
});
