import { describe, expect, test } from "vitest";
import { buildScores } from "@/lib/settlement/odds-api/settle-leg";
import { classifyLeg } from "@/lib/settlement/odds-api/classify";

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

  test("football cumulative-corruption guard rejects halfScoreHome > score_home", () => {
    const result = buildScores({
      score_home: 1,
      score_away: 0,
      period_scores: null,
      live_data: { halfScoreHome: [2, 2], halfScoreAway: [0, 0] },
      sport_slug: "football",
      period: null,
    });
    expect(result?.ht_home).toBeNull();
    expect(result?.ht_away).toBeNull();
  });

  test("tennis halfScoreHome[0] > score_home is valid (sets vs games)", () => {
    // Tennis: score_home/away = sets won (2:0), halfScoreHome[0] = games in set 1 (6)
    // Legitimately 6 > 2; guard must not fire for non-football.
    const result = buildScores({
      score_home: 2,
      score_away: 0,
      period_scores: null,
      live_data: { halfScoreHome: [6, 6], halfScoreAway: [4, 3] },
      sport_slug: "tennis",
      period: null,
    });
    expect(result?.ht_home).toBe(6);
    expect(result?.ht_away).toBe(4);
  });
});

describe("buildScores → classifyLeg integration (HT markets via live_data)", () => {
  test("Half Time Result from football live_data.periods", () => {
    const scores = buildScores({
      score_home: 2,
      score_away: 1,
      period_scores: null,
      live_data: {
        periods: [
          { name: "1 Tempo", homeScore: 1, awayScore: 0 },
          { name: "2 Tempo", homeScore: 1, awayScore: 1 },
        ],
      },
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Half Time Result", outcome_name: "home", line: null },
      scores,
    );
    expect(v.verdict).toBe("won");
  });

  test("Totals HT from football live_data.periods", () => {
    const scores = buildScores({
      score_home: 3,
      score_away: 1,
      period_scores: null,
      live_data: {
        periods: [
          { name: "1 Tempo", homeScore: 1, awayScore: 1 },
          { name: "2 Tempo", homeScore: 2, awayScore: 0 },
        ],
      },
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Totals HT", outcome_name: "over", line: 1.5 },
      scores,
    );
    expect(v.verdict).toBe("won"); // HT total 1+1=2 > 1.5
  });

  test("BTTS HT from football live_data.periods", () => {
    const scores = buildScores({
      score_home: 1,
      score_away: 0,
      period_scores: null,
      live_data: {
        periods: [{ name: "1 Tempo", homeScore: 1, awayScore: 0 }],
      },
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Both Teams To Score HT", outcome_name: "no", line: null },
      scores,
    );
    expect(v.verdict).toBe("won"); // HT 1-0, no BTTS
  });

  test("Half Time Result returns null when live_data missing periods + halfScore", () => {
    const scores = buildScores({
      score_home: 1,
      score_away: 1,
      period_scores: null,
      live_data: null,
      sport_slug: "football",
      period: null,
    })!;
    const v = classifyLeg(
      { market_type: "Half Time Result", outcome_name: "home", line: null },
      scores,
    );
    expect(v.verdict).toBeNull();
    expect(v.reason).toBe("ht_scores_missing");
  });
});
