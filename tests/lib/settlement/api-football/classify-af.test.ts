// M3.3 + M3.4 + M3.5 — Unit tests for classifyLegAF dispatcher.
//
// Coverage:
//   - Bucket A score-derived (1x2, totals, btts, dc, dnb, htft, cs, oddeven,
//     team_total*, exact_total_goals, first_team_to_score, method_of_victory,
//     HT variants, 2H variants, 3-way aliases)
//   - Bucket B statistics-derived (corners family, cards/bookings, shots,
//     shots-on-target, offsides, fouls, gk saves, handicaps)
//   - Bucket C player props (to_score_2plus, to_score_3plus, player_shots,
//     player_shots_on_target, player_to_be_booked, player_fouls,
//     player_to_be_fouled, player_tackles, player_to_assist, team_goalscorer,
//     goal_method)
//   - Edge cases: missing HT data, missing stats, missing players, unknown
//     market type, void outcomes

import { describe, it, expect } from "vitest";
import { classifyLegAF } from "@/lib/settlement/api-football/classify-af";
import type { BetLeg } from "@/lib/settlement/odds-api/classify";
import type { AFResult } from "@/lib/settlement/api-football/build-result-af";

// ════════════════════════════════════════════════════════════════════
// Fixtures
// ════════════════════════════════════════════════════════════════════

const FULL: AFResult = {
  home: 2,
  away: 1,
  ht_home: 1,
  ht_away: 0,
  home_stats: {
    shots: 14,
    shots_on_target: 6,
    corners: 7,
    offsides: 3,
    fouls: 12,
    cards_yellow: 2,
    cards_red: 0,
    cards_total: 2,
    goalkeeper_saves: 4,
  },
  away_stats: {
    shots: 9,
    shots_on_target: 3,
    corners: 4,
    offsides: 5,
    fouls: 15,
    cards_yellow: 3,
    cards_red: 1,
    cards_total: 4,
    goalkeeper_saves: 7,
  },
  shots_home: 14,
  shots_away: 9,
  sot_home: 6,
  sot_away: 3,
  corners_home: 7,
  corners_away: 4,
  cards_home: 2,
  cards_away: 4,
  offsides_home: 3,
  offsides_away: 5,
  fouls_home: 12,
  fouls_away: 15,
  gk_saves_home: 4,
  gk_saves_away: 7,
  players_af_ft: [
    {
      team: { name: "Home FC" },
      players: [
        {
          player: { id: 101, name: "Mario Rossi" },
          statistics: [
            {
              games: { minutes: 90 },
              shots: { total: 4, on: 2 },
              goals: { total: 2, assists: 1 },
              fouls: { committed: 1, drawn: 3 },
              cards: { yellow: 0, red: 0 },
              tackles: { total: 2 },
            },
          ],
        },
        {
          player: { id: 102, name: "Luigi Bianchi" },
          statistics: [
            {
              shots: { total: 2, on: 0 },
              goals: { total: 0, assists: 0 },
              fouls: { committed: 3, drawn: 0 },
              cards: { yellow: 1, red: 0 },
              tackles: { total: 5 },
            },
          ],
        },
      ],
    },
    {
      team: { name: "Away FC" },
      players: [
        {
          player: { id: 201, name: "Paolo Verdi" },
          statistics: [
            {
              shots: { total: 3, on: 1 },
              goals: { total: 1, assists: 0 },
              fouls: { committed: 2, drawn: 1 },
              cards: { yellow: 1, red: 1 },
              tackles: { total: 1 },
            },
          ],
        },
      ],
    },
  ],
  events_af: [
    {
      time: { elapsed: 12 },
      team: { name: "Home FC" },
      type: "Goal",
      detail: "Normal Goal",
      player: { name: "Mario Rossi" },
    },
    {
      time: { elapsed: 67 },
      team: { name: "Away FC" },
      type: "Goal",
      detail: "Penalty",
      player: { name: "Paolo Verdi" },
    },
    {
      time: { elapsed: 85 },
      team: { name: "Home FC" },
      type: "Goal",
      detail: "Normal Goal",
      player: { name: "Mario Rossi" },
    },
  ],
};

