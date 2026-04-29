import { describe, it, expect } from "vitest";
import { parseMarketType } from "@/lib/normalize/regex-patterns";

describe("parseMarketType — base markets", () => {
  it("parses 1X2 full time", () => {
    expect(parseMarketType("1X2")).toEqual({ base_key: "1x2", period: "ft", line: null });
  });

  it("parses 1X2 first half (legacy '1X2 1T' form)", () => {
    expect(parseMarketType("1X2 1T")).toEqual({ base_key: "1x2", period: "1h", line: null });
  });

  it("parses 1X2 second half (legacy '1X2 - 2T' form)", () => {
    expect(parseMarketType("1X2 - 2T")).toEqual({ base_key: "1x2", period: "2h", line: null });
  });

  it("parses DC with Italian period name", () => {
    expect(parseMarketType("DC 1° Tempo")).toEqual({ base_key: "dc", period: "1h", line: null });
  });

  it("parses GG/NG", () => {
    expect(parseMarketType("GG/NG")).toEqual({ base_key: "gg_ng", period: "ft", line: null });
  });

  it("parses Pari/Dispari", () => {
    expect(parseMarketType("Pari/Dispari")).toEqual({ base_key: "odd_even", period: "ft", line: null });
  });
});

describe("parseMarketType — U/O parametric", () => {
  it("parses legacy 'U/O 2.5'", () => {
    expect(parseMarketType("U/O 2.5")).toEqual({ base_key: "u_o", period: "ft", line: 2.5 });
  });

  it("parses legacy 'U/O 1T 1.5'", () => {
    expect(parseMarketType("U/O 1T 1.5")).toEqual({ base_key: "u_o", period: "1h", line: 1.5 });
  });

  it("parses legacy 'U/O 1.5 - 1T'", () => {
    expect(parseMarketType("U/O 1.5 - 1T")).toEqual({ base_key: "u_o", period: "1h", line: 1.5 });
  });

  it("parses integer lines ('U/O 3')", () => {
    expect(parseMarketType("U/O 3")).toEqual({ base_key: "u_o", period: "ft", line: 3 });
  });
});

