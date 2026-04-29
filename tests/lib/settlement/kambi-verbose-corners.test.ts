import { describe, it, expect } from "vitest";
import { __test__settle as settle } from "@/lib/settlement";

// Validation that existing regex patterns at lib/settlement.ts:576-588 actually
// match the Kambi-verbose naming found in prod DB (1.199+1.325 markets).
describe("Phase 2.5 — Kambi-verbose HT/SH corner patterns (real prod strings)", () => {
  const ev = {
    score_home: 2,
    score_away: 1,
    live_data: {
      halfScoreHome: [1, 1],
      halfScoreAway: [0, 1],
      stats: [
        { name: "Partita: Calci d'angolo", home: 8, away: 5 },
        { name: "1 Tempo: Calci d'angolo", home: 3, away: 2 },
        { name: "2 Tempo: Calci d'angolo", home: 5, away: 3 },
      ],
    },
  };

  // O/U HT — pattern at line 576
  it("Totale calci d'angolo - 1° tempo 4.5 Over → won (HT total 5 > 4.5)", () => {
    expect(settle(ev, "Totale calci d'angolo - 1° tempo 4.5", "Over", undefined, "calcio")).toBe("won");
  });

  it("Totale calci d'angolo - 1° tempo 5.5 Under → won (HT total 5 < 5.5)", () => {
    expect(settle(ev, "Totale calci d'angolo - 1° tempo 5.5", "Under", undefined, "calcio")).toBe("won");
  });

  it("Totale calci d'angolo - 1° tempo 5 Over → push", () => {
    expect(settle(ev, "Totale calci d'angolo - 1° tempo 5", "Over", undefined, "calcio")).toBe("push");
  });

  // O/U SH — pattern at line 583 (sh = total − ht = 13 − 5 = 8)
  it("Totale calci d'angolo - 2° tempo 7.5 Over → won (SH total 8 > 7.5)", () => {
    expect(settle(ev, "Totale calci d'angolo - 2° tempo 7.5", "Over", undefined, "calcio")).toBe("won");
  });

  it("Totale calci d'angolo - 2° tempo 8.5 Over → lost (SH total 8 < 8.5)", () => {
    expect(settle(ev, "Totale calci d'angolo - 2° tempo 8.5", "Over", undefined, "calcio")).toBe("lost");
  });

  // 1X2 HT — pattern at line 578 (home 3 > away 2 → home wins)
  it("Più calci d'angolo - 1° tempo '1' → won", () => {
    expect(settle(ev, "Più calci d'angolo - 1° tempo", "1", undefined, "calcio")).toBe("won");
  });

  it("Più calci d'angolo - 1° tempo '2' → lost", () => {
    expect(settle(ev, "Più calci d'angolo - 1° tempo", "2", undefined, "calcio")).toBe("lost");
  });

  // 1X2 SH — pattern at line 585 (home 5 > away 3 → home wins)
  it("Più calci d'angolo - 2° tempo '1' → won", () => {
    expect(settle(ev, "Più calci d'angolo - 2° tempo", "1", undefined, "calcio")).toBe("won");
  });

  it("Più calci d'angolo - 2° tempo 'X' → lost (home > away)", () => {
    expect(settle(ev, "Più calci d'angolo - 2° tempo", "X", undefined, "calcio")).toBe("lost");
  });

  it("returns null when HT stats missing", () => {
    const noStats = {
      score_home: 2,
      score_away: 1,
      live_data: { halfScoreHome: [1, 1], halfScoreAway: [0, 1] },
    };
    expect(settle(noStats, "Totale calci d'angolo - 1° tempo 4.5", "Over", undefined, "calcio")).toBeNull();
    expect(settle(noStats, "Più calci d'angolo - 1° tempo", "1", undefined, "calcio")).toBeNull();
  });
});