function leg(market_type: string, outcome_name: string, line: number | null = null): BetLeg {
  return { market_type, outcome_name, line };
}

// ════════════════════════════════════════════════════════════════════
// Bucket A — score-derived
// ════════════════════════════════════════════════════════════════════

describe("classifyLegAF — Bucket A (score-derived)", () => {
  it("1x2: home win", () => {
    expect(classifyLegAF(leg("1x2", "1"), FULL).verdict).toBe("won");
  });
  it("1x2: away wrong → lost", () => {
    expect(classifyLegAF(leg("1x2", "2"), FULL).verdict).toBe("lost");
  });
  it("ml: alias of 1x2", () => {
    expect(classifyLegAF(leg("ml", "1"), FULL).verdict).toBe("won");
  });
  it("3way_result: alias of 1x2", () => {
    expect(classifyLegAF(leg("3way_result", "X"), FULL).verdict).toBe("lost");
  });
  it("1x2_ht: home leads at HT", () => {
    expect(classifyLegAF(leg("1x2_ht", "1"), FULL).verdict).toBe("won");
  });
  it("1x2_ht: defers when ht missing", () => {
    const r = { ...FULL, ht_home: null, ht_away: null };
    const out = classifyLegAF(leg("1x2_ht", "1"), r);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("ht_scores_missing");
  });
  it("1x2_2h: 2H score 1-1 → draw", () => {
    // FT 2-1, HT 1-0 → 2H 1-1 → draw
    expect(classifyLegAF(leg("1x2_2h", "X"), FULL).verdict).toBe("won");
  });
  it("totals: Over 2.5 with 3 goals → won", () => {
    expect(classifyLegAF(leg("totals", "Over", 2.5), FULL).verdict).toBe("won");
  });
  it("totals: Under 2.5 with 3 goals → lost", () => {
    expect(classifyLegAF(leg("totals", "Under", 2.5), FULL).verdict).toBe("lost");
  });
  it("totals_ht: Over 0.5 HT (1-0) → won", () => {
    expect(classifyLegAF(leg("totals_ht", "Over", 0.5), FULL).verdict).toBe("won");
  });
  it("totals_2h: Over 1.5 2H (1-1=2) → won", () => {
    expect(classifyLegAF(leg("totals_2h", "Over", 1.5), FULL).verdict).toBe("won");
  });
  it("btts: yes — both teams scored → won", () => {
    expect(classifyLegAF(leg("btts", "Yes"), FULL).verdict).toBe("won");
  });
  it("btts_ht: at HT 1-0 → no → won", () => {
    expect(classifyLegAF(leg("btts_ht", "No"), FULL).verdict).toBe("won");
  });
  it("btts_2h: 2H 1-1 → yes wins", () => {
    expect(classifyLegAF(leg("btts_2h", "Yes"), FULL).verdict).toBe("won");
  });
  it("double_chance: 1X with home win → won", () => {
    expect(classifyLegAF(leg("double_chance", "1X"), FULL).verdict).toBe("won");
  });
  it("draw_no_bet: home win → won (no draw)", () => {
    expect(classifyLegAF(leg("draw_no_bet", "1"), FULL).verdict).toBe("won");
  });
  it("draw_no_bet voids when match drawn", () => {
    const r = { ...FULL, home: 1, away: 1 };
    expect(classifyLegAF(leg("draw_no_bet", "1"), r).verdict).toBe("void");
  });
  it("correct_score: 2-1 matched", () => {
    expect(classifyLegAF(leg("correct_score", "2-1"), FULL).verdict).toBe("won");
  });
  it("correct_score: 1-1 wrong → lost", () => {
    expect(classifyLegAF(leg("correct_score", "1-1"), FULL).verdict).toBe("lost");
  });
  it("ht_ft: 1/1 (HT 1-0, FT 2-1) → won", () => {
    expect(classifyLegAF(leg("ht_ft", "1/1"), FULL).verdict).toBe("won");
  });
  it("odd_even: total 3 → odd → won", () => {
    expect(classifyLegAF(leg("odd_even", "odd"), FULL).verdict).toBe("won");
  });
  it("team_total_home: Over 1.5 with home=2 → won", () => {
    expect(classifyLegAF(leg("team_total_home", "Over", 1.5), FULL).verdict).toBe("won");
  });
  it("team_total_goals_away: Under 1.5 with away=1 → won", () => {
    expect(classifyLegAF(leg("team_total_goals_away", "Under", 1.5), FULL).verdict).toBe("won");
  });
  it("team_total_goals_home_ht: Over 0.5 (HT 1) → won", () => {
    expect(classifyLegAF(leg("team_total_goals_home_ht", "Over", 0.5), FULL).verdict).toBe("won");
  });
  it("exact_total_goals: outcome '3' with total 3 → won", () => {
    expect(classifyLegAF(leg("exact_total_goals", "3"), FULL).verdict).toBe("won");
  });
  it("exact_total_goals: outcome '4' with total 3 → lost", () => {
    expect(classifyLegAF(leg("exact_total_goals", "4"), FULL).verdict).toBe("lost");
  });
  it("first_team_to_score: literal team name 'Home FC' matches first goal", () => {
    expect(classifyLegAF(leg("first_team_to_score", "Home FC"), FULL).verdict).toBe("won");
  });
  it("first_team_to_score: defers on '1' (no literal name)", () => {
    const out = classifyLegAF(leg("first_team_to_score", "1"), FULL);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("outcome_requires_literal_team_name");
  });
  it("method_of_victory: normal (no shootout / ET) → won", () => {
    expect(classifyLegAF(leg("method_of_victory", "Normal"), FULL).verdict).toBe("won");
  });
  it("method_of_victory: extra time when 95' goal present", () => {
    const r = {
      ...FULL,
      events_af: [
        { time: { elapsed: 95 }, team: { name: "Home FC" }, type: "Goal", detail: "Normal Goal" },
      ],
    };
    expect(classifyLegAF(leg("method_of_victory", "Extra Time"), r).verdict).toBe("won");
  });
});