describe("parseMarketType — handicap parametric", () => {
  it("parses '1X2 H (-1)'", () => {
    expect(parseMarketType("1X2 H (-1)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: -1 });
  });

  it("parses '1X2 H (+1.5)'", () => {
    expect(parseMarketType("1X2 H (+1.5)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: 1.5 });
  });

  it("parses '1X2 H (0)' (pickem)", () => {
    expect(parseMarketType("1X2 H (0)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: 0 });
  });

  it("parses legacy '1X2 H (-1) - 1T' (handicap first half)", () => {
    expect(parseMarketType("1X2 H (-1) - 1T")).toEqual({ base_key: "1x2_handicap", period: "1h", line: -1 });
  });

  it("parses legacy '1X2 H (-1.5) - 2T' (handicap second half)", () => {
    expect(parseMarketType("1X2 H (-1.5) - 2T")).toEqual({ base_key: "1x2_handicap", period: "2h", line: -1.5 });
  });

  it("parses legacy '1X2 H (0) - 2T' (handicap pickem second half)", () => {
    expect(parseMarketType("1X2 H (0) - 2T")).toEqual({ base_key: "1x2_handicap", period: "2h", line: 0 });
  });

  it("parses legacy-style '1X2 H (-1) 1T' (no hyphen)", () => {
    expect(parseMarketType("1X2 H (-1) 1T")).toEqual({ base_key: "1x2_handicap", period: "1h", line: -1 });
  });

  it("parses legacy '1X2 Asian H (-1)' (Bug B)", () => {
    expect(parseMarketType("1X2 Asian H (-1)")).toEqual({ base_key: "asian_handicap", period: "ft", line: -1 });
  });

  it("parses legacy '1X2 Asian H (-1) - 2T' (Bug B with period)", () => {
    expect(parseMarketType("1X2 Asian H (-1) - 2T")).toEqual({ base_key: "asian_handicap", period: "2h", line: -1 });
  });

  it("parses legacy '1X2 Asian H (+1.5) - 1T'", () => {
    expect(parseMarketType("1X2 Asian H (+1.5) - 1T")).toEqual({ base_key: "asian_handicap", period: "1h", line: 1.5 });
  });

  it("parses legacy '1x2 con Handicap (-1)' (Bug C full time)", () => {
    expect(parseMarketType("1x2 con Handicap (-1)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: -1 });
  });

  it("parses legacy '1x2 con Handicap - 1° tempo (-1)' (Bug C first half)", () => {
    expect(parseMarketType("1x2 con Handicap - 1° tempo (-1)")).toEqual({ base_key: "1x2_handicap", period: "1h", line: -1 });
  });

  it("parses legacy '1x2 con Handicap - 2° tempo (+1.5)' (Bug C second half)", () => {
    expect(parseMarketType("1x2 con Handicap - 2° tempo (+1.5)")).toEqual({ base_key: "1x2_handicap", period: "2h", line: 1.5 });
  });

  it("parses legacy 'Handicap Asiatico (-1)' with optional period support", () => {
    expect(parseMarketType("Handicap Asiatico (-1)")).toEqual({ base_key: "asian_handicap", period: "ft", line: -1 });
  });

  it("parses legacy 'Handicap Asiatico (-1) 1T'", () => {
    expect(parseMarketType("Handicap Asiatico (-1) 1T")).toEqual({ base_key: "asian_handicap", period: "1h", line: -1 });
  });
});

describe("parseMarketType — legacy combo", () => {
  it("parses '1X2 + Ogni Squadra Segna' (Bug D: 1X2 + BTTS combo)", () => {
    expect(parseMarketType("1X2 + Ogni Squadra Segna")).toEqual({ base_key: "1x2_btts", period: "ft", line: null });
  });

  it("parses '1X2 + Ogni Squadra Segna - 1T'", () => {
    expect(parseMarketType("1X2 + Ogni Squadra Segna - 1T")).toEqual({ base_key: "1x2_btts", period: "1h", line: null });
  });
});

describe("parseMarketType — legacy asian totals and 2-way moneyline", () => {
  it("parses 'Totale Asiatico 2.5'", () => {
    expect(parseMarketType("Totale Asiatico 2.5")).toEqual({ base_key: "asian_total", period: "ft", line: 2.5 });
  });

  it("parses 'Totale Asiatico 1.25 - 1T'", () => {
    expect(parseMarketType("Totale Asiatico 1.25 - 1T")).toEqual({ base_key: "asian_total", period: "1h", line: 1.25 });
  });

  it("parses 'Totale Asiatico 3.75 - 2T'", () => {
    expect(parseMarketType("Totale Asiatico 3.75 - 2T")).toEqual({ base_key: "asian_total", period: "2h", line: 3.75 });
  });

  it("parses 'Squadra 1 Totale Asiatico (1.25)'", () => {
    expect(parseMarketType("Squadra 1 Totale Asiatico (1.25)")).toEqual({ base_key: "total_team_asian", period: "ft", line: 1.25 });
  });

  it("parses 'Squadra 2 Totale Asiatico (0.75) - 2T'", () => {
    expect(parseMarketType("Squadra 2 Totale Asiatico (0.75) - 2T")).toEqual({ base_key: "total_team_asian", period: "2h", line: 0.75 });
  });

  it("parses 'Vincente Incontro' (2-way moneyline)", () => {
    expect(parseMarketType("Vincente Incontro")).toEqual({ base_key: "winner", period: "ft", line: null });
  });

  it("parses 'Vincente Incontro - 1T'", () => {
    expect(parseMarketType("Vincente Incontro - 1T")).toEqual({ base_key: "winner", period: "1h", line: null });
  });

  it("parses 'Vincente Incontro - 2T'", () => {
    expect(parseMarketType("Vincente Incontro - 2T")).toEqual({ base_key: "winner", period: "2h", line: null });
  });
});

describe("parseMarketType — both halves + exact goals", () => {
  it("parses legacy 'Segna Entrambi i Tempi'", () => {
    expect(parseMarketType("Segna Entrambi i Tempi")).toEqual({ base_key: "both_halves_score", period: "ft", line: null });
  });

  it("parses legacy 'Segna In Entrambi i Tempi'", () => {
    expect(parseMarketType("Segna In Entrambi i Tempi")).toEqual({ base_key: "both_halves_score", period: "ft", line: null });
  });

  it("parses legacy 'Goal In Entrambi i Tempi'", () => {
    expect(parseMarketType("Goal In Entrambi i Tempi")).toEqual({ base_key: "both_halves_score", period: "ft", line: null });
  });

  it("parses legacy 'Numero Esatto (2)' (exact goals count)", () => {
    expect(parseMarketType("Numero Esatto (2)")).toEqual({ base_key: "exact_goals", period: "ft", line: 2 });
  });

  it("parses legacy 'Numero Esatto (2) - 1T'", () => {
    expect(parseMarketType("Numero Esatto (2) - 1T")).toEqual({ base_key: "exact_goals", period: "1h", line: 2 });
  });

  it("parses legacy 'Numero Esatto (3) - 2T'", () => {
    expect(parseMarketType("Numero Esatto (3) - 2T")).toEqual({ base_key: "exact_goals", period: "2h", line: 3 });
  });
});

describe("parseMarketType — special", () => {
  it("parses 'Risultato Esatto'", () => {
    expect(parseMarketType("Risultato Esatto")).toEqual({ base_key: "correct_score", period: "ft", line: null });
  });

  it("parses 'Risultato Esatto 1° Tempo'", () => {
    expect(parseMarketType("Risultato Esatto 1° Tempo")).toEqual({ base_key: "correct_score", period: "1h", line: null });
  });

  it("parses 'Draw No Bet'", () => {
    expect(parseMarketType("Draw No Bet")).toEqual({ base_key: "dnb", period: "ft", line: null });
  });

  it("parses 'Draw No Bet 1T'", () => {
    expect(parseMarketType("Draw No Bet 1T")).toEqual({ base_key: "dnb", period: "1h", line: null });
  });

  it("parses 'Esito 1T/Finale'", () => {
    expect(parseMarketType("Esito 1T/Finale")).toEqual({ base_key: "htft", period: "ft", line: null });
  });

  it("parses legacy 'PT-F' (HT/FT alias with 9 V1/X/V2 outcomes)", () => {
    expect(parseMarketType("PT-F")).toEqual({ base_key: "htft", period: "ft", line: null });
  });

  it("parses legacy 'Tempo/Tempo' (HT/FT alias with 9 half-by-half outcomes)", () => {
    expect(parseMarketType("Tempo/Tempo")).toEqual({ base_key: "htft", period: "ft", line: null });
  });

  // Wave 17: 'PT-F + Totale (N)' now maps to htft_and_total_ft (new compound canonical).
  // Previously the anchored htft rule ensured it did NOT fall into bare htft.
  it("regression: 'PT-F + Totale (2.5)' maps to htft_and_total_ft (not bare htft)", () => {
    expect(parseMarketType("PT-F + Totale (2.5)"))
      .toEqual({ base_key: "htft_and_total", period: "ft", line: 2.5 });
  });

  it("parses legacy 'Segna Goal' (first team to score 1/X/2)", () => {
    expect(parseMarketType("Segna Goal")).toEqual({ base_key: "first_team_to_score", period: "ft", line: null });
  });
});

describe("parseMarketType — wave A+ no-line patterns", () => {
  it("parses legacy 'Squadra 1 Segna Nei Tempi' (goal halves compare team 1)", () => {
    expect(parseMarketType("Squadra 1 Segna Nei Tempi")).toEqual({ base_key: "team1_halves_goal_compare", period: "ft", line: null });
  });

  it("parses legacy 'Squadra 2 Segna Nei Tempi'", () => {
    expect(parseMarketType("Squadra 2 Segna Nei Tempi")).toEqual({ base_key: "team2_halves_goal_compare", period: "ft", line: null });
  });

  it("parses legacy 'Doppia Chance + Entrambe Le Squadre Segnano'", () => {
    expect(parseMarketType("Doppia Chance + Entrambe Le Squadre Segnano")).toEqual({ base_key: "dc_btts", period: "ft", line: null });
  });

  it("parses legacy 'Doppia Chance + Entrambe Le Squadre Segnano - 1T'", () => {
    expect(parseMarketType("Doppia Chance + Entrambe Le Squadre Segnano - 1T")).toEqual({ base_key: "dc_btts", period: "1h", line: null });
  });

  it("parses legacy 'Doppia Chance + Entrambe Le Squadre Segnano - 2T'", () => {
    expect(parseMarketType("Doppia Chance + Entrambe Le Squadre Segnano - 2T")).toEqual({ base_key: "dc_btts", period: "2h", line: null });
  });

  it("parses legacy 'Pareggio In Almeno Un Tempo'", () => {
    expect(parseMarketType("Pareggio In Almeno Un Tempo")).toEqual({ base_key: "draw_any_half", period: "ft", line: null });
  });

  it("parses legacy 'Individuale Totale 1 Pari /Dispari' (note: space after 'Pari')", () => {
    expect(parseMarketType("Individuale Totale 1 Pari /Dispari")).toEqual({ base_key: "team1_total_oe", period: "ft", line: null });
  });

  it("parses legacy 'Individuale Totale 2 Pari /Dispari'", () => {
    expect(parseMarketType("Individuale Totale 2 Pari /Dispari")).toEqual({ base_key: "team2_total_oe", period: "ft", line: null });
  });

  it("parses legacy 'Individuale Totale 1 Pari/Dispari' (no space variant)", () => {
    expect(parseMarketType("Individuale Totale 1 Pari/Dispari")).toEqual({ base_key: "team1_total_oe", period: "ft", line: null });
  });

  it("parses legacy 'Squadra 1 Vince Uno Dei Due Tempi'", () => {
    expect(parseMarketType("Squadra 1 Vince Uno Dei Due Tempi")).toEqual({ base_key: "team1_wins_any_half", period: "ft", line: null });
  });

  it("parses legacy 'Squadra 2 Vince Uno Dei Due Tempi'", () => {
    expect(parseMarketType("Squadra 2 Vince Uno Dei Due Tempi")).toEqual({ base_key: "team2_wins_any_half", period: "ft", line: null });
  });

  it("parses legacy 'Ultimo Goal - 1T'", () => {
    expect(parseMarketType("Ultimo Goal - 1T")).toEqual({ base_key: "last_goal", period: "1h", line: null });
  });

  it("parses legacy 'Ultimo Goal - 2T'", () => {
    expect(parseMarketType("Ultimo Goal - 2T")).toEqual({ base_key: "last_goal", period: "2h", line: null });
  });
});

describe("parseMarketType — wave B line=N patterns", () => {
  // Totale 3Opzioni (N) — generic 3-way total with line
  it("parses 'Totale 3Opzioni (2)' (FT, line=2)", () => {
    expect(parseMarketType("Totale 3Opzioni (2)")).toEqual({ base_key: "total_3way", period: "ft", line: 2 });
  });

  it("parses 'Totale 3Opzioni (1) - 1T'", () => {
    expect(parseMarketType("Totale 3Opzioni (1) - 1T")).toEqual({ base_key: "total_3way", period: "1h", line: 1 });
  });

  it("parses 'Totale 3Opzioni (2) - 2T'", () => {
    expect(parseMarketType("Totale 3Opzioni (2) - 2T")).toEqual({ base_key: "total_3way", period: "2h", line: 2 });
  });

  // Totale X Individuale 3Opzioni (N) — team-specific 3-way
  it("parses 'Totale 1 Individuale 3Opzioni (1)'", () => {
    expect(parseMarketType("Totale 1 Individuale 3Opzioni (1)")).toEqual({ base_key: "team1_total_3way", period: "ft", line: 1 });
  });

  it("parses 'Totale 1 Individuale 3Opzioni (2) - 1T'", () => {
    expect(parseMarketType("Totale 1 Individuale 3Opzioni (2) - 1T")).toEqual({ base_key: "team1_total_3way", period: "1h", line: 2 });
  });

  it("parses 'Totale 2 Individuale 3Opzioni (1) - 2T'", () => {
    expect(parseMarketType("Totale 2 Individuale 3Opzioni (1) - 2T")).toEqual({ base_key: "team2_total_3way", period: "2h", line: 1 });
  });

  // N, Risultato + Totale (X.Y) — team win/dnb + U/O combo
  it("parses '1, Risultato + Totale (2.5)'", () => {
    expect(parseMarketType("1, Risultato + Totale (2.5)")).toEqual({ base_key: "team1_result_total", period: "ft", line: 2.5 });
  });

  it("parses '1, Risultato + Totale (1.5) - 1T'", () => {
    expect(parseMarketType("1, Risultato + Totale (1.5) - 1T")).toEqual({ base_key: "team1_result_total", period: "1h", line: 1.5 });
  });

  it("parses '2, Risultato + Totale (3.5) - 2T'", () => {
    expect(parseMarketType("2, Risultato + Totale (3.5) - 2T")).toEqual({ base_key: "team2_result_total", period: "2h", line: 3.5 });
  });

  // Goal Successivo (N) — who scores next goal N
  it("parses 'Goal Successivo (1)'", () => {
    expect(parseMarketType("Goal Successivo (1)")).toEqual({ base_key: "next_goal", period: "ft", line: 1 });
  });

  it("parses 'Goal Successivo (1) - 1T'", () => {
    expect(parseMarketType("Goal Successivo (1) - 1T")).toEqual({ base_key: "next_goal", period: "1h", line: 1 });
  });

  it("parses 'Goal Successivo (2) - 2T'", () => {
    expect(parseMarketType("Goal Successivo (2) - 2T")).toEqual({ base_key: "next_goal", period: "2h", line: 2 });
  });

  // Vittoria Di (N) — team wins by exactly N goals (Sì/No per team)
  it("parses 'Vittoria Di (1)'", () => {
    expect(parseMarketType("Vittoria Di (1)")).toEqual({ base_key: "win_by_margin", period: "ft", line: 1 });
  });

  it("parses 'Vittoria Di (3)'", () => {
    expect(parseMarketType("Vittoria Di (3)")).toEqual({ base_key: "win_by_margin", period: "ft", line: 3 });
  });

  // Una Qualsiasi Squadra Vince Di (N)
  it("parses 'Una Qualsiasi Squadra Vince Di (2)'", () => {
    expect(parseMarketType("Una Qualsiasi Squadra Vince Di (2)")).toEqual({ base_key: "any_team_win_by_margin", period: "ft", line: 2 });
  });

  // Sfida Al (N) — race to N goals
  it("parses 'Sfida Al (3)'", () => {
    expect(parseMarketType("Sfida Al (3)")).toEqual({ base_key: "race_to_goals", period: "ft", line: 3 });
  });

  it("parses 'Sfida Al (2)'", () => {
    expect(parseMarketType("Sfida Al (2)")).toEqual({ base_key: "race_to_goals", period: "ft", line: 2 });
  });

  // Pareggio + Totale (X.Y)
  it("parses 'Pareggio + Totale (1.5)'", () => {
    expect(parseMarketType("Pareggio + Totale (1.5)")).toEqual({ base_key: "draw_and_u_o", period: "ft", line: 1.5 });
  });

  it("parses 'Pareggio + Totale (1.5) - 1T'", () => {
    expect(parseMarketType("Pareggio + Totale (1.5) - 1T")).toEqual({ base_key: "draw_and_u_o", period: "1h", line: 1.5 });
  });

  it("parses 'Pareggio + Totale (2.5) - 2T'", () => {
    expect(parseMarketType("Pareggio + Totale (2.5) - 2T")).toEqual({ base_key: "draw_and_u_o", period: "2h", line: 2.5 });
  });

  // Wave 20: 11T/12T = basketball aggregate halves → 1h/2h (NBA convention).
  it("Wave 20: 'Totale 3Opzioni (1) - 11T' → total_3way_1h line=1", () => {
    expect(parseMarketType("Totale 3Opzioni (1) - 11T"))
      .toEqual({ base_key: "total_3way", period: "1h", line: 1 });
  });
});

describe("parseMarketType — wave 12b team nolose + team total", () => {
  it("parses '1X + Squadra 1 Totale (1.5)' → team1_nolose_and_team_total_ft", () => {
    expect(parseMarketType("1X + Squadra 1 Totale (1.5)")).toEqual({ base_key: "team1_nolose_and_team_total", period: "ft", line: 1.5 });
  });

  it("parses '1X + Squadra 1 Totale (1.5) - 1T'", () => {
    expect(parseMarketType("1X + Squadra 1 Totale (1.5) - 1T")).toEqual({ base_key: "team1_nolose_and_team_total", period: "1h", line: 1.5 });
  });

  it("parses 'Doppia Chance + Totale Squadra 1 (1.5)' (alt naming)", () => {
    expect(parseMarketType("Doppia Chance + Totale Squadra 1 (1.5)")).toEqual({ base_key: "team1_nolose_and_team_total", period: "ft", line: 1.5 });
  });

  it("parses '2X + Squadra 2 Totale (1.5)' → team2_nolose_and_team_total", () => {
    expect(parseMarketType("2X + Squadra 2 Totale (1.5)")).toEqual({ base_key: "team2_nolose_and_team_total", period: "ft", line: 1.5 });
  });

  it("parses 'Doppia Chance + Totale Squadra 2 (1.5) - 2T' (observed form)", () => {
    expect(parseMarketType("Doppia Chance + Totale Squadra 2 (1.5) - 2T")).toEqual({ base_key: "team2_nolose_and_team_total", period: "2h", line: 1.5 });
  });
});

describe("parseMarketType — wave 12c BTTS combos", () => {
  it("parses 'Entrambe Le Squadre Segnano + Doppia Chance' → no_btts_and_dc_ft", () => {
    expect(parseMarketType("Entrambe Le Squadre Segnano + Doppia Chance")).toEqual({ base_key: "no_btts_and_dc", period: "ft", line: null });
  });

  it("parses 'Entrambe Le Squadre Segnano + Doppia Chance - 2T' → no_btts_and_dc_2h", () => {
    expect(parseMarketType("Entrambe Le Squadre Segnano + Doppia Chance - 2T")).toEqual({ base_key: "no_btts_and_dc", period: "2h", line: null });
  });

  it("parses 'Totale E Entrambe A Segno (3.5)' → btts_and_total_ft", () => {
    expect(parseMarketType("Totale E Entrambe A Segno (3.5)")).toEqual({ base_key: "btts_and_total", period: "ft", line: 3.5 });
  });

  it("parses 'Totale E Entrambe A Segno (2.5) - 1T' → btts_and_total_1h", () => {
    expect(parseMarketType("Totale E Entrambe A Segno (2.5) - 1T")).toEqual({ base_key: "btts_and_total", period: "1h", line: 2.5 });
  });

  it("parses 'Almeno Una Delle Due Squadre Non Segna + Totale (2.5)' → no_btts_and_total_ft", () => {
    expect(parseMarketType("Almeno Una Delle Due Squadre Non Segna + Totale (2.5)")).toEqual({ base_key: "no_btts_and_total", period: "ft", line: 2.5 });
  });

  it("parses 'Almeno Una Delle Due Squadre Non Segna + Totale (1.5) - 1T' → no_btts_and_total_1h", () => {
    expect(parseMarketType("Almeno Una Delle Due Squadre Non Segna + Totale (1.5) - 1T")).toEqual({ base_key: "no_btts_and_total", period: "1h", line: 1.5 });
  });
});

describe("parseMarketType — wave 12a team win + team total combo", () => {
  it("parses legacy 'V1 + Totale 1 (1.5)' → team1_win_and_team_total_ft", () => {
    expect(parseMarketType("V1 + Totale 1 (1.5)")).toEqual({ base_key: "team1_win_and_team_total", period: "ft", line: 1.5 });
  });

  it("parses legacy 'V1 + Totale 1 (1.5) - 1T' → team1_win_and_team_total_1h", () => {
    expect(parseMarketType("V1 + Totale 1 (1.5) - 1T")).toEqual({ base_key: "team1_win_and_team_total", period: "1h", line: 1.5 });
  });

  it("parses legacy 'V1 + Totale 1 (1.5) - 2T' → team1_win_and_team_total_2h", () => {
    expect(parseMarketType("V1 + Totale 1 (1.5) - 2T")).toEqual({ base_key: "team1_win_and_team_total", period: "2h", line: 1.5 });
  });

  it("parses legacy 'V2 + Totale 2 (2.5)' → team2_win_and_team_total_ft", () => {
    expect(parseMarketType("V2 + Totale 2 (2.5)")).toEqual({ base_key: "team2_win_and_team_total", period: "ft", line: 2.5 });
  });

  it("parses legacy 'V2 + Totale 2 (1.5) - 2T' → team2_win_and_team_total_2h", () => {
    expect(parseMarketType("V2 + Totale 2 (1.5) - 2T")).toEqual({ base_key: "team2_win_and_team_total", period: "2h", line: 1.5 });
  });
});

describe("parseMarketType — wave 11 team both-halves score", () => {
  it("parses legacy 'Squadra 1 Segna Un Goal In Entrambi I Tempi' → team1_both_halves_score_ft", () => {
    expect(parseMarketType("Squadra 1 Segna Un Goal In Entrambi I Tempi")).toEqual({ base_key: "team1_both_halves_score", period: "ft", line: null });
  });

  it("parses legacy 'Squadra 2 Segna Un Goal In Entrambi I Tempi' → team2_both_halves_score_ft", () => {
    expect(parseMarketType("Squadra 2 Segna Un Goal In Entrambi I Tempi")).toEqual({ base_key: "team2_both_halves_score", period: "ft", line: null });
  });
});

describe("parseMarketType — wave 9 alias regex", () => {
  it("parses legacy 'Tempo Regolamentare Doppia Chance' → dc_ft", () => {
    expect(parseMarketType("Tempo Regolamentare Doppia Chance")).toEqual({ base_key: "dc", period: "ft", line: null });
  });

  it("parses legacy 'Quale Squadra Segnerà Punti Per Prima?' → first_team_to_score", () => {
    expect(parseMarketType("Quale Squadra Segnerà Punti Per Prima?")).toEqual({ base_key: "first_team_to_score", period: "ft", line: null });
  });

  it("parses legacy 'Vittoria (2 Opzioni)' → winner_ft", () => {
    expect(parseMarketType("Vittoria (2 Opzioni)")).toEqual({ base_key: "winner", period: "ft", line: null });
  });

  it("parses legacy 'Risultato Ed Entrambe Le Squadre Segnano' → 1x2_btts_ft", () => {
    expect(parseMarketType("Risultato Ed Entrambe Le Squadre Segnano")).toEqual({ base_key: "1x2_btts", period: "ft", line: null });
  });

  it("parses legacy 'Risultato Ed Entrambe Le Squadre Segnano - 2T' → 1x2_btts_2h", () => {
    expect(parseMarketType("Risultato Ed Entrambe Le Squadre Segnano - 2T")).toEqual({ base_key: "1x2_btts", period: "2h", line: null });
  });

  it("parses legacy 'Gol totali - Pari/Dispari - Primo tempo' → oe_1h", () => {
    expect(parseMarketType("Gol totali - Pari/Dispari - Primo tempo")).toEqual({ base_key: "odd_even", period: "1h", line: null });
  });
});

describe("parseMarketType — wave 10 new canonicals (T/T handicap, set, team win-to-nil)", () => {
  // T/T Handicap (2-way handicap for esports / tennis / volley)
  it("parses legacy 'T/T Handicap (-1.5)' → 2way_handicap_ft", () => {
    expect(parseMarketType("T/T Handicap (-1.5)")).toEqual({ base_key: "2way_handicap", period: "ft", line: -1.5 });
  });

  it("parses legacy 'T/T Handicap (+2.5) - 1T' → 2way_handicap_1h", () => {
    expect(parseMarketType("T/T Handicap (+2.5) - 1T")).toEqual({ base_key: "2way_handicap", period: "1h", line: 2.5 });
  });

  it("parses legacy 'T/T Handicap (-3.5) - 2T' → 2way_handicap_2h", () => {
    expect(parseMarketType("T/T Handicap (-3.5) - 2T")).toEqual({ base_key: "2way_handicap", period: "2h", line: -3.5 });
  });

  it("parses legacy 'T/T Handicap (0)' pickem", () => {
    expect(parseMarketType("T/T Handicap (0)")).toEqual({ base_key: "2way_handicap", period: "ft", line: 0 });
  });

  // Vince a Zero periods
  it("parses legacy 'Vince a Zero - 1T' → win_to_nil_1h", () => {
    expect(parseMarketType("Vince a Zero - 1T")).toEqual({ base_key: "win_to_nil", period: "1h", line: null });
  });

  it("parses legacy 'Vince a Zero - 2T' → win_to_nil_2h", () => {
    expect(parseMarketType("Vince a Zero - 2T")).toEqual({ base_key: "win_to_nil", period: "2h", line: null });
  });

  it("still parses legacy 'Vince a Zero' (no period) → win_to_nil_ft", () => {
    expect(parseMarketType("Vince a Zero")).toEqual({ base_key: "win_to_nil", period: "ft", line: null });
  });

  // Squadra X Vince A Zero (team-specific)
  it("parses legacy 'Squadra 1 Vince A Zero' → team1_win_to_nil_ft", () => {
    expect(parseMarketType("Squadra 1 Vince A Zero")).toEqual({ base_key: "team1_win_to_nil", period: "ft", line: null });
  });

  it("parses legacy 'Squadra 1 Vince A Zero - 1T' → team1_win_to_nil_1h", () => {
    expect(parseMarketType("Squadra 1 Vince A Zero - 1T")).toEqual({ base_key: "team1_win_to_nil", period: "1h", line: null });
  });

  it("parses legacy 'Squadra 2 Vince A Zero - 2T' → team2_win_to_nil_2h", () => {
    expect(parseMarketType("Squadra 2 Vince A Zero - 2T")).toEqual({ base_key: "team2_win_to_nil", period: "2h", line: null });
  });

  // Tennis set family
  it("parses legacy 'Set Handicap (-1.5)' → set_handicap_ft", () => {
    expect(parseMarketType("Set Handicap (-1.5)")).toEqual({ base_key: "set_handicap", period: "ft", line: -1.5 });
  });

  it("parses legacy 'Set Handicap (1.5)' unsigned positive", () => {
    expect(parseMarketType("Set Handicap (1.5)")).toEqual({ base_key: "set_handicap", period: "ft", line: 1.5 });
  });

  it("parses legacy 'Totale Set (2.5)' → total_sets_ft", () => {
    expect(parseMarketType("Totale Set (2.5)")).toEqual({ base_key: "total_sets", period: "ft", line: 2.5 });
  });

  it("parses legacy 'Risultato Set' → set_result_ft", () => {
    expect(parseMarketType("Risultato Set")).toEqual({ base_key: "set_result", period: "ft", line: null });
  });
});

describe("parseMarketType — wave 8 trailing-dash tolerance (legacy scraper bug)", () => {
  it("parses legacy 'U/O 9.5 - ' (trailing dash + space) → u_o_ft line 9.5", () => {
    expect(parseMarketType("U/O 9.5 - ")).toEqual({ base_key: "u_o", period: "ft", line: 9.5 });
  });

  it("parses legacy 'U/O 10 -' (trailing dash no space) → u_o_ft line 10", () => {
    expect(parseMarketType("U/O 10 -")).toEqual({ base_key: "u_o", period: "ft", line: 10 });
  });

  it("parses legacy 'Totale 3Opzioni (9) - ' → total_3way_ft line 9", () => {
    expect(parseMarketType("Totale 3Opzioni (9) - ")).toEqual({ base_key: "total_3way", period: "ft", line: 9 });
  });

  it("parses legacy 'Goal Successivo (2) - ' → next_goal_ft line 2", () => {
    expect(parseMarketType("Goal Successivo (2) - ")).toEqual({ base_key: "next_goal", period: "ft", line: 2 });
  });

  it("parses legacy 'Numero Esatto (3) - ' → exact_goals_ft line 3", () => {
    expect(parseMarketType("Numero Esatto (3) - ")).toEqual({ base_key: "exact_goals", period: "ft", line: 3 });
  });

  it("parses legacy '1, Risultato + Totale (2.5) - ' → team1_result_total_ft line 2.5", () => {
    expect(parseMarketType("1, Risultato + Totale (2.5) - ")).toEqual({ base_key: "team1_result_total", period: "ft", line: 2.5 });
  });

  it("parses legacy 'Vincente Incontro - ' → winner_ft", () => {
    expect(parseMarketType("Vincente Incontro - ")).toEqual({ base_key: "winner", period: "ft", line: null });
  });

  it("parses legacy '1X2 + Ogni Squadra Segna - ' → 1x2_btts_ft", () => {
    expect(parseMarketType("1X2 + Ogni Squadra Segna - ")).toEqual({ base_key: "1x2_btts", period: "ft", line: null });
  });

  // Wave 20: 11T → 1h (basket aggregate half)
  it("Wave 20: 'U/O 9.5 - 11T' → u_o_1h line=9.5", () => {
    expect(parseMarketType("U/O 9.5 - 11T"))
      .toEqual({ base_key: "u_o", period: "1h", line: 9.5 });
  });

  it("still matches 'U/O 9.5 - 1T' (valid period)", () => {
    expect(parseMarketType("U/O 9.5 - 1T")).toEqual({ base_key: "u_o", period: "1h", line: 9.5 });
  });
});

describe("parseMarketType — wave 7 corner markets", () => {
  it("parses legacy 'Totale calci d'angolo 9.5' → total_corners_ft", () => {
    expect(parseMarketType("Totale calci d'angolo 9.5")).toEqual({ base_key: "total_corners", period: "ft", line: 9.5 });
  });

  it("parses legacy 'Totale calci d'angolo 10.5' integer-like", () => {
    expect(parseMarketType("Totale calci d'angolo 10.5")).toEqual({ base_key: "total_corners", period: "ft", line: 10.5 });
  });

  it("parses legacy 'Totale calci d'angolo - 1° tempo 4.5' → total_corners_1h", () => {
    expect(parseMarketType("Totale calci d'angolo - 1° tempo 4.5")).toEqual({ base_key: "total_corners", period: "1h", line: 4.5 });
  });

  it("parses legacy 'Totale calci d'angolo - 2° tempo 6.5' → total_corners_2h", () => {
    expect(parseMarketType("Totale calci d'angolo - 2° tempo 6.5")).toEqual({ base_key: "total_corners", period: "2h", line: 6.5 });
  });

  it("parses legacy 'Più calci d'angolo' → corner_winner_ft", () => {
    expect(parseMarketType("Più calci d'angolo")).toEqual({ base_key: "corner_winner", period: "ft", line: null });
  });

  it("parses legacy 'Più calci d'angolo - 1° tempo' → corner_winner_1h", () => {
    expect(parseMarketType("Più calci d'angolo - 1° tempo")).toEqual({ base_key: "corner_winner", period: "1h", line: null });
  });

  it("parses legacy 'Più calci d'angolo - 2° tempo' → corner_winner_2h", () => {
    expect(parseMarketType("Più calci d'angolo - 2° tempo")).toEqual({ base_key: "corner_winner", period: "2h", line: null });
  });

  it("parses legacy 'Calci d'angolo - 1X2 con Handicap (-2)' → corner_1x2_handicap_ft", () => {
    expect(parseMarketType("Calci d'angolo - 1X2 con Handicap (-2)")).toEqual({ base_key: "corner_1x2_handicap", period: "ft", line: -2 });
  });

  it("parses legacy 'Calci d'angolo - 1X2 con Handicap (+3)' positive line", () => {
    expect(parseMarketType("Calci d'angolo - 1X2 con Handicap (+3)")).toEqual({ base_key: "corner_1x2_handicap", period: "ft", line: 3 });
  });

  it("parses legacy 'Corner successivo, puntata annullata in caso di nessun corner, (1)' → next_corner_ft line=1", () => {
    expect(parseMarketType("Corner successivo, puntata annullata in caso di nessun corner, (1)")).toEqual({ base_key: "next_corner", period: "ft", line: 1 });
  });

  it("parses legacy 'Corner successivo, puntata annullata in caso di nessun corner, (2)' line=2", () => {
    expect(parseMarketType("Corner successivo, puntata annullata in caso di nessun corner, (2)")).toEqual({ base_key: "next_corner", period: "ft", line: 2 });
  });
});

describe("parseMarketType — wave 6 legacy verbose forms", () => {
  it("parses legacy 'Handicap (-0.5)' → 1x2_h_ft", () => {
    expect(parseMarketType("Handicap (-0.5)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: -0.5 });
  });

  it("parses legacy 'Handicap (+0.5)' → 1x2_h_ft", () => {
    expect(parseMarketType("Handicap (+0.5)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: 0.5 });
  });

  it("parses legacy 'Handicap (-1)' integer line", () => {
    expect(parseMarketType("Handicap (-1)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: -1 });
  });

  it("parses legacy 'Handicap (-1.5)' line", () => {
    expect(parseMarketType("Handicap (-1.5)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: -1.5 });
  });

  it("parses legacy 'Handicap - 1° tempo (-0.5)' period-in-middle → 1x2_h_1h", () => {
    expect(parseMarketType("Handicap - 1° tempo (-0.5)")).toEqual({ base_key: "1x2_handicap", period: "1h", line: -0.5 });
  });

  it("parses legacy 'Handicap Asiatico - 1° tempo (-0.5)' → asian_handicap_1h", () => {
    expect(parseMarketType("Handicap Asiatico - 1° tempo (-0.5)")).toEqual({ base_key: "asian_handicap", period: "1h", line: -0.5 });
  });

  it("parses legacy 'Handicap Asiatico - 2° tempo (+1.5)' → asian_handicap_2h", () => {
    expect(parseMarketType("Handicap Asiatico - 2° tempo (+1.5)")).toEqual({ base_key: "asian_handicap", period: "2h", line: 1.5 });
  });

  it("parses legacy 'Totale Asiatico - 1° tempo 1.5' → asian_total_1h", () => {
    expect(parseMarketType("Totale Asiatico - 1° tempo 1.5")).toEqual({ base_key: "asian_total", period: "1h", line: 1.5 });
  });

  it("parses legacy 'Totale Asiatico - 2° tempo 2' integer line → asian_total_2h", () => {
    expect(parseMarketType("Totale Asiatico - 2° tempo 2")).toEqual({ base_key: "asian_total", period: "2h", line: 2 });
  });

  it("parses legacy 'Gol segnato in entrambi i tempi' → both_halves_score", () => {
    expect(parseMarketType("Gol segnato in entrambi i tempi")).toEqual({ base_key: "both_halves_score", period: "ft", line: null });
  });

  it("parses legacy 'Entrambe le squadre segnano' (no period) → gg_ng_ft", () => {
    expect(parseMarketType("Entrambe le squadre segnano")).toEqual({ base_key: "gg_ng", period: "ft", line: null });
  });

  it("parses legacy 'Entrambe le squadre segnano - 2° tempo (Gol/No Gol)' → gg_ng_2h", () => {
    expect(parseMarketType("Entrambe le squadre segnano - 2° tempo (Gol/No Gol)")).toEqual({ base_key: "gg_ng", period: "2h", line: null });
  });

  it("parses legacy 'Entrambe le squadre segnano - 1° tempo' (without GG/NG suffix) → gg_ng_1h", () => {
    expect(parseMarketType("Entrambe le squadre segnano - 1° tempo")).toEqual({ base_key: "gg_ng", period: "1h", line: null });
  });

  it("parses legacy 'Vince a Zero' → win_to_nil_ft", () => {
    expect(parseMarketType("Vince a Zero")).toEqual({ base_key: "win_to_nil", period: "ft", line: null });
  });
});

describe("parseMarketType — asian U/O detection (quarter lines)", () => {
  it("routes 'U/O 4.75' (legacy asian) to asian_total (NOT u_o)", () => {
    expect(parseMarketType("U/O 4.75")).toEqual({ base_key: "asian_total", period: "ft", line: 4.75 });
  });

  it("routes 'U/O 1.25' to asian_total", () => {
    expect(parseMarketType("U/O 1.25")).toEqual({ base_key: "asian_total", period: "ft", line: 1.25 });
  });

  it("routes 'U/O 1T 1.25' (legacy period-then-line) to asian_total_1h", () => {
    expect(parseMarketType("U/O 1T 1.25")).toEqual({ base_key: "asian_total", period: "1h", line: 1.25 });
  });

  it("routes 'U/O 3.25 - 2T' (legacy-style) to asian_total_2h", () => {
    expect(parseMarketType("U/O 3.25 - 2T")).toEqual({ base_key: "asian_total", period: "2h", line: 3.25 });
  });

  it("still routes half line 'U/O 4.5' to u_o (unchanged)", () => {
    expect(parseMarketType("U/O 4.5")).toEqual({ base_key: "u_o", period: "ft", line: 4.5 });
  });

  it("still routes integer 'U/O 3' to u_o (unchanged)", () => {
    expect(parseMarketType("U/O 3")).toEqual({ base_key: "u_o", period: "ft", line: 3 });
  });
});

describe("parseMarketType — unknown NT period rejection", () => {
  // Wave 20: 11T → 1h, 12T → 2h (basket aggregate halves)
  it("Wave 20: 'Pari/Dispari - 12T' → oe_2h", () => {
    expect(parseMarketType("Pari/Dispari - 12T"))
      .toEqual({ base_key: "odd_even", period: "2h", line: null });
  });

  it("Wave 20: '1X2 - 12T' → 1x2_2h", () => {
    expect(parseMarketType("1X2 - 12T"))
      .toEqual({ base_key: "1x2", period: "2h", line: null });
  });

  it("Wave 20: 'GG/NG - 11T' → gg_ng_1h", () => {
    expect(parseMarketType("GG/NG - 11T"))
      .toEqual({ base_key: "gg_ng", period: "1h", line: null });
  });

  it("Wave 20: 'DC - 11T' → dc_1h", () => {
    expect(parseMarketType("DC - 11T"))
      .toEqual({ base_key: "dc", period: "1h", line: null });
  });

  it("still matches valid 'GG/NG - 3T' (basket period 3)", () => {
    expect(parseMarketType("GG/NG - 3T")).toEqual({ base_key: "gg_ng", period: "3h", line: null });
  });

  it("still matches 'Pari/Dispari - 4T' (basket period 4)", () => {
    expect(parseMarketType("Pari/Dispari - 4T")).toEqual({ base_key: "odd_even", period: "4h", line: null });
  });
});

describe("parseMarketType — unknown", () => {
  it("returns null for unrecognised strings", () => {
    expect(parseMarketType("Qualche Mercato Esotico")).toBeNull();
    expect(parseMarketType("")).toBeNull();
  });
});

// ═══ Wave 13: Totale Home/Away, Multicalci d'angolo, last_scorer,
//                basket quarter (Punti totali, Handicap), trailing-dash fixes ═══

describe("parseMarketType — Wave 13 total_team Home/Away", () => {
  it("parses legacy 'Totale Home 3.5' → total_team_ft", () => {
    expect(parseMarketType("Totale Home 3.5")).toEqual({ base_key: "total_team", period: "ft", line: 3.5 });
  });

  it("parses legacy 'Totale Away 2' → total_team_ft (integer line)", () => {
    expect(parseMarketType("Totale Away 2")).toEqual({ base_key: "total_team", period: "ft", line: 2 });
  });

  it("parses legacy 'Totale Home 3.5 - 1T' → total_team_1h", () => {
    expect(parseMarketType("Totale Home 3.5 - 1T")).toEqual({ base_key: "total_team", period: "1h", line: 3.5 });
  });

  it("parses legacy 'Totale Away 2.5 - 2T' → total_team_2h", () => {
    expect(parseMarketType("Totale Away 2.5 - 2T")).toEqual({ base_key: "total_team", period: "2h", line: 2.5 });
  });

  it("parses legacy 'Totale Home 4.5' (higher line)", () => {
    expect(parseMarketType("Totale Home 4.5")).toEqual({ base_key: "total_team", period: "ft", line: 4.5 });
  });
});

describe("parseMarketType — Wave 13 total_corners Multicalci", () => {
  it("parses legacy \"Multicalci d'angolo (8.5)\" → total_corners_ft", () => {
    expect(parseMarketType("Multicalci d'angolo (8.5)")).toEqual({ base_key: "total_corners", period: "ft", line: 8.5 });
  });

  it("parses legacy \"Multicalci d'angolo (10.5) - \" with trailing dash → total_corners_ft", () => {
    expect(parseMarketType("Multicalci d'angolo (10.5) - ")).toEqual({ base_key: "total_corners", period: "ft", line: 10.5 });
  });

  it("parses legacy \"Multicalci d'angolo (30.5) - 1T\" → total_corners_1h", () => {
    expect(parseMarketType("Multicalci d'angolo (30.5) - 1T")).toEqual({ base_key: "total_corners", period: "1h", line: 30.5 });
  });

  it("parses Multicalci with typographic apostrophe", () => {
    expect(parseMarketType("Multicalci d’angolo (15.5)")).toEqual({ base_key: "total_corners", period: "ft", line: 15.5 });
  });
});

describe("parseMarketType — Wave 13 last_scorer", () => {
  it("parses legacy \"Chi Segnerà il L'ultimo Goal Della Partita?\" → last_scorer (ft)", () => {
    expect(parseMarketType("Chi Segnerà il L'ultimo Goal Della Partita?")).toEqual({ base_key: "last_scorer", period: "ft", line: null });
  });

  it("parses legacy with trailing dash variant \"... - \"", () => {
    expect(parseMarketType("Chi Segnerà il L'ultimo Goal Della Partita? - ")).toEqual({ base_key: "last_scorer", period: "ft", line: null });
  });

  it("tollera apostrofo tipografico", () => {
    expect(parseMarketType("Chi Segnerà il L’ultimo Goal Della Partita?")).toEqual({ base_key: "last_scorer", period: "ft", line: null });
  });
});

describe("parseMarketType — Wave 13 basket quarter totals + handicap", () => {
  // "Punti totali - N° Quarto X.5" (legacy basket points over/under per quarter)
  it("parses legacy 'Punti totali - 1° Quarto 40.5' → u_o_1h", () => {
    expect(parseMarketType("Punti totali - 1° Quarto 40.5")).toEqual({ base_key: "u_o", period: "1h", line: 40.5 });
  });

  it("parses legacy 'Punti totali - 4° Quarto 41.5' → u_o_4h", () => {
    expect(parseMarketType("Punti totali - 4° Quarto 41.5")).toEqual({ base_key: "u_o", period: "4h", line: 41.5 });
  });

  it("parses legacy 'Punti totali - 3° Quarto 40' (integer line) → u_o_3h", () => {
    expect(parseMarketType("Punti totali - 3° Quarto 40")).toEqual({ base_key: "u_o", period: "3h", line: 40 });
  });

  // "Handicap - N° Quarto (±X.5)" (legacy basket handicap, 2-way) — must NOT map to 1x2_handicap
  it("parses legacy 'Handicap - 1° Quarto (+1.5)' → 2way_handicap_1h (basket)", () => {
    expect(parseMarketType("Handicap - 1° Quarto (+1.5)")).toEqual({ base_key: "2way_handicap", period: "1h", line: 1.5 });
  });

  it("parses legacy 'Handicap - 3° Quarto (-1.5)' → 2way_handicap_3h", () => {
    expect(parseMarketType("Handicap - 3° Quarto (-1.5)")).toEqual({ base_key: "2way_handicap", period: "3h", line: -1.5 });
  });

  it("parses legacy 'Handicap - 4° Quarto (+1)' → 2way_handicap_4h (integer line)", () => {
    expect(parseMarketType("Handicap - 4° Quarto (+1)")).toEqual({ base_key: "2way_handicap", period: "4h", line: 1 });
  });

  // Regression: 'Handicap - 1° tempo' (calcio, 3-way) must still be 1x2_handicap
  it("does NOT break existing 'Handicap - 1° tempo (-1.5)' → 1x2_handicap_1h (calcio)", () => {
    expect(parseMarketType("Handicap - 1° tempo (-1.5)")).toEqual({ base_key: "1x2_handicap", period: "1h", line: -1.5 });
  });
});

describe("parseMarketType — Wave 13 trailing-dash permissive fixes", () => {
  // legacy emits trailing " - " (empty period fragment) due to scraper bug.
  // These patterns must treat it as if no period (→ ft).

  it("parses '(Totale Asiatico) 12.25 - ' (trailing dash) → asian_total_ft", () => {
    expect(parseMarketType("Totale Asiatico 12.25 - ")).toEqual({ base_key: "asian_total", period: "ft", line: 12.25 });
  });

  it("parses 'Squadra 1 Totale Asiatico (4.75) - ' (trailing dash) → total_team_asian_ft", () => {
    expect(parseMarketType("Squadra 1 Totale Asiatico (4.75) - ")).toEqual({ base_key: "total_team_asian", period: "ft", line: 4.75 });
  });

  it("parses 'Squadra 2 Totale Asiatico (3.25) - ' (trailing dash) → total_team_asian_ft", () => {
    expect(parseMarketType("Squadra 2 Totale Asiatico (3.25) - ")).toEqual({ base_key: "total_team_asian", period: "ft", line: 3.25 });
  });

  it("parses 'Sfida Al (7) - ' (trailing dash) → race_to_goals_ft", () => {
    expect(parseMarketType("Sfida Al (7) - ")).toEqual({ base_key: "race_to_goals", period: "ft", line: 7 });
  });

  // Existing behavior (no trailing) still works
  it("still parses 'Sfida Al (9)' (no trailing) → race_to_goals_ft", () => {
    expect(parseMarketType("Sfida Al (9)")).toEqual({ base_key: "race_to_goals", period: "ft", line: 9 });
  });

  it("still parses 'Squadra 1 Totale Asiatico (1.75)' (no trailing) → total_team_asian_ft", () => {
    expect(parseMarketType("Squadra 1 Totale Asiatico (1.75)")).toEqual({ base_key: "total_team_asian", period: "ft", line: 1.75 });
  });
});

describe("parseMarketType — Wave 13 T/T Handicap period 3h/4h (with new canonicals)", () => {
  it("parses legacy 'T/T Handicap (-2.5) - 3T' → 2way_handicap_3h", () => {
    expect(parseMarketType("T/T Handicap (-2.5) - 3T")).toEqual({ base_key: "2way_handicap", period: "3h", line: -2.5 });
  });

  it("parses legacy 'T/T Handicap (+1.5) - 4T' → 2way_handicap_4h", () => {
    expect(parseMarketType("T/T Handicap (+1.5) - 4T")).toEqual({ base_key: "2way_handicap", period: "4h", line: 1.5 });
  });

  // Wave 20: 11T → 1h for T/T Handicap (basket aggregate-half 2way handicap)
  it("Wave 20: legacy 'T/T Handicap (-2.5) - 11T' → 2way_handicap_1h line=-2.5", () => {
    expect(parseMarketType("T/T Handicap (-2.5) - 11T"))
      .toEqual({ base_key: "2way_handicap", period: "1h", line: -2.5 });
  });
});

// ═══ Wave 14: OT ("Supplementari inclusi" / "Including Overtime") patterns ═══

describe("parseMarketType — Wave 14 OT (Supplementari inclusi / Including Overtime)", () => {
  // Totale gol - Supplementari inclusi N → u_o_et
  it("parses legacy 'Totale gol - Supplementari inclusi 5.5' → u_o_et", () => {
    expect(parseMarketType("Totale gol - Supplementari inclusi 5.5")).toEqual({ base_key: "u_o", period: "et", line: 5.5 });
  });

  it("parses legacy 'Totale gol - Supplementari inclusi 8.5' → u_o_et", () => {
    expect(parseMarketType("Totale gol - Supplementari inclusi 8.5")).toEqual({ base_key: "u_o", period: "et", line: 8.5 });
  });

  // U/O Incl. Supp. N → u_o_et (abbreviated form)
  it("parses legacy 'U/O Incl. Supp. 164.5' → u_o_et", () => {
    expect(parseMarketType("U/O Incl. Supp. 164.5")).toEqual({ base_key: "u_o", period: "et", line: 164.5 });
  });

  // Risultato esatto - Supplementari inclusi → cs_et
  it("parses legacy 'Risultato esatto - Supplementari inclusi' → cs_et", () => {
    expect(parseMarketType("Risultato esatto - Supplementari inclusi")).toEqual({ base_key: "correct_score", period: "et", line: null });
  });

  // Entrambe le squadre segnano - Supplementari inclusi → gg_ng_et
  it("parses legacy 'Entrambe le squadre segnano - Supplementari inclusi' → gg_ng_et", () => {
    expect(parseMarketType("Entrambe le squadre segnano - Supplementari inclusi")).toEqual({ base_key: "gg_ng", period: "et", line: null });
  });

  // 1X2 con handicap - Supplementari inclusi (±N) → 1x2_h_et
  it("parses legacy '1X2 con handicap - Supplementari inclusi (-1)' → 1x2_h_et", () => {
    expect(parseMarketType("1X2 con handicap - Supplementari inclusi (-1)")).toEqual({ base_key: "1x2_handicap", period: "et", line: -1 });
  });

  it("parses legacy '1X2 con handicap - Supplementari inclusi (+2)' → 1x2_h_et", () => {
    expect(parseMarketType("1X2 con handicap - Supplementari inclusi (+2)")).toEqual({ base_key: "1x2_handicap", period: "et", line: 2 });
  });

  // Regression: existing "Tempo regolamentare" STILL maps to ft
  it("still maps '1x2 con Handicap - Tempo regolamentare (-2)' to 1x2_h_ft (not et)", () => {
    expect(parseMarketType("1x2 con Handicap - Tempo regolamentare (-2)")).toEqual({ base_key: "1x2_handicap", period: "ft", line: -2 });
  });

  // Handicap - 2nd Half - Including Overtime (±X) — composite period: 2h + OT
  // Semantically 2nd-half-incl-OT. Catalog has no `_2h_et`. Expected null gracefully.
  // (Skip test — out of scope Wave 14; mapping strategy TBD)
});

// ═══ Wave 15: last_goal_ft, winner alias, own_goal canonicals ═══

describe("parseMarketType — Wave 15 Ultimo Goal / Vittoria Squadra / Autogol", () => {
  it("parses legacy 'Ultimo Goal' → last_goal_ft (new canonical)", () => {
    expect(parseMarketType("Ultimo Goal")).toEqual({ base_key: "last_goal", period: "ft", line: null });
  });

  it("parses legacy 'Vittoria Squadra' → winner_ft (existing canonical)", () => {
    expect(parseMarketType("Vittoria Squadra")).toEqual({ base_key: "winner", period: "ft", line: null });
  });

  it("parses legacy 'Autogol' → own_goal_ft (new canonical)", () => {
    expect(parseMarketType("Autogol")).toEqual({ base_key: "own_goal", period: "ft", line: null });
  });

  // Regression: existing 'Ultimo Goal - 1T' / '- 2T' still maps to last_goal_1h/2h
  it("regression: 'Ultimo Goal - 1T' → last_goal_1h", () => {
    expect(parseMarketType("Ultimo Goal - 1T")).toEqual({ base_key: "last_goal", period: "1h", line: null });
  });

  it("regression: 'Ultimo Goal - 2T' → last_goal_2h", () => {
    expect(parseMarketType("Ultimo Goal - 2T")).toEqual({ base_key: "last_goal", period: "2h", line: null });
  });
});

// ═══ Wave 16: high-volume patterns — 95% coverage push (2026-04-21 night) ═══

describe("parseMarketType — Wave 16 high-volume additions", () => {
  it("parses 'Entrambe Le Squadre Segnano In Entrambi i Tempi' → btts_both_halves_ft", () => {
    expect(parseMarketType("Entrambe Le Squadre Segnano In Entrambi i Tempi"))
      .toEqual({ base_key: "btts_both_halves", period: "ft", line: null });
  });

  it("parses 'Squadre Goal' → team_goal_combo_ft", () => {
    expect(parseMarketType("Squadre Goal"))
      .toEqual({ base_key: "team_goal_combo", period: "ft", line: null });
  });

  it("parses 'Tempo Con il Maggior Numero Di Punti' → highest_scoring_half_ft", () => {
    expect(parseMarketType("Tempo Con il Maggior Numero Di Punti"))
      .toEqual({ base_key: "highest_scoring_half", period: "ft", line: null });
  });

  it("parses 'Modalità Di Vittoria' → way_of_winning_ft", () => {
    expect(parseMarketType("Modalità Di Vittoria"))
      .toEqual({ base_key: "way_of_winning", period: "ft", line: null });
  });

  it("parses 'Chi Vincerà il Lancio Della Monetina' → coin_toss_winner_ft", () => {
    expect(parseMarketType("Chi Vincerà il Lancio Della Monetina"))
      .toEqual({ base_key: "coin_toss_winner", period: "ft", line: null });
  });

  it("parses 'Totale Mappe (2.5)' → total_maps_ft line=2.5", () => {
    expect(parseMarketType("Totale Mappe (2.5)"))
      .toEqual({ base_key: "total_maps", period: "ft", line: 2.5 });
  });

  it("parses 'Totale Mappe (1.5)' → total_maps_ft line=1.5", () => {
    expect(parseMarketType("Totale Mappe (1.5)"))
      .toEqual({ base_key: "total_maps", period: "ft", line: 1.5 });
  });

  it("parses 'Chi Segnerà il Primo Goal Della Partita?' → first_scorer_team_ft", () => {
    expect(parseMarketType("Chi Segnerà il Primo Goal Della Partita?"))
      .toEqual({ base_key: "first_scorer_team", period: "ft", line: null });
  });

  // Trailing-dash permissive (legacy emits "Chi Segnerà il Primo Goal Della Partita? - ")
  it("parses trailing-dash form 'Chi Segnerà il Primo Goal Della Partita? - ' → first_scorer_team_ft", () => {
    expect(parseMarketType("Chi Segnerà il Primo Goal Della Partita? - "))
      .toEqual({ base_key: "first_scorer_team", period: "ft", line: null });
  });

  it("parses 'Qualificazione' → qualification_ft", () => {
    expect(parseMarketType("Qualificazione"))
      .toEqual({ base_key: "qualification", period: "ft", line: null });
  });

  // Existing winner rule now resolves to winner_3h/4h via new canonicals
  it("parses 'Vincente Incontro - 3T' → winner_3h (via existing rule, new canonical)", () => {
    expect(parseMarketType("Vincente Incontro - 3T"))
      .toEqual({ base_key: "winner", period: "3h", line: null });
  });

  it("parses 'Vincente Incontro - 4T' → winner_4h", () => {
    expect(parseMarketType("Vincente Incontro - 4T"))
      .toEqual({ base_key: "winner", period: "4h", line: null });
  });

  // Existing correct_score rule now resolves to cs_3h/4h via new canonicals
  it("parses 'Risultato Esatto - 3T' → cs_3h (via existing rule, new canonical)", () => {
    expect(parseMarketType("Risultato Esatto - 3T"))
      .toEqual({ base_key: "correct_score", period: "3h", line: null });
  });

  it("parses 'Risultato Esatto - 4T' → cs_4h", () => {
    expect(parseMarketType("Risultato Esatto - 4T"))
      .toEqual({ base_key: "correct_score", period: "4h", line: null });
  });
});

describe("parseMarketType — Wave 16 legacy aliases", () => {
  it("parses 'Match Odds' → 1x2_ft", () => {
    expect(parseMarketType("Match Odds"))
      .toEqual({ base_key: "1x2", period: "ft", line: null });
  });

  it("parses 'Esito dell'incontro' → 1x2_ft", () => {
    expect(parseMarketType("Esito dell'incontro"))
      .toEqual({ base_key: "1x2", period: "ft", line: null });
  });

  it("parses 'Esito Finale 1x2 - Tempo regolamentare' → 1x2_ft", () => {
    expect(parseMarketType("Esito Finale 1x2 - Tempo regolamentare"))
      .toEqual({ base_key: "1x2", period: "ft", line: null });
  });

  it("parses 'Tempi regolamentari - 1X2' → 1x2_ft", () => {
    expect(parseMarketType("Tempi regolamentari - 1X2"))
      .toEqual({ base_key: "1x2", period: "ft", line: null });
  });

  it("parses 'Doppia Chance - Tempo regolamentare' → dc_ft", () => {
    expect(parseMarketType("Doppia Chance - Tempo regolamentare"))
      .toEqual({ base_key: "dc", period: "ft", line: null });
  });

  it("parses '1° Quarto' → 1x2_1h (basketball quarter 1X2)", () => {
    expect(parseMarketType("1° Quarto"))
      .toEqual({ base_key: "1x2", period: "1h", line: null });
  });

  it("parses '4° Quarto' → 1x2_4h", () => {
    expect(parseMarketType("4° Quarto"))
      .toEqual({ base_key: "1x2", period: "4h", line: null });
  });

  it("parses 'Risultato al termine del 4° Quarto' → winner_4h", () => {
    expect(parseMarketType("Risultato al termine del 4° Quarto"))
      .toEqual({ base_key: "winner", period: "4h", line: null });
  });

  it("parses 'Draw No Bet - 3° Quarto' → dnb_3h", () => {
    expect(parseMarketType("Draw No Bet - 3° Quarto"))
      .toEqual({ base_key: "dnb", period: "3h", line: null });
  });

  it("parses 'Draw No Bet - 4° Quarto' → dnb_4h", () => {
    expect(parseMarketType("Draw No Bet - 4° Quarto"))
      .toEqual({ base_key: "dnb", period: "4h", line: null });
  });

  it("'1° Set' routes to set_n_winner, NOT 1X2 (outcomes are player names; Wave 35 canonical)", () => {
    expect(parseMarketType("1° Set"))
      .toEqual({ base_key: "set_n_winner", period: "ft", line: 1 });
  });
});

describe("parseMarketType — Wave 16 Maps family", () => {
  it("parses 'Totale Mappe Handicap (-1.5)' → maps_handicap_ft line=-1.5", () => {
    expect(parseMarketType("Totale Mappe Handicap (-1.5)"))
      .toEqual({ base_key: "maps_handicap", period: "ft", line: -1.5 });
  });

  it("parses 'Handicap Mappa (-1.5)' → maps_handicap_ft", () => {
    expect(parseMarketType("Handicap Mappa (-1.5)"))
      .toEqual({ base_key: "maps_handicap", period: "ft", line: -1.5 });
  });

  it("parses 'Map Handicap (+1.5)' → maps_handicap_ft", () => {
    expect(parseMarketType("Map Handicap (+1.5)"))
      .toEqual({ base_key: "maps_handicap", period: "ft", line: 1.5 });
  });

  it("parses 'Totale Mappe Pari/Dispari' → maps_oe_ft", () => {
    expect(parseMarketType("Totale Mappe Pari/Dispari"))
      .toEqual({ base_key: "maps_oe", period: "ft", line: null });
  });

  it("parses 'Total Maps (Odd/Even)' → maps_oe_ft", () => {
    expect(parseMarketType("Total Maps (Odd/Even)"))
      .toEqual({ base_key: "maps_oe", period: "ft", line: null });
  });

  it("parses 'Mappe totali 2.5' → total_maps_ft line=2.5", () => {
    expect(parseMarketType("Mappe totali 2.5"))
      .toEqual({ base_key: "total_maps", period: "ft", line: 2.5 });
  });

  it("parses 'Total Maps 2.5' → total_maps_ft line=2.5", () => {
    expect(parseMarketType("Total Maps 2.5"))
      .toEqual({ base_key: "total_maps", period: "ft", line: 2.5 });
  });

  it("parses 'Map 1' → map_winner_ft line=1", () => {
    expect(parseMarketType("Map 1"))
      .toEqual({ base_key: "map_winner", period: "ft", line: 1 });
  });

  it("parses 'Mappa 2' → map_winner_ft line=2", () => {
    expect(parseMarketType("Mappa 2"))
      .toEqual({ base_key: "map_winner", period: "ft", line: 2 });
  });

  it("parses 'Risultato esatto: Mappa' → cs_map_ft", () => {
    expect(parseMarketType("Risultato esatto: Mappa"))
      .toEqual({ base_key: "cs_map", period: "ft", line: null });
  });
});

describe("parseMarketType — Wave 16 tennis + cards + penalty families", () => {
  it("parses 'Totale giochi 22.5' → total_games_ft line=22.5", () => {
    expect(parseMarketType("Totale giochi 22.5"))
      .toEqual({ base_key: "total_games", period: "ft", line: 22.5 });
  });

  it("parses 'Totale giochi nel 1° set 9.5' → total_games_set1_ft line=9.5", () => {
    expect(parseMarketType("Totale giochi nel 1° set 9.5"))
      .toEqual({ base_key: "total_games_set1", period: "ft", line: 9.5 });
  });

  it("parses 'Totale giochi nel 3° set 10.5' → total_games_set3_ft line=10.5", () => {
    expect(parseMarketType("Totale giochi nel 3° set 10.5"))
      .toEqual({ base_key: "total_games_set3", period: "ft", line: 10.5 });
  });

  it("parses 'Totale set 2.5' → total_sets_ft line=2.5", () => {
    expect(parseMarketType("Totale set 2.5"))
      .toEqual({ base_key: "total_sets", period: "ft", line: 2.5 });
  });

  it("parses 'Totale cartellini 4.5' → total_cards_ft line=4.5", () => {
    expect(parseMarketType("Totale cartellini 4.5"))
      .toEqual({ base_key: "total_cards", period: "ft", line: 4.5 });
  });

  it("parses 'Cartellino rosso assegnato' → red_card_given_ft", () => {
    expect(parseMarketType("Cartellino rosso assegnato"))
      .toEqual({ base_key: "red_card_given", period: "ft", line: null });
  });

  it("parses 'Almeno un calcio di rigore assegnato' → penalty_awarded_ft", () => {
    expect(parseMarketType("Almeno un calcio di rigore assegnato"))
      .toEqual({ base_key: "penalty_awarded", period: "ft", line: null });
  });

  it("parses 'Piú cartellini' (acute accent) → more_cards_ft", () => {
    expect(parseMarketType("Piú cartellini"))
      .toEqual({ base_key: "more_cards", period: "ft", line: null });
  });

  it("parses 'Più giochi' (grave accent) → more_games_ft", () => {
    expect(parseMarketType("Più giochi"))
      .toEqual({ base_key: "more_games", period: "ft", line: null });
  });

  it("parses 'Pareggio ed entrambe le squadre a segno (Gol/No Gol)' → draw_and_btts_ft", () => {
    expect(parseMarketType("Pareggio ed entrambe le squadre a segno (Gol/No Gol)"))
      .toEqual({ base_key: "draw_and_btts", period: "ft", line: null });
  });

  it("parses 'Entrambe le squadre realizzano almeno 2 gol - Tempi regolamentari' → team_goals_min_ft line=2", () => {
    expect(parseMarketType("Entrambe le squadre realizzano almeno 2 gol - Tempi regolamentari"))
      .toEqual({ base_key: "team_goals_min", period: "ft", line: 2 });
  });

  it("parses 'Gol totali - Tempo Regolamentare 4.5' → u_o_ft line=4.5", () => {
    expect(parseMarketType("Gol totali - Tempo Regolamentare 4.5"))
      .toEqual({ base_key: "u_o", period: "ft", line: 4.5 });
  });
});

describe("parseMarketType — Wave 17 compound + minute + multi-goal", () => {
  it("parses 'PT-F + Totale (2.5)' → htft_and_total_ft line=2.5", () => {
    expect(parseMarketType("PT-F + Totale (2.5)"))
      .toEqual({ base_key: "htft_and_total", period: "ft", line: 2.5 });
  });

  it("parses 'Handicap 1 + Totale (2.5)' → handicap_and_total_ft line=2.5", () => {
    expect(parseMarketType("Handicap 1 + Totale (2.5)"))
      .toEqual({ base_key: "handicap_and_total", period: "ft", line: 2.5 });
  });

  it("parses 'Handicap 2 + Totale - 1T' → handicap_and_total_1h line=null", () => {
    expect(parseMarketType("Handicap 2 + Totale - 1T"))
      .toEqual({ base_key: "handicap_and_total", period: "1h", line: null });
  });

  it("parses 'Handicap 1 + Totale - ' (trailing dash) → handicap_and_total_ft", () => {
    expect(parseMarketType("Handicap 1 + Totale - "))
      .toEqual({ base_key: "handicap_and_total", period: "ft", line: null });
  });

  it("parses 'Doppia Chance + Totale (5.5)' → dc_and_total_ft line=5.5", () => {
    expect(parseMarketType("Doppia Chance + Totale (5.5)"))
      .toEqual({ base_key: "dc_and_total", period: "ft", line: 5.5 });
  });

  it("parses 'Entrambe A Segno Sì/No + Totale (2.5)' → btts_and_total_ft line=2.5", () => {
    expect(parseMarketType("Entrambe A Segno Sì/No + Totale (2.5)"))
      .toEqual({ base_key: "btts_and_total", period: "ft", line: 2.5 });
  });

  it("parses 'Entrambe Le Squadre a Segno + Totale (3.5)' → btts_and_total_ft line=3.5", () => {
    expect(parseMarketType("Entrambe Le Squadre a Segno + Totale (3.5)"))
      .toEqual({ base_key: "btts_and_total", period: "ft", line: 3.5 });
  });

  it("parses 'Multi Goal' → multi_goal_ft", () => {
    expect(parseMarketType("Multi Goal"))
      .toEqual({ base_key: "multi_goal", period: "ft", line: null });
  });

  it("parses 'Multi Goal - 1T' → multi_goal_1h", () => {
    expect(parseMarketType("Multi Goal - 1T"))
      .toEqual({ base_key: "multi_goal", period: "1h", line: null });
  });

  it("parses 'Squadra 1, Multi Goal - 2T' → team1_multi_goal_2h", () => {
    expect(parseMarketType("Squadra 1, Multi Goal - 2T"))
      .toEqual({ base_key: "team1_multi_goal", period: "2h", line: null });
  });

  it("parses 'Squadra 2, Multi Goal' → team2_multi_goal_ft", () => {
    expect(parseMarketType("Squadra 2, Multi Goal"))
      .toEqual({ base_key: "team2_multi_goal", period: "ft", line: null });
  });

  it("parses 'Risultato Al Minuto (30)' → minute_result_ft line=30", () => {
    expect(parseMarketType("Risultato Al Minuto (30)"))
      .toEqual({ base_key: "minute_result", period: "ft", line: 30 });
  });

  it("parses 'Tempo Del Primo Goal' → time_of_first_goal_ft", () => {
    expect(parseMarketType("Tempo Del Primo Goal"))
      .toEqual({ base_key: "time_of_first_goal", period: "ft", line: null });
  });

  it("parses 'Totale Goal Nei Tempi (1.5)' → halves_both_ou_ft line=1.5", () => {
    expect(parseMarketType("Totale Goal Nei Tempi (1.5)"))
      .toEqual({ base_key: "halves_both_ou", period: "ft", line: 1.5 });
  });

  it("parses 'Vince Il Suo Primo Turno Di Servizio - 1T' → first_serve_hold_1h", () => {
    expect(parseMarketType("Vince Il Suo Primo Turno Di Servizio - 1T"))
      .toEqual({ base_key: "first_serve_hold", period: "1h", line: null });
  });

  it("parses 'Goal Intervallo - Sì' → goal_interval_ft", () => {
    expect(parseMarketType("Goal Intervallo - Sì"))
      .toEqual({ base_key: "goal_interval", period: "ft", line: null });
  });

  it("parses 'Goal Intervallo - No (46.06)' → goal_interval_ft", () => {
    expect(parseMarketType("Goal Intervallo - No (46.06)"))
      .toEqual({ base_key: "goal_interval", period: "ft", line: null });
  });

  it("parses 'Goal Nell'intervallo Di Tempo - Sì/No' → goal_interval_ft", () => {
    expect(parseMarketType("Goal Nell'intervallo Di Tempo - Sì/No"))
      .toEqual({ base_key: "goal_interval", period: "ft", line: null });
  });

  it("parses 'Vittoria Di' (no line) → win_by_margin_grid_ft", () => {
    expect(parseMarketType("Vittoria Di"))
      .toEqual({ base_key: "win_by_margin_grid", period: "ft", line: null });
  });

  // Regression: existing "Vittoria Di (N)" still maps to win_by_margin_ft line=N
  it("regression: 'Vittoria Di (3)' still maps to win_by_margin_ft line=3", () => {
    expect(parseMarketType("Vittoria Di (3)"))
      .toEqual({ base_key: "win_by_margin", period: "ft", line: 3 });
  });
});

describe("parseMarketType — Wave 18 additional families", () => {
  it("parses 'Gol Nel Tempo' → first_goal_half_ft", () => {
    expect(parseMarketType("Gol Nel Tempo"))
      .toEqual({ base_key: "first_goal_half", period: "ft", line: null });
  });

  it("parses 'Momento In Cui Viene Realizzato Il Secondo Goal' → second_goal_time_ft", () => {
    expect(parseMarketType("Momento In Cui Viene Realizzato Il Secondo Goal"))
      .toEqual({ base_key: "second_goal_time", period: "ft", line: null });
  });

  it("parses 'Individuale Totale 1 Numero Esatto Di Goal (2) - 1T' → team1_exact_goals_1h", () => {
    expect(parseMarketType("Individuale Totale 1 Numero Esatto Di Goal (2) - 1T"))
      .toEqual({ base_key: "team1_exact_goals", period: "1h", line: null });
  });

  it("parses 'Individuale Totale 2 Numero Esatto Di Goal (3) - 2T' → team2_exact_goals_2h", () => {
    expect(parseMarketType("Individuale Totale 2 Numero Esatto Di Goal (3) - 2T"))
      .toEqual({ base_key: "team2_exact_goals", period: "2h", line: null });
  });

  it("parses 'Numero Esatto - 1T' → exact_total_halves_1h", () => {
    expect(parseMarketType("Numero Esatto - 1T"))
      .toEqual({ base_key: "exact_total_halves", period: "1h", line: null });
  });

  it("parses 'Numero Esatto - 2T' → exact_total_halves_2h", () => {
    expect(parseMarketType("Numero Esatto - 2T"))
      .toEqual({ base_key: "exact_total_halves", period: "2h", line: null });
  });

  it("parses 'Totale Esatto - ' → exact_total_grid_ft", () => {
    expect(parseMarketType("Totale Esatto - "))
      .toEqual({ base_key: "exact_total_grid", period: "ft", line: null });
  });

  it("parses 'Set / Partita' → set_match_combo_ft", () => {
    expect(parseMarketType("Set / Partita"))
      .toEqual({ base_key: "set_match_combo", period: "ft", line: null });
  });

  it("parses 'Individuale Totale 1 Pari /Dispari - 1T' → team1_total_oe_1h", () => {
    expect(parseMarketType("Individuale Totale 1 Pari /Dispari - 1T"))
      .toEqual({ base_key: "team1_total_oe", period: "1h", line: null });
  });

  it("parses 'Vittoria Di (1) - 2T' → win_by_margin_2h line=1", () => {
    expect(parseMarketType("Vittoria Di (1) - 2T"))
      .toEqual({ base_key: "win_by_margin", period: "2h", line: 1 });
  });

  it("parses 'Vittoria o Pareggio Al Minuto (30)' → minute_win_or_draw_ft line=30", () => {
    expect(parseMarketType("Vittoria o Pareggio Al Minuto (30)"))
      .toEqual({ base_key: "minute_win_or_draw", period: "ft", line: 30 });
  });

  it("parses 'Totale Al Minuto' (no line) → minute_total_grid_ft", () => {
    expect(parseMarketType("Totale Al Minuto"))
      .toEqual({ base_key: "minute_total_grid", period: "ft", line: null });
  });

  it("parses 'Totale Al Minuto (50.03)' → minute_total_grid_ft (grid)", () => {
    expect(parseMarketType("Totale Al Minuto (50.03)"))
      .toEqual({ base_key: "minute_total_grid", period: "ft", line: null });
  });

  it("parses 'Totale Al Minuto - ' (trailing dash) → minute_total_grid_ft", () => {
    expect(parseMarketType("Totale Al Minuto - "))
      .toEqual({ base_key: "minute_total_grid", period: "ft", line: null });
  });

  it("parses 'Segna In Entrambi i Tempi - ' (trailing dash) → both_halves_score_ft", () => {
    expect(parseMarketType("Segna In Entrambi i Tempi - "))
      .toEqual({ base_key: "both_halves_score", period: "ft", line: null });
  });

  it("parses 'Prossimo Calcio D'angolo (1) - ' (trailing dash) → next_corner_ft line=1", () => {
    expect(parseMarketType("Prossimo Calcio D'angolo (1) - "))
      .toEqual({ base_key: "next_corner", period: "ft", line: 1 });
  });
});

// ═══ Wave 35 — set winners, set handicaps, consecutive goals, extra time ═══
describe("parseMarketType — Wave 35 set winners", () => {
  it("parses legacy '1° Set' → set_n_winner_ft line=1", () => {
    expect(parseMarketType("1° Set"))
      .toEqual({ base_key: "set_n_winner", period: "ft", line: 1 });
  });

  it("parses legacy '2° Set' → set_n_winner_ft line=2", () => {
    expect(parseMarketType("2° Set"))
      .toEqual({ base_key: "set_n_winner", period: "ft", line: 2 });
  });

  it("parses legacy '5° Set' → set_n_winner_ft line=5 (tennis 5-setter)", () => {
    expect(parseMarketType("5° Set"))
      .toEqual({ base_key: "set_n_winner", period: "ft", line: 5 });
  });

  it("parses legacy 'Set 2' (alternative form) → set_n_winner_ft line=2", () => {
    expect(parseMarketType("Set 2"))
      .toEqual({ base_key: "set_n_winner", period: "ft", line: 2 });
  });

  it("parses legacy 'Set 3' → set_n_winner_ft line=3", () => {
    expect(parseMarketType("Set 3"))
      .toEqual({ base_key: "set_n_winner", period: "ft", line: 3 });
  });
});

describe("parseMarketType — Wave 35 set handicap", () => {
  it("parses legacy 'Handicap sui Set (-1.5)' → set_handicap_ft line=-1.5", () => {
    expect(parseMarketType("Handicap sui Set (-1.5)"))
      .toEqual({ base_key: "set_handicap", period: "ft", line: -1.5 });
  });

  it("parses legacy 'Handicap sui Set (+1.5)' → set_handicap_ft line=1.5", () => {
    expect(parseMarketType("Handicap sui Set (+1.5)"))
      .toEqual({ base_key: "set_handicap", period: "ft", line: 1.5 });
  });

  it("parses legacy 'Handicap sui Set (-2.5)' → set_handicap_ft line=-2.5", () => {
    expect(parseMarketType("Handicap sui Set (-2.5)"))
      .toEqual({ base_key: "set_handicap", period: "ft", line: -2.5 });
  });
});

describe("parseMarketType — Wave 35 consecutive goals (any team)", () => {
  it("parses legacy 'Goal Di Seguito Di Una Squadra (2)' → any_team_consecutive_goals_ft line=2", () => {
    expect(parseMarketType("Goal Di Seguito Di Una Squadra (2)"))
      .toEqual({ base_key: "any_team_consecutive_goals", period: "ft", line: 2 });
  });

  it("parses legacy 'Goal Di Seguito Di Una Squadra (3)' → any_team_consecutive_goals_ft line=3", () => {
    expect(parseMarketType("Goal Di Seguito Di Una Squadra (3)"))
      .toEqual({ base_key: "any_team_consecutive_goals", period: "ft", line: 3 });
  });

  it("does not mis-match existing 'Squadra 1, X Goal Di Seguito'-style (team-specific stays unmatched by this rule)", () => {
    // Team-specific variants are out of Wave 35 scope. This rule must ignore them
    // (they fall through to other rules or stay unmapped). Main point: the
    // 'Di Una Squadra' phrasing is the any-team marker.
    const r = parseMarketType("Squadra 1 Goal Consecutivi");
    // should NOT match our new rule (different base_key if it matches anything else)
    expect(r?.base_key).not.toBe("any_team_consecutive_goals");
  });
});

describe("parseMarketType — Wave 35 extra time yes/no per period", () => {
  it("parses legacy 'Ci Saranno i Supplementari - Sì/No' (no period) → extra_time_yn_ft", () => {
    expect(parseMarketType("Ci Saranno i Supplementari - Sì/No"))
      .toEqual({ base_key: "extra_time_yn", period: "ft", line: null });
  });

  it("parses legacy 'Ci Saranno i Supplementari - Sì/No - 1T' → extra_time_yn_1h", () => {
    expect(parseMarketType("Ci Saranno i Supplementari - Sì/No - 1T"))
      .toEqual({ base_key: "extra_time_yn", period: "1h", line: null });
  });

  it("parses legacy 'Ci Saranno i Supplementari - Sì/No - 2T' → extra_time_yn_2h", () => {
    expect(parseMarketType("Ci Saranno i Supplementari - Sì/No - 2T"))
      .toEqual({ base_key: "extra_time_yn", period: "2h", line: null });
  });

  it("parses legacy 'Ci Saranno i Supplementari - Sì/No - 3T' → extra_time_yn_3h", () => {
    expect(parseMarketType("Ci Saranno i Supplementari - Sì/No - 3T"))
      .toEqual({ base_key: "extra_time_yn", period: "3h", line: null });
  });

  it("tolerates 'Si' without accent (ASCII fallback)", () => {
    expect(parseMarketType("Ci Saranno i Supplementari - Si/No"))
      .toEqual({ base_key: "extra_time_yn", period: "ft", line: null });
  });
});

