import { describe, it, expect } from "vitest";
import { __test__settle as settle } from "@/lib/settlement";

describe("Family A: team-split corners O/U", () => {
  const baseEvent = {
    score_home: 1, score_away: 1,
    live_data: {
      halfScoreHome: [0, 1], halfScoreAway: [1, 0],
      stats: [
        { name: "Partita: Calci d'angolo", home: 7, away: 4 },
      ],
    },
  };

  it("O/U Corner Casa 4.5 Over → won when home=7", () => {
    expect(settle(baseEvent, "O/U Corner Casa 4.5", "Over", 4.5, "calcio")).toBe("won");
  });

  it("O/U Corner Casa 4.5 Under → lost when home=7", () => {
    expect(settle(baseEvent, "O/U Corner Casa 4.5", "Under", 4.5, "calcio")).toBe("lost");
  });

  it("O/U Corner Ospite 3.5 Under → lost when away=4", () => {
    expect(settle(baseEvent, "O/U Corner Ospite 3.5", "Under", 3.5, "calcio")).toBe("lost");
  });

  it("O/U Corner Ospite 3.5 Over → won when away=4", () => {
    expect(settle(baseEvent, "O/U Corner Ospite 3.5", "Over", 3.5, "calcio")).toBe("won");
  });

  it("returns null if stats not persisted", () => {
    const noStats = {
      score_home: 1, score_away: 1,
      live_data: { halfScoreHome: [0], halfScoreAway: [0] }, // no stats
    };
    expect(settle(noStats, "O/U Corner Casa 4.5", "Over", 4.5, "calcio")).toBeNull();
  });

  it("returns push when corners exactly match a whole line", () => {
    const ev = {
      ...baseEvent,
      live_data: {
        ...baseEvent.live_data,
        stats: [{ name: "Partita: Calci d'angolo", home: 4, away: 4 }],
      },
    };
    expect(settle(ev, "O/U Corner Casa 4", "Over", 4, "calcio")).toBe("push");
    expect(settle(ev, "O/U Corner Ospite 4", "Under", 4, "calcio")).toBe("push");
  });

  it("Kambi verbose: Calci d'angolo - Totale Casa 5.5", () => {
    expect(settle(baseEvent, "Calci d'angolo - Totale Casa 5.5", "Over", undefined, "calcio")).toBe("won");
    expect(settle(baseEvent, "Calci d'angolo - Totale Casa 5.5", "Under", undefined, "calcio")).toBe("lost");
  });

  it("Kambi verbose: Calci d'angolo - Totale Ospite 5.5", () => {
    expect(settle(baseEvent, "Calci d'angolo - Totale Ospite 5.5", "Over", undefined, "calcio")).toBe("lost");
    expect(settle(baseEvent, "Calci d'angolo - Totale Ospite 5.5", "Under", undefined, "calcio")).toBe("won");
  });
});

describe("Family A: team-split shots O/U", () => {
  const ev = {
    score_home: 1, score_away: 0,
    live_data: {
      halfScoreHome: [1], halfScoreAway: [0],
      stats: [
        { name: "Partita: Tiri totali", home: 11, away: 2 },
        { name: "Partita: Tiri in porta", home: 5, away: 1 },
      ],
    },
  };

  it("O/U Tiri Casa 10.5 Over → won", () => {
    expect(settle(ev, "O/U Tiri Casa 10.5", "Over", 10.5, "calcio")).toBe("won");
  });

  it("O/U Tiri Casa 10.5 Under → lost", () => {
    expect(settle(ev, "O/U Tiri Casa 10.5", "Under", 10.5, "calcio")).toBe("lost");
  });

  it("O/U Tiri Ospite 1.5 Over → won", () => {
    expect(settle(ev, "O/U Tiri Ospite 1.5", "Over", 1.5, "calcio")).toBe("won");
  });

  it("O/U Tiri Porta Casa 4.5 Over → won (5 vs 4.5)", () => {
    expect(settle(ev, "O/U Tiri Porta Casa 4.5", "Over", 4.5, "calcio")).toBe("won");
  });

  it("O/U Tiri Porta Ospite 1.5 Under → won (1 vs 1.5)", () => {
    expect(settle(ev, "O/U Tiri Porta Ospite 1.5", "Under", 1.5, "calcio")).toBe("won");
  });

  it("returns null on missing stats (live_data.stats absent)", () => {
    const noStats = { score_home: 1, score_away: 0, live_data: { halfScoreHome: [1], halfScoreAway: [0] } };
    expect(settle(noStats, "O/U Tiri Casa 10.5", "Over", 10.5, "calcio")).toBeNull();
  });

  it("player-prop 'Tiri Totali' variant remains VOID (still blacklisted)", () => {
    // Scraper sometimes emits "Player Name | Tiri Totali" - this must keep routing to void
    expect(settle(ev, "Lautaro Martinez | Tiri Totali", "Over", 2.5, "calcio")).toBe("void");
  });
});