// ════════════════════════════════════════════════════════════════════
// Bucket B — statistics-derived
// ════════════════════════════════════════════════════════════════════

describe("classifyLegAF — Bucket B (statistics-derived)", () => {
  it("total_corners: Over 10.5 (7+4=11) → won", () => {
    expect(classifyLegAF(leg("total_corners", "Over", 10.5), FULL).verdict).toBe("won");
  });
  it("total_corners: defers when stats missing", () => {
    const r = { ...FULL, corners_home: undefined, corners_away: undefined };
    const out = classifyLegAF(leg("total_corners", "Over", 10.5), r);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("statistics_af_missing");
  });
  it("total_corners_ht: always defers (no HT split)", () => {
    expect(classifyLegAF(leg("total_corners_ht", "Over", 4.5), FULL).reason).toBe(
      "statistics_af_missing"
    );
  });
  it("corners_totals_home: Over 6.5 (home=7) → won", () => {
    expect(classifyLegAF(leg("corners_totals_home", "Over", 6.5), FULL).verdict).toBe("won");
  });
  it("corners_totals_away: Over 4.5 (away=4) → lost", () => {
    expect(classifyLegAF(leg("corners_totals_away", "Over", 4.5), FULL).verdict).toBe("lost");
  });
  it("corners_spread: home -2.5 (7-4=3 margin) → won", () => {
    expect(classifyLegAF(leg("corners_spread", "1", -2.5), FULL).verdict).toBe("won");
  });
  it("corner_handicap: away +2.5 with 4 → 6.5 vs 7 home → lost", () => {
    expect(classifyLegAF(leg("corner_handicap", "2", 2.5), FULL).verdict).toBe("lost");
  });
  it("corner_1x2: home has more corners → '1' wins", () => {
    expect(classifyLegAF(leg("corner_1x2", "1"), FULL).verdict).toBe("won");
  });
  it("corner_2way: alias of corner_1x2", () => {
    expect(classifyLegAF(leg("corner_2way", "2"), FULL).verdict).toBe("lost");
  });
  it("bookings_totals: Over 5.5 (2+4=6) → won", () => {
    expect(classifyLegAF(leg("bookings_totals", "Over", 5.5), FULL).verdict).toBe("won");
  });
  it("bookings_totals_home: Over 2.5 (home=2) → lost", () => {
    expect(classifyLegAF(leg("bookings_totals_home", "Over", 2.5), FULL).verdict).toBe("lost");
  });
  it("team_cards_away: Over 3.5 (away=4) → won", () => {
    expect(classifyLegAF(leg("team_cards_away", "Over", 3.5), FULL).verdict).toBe("won");
  });
  it("bookings_spread: home -1.5 cards (2-4=-2 margin) → lost", () => {
    expect(classifyLegAF(leg("bookings_spread", "1", -1.5), FULL).verdict).toBe("lost");
  });
  it("number_of_cards: 'Exactly 6' with total 6 → won", () => {
    // detectOUSide returns null, fall through to N exact match
    expect(classifyLegAF(leg("number_of_cards", "Exactly 6"), FULL).verdict).toBe("won");
  });
  it("total_shots: Over 22.5 (14+9=23) → won", () => {
    expect(classifyLegAF(leg("total_shots", "Over", 22.5), FULL).verdict).toBe("won");
  });
  it("total_shots_home: Over 13.5 (14) → won", () => {
    expect(classifyLegAF(leg("total_shots_home", "Over", 13.5), FULL).verdict).toBe("won");
  });
  it("team_shots_away: Under 10 (9) → won", () => {
    expect(classifyLegAF(leg("team_shots_away", "Under", 10), FULL).verdict).toBe("won");
  });
  it("total_shots_on_target: Over 8.5 (6+3=9) → won", () => {
    expect(classifyLegAF(leg("total_shots_on_target", "Over", 8.5), FULL).verdict).toBe("won");
  });
  it("total_shots_on_target_home: Over 5.5 (6) → won", () => {
    expect(classifyLegAF(leg("total_shots_on_target_home", "Over", 5.5), FULL).verdict).toBe("won");
  });
  it("most_shots_on_target: '1' (home has 6 vs 3) → won", () => {
    expect(classifyLegAF(leg("most_shots_on_target", "1"), FULL).verdict).toBe("won");
  });
  it("total_offsides: Over 7.5 (3+5=8) → won", () => {
    expect(classifyLegAF(leg("total_offsides", "Over", 7.5), FULL).verdict).toBe("won");
  });
  it("team_offsides_home: Under 4 (3) → won", () => {
    expect(classifyLegAF(leg("team_offsides_home", "Under", 4), FULL).verdict).toBe("won");
  });
  it("total_fouls: Over 26.5 (12+15=27) → won", () => {
    expect(classifyLegAF(leg("total_fouls", "Over", 26.5), FULL).verdict).toBe("won");
  });
  it("total_fouls_away: Over 14.5 (15) → won", () => {
    expect(classifyLegAF(leg("total_fouls_away", "Over", 14.5), FULL).verdict).toBe("won");
  });
  it("goalkeeper_saves_home: Under 5.5 (4) → won", () => {
    expect(classifyLegAF(leg("goalkeeper_saves_home", "Under", 5.5), FULL).verdict).toBe("won");
  });
  it("goalkeeper_saves_away: Over 6.5 (7) → won", () => {
    expect(classifyLegAF(leg("goalkeeper_saves_away", "Over", 6.5), FULL).verdict).toBe("won");
  });
  it("asian_handicap: home -0.5 with score 2-1 → won", () => {
    expect(classifyLegAF(leg("asian_handicap", "1", -0.5), FULL).verdict).toBe("won");
  });
  it("asian_handicap: quarter line -0.25 home → won", () => {
    // home -0.25 = avg of (0) and (-0.5). At 2-1: 0 line → won (2>1), -0.5 → won → won
    expect(classifyLegAF(leg("asian_handicap", "1", -0.25), FULL).verdict).toBe("won");
  });
  it("european_handicap: home -1, score 2-1 → 1-1 → draw → X wins", () => {
    expect(classifyLegAF(leg("european_handicap", "X", -1), FULL).verdict).toBe("won");
  });
  it("spread: away +1.5, score 2-1 → 2-2.5 → 2 wins by spread", () => {
    expect(classifyLegAF(leg("spread", "2", 1.5), FULL).verdict).toBe("won");
  });
  it("goal_line: Over 3 (total 3) → void", () => {
    expect(classifyLegAF(leg("goal_line", "Over", 3), FULL).verdict).toBe("void");
  });
});

