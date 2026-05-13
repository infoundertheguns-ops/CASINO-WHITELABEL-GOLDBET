import { describe, expect, test } from "vitest";
import { buildScores } from "@/lib/settlement/odds-api/settle-leg";

describe("buildScores — period-source priority", () => {
  test("legacy period_scores column wins when populated", () => {
    const result = buildScores({
      score_home: 2,
      score_away: 1,
      period_scores: { "1H": { home: 1, away: 0 } },
      live_data: { halfScoreHome: [9, 9], halfScoreAway: [9, 9] },
      sport_slug: "football",
      period: null,
    });
    expect(result?.ht_home).toBe(1);
    expect(result?.ht_away).toBe(0);
  });

  test("football falls back to live_data.periods name='1 Tempo'", () => {
    const result = buildScores({
      score_home: 2,
      score_away: 0,
      period_scores: null,
      live_data: {
        periods: [
          { name: "1 Tempo", homeScore: 1, awayScore: 0 },
          { name: "2 Tempo", homeScore: 1, awayScore: 0 },
        ],
      },
      sport_slug: "football",
      period: null,
    });
    expect(result?.ht_home).toBe(1);
    expect(result?.ht_away).toBe(0);
  });

  test("tennis uses live_data.halfScoreHome[0] for first set", () => {
    const result = buildScores({
      score_home: 2,
      score_away: 0,
      period_scores: null,
      live_data: { halfScoreHome: [6, 7], halfScoreAway: [4, 6] },
      sport_slug: "tennis",
      period: null,
    });
    expect(result?.ht_home).toBe(6);
    expect(result?.ht_away).toBe(4);
    expect(result?.period_scores_home).toEqual([6, 7]);
    expect(result?.period_scores_away).toEqual([4, 6]);
  });

  test("returns null when score_home or score_away missing", () => {
    expect(buildScores({
      score_home: null,
      score_away: 1,
      period_scores: null,
      live_data: null,
      sport_slug: "football",
      period: null,
    })).toBeNull();
  });

  test("no period data anywhere → ht_home/away null but result valid", () => {
    const result = buildScores({
      score_home: 1,
      score_away: 1,
      period_scores: null,
      live_data: null,
      sport_slug: "football",
      period: null,
    });
    expect(result).not.toBeNull();
    expect(result?.ht_home).toBeNull();
    expect(result?.ht_away).toBeNull();
  });
});