describe("makeTeamOU edge cases (cross-cutting Family A)", () => {
  const ev = {
    score_home: 1, score_away: 1,
    live_data: {
      halfScoreHome: [0, 1], halfScoreAway: [1, 0],
      stats: [{ name: "Partita: Calci d'angolo", home: 7, away: 4 }],
    },
  };

  it("invalid outcome name returns null (not lost)", () => {
    // Outcome 'Pareggio' on an O/U market — nonsensical, must return null
    expect(settle(ev, "O/U Corner Casa 4.5", "Pareggio", 4.5, "calcio")).toBeNull();
  });

  it("uppercase outcome 'OVER' routes same as 'Over'", () => {
    expect(settle(ev, "O/U Corner Casa 4.5", "OVER", 4.5, "calcio")).toBe("won");
  });

  it("mixed-case 'OvEr' routes same as 'Over'", () => {
    expect(settle(ev, "O/U Corner Casa 4.5", "OvEr", 4.5, "calcio")).toBe("won");
  });

  it("padded whitespace outcome '  Over  ' routes via trim()", () => {
    expect(settle(ev, "O/U Corner Casa 4.5", "  Over  ", 4.5, "calcio")).toBe("won");
  });
});

describe("Family A: team-split goals O/U", () => {
  const ev = { score_home: 2, score_away: 1, live_data: { halfScoreHome: [1, 1], halfScoreAway: [0, 1] } };

  it("O/U Gol Casa 1.5 Over → won (home=2)", () => {
    expect(settle(ev, "O/U Gol Casa 1.5", "Over", 1.5, "calcio")).toBe("won");
  });

  it("O/U Gol Casa 2.5 Under → won (home=2)", () => {
    expect(settle(ev, "O/U Gol Casa 2.5", "Under", 2.5, "calcio")).toBe("won");
  });

  it("O/U Gol Ospite 1.5 Under → won (away=1)", () => {
    expect(settle(ev, "O/U Gol Ospite 1.5", "Under", 1.5, "calcio")).toBe("won");
  });

  it("O/U Gol Ospite 0.5 Over → won (away=1)", () => {
    expect(settle(ev, "O/U Gol Ospite 0.5", "Over", 0.5, "calcio")).toBe("won");
  });

  it("push on exact whole-line for home goals (home=2, line=2)", () => {
    expect(settle(ev, "O/U Gol Casa 2", "Over", 2, "calcio")).toBe("push");
    expect(settle(ev, "O/U Gol Casa 2", "Under", 2, "calcio")).toBe("push");
  });

  it("Kambi verbose 'Gol totali Casa 1.5' Over → won", () => {
    expect(settle(ev, "Gol totali Casa 1.5", "Over", undefined, "calcio")).toBe("won");
  });

  it("Kambi verbose 'Gol totali Ospite 1.5' Under → won", () => {
    expect(settle(ev, "Gol totali Ospite 1.5", "Under", undefined, "calcio")).toBe("won");
  });

  it("returns null when score is not yet set (live not final)", () => {
    // buildResult returns null if score_home/away are null
    const preScore = { score_home: null, score_away: null, live_data: {} };
    expect(settle(preScore, "O/U Gol Casa 1.5", "Over", 1.5, "calcio")).toBeNull();
  });
});