// ════════════════════════════════════════════════════════════════════
// Bucket C — player props
// ════════════════════════════════════════════════════════════════════

describe("classifyLegAF — Bucket C (player props)", () => {
  it("to_score_2plus_goals: Mario Rossi (2 goals) → won", () => {
    expect(classifyLegAF(leg("to_score_2plus_goals", "Mario Rossi"), FULL).verdict).toBe("won");
  });
  it("to_score_2plus_goals: Luigi Bianchi (0 goals) → lost", () => {
    expect(classifyLegAF(leg("to_score_2plus_goals", "Luigi Bianchi"), FULL).verdict).toBe("lost");
  });
  it("to_score_3plus_goals: Mario Rossi (2 goals) → lost", () => {
    expect(classifyLegAF(leg("to_score_3plus_goals", "Mario Rossi"), FULL).verdict).toBe("lost");
  });
  it("player_shots: Mario Rossi Over 3.5 (4 shots) → won", () => {
    expect(classifyLegAF(leg("player_shots", "Mario Rossi Over 3.5"), FULL).verdict).toBe("won");
  });
  it("player_shots: Mario Rossi line via leg.line", () => {
    expect(
      classifyLegAF(leg("player_shots", "Mario Rossi Over", 3.5), FULL).verdict
    ).toBe("won");
  });
  it("player_shots_on_target: Mario Rossi Over 1.5 (2 SOT) → won", () => {
    expect(
      classifyLegAF(leg("player_shots_on_target", "Mario Rossi Over 1.5"), FULL).verdict
    ).toBe("won");
  });
  it("player_to_be_booked: Luigi Bianchi (1 yellow) → won", () => {
    expect(classifyLegAF(leg("player_to_be_booked", "Luigi Bianchi"), FULL).verdict).toBe("won");
  });
  it("player_to_be_booked: Mario Rossi (no cards) → lost", () => {
    expect(classifyLegAF(leg("player_to_be_booked", "Mario Rossi"), FULL).verdict).toBe("lost");
  });
  it("player_fouls: Luigi Bianchi Over 2.5 (3 fouls) → won", () => {
    expect(classifyLegAF(leg("player_fouls", "Luigi Bianchi Over 2.5"), FULL).verdict).toBe("won");
  });
  it("player_to_be_fouled: Mario Rossi Over 2.5 (3 fouls drawn) → won", () => {
    expect(
      classifyLegAF(leg("player_to_be_fouled", "Mario Rossi Over 2.5"), FULL).verdict
    ).toBe("won");
  });
  it("player_tackles: Luigi Bianchi Over 4.5 (5 tackles) → won", () => {
    expect(classifyLegAF(leg("player_tackles", "Luigi Bianchi Over 4.5"), FULL).verdict).toBe("won");
  });
  it("player_to_assist: Mario Rossi (1 assist) → won", () => {
    expect(classifyLegAF(leg("player_to_assist", "Mario Rossi"), FULL).verdict).toBe("won");
  });
  it("player_to_assist: Luigi Bianchi (0 assists) → lost", () => {
    expect(classifyLegAF(leg("player_to_assist", "Luigi Bianchi"), FULL).verdict).toBe("lost");
  });
  it("team_goalscorer: Home FC scored → won", () => {
    expect(classifyLegAF(leg("team_goalscorer", "Home FC"), FULL).verdict).toBe("won");
  });
  it("team_goalscorer: Nonexistent FC → lost", () => {
    expect(classifyLegAF(leg("team_goalscorer", "Nonexistent FC"), FULL).verdict).toBe("lost");
  });
  it("goal_method: first goal 'Normal Goal' → won", () => {
    expect(classifyLegAF(leg("goal_method", "Normal Goal"), FULL).verdict).toBe("won");
  });
  it("goal_method: 'Penalty' lost (first was normal)", () => {
    expect(classifyLegAF(leg("goal_method", "Penalty"), FULL).verdict).toBe("lost");
  });
});

