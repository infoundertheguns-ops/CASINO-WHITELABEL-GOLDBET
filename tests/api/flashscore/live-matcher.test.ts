import { describe, it, expect } from "vitest";
import { computeEnrichmentUpdate, findFuzzyMatch } from "@/app/api/flashscore/live/_lib";
import type { FlashscoreLive } from "@/lib/flashscore";

const baseEv = {
  id: "evt-1",
  home: "Inter",
  away: "Milan",
  score_home: null,
  score_away: null,
  starts_at: "2026-05-06T20:00:00Z",
  period: null,
  minute: null,
  live_data: null,
  flashscore_id: null,
};

const baseFs: FlashscoreLive = {
  matchId: "fs-1",
  homeTeam: "Inter",
  awayTeam: "Milan",
  scoreHome: 1,
  scoreAway: 0,
  periods: [[1, 0]],
  timestamp: 0,
  stageCode: "2",
  country: "",
  league: "",
  sport: "",
};

describe("computeEnrichmentUpdate", () => {
  it("returns null update when nothing has changed", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 1, score_away: 0, period: "1T", live_data: { halfScoreHome: [1], halfScoreAway: [0] } },
      fs: baseFs,
      sport: "calcio",
    });
    expect(update).toBeNull();
  });

  it("sets period from periods.length when DB has none", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [[1, 0]] },
      sport: "calcio",
    });
    expect(update?.period).toBe("1T");
  });

  it("merges halfScoreHome/Away into live_data", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [[1, 0], [2, 1]] },
      sport: "calcio",
    });
    const ld = update?.live_data as Record<string, unknown>;
    expect(ld.halfScoreHome).toEqual([1, 2]);
    expect(ld.halfScoreAway).toEqual([0, 1]);
  });

  it("preserves existing live_data keys not touched by FS", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, live_data: { stats: [{ name: "Corners", home: 5, away: 3 }] } },
      fs: { ...baseFs, periods: [[1, 0]] },
      sport: "calcio",
    });
    const ld = update?.live_data as Record<string, unknown>;
    expect(ld.stats).toEqual([{ name: "Corners", home: 5, away: 3 }]);
    expect(ld.halfScoreHome).toEqual([1]);
  });

  it("overwrites score when DB null", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, scoreHome: 2, scoreAway: 1 },
      sport: "calcio",
    });
    expect(update?.score_home).toBe(2);
    expect(update?.score_away).toBe(1);
  });

  it("does NOT overwrite score when DB already has values (non-tennis)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 3, score_away: 2 },
      fs: { ...baseFs, scoreHome: 9, scoreAway: 9 },
      sport: "calcio",
    });
    expect(update?.score_home).toBeUndefined();
    expect(update?.score_away).toBeUndefined();
  });

  it("DOES overwrite tennis score when DB looks like game-points (>=15)", () => {
    const { update } = computeEnrichmentUpdate({
      ev: { ...baseEv, score_home: 30, score_away: 15 },
      fs: { ...baseFs, scoreHome: 1, scoreAway: 0 },
      sport: "tennis",
    });
    expect(update?.score_home).toBe(1);
    expect(update?.score_away).toBe(0);
  });

  it("derives Frame N for snooker from score sum", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [], scoreHome: 2, scoreAway: 1 },
      sport: "snooker",
    });
    expect(update?.period).toBe("Frame 4");
  });

  it("derives Leg N for darts from score sum", () => {
    const { update } = computeEnrichmentUpdate({
      ev: baseEv,
      fs: { ...baseFs, periods: [], scoreHome: 1, scoreAway: 2 },
      sport: "freccette",
    });
    expect(update?.period).toBe("Leg 4");
  });
});

describe("findFuzzyMatch", () => {
  const liveCandidates: FlashscoreLive[] = [
    { ...baseFs, matchId: "fs-a", homeTeam: "Inter Milano", awayTeam: "AC Milan", timestamp: new Date(baseEv.starts_at).getTime() / 1000 },
    { ...baseFs, matchId: "fs-b", homeTeam: "Roma", awayTeam: "Lazio", timestamp: new Date(baseEv.starts_at).getTime() / 1000 },
  ];

  it("returns best-scoring fuzzy match within window", () => {
    const result = findFuzzyMatch(baseEv, liveCandidates, new Set());
    expect(result.idx).toBe(0);
    expect(result.score).toBeGreaterThan(1.0);
  });

  it("skips already-used candidates", () => {
    const result = findFuzzyMatch(baseEv, liveCandidates, new Set([0]));
    expect(result.idx).toBe(-1);
  });

  it("rejects matches outside ±4h window", () => {
    const farPast = liveCandidates.map((c) => ({ ...c, timestamp: 86400 })); // 1970-01-02 — non-zero so window check runs
    const result = findFuzzyMatch(baseEv, farPast, new Set());
    expect(result.idx).toBe(-1);
  });

  it("rejects when team-name score below threshold", () => {
    const wrong = [{ ...baseFs, matchId: "fs-c", homeTeam: "Bayern", awayTeam: "Dortmund", timestamp: new Date(baseEv.starts_at).getTime() / 1000 }];
    const result = findFuzzyMatch(baseEv, wrong, new Set());
    expect(result.idx).toBe(-1);
  });
});
