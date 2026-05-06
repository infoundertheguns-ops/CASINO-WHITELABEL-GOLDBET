import { describe, it, expect } from "vitest";
import { normalizeTeam, matchTeams } from "../normalize.js";

describe("normalizeTeam — basic", () => {
  it("lowercases + strips diacritics", () => {
    const r = normalizeTeam("Bayern München", "football");
    expect(r.key).toBe("bayern munchen");
  });
  it("strips generic NOISE prefix FC", () => {
    const r = normalizeTeam("FC Barcelona", "football");
    expect(r.key).toBe("barcelona");
  });
  it("strips multiple NOISE tokens", () => {
    const r = normalizeTeam("AC Milan FC", "football");
    expect(r.key).toBe("milan");
  });
  it("empty string yields empty key + empty tokens", () => {
    const r = normalizeTeam("", "football");
    expect(r.key).toBe("");
    expect(r.tokens.length).toBe(0);
  });
  it("only NOISE tokens yield empty key", () => {
    const r = normalizeTeam("FC SC AC", "football");
    expect(r.key).toBe("");
  });
});

describe("normalizeTeam — Eastern European prefixes (from discovery)", () => {
  it("strips GKS prefix", () => {
    const r = normalizeTeam("GKS Katowice", "football");
    expect(r.key).toBe("katowice");
  });
  it("strips KKP prefix", () => {
    const r = normalizeTeam("KKP Stomilanki Olsztyn", "football");
    expect(r.key).toBe("stomilanki olsztyn");
  });
  it("strips KF prefix", () => {
    const r = normalizeTeam("KF Shkendija Haracine", "football");
    expect(r.key).toBe("shkendija haracine");
  });
  it("strips FK prefix", () => {
    const r = normalizeTeam("FK Vora", "football");
    expect(r.key).toBe("vora");
  });
  it("strips women's marker D when standalone", () => {
    const r = normalizeTeam("Katowice D", "football");
    expect(r.key).toBe("katowice");
  });
  it("strips Sports plural NOISE", () => {
    const r = normalizeTeam("Rayon Sports FC", "football");
    expect(r.key).toBe("rayon");
  });
});

describe("normalizeTeam — alias dictionary", () => {
  it("Inter → internazionale via alias", () => {
    const r = normalizeTeam("Inter", "football");
    expect(r.key).toBe("internazionale");
  });
  it("Bayern → bayern munchen via alias (post-strip)", () => {
    const r = normalizeTeam("Bayern", "football");
    expect(r.key).toBe("bayern munchen");
  });
  it("Real → real madrid via alias", () => {
    const r = normalizeTeam("Real", "football");
    expect(r.key).toBe("real madrid");
  });
  it("PSG → paris saint germain via alias", () => {
    const r = normalizeTeam("PSG", "football");
    expect(r.key).toBe("paris saint germain");
  });
});

describe("normalizeTeam — reserve markers", () => {
  it("captures reserve marker B", () => {
    const r = normalizeTeam("Roma B", "football");
    expect(r.key).toBe("roma");
    expect(r.reserveMarkers.has("b")).toBe(true);
  });
  it("captures reserve marker '2'", () => {
    const r = normalizeTeam("Noah Yerevan 2", "football");
    expect(r.key).toBe("noah yerevan");
    expect(r.reserveMarkers.has("2")).toBe(true);
  });
  it("captures U21 marker", () => {
    const r = normalizeTeam("Italy U21", "football");
    expect(r.key).toBe("italy");
    expect(r.reserveMarkers.has("u21")).toBe(true);
  });
  it("captures II marker", () => {
    const r = normalizeTeam("Bayern Munchen II", "football");
    expect(r.key).toBe("bayern munchen");
    expect(r.reserveMarkers.has("ii")).toBe(true);
  });
});

describe("matchTeams — Stage 2 strict equality (real discovery cases)", () => {
  const cases: Array<[string, string, string]> = [
    ["GKS Katowice", "Katowice D", "prefix + women's D both reduce to 'katowice'"],
    ["KKP Stomilanki Olsztyn", "Stomilanki Olsztyn D", "prefix + women's D"],
    ["FC Prishtina", "Prishtina", "FC prefix"],
    ["KF Prishtina E Re", "Prishtina e Re", "KF prefix + case (lowercase normalize)"],
    ["AS Muhanga", "Muhanga", "AS prefix"],
    ["Rayon Sports FC", "Rayon Sport", "Sports/Sport plural + FC"],
    ["AC Milan FC", "Milan", "double NOISE strip"],
  ];
  for (const [a, b, desc] of cases) {
    it(`MATCH: ${a} ↔ ${b} (${desc})`, () => {
      expect(matchTeams(normalizeTeam(a, "football"), normalizeTeam(b, "football"))).toBe(true);
    });
  }
});

describe("matchTeams — Stage 3 subset fallback", () => {
  it("MATCH: Shkendija Tetovo ↔ Shkendija (city qualifier in only one)", () => {
    expect(matchTeams(normalizeTeam("Shkendija Tetovo", "football"), normalizeTeam("Shkendija", "football"))).toBe(true);
  });
  it("MATCH: Atletico Madrid ↔ Atletico Madrid (strict eq, baseline)", () => {
    expect(matchTeams(normalizeTeam("Atletico Madrid", "football"), normalizeTeam("Atletico Madrid", "football"))).toBe(true);
  });
});

describe("matchTeams — Stage 1 reserve marker mismatch (hard fail)", () => {
  it("NO MATCH: Roma ↔ Roma B (reserve diverge)", () => {
    expect(matchTeams(normalizeTeam("Roma", "football"), normalizeTeam("Roma B", "football"))).toBe(false);
  });
  it("NO MATCH: Noah Yerevan ↔ Noah Yerevan 2", () => {
    expect(matchTeams(normalizeTeam("Noah Yerevan", "football"), normalizeTeam("Noah Yerevan 2", "football"))).toBe(false);
  });
  it("NO MATCH: Italy ↔ Italy U21", () => {
    expect(matchTeams(normalizeTeam("Italy", "football"), normalizeTeam("Italy U21", "football"))).toBe(false);
  });
  it("NO MATCH: Bayern Munchen ↔ Bayern Munchen II", () => {
    expect(matchTeams(normalizeTeam("Bayern Munchen", "football"), normalizeTeam("Bayern Munchen II", "football"))).toBe(false);
  });
  it("MATCH: Roma B ↔ Roma B (same reserve)", () => {
    expect(matchTeams(normalizeTeam("Roma B", "football"), normalizeTeam("Roma B", "football"))).toBe(true);
  });
});

describe("matchTeams — empty / edge cases", () => {
  it("NO MATCH: empty ↔ Anything", () => {
    expect(matchTeams(normalizeTeam("", "football"), normalizeTeam("Roma", "football"))).toBe(false);
  });
  it("NO MATCH: Anything ↔ empty", () => {
    expect(matchTeams(normalizeTeam("Roma", "football"), normalizeTeam("", "football"))).toBe(false);
  });
  it("NO MATCH: only NOISE tokens both sides", () => {
    expect(matchTeams(normalizeTeam("FC SC", "football"), normalizeTeam("AC FC", "football"))).toBe(false);
  });
});