// ════════════════════════════════════════════════════════════════════
// Edge cases
// ════════════════════════════════════════════════════════════════════

describe("classifyLegAF — edge cases", () => {
  it("unknown market_type → null + reason market_type_not_supported_af", () => {
    const out = classifyLegAF(leg("not_a_real_market", "Yes"), FULL);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("market_type_not_supported_af");
  });
  it("Bucket C: defers when players_af_ft missing", () => {
    const r = { ...FULL, players_af_ft: undefined };
    const out = classifyLegAF(leg("to_score_2plus_goals", "Mario Rossi"), r);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("players_af_missing");
  });
  it("first_team_to_score defers when events_af missing", () => {
    const r = { ...FULL, events_af: undefined };
    const out = classifyLegAF(leg("first_team_to_score", "Home FC"), r);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("events_af_missing");
  });
  it("team_goalscorer defers when events_af missing", () => {
    const r = { ...FULL, events_af: undefined };
    const out = classifyLegAF(leg("team_goalscorer", "Home FC"), r);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("events_af_missing");
  });
  it("goal_method on 0-0 game → void", () => {
    const r = { ...FULL, home: 0, away: 0, events_af: [] };
    expect(classifyLegAF(leg("goal_method", "Normal Goal"), r).verdict).toBe("void");
  });
  it("player_shots: player not in feed → null + reason", () => {
    const out = classifyLegAF(leg("player_shots", "Ghost Player Over 2.5"), FULL);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("player_not_found");
  });
  it("Bucket B handicap with quarter line → null", () => {
    // settleStatHandicap rejects quarter lines via settleHandicap2Way internal guard
    const out = classifyLegAF(leg("corners_spread", "1", -2.25), FULL);
    expect(out.verdict).toBeNull();
  });
  it("totals: invalid outcome 'Maybe' → null reason outcome_unrecognized", () => {
    const out = classifyLegAF(leg("totals", "Maybe", 2.5), FULL);
    expect(out.verdict).toBeNull();
    expect(out.reason).toBe("outcome_unrecognized");
  });
  it("player_to_be_booked: 'Player Name No' form → wins when not booked", () => {
    expect(
      classifyLegAF(leg("player_to_be_booked", "Mario Rossi No"), FULL).verdict
    ).toBe("won");
  });
  it("AFResult zero stats (0-0 game with empty events) classifies correctly", () => {
    const r: AFResult = { ...FULL, home: 0, away: 0, events_af: [] };
    expect(classifyLegAF(leg("1x2", "X"), r).verdict).toBe("won");
    expect(classifyLegAF(leg("btts", "No"), r).verdict).toBe("won");
  });
});
