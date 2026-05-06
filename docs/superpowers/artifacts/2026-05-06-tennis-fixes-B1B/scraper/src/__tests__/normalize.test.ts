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

describe("normalizeTeam — per-sport scaffold (B1.A)", () => {
  it("tennis falls back to _default NOISE when no override defined", () => {
    // FC is in _default NOISE; tennis override doesn't exist yet → tokens identical
    const tennis = normalizeTeam("FC Barcelona", "tennis");
    const football = normalizeTeam("FC Barcelona", "football");
    expect(tennis.key).toBe(football.key);
    expect(tennis.tokens).toEqual(football.tokens);
  });
});

describe("normalizeTeam — tennis (B1.B comma + paren + NOISE)", () => {
  // ── Comma-format positive tests (data-driven from B1.A captured samples) ──
  it("Sabalenka, Aryna matches Sabalenka A.", () => {
    const a = normalizeTeam("Sabalenka, Aryna", "tennis");
    const b = normalizeTeam("Sabalenka A.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Pucinelli de Almeida, Matheus matches Pucinelli De Almeida M.", () => {
    const a = normalizeTeam("Pucinelli de Almeida, Matheus", "tennis");
    const b = normalizeTeam("Pucinelli De Almeida M.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Diaz Acosta, Facundo matches Diaz Acosta F.", () => {
    const a = normalizeTeam("Diaz Acosta, Facundo", "tennis");
    const b = normalizeTeam("Diaz Acosta F.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Struff, Jan-Lennard matches Struff J. (hyphen + comma combo)", () => {
    const a = normalizeTeam("Struff, Jan-Lennard", "tennis");
    const b = normalizeTeam("Struff J.", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Sinner, J. matches Sinner Jannik (initial-first comma to full name)", () => {
    const a = normalizeTeam("Sinner, J.", "tennis");
    const b = normalizeTeam("Sinner Jannik", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Sinner J. matches Sinner, Jannik (reverse direction)", () => {
    const a = normalizeTeam("Sinner J.", "tennis");
    const b = normalizeTeam("Sinner, Jannik", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  // ── Comma-format negative tests (no false positives) ──
  it("Korda, Sebastian does NOT match Korda, Petr (different first names ≥4 chars)", () => {
    const a = normalizeTeam("Korda, Sebastian", "tennis");
    const b = normalizeTeam("Korda, Petr", "tennis");
    expect(matchTeams(a, b)).toBe(false);
  });

  it("Sabalenka, A does NOT match Pegula, A (different surnames, same initial)", () => {
    const a = normalizeTeam("Sabalenka, A", "tennis");
    const b = normalizeTeam("Pegula, A", "tennis");
    expect(matchTeams(a, b)).toBe(false);
  });

  // ── Paren strip tests (defensive — country code suffixes) ──
  it("Sinner J. (ITA) matches Sinner Jannik (parens stripped)", () => {
    const a = normalizeTeam("Sinner J. (ITA)", "tennis");
    const b = normalizeTeam("Sinner Jannik", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Alcaraz C. (ESP) matches Alcaraz Carlos (parens stripped)", () => {
    const a = normalizeTeam("Alcaraz C. (ESP)", "tennis");
    const b = normalizeTeam("Alcaraz Carlos", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  // ── Tennis NOISE token tests ──
  it("Korda S. (Q1) matches Korda Sebastian (qualifier marker stripped)", () => {
    const a = normalizeTeam("Korda S. (Q1)", "tennis");
    const b = normalizeTeam("Korda Sebastian", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Maric F. WC matches Maric Filip (wildcard marker stripped)", () => {
    const a = normalizeTeam("Maric F. WC", "tennis");
    const b = normalizeTeam("Maric Filip", "tennis");
    expect(matchTeams(a, b)).toBe(true);
  });

  it("Li, Na tokens preserve 'li' and 'na' (2-char Chinese surname NOT in NOISE)", () => {
    // Regression guard: future maintainer must NOT add common 2-char tokens to
    // tennis NOISE without checking surname collision risk. "li" is a real
    // surname for many Asian players (Na Li, etc.). This test locks the intent.
    const r = normalizeTeam("Li, Na", "tennis");
    expect(r.tokens).toContain("li");
    expect(r.tokens).toContain("na");
  });

  // Token-introspection tests — lock the NOISE_TOKENS_BY_SPORT.tennis
  // contract directly. Without these, a missing _TENNIS_NOISE Set still
  // passes the matchTeams-outcome tests above because q1/wc are 2-3 chars
  // and below DISCRIMINATING_MIN_LEN=4 → silently excluded from Stage 3
  // anyway. The assertions here verify the NOISE filter actually fires.
  it("tennis NOISE strips Q1 from tokens (not just below disc-min)", () => {
    const r = normalizeTeam("Korda S Q1", "tennis");
    expect(r.tokens).not.toContain("q1");
    expect(r.tokens).toContain("korda");
  });

  it("Q1 NOT stripped for football (per-sport NOISE isolation)", () => {
    // This locks the per-sport contract: football falls back to _default
    // NOISE which does NOT contain q1, so the token survives.
    const r = normalizeTeam("Team Q1", "football");
    expect(r.tokens).toContain("q1");
  });
});
